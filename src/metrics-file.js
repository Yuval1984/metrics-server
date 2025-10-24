import express from "express";
import { mkdir, appendFile, rm, stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";

const router = express.Router();
router.use(express.json());

// persistent folder for file logs
const DATA_ROOT = path.resolve(process.cwd(), "data/apps");
const API_KEYS = process.env.API_KEYS ? JSON.parse(process.env.API_KEYS) : {};

const isoDayUTC = (ts) => new Date(ts).toISOString().slice(0, 10);
const hourUTC = (ts) => String(new Date(ts).getUTCHours()).padStart(2, "0");
const rid = () => crypto.randomUUID();
const dayFile = (app, day) => path.join(DATA_ROOT, app, `${day}.ndjson`);
const ensureDir = (p) => mkdir(p, { recursive: true });

function requireKey(req, res, next) {
  if (!Object.keys(API_KEYS).length) return next();
  const want = API_KEYS[req.params.app];
  const got = req.header("x-api-key");
  if (!want || got !== want) return res.status(401).json({ error: "unauthorized" });
  next();
}

async function logEvent(app, obj) {
  const ts = obj.ts ?? Date.now();
  const day = isoDayUTC(ts);
  const dir = path.join(DATA_ROOT, app);
  await ensureDir(dir);
  await appendFile(dayFile(app, day), JSON.stringify({ ...obj, ts }) + "\n");
}

async function aggregateDay(app, day) {
  const file = dayFile(app, day);
  let totalVisits = 0,
    totalDurationMs = 0;
  const hourBuckets = {};
  const sessions = new Map();

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      const { type, ts, sessionId } = e;
      if (!sessionId) return;
      let s = sessions.get(sessionId);
      if (!s) {
        s = { startedAt: null, lastSeenAt: null, ended: false };
        sessions.set(sessionId, s);
      }

      if (type === "start") {
        s.startedAt = ts;
        s.lastSeenAt = ts;
        totalVisits++;
        const h = hourUTC(ts);
        hourBuckets[h] = (hourBuckets[h] ?? 0) + 1;
      } else if (type === "heartbeat") {
        s.lastSeenAt = Math.max(s.lastSeenAt ?? 0, ts);
      } else if (type === "end") {
        if (s.startedAt != null && !s.ended) {
          s.lastSeenAt = Math.max(s.lastSeenAt ?? 0, ts);
          totalDurationMs += Math.max(0, s.lastSeenAt - s.startedAt);
          s.ended = true;
        }
      }
    });
    rl.on("close", resolve);
    rl.on("error", () => resolve());
  });

  for (const s of sessions.values()) {
    if (!s.ended && s.startedAt != null && s.lastSeenAt != null) {
      totalDurationMs += Math.max(0, s.lastSeenAt - s.startedAt);
    }
  }

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
  const results = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1))
    results.push(await aggregateDay(app, d.toISOString().slice(0, 10)));
  return results;
}

router.post("/:app/start", requireKey, async (req, res) => {
  const sessionId = rid();
  await logEvent(req.params.app, { type: "start", sessionId });
  res.json({ sessionId });
});

router.post("/:app/heartbeat", requireKey, async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  await logEvent(req.params.app, { type: "heartbeat", sessionId });
  res.sendStatus(204);
});

router.post("/:app/end", requireKey, async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  await logEvent(req.params.app, { type: "end", sessionId });
  res.sendStatus(204);
});

router.get("/:app/stats", requireKey, async (req, res) => {
  const { app } = req.params;
  const { day, from, to } = req.query;
  if (day) return res.json({ tz: "UTC", days: [await aggregateDay(app, day)] });
  if (from && to) return res.json({ tz: "UTC", days: await aggregateRange(app, from, to) });
  const today = new Date().toISOString().slice(0, 10);
  res.json({ tz: "UTC", days: [await aggregateDay(app, today)] });
});

// DELETE /v1/:app/reset[?day=YYYY-MM-DD]
// Only allowed when an API key is configured for that app and provided correctly.
router.delete("/:app/reset", requireKey, async (req, res) => {
  const app = req.params.app;

  // extra safety: require that this app actually has a key configured
  if (!API_KEYS[app]) {
    return res.status(403).json({ error: "reset requires an API key configured for this app" });
  }

  const { day } = req.query;

  try {
    if (day) {
      // delete a single day's file
      const file = dayFile(app, String(day));
      await stat(file); // ensure it exists
      await rm(file, { force: true });
      return res.json({ ok: true, cleared: { app, day } });
    } else {
      // delete entire app folder (all days)
      const dir = path.join(DATA_ROOT, app);
      await rm(dir, { recursive: true, force: true });
      return res.json({ ok: true, cleared: { app, allDays: true } });
    }
  } catch {
    return res.status(404).json({ error: "not found" });
  }
});

export default router;
