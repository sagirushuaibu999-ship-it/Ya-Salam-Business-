const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// Serve index.html and other frontend files
app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;

const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;

const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

// ===============================
// HOME - WEBSITE
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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

    res.status(response.status).json(data);

  } catch (error) {
    console.error("Variation error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

// ===============================
// VTPASS PAYMENT HELPER
// ===============================
async function vtpassPay(body) {
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

  const data = await response.json();

  return {
    httpStatus: response.status,
    data
  };
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

    const requestId =
      `YSB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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
      message: "Unable to connect to VTpass"
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

    if (
      !serviceID ||
      !variation_code ||
      !phone
    ) {
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

    const requestId =
      `YSB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const paymentData = {
      request_id: requestId,
      serviceID: serviceID,
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

    const result =
      await vtpassPay(paymentData);

    res.status(result.httpStatus).json({
      ...result.data,
      request_id: requestId
    });

  } catch (error) {
    console.error("Data error:", error);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to VTpass"
    });
  }
});

// ===============================
// REQUERY TRANSACTION
// ===============================
app.post("/api/requery", async (req, res) => {
  try {
    const {
      request_id
    } = req.body;

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
          request_id
        })
      }
    );

    const data =
      await response.json();

    res.status(response.status).json(data);

  } catch (error) {
    console.error(
      "Requery error:",
      error
    );

    res.status(500).json({
      status: "error",
      message:
        "Unable to check transaction status"
    });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
