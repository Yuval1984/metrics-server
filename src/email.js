import express from "express";
import nodemailer from "nodemailer";

const router = express.Router();
router.use(express.json());

/**
 * POST /email/send
 * Send an email using Google SMTP
 * 
 * Body:
 * {
 *   "to": "recipient@example.com",
 *   "subject": "Email subject",
 *   "text": "Plain text body (optional if html is provided)",
 *   "html": "<p>HTML body (optional if text is provided)</p>",
 *   "smtpConfig": {
 *     "user": "your-email@gmail.com",
 *     "password": "your-app-password"  // Gmail App Password or OAuth2 token
 *   }
 * }
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
    const { to, subject, text, html, smtpConfig } = req.body;

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
    if (!smtpConfig) {
      clearTimeout(responseTimeout);
      return res.status(400).json({ error: "Missing required field: 'smtpConfig'" });
    }
    if (!smtpConfig.user || !smtpConfig.password) {
      clearTimeout(responseTimeout);
      return res.status(400).json({ error: "Missing required fields in 'smtpConfig': 'user' and 'password' are required" });
    }

    console.log(`Attempting to send email from ${smtpConfig.user} to ${to}`);

    // Configure nodemailer transporter with Gmail SMTP
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password, // Gmail App Password or OAuth2 token
      },
      connectionTimeout: 10000, // 10 seconds to establish connection
      greetingTimeout: 10000, // 10 seconds for SMTP greeting
      socketTimeout: 10000, // 10 seconds for socket inactivity
      debug: process.env.NODE_ENV === "development", // Enable debug logging in development
    });

    // Verify connection with timeout
    console.log("Verifying SMTP connection...");
    try {
      await Promise.race([
        transporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Connection timeout: SMTP verification took too long (15s)")), 15000)
        )
      ]);
      console.log("SMTP connection verified successfully");
    } catch (verifyError) {
      console.error("SMTP verification failed:", verifyError.message, verifyError.code);
      clearTimeout(responseTimeout);
      
      if (verifyError.code === "EAUTH") {
        return res.status(401).json({
          error: "Authentication failed",
          message: "Invalid Gmail credentials. Please verify your App Password is correct (16 characters, no spaces).",
          details: "Make sure you're using a Gmail App Password, not your regular password. Generate one at: https://myaccount.google.com/apppasswords",
        });
      }
      
      if (verifyError.code === "ECONNECTION" || verifyError.code === "ETIMEDOUT") {
        return res.status(503).json({
          error: "Connection failed",
          message: "Could not connect to Gmail SMTP server (smtp.gmail.com:587). This might be blocked by your hosting provider or firewall.",
          details: "Render.com free tier may block outgoing SMTP connections. Consider upgrading or using a different email service.",
        });
      }
      
      throw verifyError;
    }

    // Send email with timeout
    console.log("Sending email...");
    const info = await Promise.race([
      transporter.sendMail({
        from: `"${smtpConfig.user.split('@')[0]}" <${smtpConfig.user}>`,
        to,
        subject,
        text: text || undefined,
        html: html || undefined,
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Send timeout: Email sending took too long (30s)")), 30000)
      )
    ]);
    
    console.log("Email sent successfully:", info.messageId);
    clearTimeout(responseTimeout);
    
    res.json({
      success: true,
      messageId: info.messageId,
      message: "Email sent successfully",
    });
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

