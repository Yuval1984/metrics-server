import express from "express";
import crypto from "crypto";
import pkg from "pg";

const { Pool } = pkg;

const router = express.Router();
router.use(express.json());

// ---------- DB POOL ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render requires SSL in production; locally it's fine without
  ssl:
    process.env.PGSSL === "require" ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// ---------- API KEYS ----------
const API_KEYS = process.env.API_KEYS ? JSON.parse(process.env.API_KEYS) : {};

function requireKey(req, res, next) {
  if (!Object.keys(API_KEYS).length) return next();
  const want = API_KEYS[req.params.app];
  const got = req.header("x-api-key");
  if (!want || got !== want) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ---------- SCHEMA MIGRATION ----------
const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  app           text       NOT NULL,
  session_id    uuid       PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ended         boolean    NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sessions_app_started ON sessions (app, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_app_lastseen ON sessions (app, last_seen_at);
`;

async function ensureSchema() {
  await pool.query(MIGRATION);
}
ensureSchema().catch((e) => {
  console.error("Schema init failed:", e);
});

// ---------- HELPERS ----------
const rid = () => crypto.randomUUID();

/** Aggregate one day in UTC */
async function aggregateDay(app, day) {
  // day: 'YYYY-MM-DD' (UTC)
  const params = [app, day];

  // total visits & total duration
  const totalsQ = `
    SELECT
      COUNT(*)::int AS visits,
      COALESCE(SUM(EXTRACT(EPOCH FROM (last_seen_at - started_at)) * 1000), 0)::bigint AS total_ms
    FROM sessions
    WHERE app = $1
      AND ((started_at AT TIME ZONE 'UTC')::date = $2::date);
  `;

  // per-hour buckets (by hour of START time, in UTC)
  const hoursQ = `
    SELECT
      TO_CHAR(date_trunc('hour', started_at AT TIME ZONE 'UTC'), 'HH24') AS hour,
      COUNT(*)::int AS visits
    FROM sessions
    WHERE app = $1
      AND ((started_at AT TIME ZONE 'UTC')::date = $2::date)
    GROUP BY 1
    ORDER BY 1;
  `;

  const [totals, hours] = await Promise.all([
    pool.query(totalsQ, params),
    pool.query(hoursQ, params),
  ]);

  const totalVisits = totals.rows[0]?.visits || 0;
  const totalDurationMs = Number(totals.rows[0]?.total_ms || 0);

  const hourBuckets = {};
  for (const r of hours.rows) hourBuckets[r.hour] = r.visits;

  return {
    day,
    hourBuckets,
    totalVisits,
    totalDurationMs,
    avgDurationMs: totalVisits ? Math.round(totalDurationMs / totalVisits) : 0,
  };
}

async function aggregateRange(app, fromDay, toDay) {
  const start = new Date(fromDay + "T00:00:00Z");
  const end = new Date(toDay + "T00:00:00Z");
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    out.push(await aggregateDay(app, day));
  }
  return out;
}

// ---------- ROUTES ----------

// Start session
router.post("/:app/start", requireKey, async (req, res) => {
  const app = req.params.app;
  const sessionId = rid();
  await pool.query(
    `INSERT INTO sessions (app, session_id) VALUES ($1, $2)`,
    [app, sessionId]
  );
  res.json({ sessionId });
});

// Heartbeat
router.post("/:app/heartbeat", requireKey, async (req, res) => {
  const app = req.params.app;
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });

  await pool.query(
    `UPDATE sessions
       SET last_seen_at = GREATEST(last_seen_at, now())
     WHERE app = $1 AND session_id = $2`,
    [app, sessionId]
  );
  // even if not found, return 204 to keep client simple
  res.sendStatus(204);
});

// End session
router.post("/:app/end", requireKey, async (req, res) => {
  const app = req.params.app;
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });

  await pool.query(
    `UPDATE sessions
       SET ended = true, last_seen_at = GREATEST(last_seen_at, now())
     WHERE app = $1 AND session_id = $2`,
    [app, sessionId]
  );
  res.sendStatus(204);
});

// Stats
router.get("/:app/stats", requireKey, async (req, res) => {
  const app = req.params.app;
  const { day, from, to } = req.query;

  if (day) {
    return res.json({ tz: "UTC", days: [await aggregateDay(app, String(day))] });
  }
  if (from && to) {
    return res.json({ tz: "UTC", days: await aggregateRange(app, String(from), String(to)) });
  }
  const today = new Date().toISOString().slice(0, 10);
  res.json({ tz: "UTC", days: [await aggregateDay(app, today)] });
});

// Reset (delete) — requires app key to be configured
router.delete("/:app/reset", requireKey, async (req, res) => {
  const app = req.params.app;

  if (!API_KEYS[app]) {
    return res.status(403).json({ error: "reset requires an API key configured for this app" });
  }

  const { day } = req.query;
  if (day) {
    await pool.query(
      `DELETE FROM sessions
        WHERE app = $1
          AND ((started_at AT TIME ZONE 'UTC')::date = $2::date)`,
      [app, String(day)]
    );
    return res.json({ ok: true, cleared: { app, day: String(day) } });
  } else {
    await pool.query(`DELETE FROM sessions WHERE app = $1`, [app]);
    return res.json({ ok: true, cleared: { app, allDays: true } });
  }
});

export default router;
