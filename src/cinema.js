import express from "express";

const router = express.Router();
router.use(express.json());

/**
 * GET /cinema/getCinemaTitles
 * Fetches cinema titles from the IMDB API and returns data matching ICinemaData interface
 * 
 * Query Parameters (optional):
 * - pageToken: For pagination (nextPageToken from previous response)
 * - limit: Number of results per page
 * 
 * Response:
 * {
 *   nextPageToken: string,
 *   titles: ITitleData[],
 *   totalCount: number
 * }
 * 
 * ITitleData:
 * {
 *   genres: string[],
 *   id: string,
 *   originalTitle: string,
 *   plot: string,
 *   primaryImage: { url: string, width: number, height: number },
 *   primaryTitle: string,
 *   rating: { aggregateRating: number, voteCount: number },
 *   runtimeSeconds: number,
 *   startYear: number,
 *   type: string
 * }
 */
router.get("/getCinemaTitles", async (req, res) => {
  const responseTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("[cinema] Response timeout: Request took longer than 30 seconds");
      res.status(504).json({
        error: "Request timeout",
        message: "The external API call exceeded the maximum time limit.",
      });
    }
  }, 30000);

  try {
    console.log("[cinema] Received getCinemaTitles request");
    
    // Build query parameters
    const { pageToken, limit } = req.query;
    const apiUrl = new URL("https://api.imdbapi.dev/titles");
    
    if (pageToken) {
      apiUrl.searchParams.append("pageToken", pageToken);
    }
    if (limit) {
      apiUrl.searchParams.append("limit", limit);
    }

    console.log("[cinema] Calling external API:", apiUrl.toString());

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
      console.error("[cinema] External API error:", fetchResponse.status, errorText);
      clearTimeout(responseTimeout);
      return res.status(fetchResponse.status || 502).json({
        error: "External API error",
        status: fetchResponse.status,
        message: `Failed to fetch data from IMDB API: ${errorText}`,
      });
    }

    const apiData = await fetchResponse.json();
    console.log("[cinema] External API response received");

    // Transform the API response to match ICinemaData interface
    const transformedData = transformToCinemaData(apiData);

    clearTimeout(responseTimeout);
    return res.json(transformedData);
  } catch (error) {
    clearTimeout(responseTimeout);
    console.error("[cinema] Unexpected error:", {
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
      error: "Failed to fetch cinema titles",
      message: error.message || "Unknown error occurred",
      code: error.code || "UNKNOWN",
    });
  }
});

/**
 * Transforms the external API response to match ICinemaData interface
 */
function transformToCinemaData(apiData) {
  // Handle different possible response structures
  const titles = Array.isArray(apiData) 
    ? apiData 
    : apiData.titles || apiData.results || apiData.data || [];

  const transformedTitles = titles.map((title) => {
    // Map the title data to ITitleData interface
    return {
      genres: title.genres || title.genre || [],
      id: title.id || title.imdbId || title.tconst || "",
      originalTitle: title.originalTitle || title.original_title || title.title || "",
      plot: title.plot || title.description || title.overview || "",
      primaryImage: {
        url: title.primaryImage?.url || title.primaryImage || title.poster || title.image || "",
        width: title.primaryImage?.width || title.imageWidth || 0,
        height: title.primaryImage?.height || title.imageHeight || 0,
      },
      primaryTitle: title.primaryTitle || title.title || title.name || "",
      rating: {
        aggregateRating: title.rating?.aggregateRating || title.rating?.averageRating || title.rating || title.ratingAverage || 0,
        voteCount: title.rating?.voteCount || title.rating?.numVotes || title.voteCount || title.numVotes || 0,
      },
      runtimeSeconds: title.runtimeSeconds || title.runtime || (title.runtimeMinutes ? title.runtimeMinutes * 60 : 0),
      startYear: title.startYear || title.year || title.releaseYear || 0,
      type: title.type || title.titleType || title.category || "",
    };
  });

  return {
    nextPageToken: apiData.nextPageToken || apiData.next_page_token || apiData.pageToken || "",
    titles: transformedTitles,
    totalCount: apiData.totalCount || apiData.total_count || apiData.total || transformedTitles.length,
  };
}

export default router;

