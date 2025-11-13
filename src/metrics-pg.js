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

async function requireKey(req, res, next) {
  const got = req.header("x-api-key");
  if (!got) return res.status(401).json({ error: "API key required" });
  
  const app = req.params.app;
  
  try {
    // First check database for API key (prioritize database over env)
    const result = await pool.query('SELECT api_key FROM api_keys WHERE app = $1', [app]);
    if (result.rows.length > 0) {
      const dbKey = result.rows[0].api_key;
      if (got !== dbKey) return res.status(401).json({ error: "unauthorized" });
      return next();
    }
    
    // Then check environment variable API_KEYS (for backward compatibility)
    const envKey = API_KEYS[app];
    if (envKey) {
      if (got !== envKey) return res.status(401).json({ error: "unauthorized" });
      return next();
    }
    
    // If no API key found in DB or env, allow any key (for new apps)
    return next();
  } catch (error) {
    console.error("Error checking API key:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
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

CREATE TABLE IF NOT EXISTS api_keys (
  app           text       PRIMARY KEY,
  api_key       text       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_app_started ON sessions (app, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_app_lastseen ON sessions (app, last_seen_at);
`;

// Add new columns separately with error handling
const ADD_COLUMNS = [
  'ALTER TABLE sessions ADD COLUMN country text',
  'ALTER TABLE sessions ADD COLUMN city text', 
  'ALTER TABLE sessions ADD COLUMN device_type text',
  'ALTER TABLE sessions ADD COLUMN user_agent text',
  'ALTER TABLE sessions ADD COLUMN ip_address text'
];

const ADD_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions (country)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_device_type ON sessions (device_type)'
];

async function ensureSchema() {
  try {
    // Create base table
    await pool.query(MIGRATION);
    console.log("Base schema initialized successfully");
    
    // Add columns one by one
    for (const sql of ADD_COLUMNS) {
      try {
        await pool.query(sql);
      } catch (e) {
        if (e.code === '42701') { // duplicate column
          console.log(`Column already exists: ${sql}`);
        } else {
          console.error(`Failed to add column: ${sql}`, e);
        }
      }
    }
    
    // Add indexes
    for (const sql of ADD_INDEXES) {
      try {
        await pool.query(sql);
      } catch (e) {
        console.log(`Index already exists or failed: ${sql}`);
      }
    }
    
    console.log("Schema migration completed");
  } catch (e) {
    console.error("Schema init failed:", e);
    throw e;
  }
}
ensureSchema().catch((e) => {
  console.error("Schema init failed:", e);
});

// ---------- HELPERS ----------
const rid = () => crypto.randomUUID();

const detectDeviceType = (userAgent) => {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile';
  }
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'tablet';
  }
  return 'desktop';
};

const getClientInfo = (req) => {
  const userAgent = req.get('User-Agent') || '';
  const ipAddress = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
    (req.connection.socket ? req.connection.socket.remoteAddress : null) || 'unknown';
  
  return {
    userAgent,
    ipAddress,
    deviceType: detectDeviceType(userAgent)
  };
};

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

  // device types count per day
  const deviceTypesQ = `
    SELECT
      CASE 
        WHEN device_type = 'desktop' THEN 'pc'
        WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
        ELSE NULL
      END AS mapped_device_type,
      COUNT(*)::int AS visits
    FROM sessions
    WHERE app = $1
      AND ((started_at AT TIME ZONE 'UTC')::date = $2::date)
      AND device_type IS NOT NULL
      AND device_type IN ('mobile', 'desktop', 'pc', 'tablet')
    GROUP BY 
      CASE 
        WHEN device_type = 'desktop' THEN 'pc'
        WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
        ELSE NULL
      END;
  `;

  const [totals, hours, deviceTypesResult] = await Promise.all([
    pool.query(totalsQ, params),
    pool.query(hoursQ, params),
    pool.query(deviceTypesQ, params),
  ]);

  const totalVisits = totals.rows[0]?.visits || 0;
  const totalDurationMs = Number(totals.rows[0]?.total_ms || 0);

  const hourBuckets = {};
  for (const r of hours.rows) hourBuckets[r.hour] = r.visits;

  // Build deviceTypes object
  const deviceTypes = { mobile: 0, pc: 0, tablet: 0 };
  for (const r of deviceTypesResult.rows) {
    if (r.mapped_device_type === 'mobile' || r.mapped_device_type === 'pc' || r.mapped_device_type === 'tablet') {
      deviceTypes[r.mapped_device_type] = r.visits;
    }
  }

  return {
    day,
    hourBuckets,
    totalVisits,
    totalDurationMs,
    avgDurationMs: totalVisits ? Math.round(totalDurationMs / totalVisits) : 0,
    deviceTypes,
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
  const clientInfo = getClientInfo(req);
  const apiKey = req.header("x-api-key");
  
  // Extract country and city from request body if provided, otherwise use defaults
  const { country, city } = req.body || {};
  
  try {
    // Store API key in database (upsert - insert or update)
    await pool.query(
      `INSERT INTO api_keys (app, api_key) VALUES ($1, $2) 
       ON CONFLICT (app) DO UPDATE SET api_key = $2`,
      [app, apiKey]
    );
    
    // Start the session
    await pool.query(
      `INSERT INTO sessions (app, session_id, country, city, device_type, user_agent, ip_address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [app, sessionId, country || 'unknown', city || 'unknown', clientInfo.deviceType, clientInfo.userAgent, clientInfo.ipAddress]
    );
    
    res.json({ sessionId });
  } catch (error) {
    console.error("Error starting session:", error);
    res.status(500).json({ error: "Failed to start session" });
  }
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

// Real-time status - active sessions
router.get("/:app/status", requireKey, async (req, res) => {
  const app = req.params.app;
  
  const activeSessionsQ = `
    SELECT 
      session_id,
      started_at,
      last_seen_at,
      country,
      city,
      device_type,
      ip_address,
      EXTRACT(EPOCH FROM (now() - last_seen_at))::int AS seconds_since_last_seen,
      EXTRACT(EPOCH FROM (now() - started_at))::int AS session_duration_seconds
    FROM sessions 
    WHERE app = $1 
      AND ended = false
      AND last_seen_at > now() - interval '5 minutes'
    ORDER BY last_seen_at DESC;
  `;
  
  const result = await pool.query(activeSessionsQ, [app]);
  
  // Count device types from active sessions
  const deviceTypes = { mobile: 0, pc: 0, tablet: 0 };
  for (const row of result.rows) {
    const mappedDeviceType = row.device_type === 'desktop' ? 'pc' : (row.device_type || 'unknown');
    if (mappedDeviceType === 'mobile' || mappedDeviceType === 'pc' || mappedDeviceType === 'tablet') {
      deviceTypes[mappedDeviceType] = (deviceTypes[mappedDeviceType] || 0) + 1;
    }
  }
  
  res.json({
    app,
    activeSessions: result.rows.length,
    sessions: result.rows.map(row => ({
      sessionId: row.session_id,
      startedAt: row.started_at,
      lastSeenAt: row.last_seen_at,
      country: row.country,
      city: row.city,
      deviceType: row.device_type,
      ipAddress: row.ip_address,
      secondsSinceLastSeen: row.seconds_since_last_seen,
      sessionDurationSeconds: row.session_duration_seconds
    })),
    deviceTypes
  });
});

// Analytics by location and device
router.get("/:app/analytics", requireKey, async (req, res) => {
  const app = req.params.app;
  const { from, to } = req.query;
  
  let dateFilter = '';
  let params = [app];
  
  if (from && to) {
    // Use last_seen_at so sessions active during the window are counted,
    // even if they started before the window
    dateFilter = `AND ((last_seen_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date)`;
    params.push(from, to);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    dateFilter = `AND ((last_seen_at AT TIME ZONE 'UTC')::date = $2::date)`;
    params.push(today);
  }
  
  // Country analytics
  const countryQ = `
    SELECT 
      country,
      COUNT(*) as visits,
      COUNT(DISTINCT session_id) as unique_sessions,
      AVG(EXTRACT(EPOCH FROM (last_seen_at - started_at))) as avg_duration_seconds
    FROM sessions 
    WHERE app = $1 ${dateFilter}
    GROUP BY country
    ORDER BY visits DESC;
  `;
  
  // City analytics
  const cityQ = `
    SELECT 
      city,
      country,
      COUNT(*) as visits,
      COUNT(DISTINCT session_id) as unique_sessions,
      AVG(EXTRACT(EPOCH FROM (last_seen_at - started_at))) as avg_duration_seconds
    FROM sessions 
    WHERE app = $1 ${dateFilter}
    GROUP BY city, country
    ORDER BY visits DESC
    LIMIT 20;
  `;
  
  // Device type analytics
  const deviceQ = `
    SELECT 
      device_type,
      COUNT(*) as visits,
      COUNT(DISTINCT session_id) as unique_sessions,
      AVG(EXTRACT(EPOCH FROM (last_seen_at - started_at))) as avg_duration_seconds
    FROM sessions 
    WHERE app = $1 ${dateFilter}
    GROUP BY device_type
    ORDER BY visits DESC;
  `;
  
  const [countries, cities, devices] = await Promise.all([
    pool.query(countryQ, params),
    pool.query(cityQ, params),
    pool.query(deviceQ, params)
  ]);
  
  res.json({
    app,
    period: from && to ? `${from} to ${to}` : 'today',
    countries: countries.rows,
    cities: cities.rows,
    devices: devices.rows
  });
});

// Reset (delete) — requires app key to be configured
router.delete("/:app/reset", requireKey, async (req, res) => {
  const app = req.params.app;

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
    // Also delete the API key for this app
    await pool.query(`DELETE FROM api_keys WHERE app = $1`, [app]);
    return res.json({ ok: true, cleared: { app, allDays: true } });
  }
});

// Get all apps from database
router.get("/apps", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT app 
      FROM sessions 
      ORDER BY app
    `);
    const apps = result.rows.map(row => row.app);
    res.json({ apps });
  } catch (error) {
    console.error("Failed to fetch apps:", error);
    res.status(500).json({ error: "Failed to fetch apps" });
  }
});

// Get API keys for all apps
router.get("/api-keys", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT app, api_key 
      FROM api_keys 
      ORDER BY app
    `);
    const apiKeys = {};
    result.rows.forEach(row => {
      apiKeys[row.app] = row.api_key;
    });
    res.json({ apiKeys });
  } catch (error) {
    console.error("Failed to fetch API keys:", error);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

export default router;
