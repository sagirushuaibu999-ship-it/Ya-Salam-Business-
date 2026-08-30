const express = require("express");
const cors = require("cors");

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;

const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

// Home / health check
app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business backend is running"
  });
});

// Check VTpass configuration
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

// Get VTpass service variations
app.get("/api/variations/:serviceID", async (req, res) => {
  try {
    const { serviceID } = req.params;

    if (!serviceID) {
      return res.status(400).json({
        status: "error",
        message: "serviceID is required"
      });
    }

    const response = await fetch(
      `${VTPASS_BASE_URL}/service-variations?serviceID=${encodeURIComponent(serviceID)}`,
      {
        method: "GET",
        headers: {
          "api-key": VTPASS_API_KEY,
          "public-key": VTPASS_PUBLIC_KEY
        }
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("Variation error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

// VTpass payment helper
async function vtpassPay(body) {
  const response = await fetch(`${VTPASS_BASE_URL}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": VTPASS_API_KEY,
      "secret-key": VTPASS_SECRET_KEY
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  return {
    httpStatus: response.status,
    data
  };
}

// Airtime purchase
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

    const result = await vtpassPay({
      request_id: requestId,
      serviceID,
      amount: Number(amount),
      phone
    });

    res.status(result.httpStatus).json(result.data);
  } catch (error) {
    console.error("Airtime error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

// Data purchase
app.post("/api/data", async (req, res) => {
  try {
    const {
      serviceID,
      variation_code,
      amount,
      phone
    } = req.body;

    if (!serviceID || !variation_code || !phone) {
      return res.status(400).json({
        status: "error",
        message: "serviceID, variation_code and phone are required"
      });
    }

    const requestId = `YSB-${Date.now()}`;

    const paymentData = {
      request_id: requestId,
      serviceID,
      variation_code,
      phone
    };

    // Include amount when supplied
    if (amount !== undefined && amount !== null && amount !== "") {
      paymentData.amount = Number(amount);
    }

    const result = await vtpassPay(paymentData);

    res.status(result.httpStatus).json(result.data);
  } catch (error) {
    console.error("Data error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

// Check transaction status
app.post("/api/requery", async (req, res) => {
  try {
    const { request_id } = req.body;

    if (!request_id) {
      return res.status(400).json({
        status: "error",
        message: "request_id is required"
      });
    }

    const response = await fetch(`${VTPASS_BASE_URL}/requery`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": VTPASS_API_KEY,
        "secret-key": VTPASS_SECRET_KEY
      },
      body: JSON.stringify({
        request_id
      })
    });

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("Requery error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to check transaction status"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
