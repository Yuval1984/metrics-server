import express from "express";
import { mkdir, appendFile, rm, stat, readdir } from "fs/promises";
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

// Helper to detect device type from user agent
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

// Helper to extract client info from request
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

function requireKey(req, res, next) {
  if (!Object.keys(API_KEYS).length) return next();
  const want = API_KEYS[req.params.app];
  const got = req.header("x-api-key");
  
  // If app doesn't exist in API_KEYS, allow any API key (for new apps)
  if (!want) {
    if (!got) return res.status(401).json({ error: "API key required" });
    return next();
  }
  
  // If app exists in API_KEYS, validate the key
  if (got !== want) return res.status(401).json({ error: "unauthorized" });
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

  try {
    // Check if file exists first
    await stat(file);
  } catch (error) {
    // File doesn't exist, return empty stats
    return {
      day,
      hourBuckets,
      totalVisits: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
    };
  }

  try {
    await new Promise((resolve, reject) => {
      const stream = createReadStream(file);
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lineCount = 0;
      
      rl.on("line", (line) => {
        if (!line.trim()) return;
        lineCount++;
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
      
      rl.on("close", () => {
        resolve();
      });
      
      rl.on("error", (err) => {
        console.error(`Readline error for ${file}:`, err);
        resolve(); // Resolve anyway to return what we have
      });
      
      stream.on("error", (err) => {
        if (err.code === 'ENOENT') {
          resolve(); // File was deleted, return empty stats
        } else {
          console.error(`Stream error for ${file}:`, err);
          resolve(); // Resolve anyway
        }
      });
    });
  } catch (error) {
    console.error(`Error in aggregateDay for ${app}/${day}:`, error);
  }

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
  const clientInfo = getClientInfo(req);
  const { country, city } = req.body || {};
  
  await logEvent(req.params.app, { 
    type: "start", 
    sessionId,
    ipAddress: clientInfo.ipAddress,
    deviceType: clientInfo.deviceType,
    userAgent: clientInfo.userAgent,
    country: country || 'unknown',
    city: city || 'unknown'
  });
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

// Real-time status - active sessions
router.get("/:app/status", requireKey, async (req, res) => {
  const { app } = req.params;
  const today = new Date().toISOString().slice(0, 10);
  const file = dayFile(app, today);
  
  const activeSessions = [];
  const sessions = new Map();
  
  try {
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
        const { type, ts, sessionId, ipAddress, deviceType, country, city } = e;
        if (!sessionId) return;
        
        let s = sessions.get(sessionId);
        if (!s) {
          s = { 
            startedAt: null, 
            lastSeenAt: null, 
            ended: false,
            ipAddress: null,
            deviceType: null,
            country: null,
            city: null
          };
          sessions.set(sessionId, s);
        }

        if (type === "start") {
          s.startedAt = ts;
          s.lastSeenAt = ts;
          if (ipAddress) s.ipAddress = ipAddress;
          if (deviceType) s.deviceType = deviceType;
          if (country) s.country = country;
          if (city) s.city = city;
        } else if (type === "heartbeat") {
          s.lastSeenAt = Math.max(s.lastSeenAt ?? 0, ts);
        } else if (type === "end") {
          s.ended = true;
        }
      });
      rl.on("close", resolve);
      rl.on("error", () => resolve());
    });

    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    for (const [sessionId, session] of sessions.entries()) {
      if (!session.ended && session.lastSeenAt && session.lastSeenAt > fiveMinutesAgo) {
        activeSessions.push({
          sessionId,
          ipAddress: session.ipAddress || 'unknown',
          deviceType: session.deviceType || 'unknown',
          country: session.country || 'unknown',
          city: session.city || 'unknown',
          startedAt: new Date(session.startedAt).toISOString(),
          lastSeenAt: new Date(session.lastSeenAt).toISOString(),
          secondsSinceLastSeen: Math.floor((now - session.lastSeenAt) / 1000),
          sessionDurationSeconds: Math.floor((now - session.startedAt) / 1000)
        });
      }
    }
    
    activeSessions.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    
  } catch (error) {
    // File doesn't exist or other error - return empty result
  }
  
  res.json({
    app,
    activeSessions: activeSessions.length,
    sessions: activeSessions
  });
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

// Analytics by location and device
router.get("/:app/analytics", requireKey, async (req, res) => {
  const { app } = req.params;
  const { from, to } = req.query;
  
  const startDay = from || new Date().toISOString().slice(0, 10);
  const endDay = to || startDay;
  
  const start = new Date(startDay + "T00:00:00Z");
  const end = new Date(endDay + "T00:00:00Z");
  
  const deviceMap = new Map();
  const countryMap = new Map();
  const seenSessions = new Set(); // Global set to avoid double-counting across days
  
  // Process all days in range
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const file = dayFile(app, day);
    
    try {
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
          
          const { type, sessionId, deviceType, country, city } = e;
          if (type !== "start" || !sessionId) return;
          
          // Skip if we've already counted this session
          if (seenSessions.has(sessionId)) return;
          seenSessions.add(sessionId);
          
          // Count unique sessions per device type
          if (deviceType) {
            const current = deviceMap.get(deviceType) || 0;
            deviceMap.set(deviceType, current + 1);
          }
          
          // Count unique sessions per country and city (only if both are not "unknown")
          const countryStr = String(country || "").trim();
          const cityStr = String(city || "").trim();
          if (countryStr && cityStr && 
              countryStr.toLowerCase() !== "unknown" && 
              cityStr.toLowerCase() !== "unknown") {
            const locationKey = `${countryStr},${cityStr}`;
            const current = countryMap.get(locationKey) || 0;
            countryMap.set(locationKey, current + 1);
          }
        });
        rl.on("close", resolve);
        rl.on("error", () => resolve());
      });
    } catch (error) {
      // File doesn't exist, skip
    }
  }
  
  const devices = Array.from(deviceMap.entries()).map(([device_type, unique_sessions]) => ({
    device_type,
    unique_sessions
  }));
  
  const countries = Array.from(countryMap.entries()).map(([locationKey, visits]) => {
    const [country, city] = locationKey.split(",");
    return {
      country: country.trim(),
      city: city.trim(),
      visits
    };
  });
  
  res.json({
    devices: devices.sort((a, b) => b.unique_sessions - a.unique_sessions),
    countries: countries.sort((a, b) => b.visits - a.visits)
  });
});

// Get all apps from file system
router.get("/apps", async (req, res) => {
  try {
    const apps = [];
    const entries = await readdir(DATA_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Filter out "electric" since we're using "electrician" instead
        if (entry.name !== "electric") {
          apps.push(entry.name);
        }
      }
    }
    apps.sort();
    res.json({ apps });
  } catch (error) {
    console.error("Failed to fetch apps:", error);
    res.status(500).json({ error: "Failed to fetch apps" });
  }
});

// Get API keys for all apps (from environment variable)
router.get("/api-keys", async (req, res) => {
  try {
    // Return API keys from environment variable
    res.json({ apiKeys: API_KEYS });
  } catch (error) {
    console.error("Failed to fetch API keys:", error);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

export default router;
