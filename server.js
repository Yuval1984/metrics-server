import "dotenv/config";                 // keep first

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// import both routers; choose by env
import metricsFile from "./src/metrics-file.js";
import metricsPg from "./src/metrics-pg.js";
import emailRouter from "./src/email.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: [/localhost:4200$/, /repairman\.co\.il$/, /yuval1984\.github\.io$/] }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Metrics Server</title>
    <style>
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            margin: 0;
            padding: 40px;
            background: #f9fafb;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        h1 {
            color: #111827;
            margin-bottom: 8px;
            font-size: 24px;
        }
        .status {
            color: #10b981;
            font-size: 16px;
            margin-bottom: 32px;
        }
        .nav-buttons {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .nav-button {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.2s;
            border: none;
            cursor: pointer;
        }
        .nav-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .dashboard-btn {
            background: #3b82f6;
            color: white;
        }
        .dashboard-btn:hover {
            background: #2563eb;
        }
        .backoffice-btn {
            background: #111827;
            color: white;
        }
        .backoffice-btn:hover {
            background: #374151;
        }
        .info {
            margin-top: 24px;
            padding: 16px;
            background: #f3f4f6;
            border-radius: 8px;
            font-size: 14px;
            color: #6b7280;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Metrics Server</h1>
        <div class="status">✅ Server is running</div>
        
        <div class="nav-buttons">
            <a href="/dashboard.html" class="nav-button dashboard-btn">
                📈 Dashboard
            </a>
            <a href="/backoffice.html" class="nav-button backoffice-btn">
                📊 Backoffice
            </a>
        </div>
        
        <div class="info">
            <strong>Storage:</strong> ${usePg ? "PostgreSQL" : "File-based"}<br>
            <strong>Port:</strong> ${PORT}
        </div>
    </div>
</body>
</html>
`));

// choose storage by env
const usePg = (process.env.STORAGE || "").toLowerCase() === "postgres";
const metricsRouter = usePg ? metricsPg : metricsFile;
app.use("/v1", metricsRouter);

// Email API endpoint
app.use("/v1/email", emailRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Metrics listening on :${PORT} (storage=${usePg ? "postgres" : "file"})`)
);
