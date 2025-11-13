import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

console.log("🔍 Testing database connection...\n");

// Check if DATABASE_URL is loaded
console.log("DATABASE_URL loaded:", process.env.DATABASE_URL ? "✅ Yes" : "❌ No");
if (process.env.DATABASE_URL) {
  // Hide password in output
  const url = process.env.DATABASE_URL;
  const maskedUrl = url.replace(/:([^:@]+)@/, ':****@');
  console.log("DATABASE_URL:", maskedUrl);
}
console.log("STORAGE:", process.env.STORAGE || "not set");
console.log("PGSSL:", process.env.PGSSL || "not set");
console.log("NODE_ENV:", process.env.NODE_ENV || "not set");
console.log("");

// Try to connect
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === "require" ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function testConnection() {
  try {
    console.log("Attempting to connect...");
    const client = await pool.connect();
    console.log("✅ Connected successfully!\n");
    
    // Test a simple query
    const result = await client.query("SELECT version()");
    console.log("PostgreSQL version:", result.rows[0].version);
    
    // Check if sessions table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'sessions'
      );
    `);
    console.log("Sessions table exists:", tableCheck.rows[0].exists ? "✅ Yes" : "❌ No");
    
    client.release();
    await pool.end();
    console.log("\n✅ Connection test completed successfully!");
    
  } catch (error) {
    console.error("\n❌ Connection failed!");
    console.error("Error code:", error.code);
    console.error("Error message:", error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error("\n⚠️  Connection refused. Possible issues:");
      console.error("  1. Database host/port is incorrect");
      console.error("  2. Firewall blocking connection");
      console.error("  3. Database is not accessible from your IP");
    } else if (error.code === 'ENOTFOUND') {
      console.error("\n⚠️  Host not found. Check:");
      console.error("  1. Hostname in DATABASE_URL is correct");
      console.error("  2. You're using External Database URL (not Internal)");
    } else if (error.code === '28P01') {
      console.error("\n⚠️  Authentication failed. Check:");
      console.error("  1. Username is correct");
      console.error("  2. Password is correct");
      console.error("  3. No extra spaces in DATABASE_URL");
    } else if (error.code === '3D000') {
      console.error("\n⚠️  Database does not exist. Check database name in DATABASE_URL");
    } else if (error.message.includes('SSL')) {
      console.error("\n⚠️  SSL error. Try setting PGSSL=require in .env");
    }
    
    console.error("\nFull error details:");
    console.error(error);
    
    await pool.end();
    process.exit(1);
  }
}

testConnection();

