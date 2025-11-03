import express from "express";
import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";
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
 *   "html": "<p>HTML body (optional if text is provided)</p>",
 *   "from": "no-reply@yourdomain.com" // optional; overrides RESEND_FROM
 * }
 *
 * Notes:
 * - API key is read from server env: RESEND_API_KEY
 * - Default sender can be set via RESEND_FROM; overridden by body.from
 */
router.post("/send", async (req, res) => {
  // Set response timeout to prevent hanging
  const responseTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("Response timeout: Request took longer than 45 seconds");
      res.status(504).json({
        error: "Request timeout",
        message: "The email operation exceeded the maximum time limit. Please check your SMTP configuration and try again.",
      });
    }
  }, 45000);

  try {
    console.log("Received email send request");
    const { to, subject, text, html, from } = req.body;

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
    {
      const apiKey = process.env.RESEND_API_KEY;
      const fromAddress = from || process.env.RESEND_FROM;

      if (!apiKey) {
        clearTimeout(responseTimeout);
        return res.status(500).json({
          error: "Missing server configuration",
          message: "RESEND_API_KEY is not set on the server",
        });
      }

      if (!fromAddress) {
        clearTimeout(responseTimeout);
        return res.status(400).json({
          error: "Missing required field",
          message: "Provide a 'from' address (top-level 'from' or 'smtpConfig.from') or set RESEND_FROM on the server",
        });
      }

      console.log(`Attempting to send email via Resend from ${fromAddress} to ${to}`);

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
          console.error("Resend error:", result.error);
          clearTimeout(responseTimeout);
          return res.status(502).json({
            error: "Resend API error",
            message: result.error.message || "Failed to send email via Resend",
            details: result.error,
          });
        }

        console.log("Email sent successfully via Resend");
        clearTimeout(responseTimeout);
        return res.json({
          success: true,
          messageId: result?.data?.id || "sent",
          message: "Email sent successfully via Resend",
        });
      } catch (resendError) {
        clearTimeout(responseTimeout);
        console.error("Resend exception:", resendError);
        return res.status(500).json({
          error: "Failed to send email via Resend",
          message: resendError.message || "Unknown error occurred",
        });
      }
    }
  } catch (error) {
    clearTimeout(responseTimeout);
    console.error("Error sending email:", {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack,
    });
    
    // Handle timeout errors
    if (error.message && error.message.includes("timeout")) {
      return res.status(504).json({
        error: "Request timeout",
        message: error.message,
        details: "The operation exceeded the time limit. This may indicate network issues or SMTP server problems.",
      });
    }
    
    // Handle specific error types
    if (error.code === "EAUTH") {
      return res.status(401).json({
        error: "Authentication failed",
        message: "Invalid Gmail credentials. Please verify your App Password is correct.",
        details: "Make sure you're using a Gmail App Password (16 characters, no spaces), not your regular password.",
      });
    }
    
    if (error.code === "ECONNECTION" || error.code === "ETIMEDOUT") {
      return res.status(503).json({
        error: "Connection failed",
        message: "Could not connect to Gmail SMTP server.",
        details: "This might be due to network restrictions on your hosting provider (Render.com free tier may block SMTP).",
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

