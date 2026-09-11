const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business API is running"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "success",
    service: "Ya Salam Business API",
    security: process.env.YSB_ACCESS_PIN
      ? "configured"
      : "not configured"
  });
});

app.post("/api/security/unlock", (req, res) => {

  const pin = String(req.body?.pin || "");
  const savedPin = String(process.env.YSB_ACCESS_PIN || "");

  if (!savedPin) {
    return res.status(500).json({
      success: false,
      message: "Security PIN is not configured"
    });
  }

  if (!/^\d{6}$/.test(pin)) {
    return res.status(400).json({
      success: false,
      message: "Enter a 6-digit PIN"
    });
  }

  if (pin !== savedPin) {
    return res.status(401).json({
      success: false,
      message: "Invalid PIN"
    });
  }

  return res.json({
    success: true,
    message: "Access granted"
  });
});

app.listen(PORT, () => {
  console.log(`Ya Salam Business API running on ${PORT}`);
});
