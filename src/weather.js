import express from "express";

const router = express.Router();
router.use(express.json());

/**
 * GET /weather-channel/autocomplete
 * Fetches city autocomplete suggestions from Geoapify API
 * 
 * Query Parameters:
 * - text: The city name to search for (required)
 * 
 * Response: Returns the raw Geoapify API response
 */
router.get("/autocomplete", async (req, res) => {
  const responseTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("[weather] Response timeout: Request took longer than 30 seconds");
      res.status(504).json({
        error: "Request timeout",
        message: "The external API call exceeded the maximum time limit.",
      });
    }
  }, 30000);

  try {
    console.log("[weather] Received autocomplete request");
    
    const { text } = req.query;
    
    if (!text) {
      clearTimeout(responseTimeout);
      return res.status(400).json({
        error: "Missing required parameter",
        message: "Query parameter 'text' is required",
      });
    }

    const apiKey = process.env.GEOAPIFY_API_KEY || "f552e4f2c0434ff490a99b824c4e4f7f";
    const apiUrl = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    apiUrl.searchParams.append("text", text);
    apiUrl.searchParams.append("type", "city");
    apiUrl.searchParams.append("limit", "3");
    apiUrl.searchParams.append("lang", "en");
    apiUrl.searchParams.append("format", "json");
    apiUrl.searchParams.append("apiKey", apiKey);

    console.log("[weather] Calling Geoapify API:", apiUrl.toString().replace(apiKey, "***"));

    // Fetch data from external API
    const fetchResponse = await Promise.race([
      fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Fetch timeout: External API call took too long (25s)")), 25000)
      ),
    ]);

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      console.error("[weather] Geoapify API error:", fetchResponse.status, errorText);
      clearTimeout(responseTimeout);
      return res.status(fetchResponse.status || 502).json({
        error: "External API error",
        status: fetchResponse.status,
        message: `Failed to fetch data from Geoapify API: ${errorText}`,
      });
    }

    const apiData = await fetchResponse.json();
    console.log("[weather] Geoapify API response received");

    clearTimeout(responseTimeout);
    return res.json(apiData);
  } catch (error) {
    clearTimeout(responseTimeout);
    console.error("[weather] Unexpected error:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    // Handle timeout errors
    if (error.message && error.message.includes("timeout")) {
      return res.status(504).json({
        error: "Request timeout",
        message: error.message,
        details: "The operation exceeded the time limit.",
      });
    }

    // Handle fetch errors
    if (error.message && error.message.includes("fetch")) {
      return res.status(502).json({
        error: "External API connection failed",
        message: error.message,
      });
    }

    // Generic error response
    res.status(500).json({
      error: "Failed to fetch city autocomplete",
      message: error.message || "Unknown error occurred",
      code: error.code || "UNKNOWN",
    });
  }
});

/**
 * GET /weather-channel/forecast
 * Fetches weather forecast from OpenWeatherMap API
 * 
 * Query Parameters:
 * - city: The city name to get forecast for (required)
 * 
 * Response: Returns the raw OpenWeatherMap API response
 */
router.get("/forecast", async (req, res) => {
  const responseTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("[weather] Response timeout: Request took longer than 30 seconds");
      res.status(504).json({
        error: "Request timeout",
        message: "The external API call exceeded the maximum time limit.",
      });
    }
  }, 30000);

  try {
    console.log("[weather] Received forecast request");
    
    const { city } = req.query;
    
    if (!city) {
      clearTimeout(responseTimeout);
      return res.status(400).json({
        error: "Missing required parameter",
        message: "Query parameter 'city' is required",
      });
    }

    const apiKey = process.env.OPENWEATHER_API_KEY || "5fe237bc545d9c57c19986c237bce360";
    const apiUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
    apiUrl.searchParams.append("q", city);
    apiUrl.searchParams.append("units", "metric");
    apiUrl.searchParams.append("appid", apiKey);

    console.log("[weather] Calling OpenWeatherMap API:", apiUrl.toString().replace(apiKey, "***"));

    // Fetch data from external API
    const fetchResponse = await Promise.race([
      fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Fetch timeout: External API call took too long (25s)")), 25000)
      ),
    ]);

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      console.error("[weather] OpenWeatherMap API error:", fetchResponse.status, errorText);
      clearTimeout(responseTimeout);
      return res.status(fetchResponse.status || 502).json({
        error: "External API error",
        status: fetchResponse.status,
        message: `Failed to fetch data from OpenWeatherMap API: ${errorText}`,
      });
    }

    const apiData = await fetchResponse.json();
    console.log("[weather] OpenWeatherMap API response received");

    clearTimeout(responseTimeout);
    return res.json(apiData);
  } catch (error) {
    clearTimeout(responseTimeout);
    console.error("[weather] Unexpected error:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    // Handle timeout errors
    if (error.message && error.message.includes("timeout")) {
      return res.status(504).json({
        error: "Request timeout",
        message: error.message,
        details: "The operation exceeded the time limit.",
      });
    }

    // Handle fetch errors
    if (error.message && error.message.includes("fetch")) {
      return res.status(502).json({
        error: "External API connection failed",
        message: error.message,
      });
    }

    // Generic error response
    res.status(500).json({
      error: "Failed to fetch weather forecast",
      message: error.message || "Unknown error occurred",
      code: error.code || "UNKNOWN",
    });
  }
});

export default router;

