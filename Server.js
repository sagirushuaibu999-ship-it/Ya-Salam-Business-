const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ======================================
// NINJA API CONFIGURATION
// ======================================

// Sandbox - FREE testing
const NINJA_BASE_URL = "https://api.sandbox.ninja.boucloud.io";

const NINJA_PUBLIC_KEY = process.env.NINJA_PUBLIC_KEY;
const NINJA_SECRET_KEY = process.env.NINJA_SECRET_KEY;


// ======================================
// HOME / HEALTH CHECK
// ======================================

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business NIN & BVN backend is running"
  });
});


// ======================================
// NINJA CONFIGURATION STATUS
// ======================================

app.get("/api/ninja-status", (req, res) => {
  res.json({
    status: "success",
    ninjaConfigured: Boolean(
      NINJA_PUBLIC_KEY &&
      NINJA_SECRET_KEY
    ),
    mode: "sandbox"
  });
});


// ======================================
// GET NINJA SESSION TOKEN
// ======================================

async function getNinjaSessionToken() {
  if (!NINJA_PUBLIC_KEY || !NINJA_SECRET_KEY) {
    throw new Error(
      "NINJA_PUBLIC_KEY or NINJA_SECRET_KEY is missing"
    );
  }

  const response = await fetch(
    `${NINJA_BASE_URL}/auth/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_key: NINJA_PUBLIC_KEY,
        client_secret: NINJA_SECRET_KEY
      })
    }
  );

  const rawText = await response.text();

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      "NINJA returned a non-JSON session response"
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      "Unable to create NINJA session"
    );
  }

  const token =
    data.token ||
    data.access_token ||
    data.data?.token ||
    data.data?.access_token;

  if (!token) {
    throw new Error(
      "NINJA session token was not found in response"
    );
  }

  return token;
}


// ======================================
// NIN / BVN IDENTITY LOOKUP
// ======================================

async function ninjaIdentityLookup(idType, idNumber) {
  const token = await getNinjaSessionToken();

  const response = await fetch(
    `${NINJA_BASE_URL}/api/identity/identify`,
    {
      method: "POST",

      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        idType: idType,
        mode: "lookup",
        idNumber: idNumber
      })
    }
  );

  const rawText = await response.text();

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = {
      status: "error",
      message: "NINJA returned a non-JSON response"
    };
  }

  return {
    httpStatus: response.status,
    data
  };
}


// ======================================
// NIN VERIFICATION
// ======================================

app.post("/api/nin/verify", async (req, res) => {
  try {
    const { nin } = req.body;

    if (!nin) {
      return res.status(400).json({
        status: "error",
        message: "NIN is required"
      });
    }

    if (!/^\d{11}$/.test(String(nin))) {
      return res.status(400).json({
        status: "error",
        message: "NIN must contain exactly 11 digits"
      });
    }

    const result = await ninjaIdentityLookup(
      "nin",
      String(nin)
    );

    res.status(result.httpStatus).json(result.data);

  } catch (error) {
    console.error("NIN verification error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to NIN verification service"
    });
  }
});


// ======================================
// BVN VERIFICATION
// ======================================

app.post("/api/bvn/verify", async (req, res) => {
  try {
    const { bvn } = req.body;

    if (!bvn) {
      return res.status(400).json({
        status: "error",
        message: "BVN is required"
      });
    }

    if (!/^\d{11}$/.test(String(bvn))) {
      return res.status(400).json({
        status: "error",
        message: "BVN must contain exactly 11 digits"
      });
    }

    const result = await ninjaIdentityLookup(
      "bvn",
      String(bvn)
    );

    res.status(result.httpStatus).json(result.data);

  } catch (error) {
    console.error("BVN verification error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Unable to connect to BVN verification service"
    });
  }
});


app.get("/api/test-bvn", async (req, res) => {
  try {
    const result = await ninjaIdentityLookup(
      "bvn",
      "77777777777"
    );

    res.status(result.httpStatus).json(result.data);

  } catch (error) {
    console.error("Test BVN error:", error.message);

    res.status(500).json({
      status: "error",
      message: "BVN Sandbox test failed"
    });
  }
});
// ======================================
// START SERVER
// ======================================

app.listen(PORT, () => {
  console.log(
    `Ya Salam Business backend running on port ${PORT}`
  );
});

