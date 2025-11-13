import "dotenv/config";

const app = "electrician"; // Change this if needed
const from = "2025-11-13";
const to = "2025-11-13";

// Get API key from environment if available, or use hardcoded keys from dashboard
let apiKey = undefined;
if (process.env.API_KEYS) {
  try {
    const apiKeys = JSON.parse(process.env.API_KEYS);
    apiKey = apiKeys[app];
  } catch (e) {
    // Ignore
  }
}

// Fallback to hardcoded keys from dashboard config
if (!apiKey) {
  const hardcodedKeys = {
    repairman: "rKey123",
    electrician: "eKey456",
    profile: "pKey789",
  };
  apiKey = hardcodedKeys[app];
}

const baseUrl = process.env.BASE_URL || "http://localhost:3000/v1";
const url = `${baseUrl}/${encodeURIComponent(app)}/stats?from=${from}&to=${to}`;

console.log("🔍 Testing Stats API Endpoint");
console.log("=" .repeat(50));
console.log("URL:", url);
console.log("App:", app);
console.log("Date range:", from, "to", to);
if (apiKey) {
  console.log("API Key:", apiKey.substring(0, 10) + "...");
} else {
  console.log("API Key: Not provided (may not be required)");
}
console.log("=" .repeat(50));
console.log("");

const headers = {
  "Content-Type": "application/json",
};

if (apiKey) {
  headers["x-api-key"] = apiKey;
}

fetch(url, { headers })
  .then(async (res) => {
    console.log("📡 Response Status:", res.status, res.statusText);
    console.log("");
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ Error Response:");
      console.error(errorText);
      return;
    }
    
    const data = await res.json();
    
    console.log("✅ Full Response:");
    console.log(JSON.stringify(data, null, 2));
    console.log("");
    console.log("=" .repeat(50));
    console.log("📊 Analysis:");
    console.log("=" .repeat(50));
    
    if (data.days && Array.isArray(data.days)) {
      console.log(`Total days in response: ${data.days.length}`);
      console.log("");
      
      data.days.forEach((day, index) => {
        console.log(`Day ${index + 1}: ${day.day}`);
        console.log(`  - totalVisits: ${day.totalVisits}`);
        console.log(`  - avgDurationMs: ${day.avgDurationMs}`);
        console.log(`  - deviceTypes: ${day.deviceTypes ? "✅ EXISTS" : "❌ MISSING"}`);
        
        if (day.deviceTypes) {
          console.log(`    - mobile: ${day.deviceTypes.mobile || 0}`);
          console.log(`    - pc: ${day.deviceTypes.pc || 0}`);
          console.log(`    - tablet: ${day.deviceTypes.tablet || 0}`);
        } else {
          console.log("    ⚠️  deviceTypes field is missing!");
        }
        console.log("");
      });
      
      // Check if any day has deviceTypes
      const hasDeviceTypes = data.days.some(d => d.deviceTypes);
      if (hasDeviceTypes) {
        console.log("✅ SUCCESS: deviceTypes are being returned!");
      } else {
        console.log("❌ PROBLEM: No deviceTypes found in any day object");
        console.log("   The server may need to be restarted with the updated code");
      }
    } else {
      console.log("⚠️  Response doesn't have 'days' array");
    }
  })
  .catch((error) => {
    console.error("❌ Request failed:");
    console.error("Error:", error.message);
    console.error("");
    console.error("Make sure:");
    console.error("  1. Server is running on", baseUrl);
    console.error("  2. The endpoint is correct");
    console.error("  3. API key is correct (if required)");
  });

