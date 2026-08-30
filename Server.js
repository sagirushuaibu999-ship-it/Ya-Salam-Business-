const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;

// Test endpoint
app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business backend is running"
  });
});

// Check whether VTpass credentials exist
app.get("/api/vtpass-status", (req, res) => {
  res.json({
    status: "success",
    vtpassConfigured: Boolean(
      VTPASS_API_KEY &&
      VTPASS_PUBLIC_KEY &&
      VTPASS_SECRET_KEY
    )
  });
});

// VTpass request helper
async function vtpassRequest(endpoint, body = {}) {
  const response = await fetch(
    `https://sandbox.vtpass.com/api/${endpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": VTPASS_API_KEY,
        "public-key": VTPASS_PUBLIC_KEY,
        "secret-key": VTPASS_SECRET_KEY
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  return {
    httpStatus: response.status,
    data
  };
}

// Airtime order
app.post("/api/airtime", async (req, res) => {
  try {
    const { serviceID, amount, phone } = req.body;

    if (!serviceID || !amount || !phone) {
      return res.status(400).json({
        status: "error",
        message: "serviceID, amount and phone are required"
      });
    }

    const requestId = `YSB-${Date.now()}`;

    const result = await vtpassRequest("pay", {
      request_id: requestId,
      serviceID,
      amount,
      phone
    });

    res.status(result.httpStatus).json(result.data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

// Data order
app.post("/api/data", async (req, res) => {
  try {
    const { serviceID, variation_code, amount, phone } = req.body;

    if (!serviceID || !variation_code || !phone) {
      return res.status(400).json({
        status: "error",
        message: "serviceID, variation_code and phone are required"
      });
    }

    const requestId = `YSB-${Date.now()}`;

    const result = await vtpassRequest("pay", {
      request_id: requestId,
      serviceID,
      variation_code,
      amount,
      phone
    });

    res.status(result.httpStatus).json(result.data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
