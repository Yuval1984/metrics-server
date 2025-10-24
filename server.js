import "dotenv/config";                 // keep first

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// import both routers; choose by env
import metricsFile from "./src/metrics-file.js";
import metricsPg from "./src/metrics-pg.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: [/localhost:4200$/, /repairman\.co\.il$/] }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => res.send("✅ Metrics server is running"));

// choose storage by env
const usePg = (process.env.STORAGE || "").toLowerCase() === "postgres";
const metricsRouter = usePg ? metricsPg : metricsFile;
app.use("/v1", metricsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Metrics listening on :${PORT} (storage=${usePg ? "postgres" : "file"})`)
);
