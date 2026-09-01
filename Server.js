const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;

// VTpass Sandbox
const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

// ===============================
// GENERATE VTPASS REQUEST ID
// ===============================

function generateRequestId() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const values = {};

  parts.forEach(part => {
    values[part.type] = part.value;
  });

  const datePart =
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute;

  const randomPart = Math.random()
    .toString(36)
    .substring(2, 12);

  return datePart + randomPart;
}

// ===============================
// HOME / HEALTH CHECK
// ===============================

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business backend is running"
  });
});

// ===============================
// VTPASS STATUS
// ===============================

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

// ===============================
// GET DATA VARIATIONS
// ===============================

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

    console.log("Variations HTTP status:", response.status);
    console.log("Variations response:", data);

    res.status(response.status).json(data);

  } catch (error) {
    console.error("Variation error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass",
      error: error.message
    });
  }
});

// ===============================
// TEST VTPASS CONNECTION
// ===============================

app.get("/api/test-vtpass", async (req, res) => {
  try {
    const response = await fetch(
      `${VTPASS_BASE_URL}/service-categories`,
      {
        method: "GET",
        headers: {
          "api-key": VTPASS_API_KEY,
          "public-key": VTPASS_PUBLIC_KEY
        }
      }
    );

    const data = await response.json();

    console.log("VTpass test HTTP status:", response.status);
    console.log("VTpass test response:", data);

    res.status(response.status).json(data);

  } catch (error) {
    console.error("VTpass test error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass",
      error: error.message
    });
  }
});

// ===============================
// VTPASS PAYMENT HELPER
// ===============================

async function vtpassPay(body) {
  console.log("VTpass payment request:", {
    request_id: body.request_id,
    serviceID: body.serviceID,
    variation_code: body.variation_code,
    amount: body.amount,
    phone: body.phone
  });

  try {
    const response = await fetch(
      `${VTPASS_BASE_URL}/pay`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "api-key": VTPASS_API_KEY,
          "secret-key": VTPASS_SECRET_KEY
        },

        body: JSON.stringify(body)
      }
    );

    const rawText = await response.text();

    console.log("VTpass payment HTTP status:", response.status);
    console.log("VTpass raw response:", rawText);

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        status: "error",
        message: "VTpass returned a non-JSON response",
        raw_response: rawText
      };
    }

    console.log("VTpass parsed response:", data);

    return {
      httpStatus: response.status,
      data
    };

  } catch (error) {
    console.error("VTpass payment connection error:", error);

    return {
      httpStatus: 500,
      data: {
        status: "error",
        message: "Unable to connect to VTpass",
        error: error.message
      }
    };
  }
}

// ===============================
// AIRTIME PURCHASE
// ===============================

app.post("/api/airtime", async (req, res) => {
  try {
    const {
      serviceID,
      amount,
      phone
    } = req.body;

    if (!serviceID || !amount || !phone) {
      return res.status(400).json({
        status: "error",
        message: "serviceID, amount and phone are required"
      });
    }

    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid airtime amount"
      });
    }

    if (!/^0\d{10}$/.test(phone)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid Nigerian phone number"
      });
    }

    const requestId = generateRequestId();

    console.log("Airtime request:", requestId);

    const result = await vtpassPay({
      request_id: requestId,
      serviceID: serviceID,
      amount: numericAmount,
      phone: phone
    });

    res.status(result.httpStatus).json({
      ...result.data,
      request_id: requestId
    });

  } catch (error) {
    console.error("Airtime error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass",
      error: error.message
    });
  }
});

// ===============================
// DATA PURCHASE
// ===============================

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
        message:
          "serviceID, variation_code and phone are required"
      });
    }

    if (!/^0\d{10}$/.test(phone)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid Nigerian phone number"
      });
    }

    const requestId = generateRequestId();

    console.log("Data request:", requestId);

    const paymentData = {
  request_id: requestId,
  serviceID: serviceID,
  billersCode: phone,
  variation_code: variation_code,
  phone: phone
};

if (
  amount !== undefined &&
  amount !== null &&
  amount !== ""
) {
  const numericAmount = Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    return res.status(400).json({
      status: "error",
      message: "Invalid data amount"
    });
  }

  paymentData.amount = numericAmount;
}
      const numericAmount = Number(amount);

      if (
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
      ) {
        return res.status(400).json({
          status: "error",
          message: "Invalid data amount"
        });
      }

      paymentData.amount = numericAmount;
    }

    const result = await vtpassPay(paymentData);

    res.status(result.httpStatus).json({
      ...result.data,
      request_id: requestId
    });

  } catch (error) {
    console.error("Data error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass",
      error: error.message
    });
  }
});

// ===============================
// REQUERY TRANSACTION
// ===============================

app.post("/api/requery", async (req, res) => {
  try {
    const { request_id } = req.body;

    if (!request_id) {
      return res.status(400).json({
        status: "error",
        message: "request_id is required"
      });
    }

    const response = await fetch(
      `${VTPASS_BASE_URL}/requery`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "api-key": VTPASS_API_KEY,
          "secret-key": VTPASS_SECRET_KEY
        },

        body: JSON.stringify({
          request_id: request_id
        })
      }
    );

    const data = await response.json();

    console.log("Requery HTTP status:", response.status);
    console.log("Requery response:", data);

    res.status(response.status).json(data);

  } catch (error) {
    console.error("Requery error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to check transaction status",
      error: error.message
    });
  }
});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
