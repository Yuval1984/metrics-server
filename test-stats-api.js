import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "require" || process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

// Test the aggregateDay function directly
async function testAggregateDay() {
  try {
    console.log("Testing aggregateDay function directly...\n");
    
    const app = "electrician";
    const day = "2025-11-13";
    
    // This is the same query from metrics-pg.js
    const params = [app, day];
    
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
    
    const result = await pool.query(deviceTypesQ, params);
    
    console.log("Query results:");
    result.rows.forEach(row => {
      console.log(`  ${row.mapped_device_type}: ${row.visits}`);
    });
    
    // Build deviceTypes object (same as in metrics-pg.js)
    const deviceTypes = { mobile: 0, pc: 0, tablet: 0 };
    for (const r of result.rows) {
      if (r.mapped_device_type === 'mobile' || r.mapped_device_type === 'pc' || r.mapped_device_type === 'tablet') {
        deviceTypes[r.mapped_device_type] = r.visits;
      }
    }
    
    console.log("\n✅ deviceTypes object:");
    console.log(JSON.stringify(deviceTypes, null, 2));
    
    console.log("\n✅ This is what should be returned in the /stats API response!");
    
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await pool.end();
  }
}

testAggregateDay();

