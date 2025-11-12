import express from "express";
import { Resend } from "resend";

const router = express.Router();
router.use(express.json());

/**
 * POST /email/send
 * Send an email using Resend API
 * 
 * Payload
 * {
 *   "to": "recipient@example.com",
 *   "subject": "Email subject",
 *   "text": "Plain text body (optional if html is provided)",
 *   "html": "<p>HTML body (optional if text is provided)</p>"
 * }
 *
 * Notes:
 * - API key is read from server env: RESEND_API_KEY
 * - Sender is locked to RESEND_FROM env var or fallback to "Repairman <noreply@repairman.co.il>"
 * - Client cannot override the sender address
 */
router.post("/send", async (req, res) => {
  // Set response timeout to prevent hanging
  const responseTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("Response timeout: Request took longer than 45 seconds");
      res.status(504).json({
        error: "Request timeout",
        message: "The email operation exceeded the maximum time limit.",
      });
    }
  }, 45000);

  try {
    console.log("[email] Received email send request");
    const { to, subject, text, html } = req.body;

    // Validate required fields
    if (!to) {
      clearTimeout(responseTimeout);
      return res.status(400).json({ error: "Missing required field: 'to' (recipient email)" });
    }
    if (!subject) {
      clearTimeout(responseTimeout);
      return res.status(400).json({ error: "Missing required field: 'subject'" });
    }
    if (!text && !html) {
      clearTimeout(responseTimeout);
      return res.status(400).json({ error: "Missing required field: either 'text' or 'html' must be provided" });
    }
    // Resend-only implementation
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM || "Repairman <noreply@repairman.co.il>";

    if (!apiKey) {
      clearTimeout(responseTimeout);
      return res.status(500).json({
        error: "Missing server configuration",
        message: "RESEND_API_KEY is not set on the server",
      });
    }

    // Log before sending
    console.log("[email] to:", to, "using from:", fromAddress, "hasApiKey:", !!apiKey);

    try {
      const resend = new Resend(apiKey);
      const result = await Promise.race([
        resend.emails.send({
          from: fromAddress,
          to,
          subject,
          html: html || undefined,
          text: text || undefined,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Send timeout: Resend API call took too long (30s)")), 30000)
        ),
      ]);

      if (result?.error) {
        console.error("[email] Resend error:", result.error);
        const status = Number(result.error?.statusCode) || 502;
        return res.status(status).json({
          error: "Resend send failed",
          status,
          message: result.error?.message || "Failed to send email via Resend",
          name: result.error?.name,
          details: result.error?.response || result.error?.body || result.error,
        });
      }

      console.log("[email] Resend ok:", result?.data);
      return res.json({
        success: true,
        messageId: result?.data?.id || "sent",
        message: "Email sent successfully via Resend",
      });
    } catch (resendError) {
      console.error("[email] Resend exception:", resendError);
      const status = Number(resendError?.statusCode) || 502;
      return res.status(status).json({
        error: "Resend send failed",
        status,
        message: resendError?.message || "Unknown error",
        name: resendError?.name,
        details: resendError?.response || resendError?.body || undefined,
      });
    } finally {
      clearTimeout(responseTimeout);
    }
  } catch (error) {
    clearTimeout(responseTimeout);
    console.error("[email] Unexpected error:", {
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

    // Generic error response
    res.status(500).json({
      error: "Failed to send email",
      message: error.message || "Unknown error occurred",
      code: error.code || "UNKNOWN",
    });
  }
});

export default router;

