const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VT_BASE_URL =
  process.env.VTPASS_MODE === "live"
    ? "https://vtpass.com"
    : "https://sandbox.vtpass.com";

const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

app.get("/", (req, res) => {
  res.json({
    status: true,
    service: "YA SALAM BUSINESS Recharge API",
    message: "Backend is running"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: true,
    service: "YA SALAM BUSINESS Recharge API",
    vtpassConfigured: !!(
      VTPASS_API_KEY &&
      VTPASS_PUBLIC_KEY &&
      VTPASS_SECRET_KEY
    ),
    paystackConfigured: !!PAYSTACK_SECRET_KEY,
    vtpassMode: process.env.VTPASS_MODE || "sandbox"
  });
});


/* =========================
   VTPASS HELPERS
========================= */

function vtpassHeaders() {
  return {
    "Content-Type": "application/json",
    "api-key": VTPASS_API_KEY,
    "public-key": VTPASS_PUBLIC_KEY,
    "secret-key": VTPASS_SECRET_KEY
  };
}


/* =========================
   GET DATA PLANS
========================= */

app.get("/api/data-plans/:network", async (req, res) => {
  try {
    const network = req.params.network.toLowerCase();

    const services = {
      mtn: "mtn-data",
      airtel: "airtel-data",
      glo: "glo-data",
      "9mobile": "etisalat-data"
    };

    const serviceID = services[network];

    if (!serviceID) {
      return res.status(400).json({
        status: false,
        message: "Unsupported network"
      });
    }

    if (!VTPASS_API_KEY) {
      return res.status(500).json({
        status: false,
        message: "VTpass credentials are not configured"
      });
    }

    const response = await fetch(
      `${VT_BASE_URL}/api/service-variations?serviceID=${serviceID}`,
      {
        method: "GET",
        headers: vtpassHeaders()
      }
    );

    const data = await response.json();

    return res.json(data);

  } catch (error) {
    console.error("DATA PLANS ERROR:", error);

    return res.status(500).json({
      status: false,
      message: "Unable to load data plans"
    });
  }
});


/* =========================
   AIRTIME PURCHASE
========================= */

app.post("/api/airtime", async (req, res) => {
  try {
    const {
      network,
      phone,
      amount,
      request_id
    } = req.body;

    if (!network || !phone || !amount) {
      return res.status(400).json({
        status: false,
        message: "Network, phone and amount are required"
      });
    }

    if (!/^0[0-9]{10}$/.test(String(phone))) {
      return res.status(400).json({
        status: false,
        message: "Invalid Nigerian phone number"
      });
    }

    if (Number(amount) < 50) {
      return res.status(400).json({
        status: false,
        message: "Minimum airtime amount is ₦50"
      });
    }

    if (!VTPASS_API_KEY) {
      return res.status(500).json({
        status: false,
        message: "VTpass is not configured"
      });
    }

    const serviceMap = {
      mtn: "mtn",
      airtel: "airtel",
      glo: "glo",
      "9mobile": "etisalat"
    };

    const serviceID = serviceMap[String(network).toLowerCase()];

    if (!serviceID) {
      return res.status(400).json({
        status: false,
        message: "Unsupported network"
      });
    }

    const transactionId =
      request_id ||
      `YSB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const payload = {
      request_id: transactionId,
      serviceID,
      amount: Number(amount),
      phone: String(phone)
    };

    const response = await fetch(
      `${VT_BASE_URL}/api/pay`,
      {
        method: "POST",
        headers: vtpassHeaders(),
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    return res.json({
      status: true,
      provider: "VTpass",
      request_id: transactionId,
      result: data
    });

  } catch (error) {
    console.error("AIRTIME ERROR:", error);

    return res.status(500).json({
      status: false,
      message: "Airtime transaction failed"
    });
  }
});


/* =========================
   DATA PURCHASE
========================= */

app.post("/api/data", async (req, res) => {
  try {
    const {
      network,
      phone,
      variation_code,
      request_id
    } = req.body;

    if (!network || !phone || !variation_code) {
      return res.status(400).json({
        status: false,
        message: "Network, phone and data plan are required"
      });
    }

    if (!/^0[0-9]{10}$/.test(String(phone))) {
      return res.status(400).json({
        status: false,
        message: "Invalid Nigerian phone number"
      });
    }

    const serviceMap = {
      mtn: "mtn-data",
      airtel: "airtel-data",
      glo: "glo-data",
      "9mobile": "etisalat-data"
    };

    const serviceID = serviceMap[String(network).toLowerCase()];

    if (!serviceID) {
      return res.status(400).json({
        status: false,
        message: "Unsupported network"
      });
    }

    if (!VTPASS_API_KEY) {
      return res.status(500).json({
        status: false,
        message: "VTpass is not configured"
      });
    }

    const transactionId =
      request_id ||
      `YSB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const payload = {
      request_id: transactionId,
      serviceID,
      variation_code: String(variation_code),
      phone: String(phone)
    };

    const response = await fetch(
      `${VT_BASE_URL}/api/pay`,
      {
        method: "POST",
        headers: vtpassHeaders(),
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    return res.json({
      status: true,
      provider: "VTpass",
      request_id: transactionId,
      result: data
    });

  } catch (error) {
    console.error("DATA ERROR:", error);

    return res.status(500).json({
      status: false,
      message: "Data transaction failed"
    });
  }
});


/* =========================
   VTPASS TRANSACTION STATUS
========================= */

app.post("/api/vtpass/requery", async (req, res) => {
  try {
    const { request_id } = req.body;

    if (!request_id) {
      return res.status(400).json({
        status: false,
        message: "request_id is required"
      });
    }

    const response = await fetch(
      `${VT_BASE_URL}/api/requery`,
      {
        method: "POST",
        headers: vtpassHeaders(),
        body: JSON.stringify({
          request_id
        })
      }
    );

    const data = await response.json();

    return res.json(data);

  } catch (error) {
    console.error("REQUERY ERROR:", error);

    return res.status(500).json({
      status: false,
      message: "Unable to check transaction status"
    });
  }
});


/* =========================
   PAYSTACK INITIALIZE
========================= */

app.post("/api/wallet/fund", async (req, res) => {
  try {
    const {
      email,
      amount
    } = req.body;

    if (!email || !amount) {
      return res.status(400).json({
        status: false,
        message: "Email and amount are required"
      });
    }

    const nairaAmount = Number(amount);

    if (nairaAmount < 100) {
      return res.status(400).json({
        status: false,
        message: "Minimum wallet funding is ₦100"
      });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        status: false,
        message: "Paystack is not configured"
      });
    }

    const reference =
      `YSB-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: String(Math.round(nairaAmount * 100)),
          currency: "NGN",
          reference
        })
      }
    );

    const data = await response.json();

    return res.json({
      status: data.status,
      message: data.message,
      reference,
      data: data.data || null
    });

  } catch (error) {
    console.error("PAYSTACK ERROR:", error);

    return res.status(500).json({
      status: false,
      message: "Unable to initialize payment"
    });
  }
});


/* =========================
   PAYSTACK VERIFY
========================= */

app.get("/api/wallet/verify/:reference", async (req, res) => {
  try {
    const reference = req.params.reference;

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        status: false,
        message: "Paystack is not configured"
      });
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const data = await response.json();

    return res.json(data);

  } catch (error) {
    console.error("PAYSTACK VERIFY ERROR:", error);

    return res.status(500).json({
      status: false,
      message: "Unable to verify payment"
    });
  }
});


/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "YA SALAM BUSINESS Recharge Backend"
  });
});


app.listen(PORT, () => {
  console.log(
    `YA SALAM BUSINESS Recharge API running on port ${PORT}`
  );
});
