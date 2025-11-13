import "dotenv/config";

// Test the stats API to see if deviceTypes are returned
const app = "electrician"; // Change this to your app name
const from = "2025-11-13";
const to = "2025-11-13";

// You'll need to provide an API key if required
const apiKey = process.env.API_KEYS ? JSON.parse(process.env.API_KEYS)[app] : undefined;

const baseUrl = process.env.BASE_URL || "http://localhost:3000/v1";
const url = `${baseUrl}/${app}/stats?from=${from}&to=${to}`;

console.log("Testing API endpoint:", url);
console.log("");

const headers = {
  "Content-Type": "application/json",
};

if (apiKey) {
  headers["x-api-key"] = apiKey;
  console.log("Using API key:", apiKey.substring(0, 10) + "...");
} else {
  console.log("No API key found (may not be required)");
}

console.log("");

fetch(url, { headers })
  .then(async (res) => {
    console.log("Status:", res.status, res.statusText);
    const data = await res.json();
    
    console.log("\nResponse:");
    console.log(JSON.stringify(data, null, 2));
    
    // Check if deviceTypes exist
    if (data.days && data.days.length > 0) {
      const firstDay = data.days[0];
      console.log("\n✅ First day object:");
      console.log("  - day:", firstDay.day);
      console.log("  - totalVisits:", firstDay.totalVisits);
      console.log("  - deviceTypes:", firstDay.deviceTypes ? "✅ EXISTS" : "❌ MISSING");
      
      if (firstDay.deviceTypes) {
        console.log("  - deviceTypes value:", JSON.stringify(firstDay.deviceTypes));
      } else {
        console.log("  ⚠️  deviceTypes field is missing from the response!");
      }
    } else {
      console.log("\n⚠️  No days in response");
    }
  })
  .catch((error) => {
    console.error("Error:", error.message);
    console.error("\nMake sure the server is running on", baseUrl);
  });

