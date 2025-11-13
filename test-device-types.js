import "dotenv/config";
import pkg from "pg";
import crypto from "crypto";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === "require" ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function addTestData() {
  try {
    console.log("Connecting to database...");
    console.log("DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");
    
    const app = "electrician"; // or your test app name
    const deviceTypes = ["mobile", "desktop", "tablet", "pc"];
    
    // Get some existing sessions
    console.log(`\nFetching existing sessions for app: ${app}...`);
    const result = await pool.query(
      `SELECT session_id, started_at, device_type FROM sessions 
       WHERE app = $1 
       ORDER BY started_at DESC 
       LIMIT 50`,
      [app]
    );

    console.log(`Found ${result.rows.length} existing sessions.`);

    if (result.rows.length === 0) {
      console.log("\nNo existing sessions found. Creating test sessions...");
      
      // Create some test sessions with device types
      const now = new Date();
      for (let i = 0; i < 20; i++) {
        const sessionId = crypto.randomUUID();
        const startedAt = new Date(now.getTime() - i * 3600000); // 1 hour apart
        const deviceType = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];
        
        await pool.query(
          `INSERT INTO sessions (app, session_id, started_at, last_seen_at, ended, device_type, country, city)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (app, session_id) DO UPDATE SET device_type = $6`,
          [app, sessionId, startedAt, startedAt, true, deviceType, "Test", "TestCity"]
        );
        console.log(`  Created session ${i + 1}/20 with device_type: ${deviceType}`);
      }
    } else {
      console.log("\nUpdating existing sessions with random device types...");
      
      // Update existing sessions with random device types
      let updated = 0;
      for (const row of result.rows) {
        const deviceType = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];
        await pool.query(
          `UPDATE sessions SET device_type = $1 WHERE app = $2 AND session_id = $3`,
          [deviceType, app, row.session_id]
        );
        updated++;
        if (updated % 10 === 0) {
          console.log(`  Updated ${updated}/${result.rows.length} sessions...`);
        }
      }
      console.log(`  ✅ Updated ${updated} sessions with device types`);
    }

    // Verify the data
    console.log("\nVerifying device types in database...");
    const verifyResult = await pool.query(
      `SELECT device_type, COUNT(*) as count 
       FROM sessions 
       WHERE app = $1 AND device_type IS NOT NULL
       GROUP BY device_type
       ORDER BY count DESC`,
      [app]
    );
    
    console.log("\nDevice types distribution:");
    verifyResult.rows.forEach(row => {
      console.log(`  ${row.device_type}: ${row.count} sessions`);
    });

    // Check device types per day
    console.log("\nDevice types per day (last 7 days):");
    const dayResult = await pool.query(
      `SELECT 
        ((started_at AT TIME ZONE 'UTC')::date)::text AS day,
        CASE 
          WHEN device_type = 'desktop' THEN 'pc'
          WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
          ELSE 'other'
        END AS mapped_device_type,
        COUNT(*) as visits
      FROM sessions
      WHERE app = $1
        AND device_type IS NOT NULL
        AND started_at >= NOW() - INTERVAL '7 days'
      GROUP BY day, mapped_device_type
      ORDER BY day DESC, visits DESC`,
      [app]
    );
    
    dayResult.rows.forEach(row => {
      console.log(`  ${row.day}: ${row.mapped_device_type} = ${row.visits}`);
    });

    console.log("\n✅ Test data added/updated successfully!");
    console.log("\nNow test the /stats API to see if deviceTypes are being fetched!");
  } catch (error) {
    console.error("\n❌ Error adding test data:", error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error("\n⚠️  Cannot connect to database. Please check:");
      console.error("  1. DATABASE_URL is set in your .env file");
      console.error("  2. Database is running and accessible");
      console.error("  3. Or run the SQL script directly: add-test-device-types.sql");
    }
  } finally {
    await pool.end();
  }
}

addTestData();

