import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === "require" ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function checkDatabase() {
  try {
    console.log("🔍 Checking PostgreSQL database...\n");
    
    // Check if we can connect
    const client = await pool.connect();
    console.log("✅ Connected to database successfully!\n");
    
    // Check sessions table structure
    console.log("📊 Sessions table structure:");
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'sessions'
      ORDER BY ordinal_position;
    `);
    tableInfo.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Count total sessions
    const totalSessions = await pool.query(`SELECT COUNT(*) as count FROM sessions`);
    console.log(`\n📈 Total sessions in database: ${totalSessions.rows[0].count}`);
    
    // Check device types distribution
    console.log("\n📱 Device types distribution:");
    const deviceTypes = await pool.query(`
      SELECT 
        device_type,
        COUNT(*) as count
      FROM sessions
      WHERE device_type IS NOT NULL
      GROUP BY device_type
      ORDER BY count DESC;
    `);
    
    if (deviceTypes.rows.length === 0) {
      console.log("  ⚠️  No device types found (all are NULL)");
    } else {
      deviceTypes.rows.forEach(row => {
        console.log(`  - ${row.device_type || 'NULL'}: ${row.count} sessions`);
      });
    }
    
    // Check device types per app
    console.log("\n📊 Device types per app:");
    const byApp = await pool.query(`
      SELECT 
        app,
        device_type,
        COUNT(*) as count
      FROM sessions
      WHERE device_type IS NOT NULL
      GROUP BY app, device_type
      ORDER BY app, count DESC;
    `);
    
    if (byApp.rows.length === 0) {
      console.log("  ⚠️  No device types found");
    } else {
      byApp.rows.forEach(row => {
        console.log(`  - ${row.app}: ${row.device_type} = ${row.count}`);
      });
    }
    
    // Check recent sessions with device types
    console.log("\n🕐 Recent sessions (last 10) with device types:");
    const recent = await pool.query(`
      SELECT 
        app,
        session_id,
        device_type,
        country,
        city,
        started_at
      FROM sessions
      ORDER BY started_at DESC
      LIMIT 10;
    `);
    
    if (recent.rows.length === 0) {
      console.log("  ⚠️  No sessions found");
    } else {
      recent.rows.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.app} | ${row.device_type || 'NULL'} | ${row.country}, ${row.city} | ${row.started_at}`);
      });
    }
    
    // Check device types per day for recent days
    console.log("\n📅 Device types per day (last 7 days):");
    const byDay = await pool.query(`
      SELECT 
        ((started_at AT TIME ZONE 'UTC')::date)::text AS day,
        CASE 
          WHEN device_type = 'desktop' THEN 'pc'
          WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
          ELSE 'other'
        END AS mapped_device_type,
        COUNT(*) as visits
      FROM sessions
      WHERE device_type IS NOT NULL
        AND started_at >= NOW() - INTERVAL '7 days'
      GROUP BY day, mapped_device_type
      ORDER BY day DESC, visits DESC;
    `);
    
    if (byDay.rows.length === 0) {
      console.log("  ⚠️  No device types found for recent days");
    } else {
      byDay.rows.forEach(row => {
        console.log(`  - ${row.day}: ${row.mapped_device_type} = ${row.visits}`);
      });
    }
    
    client.release();
    console.log("\n✅ Database check completed!");
    
  } catch (error) {
    console.error("\n❌ Error checking database:", error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error("\n⚠️  Cannot connect to database. Please check:");
      console.error("  1. DATABASE_URL is set in your .env file");
      console.error("  2. Database is running and accessible");
      console.error("  3. Network/firewall allows connection");
    }
  } finally {
    await pool.end();
  }
}

checkDatabase();

