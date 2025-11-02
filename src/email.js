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
  try {
    const { to, subject, text, html, smtpConfig } = req.body;

    // Validate required fields
    if (!to) {
      return res.status(400).json({ error: "Missing required field: 'to' (recipient email)" });
    }
    if (!subject) {
      return res.status(400).json({ error: "Missing required field: 'subject'" });
    }
    if (!text && !html) {
      return res.status(400).json({ error: "Missing required field: either 'text' or 'html' must be provided" });
    }
    if (!smtpConfig) {
      return res.status(400).json({ error: "Missing required field: 'smtpConfig'" });
    }
    if (!smtpConfig.user || !smtpConfig.password) {
      return res.status(400).json({ error: "Missing required fields in 'smtpConfig': 'user' and 'password' are required" });
    }

    // Configure nodemailer transporter with Gmail SMTP
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password, // Gmail App Password or OAuth2 token
      },
    });

    // Verify connection
    await transporter.verify();

    // Send email
    const info = await transporter.sendMail({
      from: `"${smtpConfig.user.split('@')[0]}" <${smtpConfig.user}>`,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
    });

    res.json({
      success: true,
      messageId: info.messageId,
      message: "Email sent successfully",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    
    // Handle specific error types
    if (error.code === "EAUTH") {
      return res.status(401).json({
        error: "Authentication failed",
        message: "Invalid Gmail credentials. Make sure you're using an App Password, not your regular password.",
      });
    }
    if (error.code === "ECONNECTION") {
      return res.status(503).json({
        error: "Connection failed",
        message: "Could not connect to Gmail SMTP server.",
      });
    }

    res.status(500).json({
      error: "Failed to send email",
      message: error.message || "Unknown error occurred",
    });
  }
});

export default router;

