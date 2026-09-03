const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// =====================================================
// DATABASE
// =====================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// =====================================================
// NINJA CONFIGURATION
// =====================================================

const NINJA_BASE_URL =
  "https://api.sandbox.ninja.boucloud.io";

const NINJA_PUBLIC_KEY =
  process.env.NINJA_PUBLIC_KEY;

const NINJA_SECRET_KEY =
  process.env.NINJA_SECRET_KEY;

// =====================================================
// PAYSTACK CONFIGURATION
// =====================================================

const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY;

const PAYSTACK_BASE_URL =
  "https://api.paystack.co";

// =====================================================
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        reference VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        paystack_status VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Database tables are ready");

  } catch (error) {
    console.error(
      "Database initialization error:",
      error.message
    );
  }
}

// =====================================================
// HOME / HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message:
      "Ya Salam Business NIN, BVN & Wallet backend is running"
  });
});

// =====================================================
// SYSTEM STATUS
// =====================================================

app.get("/api/status", async (req, res) => {

  let databaseConnected = false;

  try {
    await pool.query("SELECT 1");
    databaseConnected = true;
  } catch {
    databaseConnected = false;
  }

  res.json({
    status: "success",
    databaseConnected,
    ninjaConfigured: Boolean(
      NINJA_PUBLIC_KEY &&
      NINJA_SECRET_KEY
    ),
    paystackConfigured: Boolean(
      PAYSTACK_SECRET_KEY
    ),
    mode: "sandbox"
  });
});

// =====================================================
// NINJA SESSION TOKEN
// =====================================================

async function getNinjaSessionToken() {

  if (!NINJA_PUBLIC_KEY || !NINJA_SECRET_KEY) {
    throw new Error(
      "NINJA credentials are missing"
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
      "NINJA session token was not found"
    );
  }

  return token;
}

// =====================================================
// NINJA IDENTITY LOOKUP
// =====================================================

async function ninjaIdentityLookup(
  idType,
  idNumber
) {

  const token =
    await getNinjaSessionToken();

  const response = await fetch(
    `${NINJA_BASE_URL}/api/identity/identify`,
    {
      method: "POST",

      headers: {
        "Authorization":
          `Bearer ${token}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        idType,
        mode: "lookup",
        idNumber
      })
    }
  );

  const rawText =
    await response.text();

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = {
      status: "error",
      message:
        "NINJA returned a non-JSON response"
    };
  }

  return {
    httpStatus: response.status,
    data
  };
}

// =====================================================
// SAFE NIN/BVN RESPONSE
// =====================================================

function safeIdentityResponse(data) {

  const person =
    data.data || data;

  return {
    status: data.status || "found",

    first_name:
      person.first_name || "",

    last_name:
      person.last_name || "",

    gender:
      person.gender || "",

    date_of_birth:
      person.date_of_birth || "",

    address_state:
      person.address_state || "",

    address_town:
      person.address_town || "",

    country:
      person.country || ""
  };
}

// =====================================================
// NIN VERIFICATION
// =====================================================

app.post(
  "/api/nin/verify",
  async (req, res) => {

    try {

      const { nin } = req.body;

      if (!nin) {
        return res.status(400).json({
          status: "error",
          message: "NIN is required"
        });
      }

      if (
        !/^\d{11}$/.test(
          String(nin)
        )
      ) {
        return res.status(400).json({
          status: "error",
          message:
            "NIN must contain exactly 11 digits"
        });
      }

      const result =
        await ninjaIdentityLookup(
          "nin",
          String(nin)
        );

      if (result.data.status === "found") {

        return res
          .status(result.httpStatus)
          .json(
            safeIdentityResponse(
              result.data
            )
          );
      }

      return res
        .status(result.httpStatus)
        .json({
          status:
            result.data.status ||
            "not_found",

          message:
            result.data.message ||
            "No matching NIN record was found."
        });

    } catch (error) {

      console.error(
        "NIN verification error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to connect to NIN verification service"
      });
    }
  }
);

// =====================================================
// BVN VERIFICATION
// =====================================================

app.post(
  "/api/bvn/verify",
  async (req, res) => {

    try {

      const { bvn } = req.body;

      if (!bvn) {
        return res.status(400).json({
          status: "error",
          message: "BVN is required"
        });
      }

      if (
        !/^\d{11}$/.test(
          String(bvn)
        )
      ) {
        return res.status(400).json({
          status: "error",
          message:
            "BVN must contain exactly 11 digits"
        });
      }

      const result =
        await ninjaIdentityLookup(
          "bvn",
          String(bvn)
        );

      if (result.data.status === "found") {

        return res
          .status(result.httpStatus)
          .json(
            safeIdentityResponse(
              result.data
            )
          );
      }

      return res
        .status(result.httpStatus)
        .json({
          status:
            result.data.status ||
            "not_found",

          message:
            result.data.message ||
            "No matching BVN record was found."
        });

    } catch (error) {

      console.error(
        "BVN verification error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to connect to BVN verification service"
      });
    }
  }
);

// =====================================================
// GET / CREATE WALLET
// =====================================================

app.post(
  "/api/wallet",
  async (req, res) => {

    try {

      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          status: "error",
          message: "Email is required"
        });
      }

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      const result = await pool.query(
        `
        INSERT INTO wallets (email)
        VALUES ($1)
        ON CONFLICT (email)
        DO UPDATE SET
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, email, balance
        `,
        [cleanEmail]
      );

      res.json({
        status: "success",
        wallet: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Wallet creation error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Unable to create wallet"
      });
    }
  }
);

// =====================================================
// GET WALLET BALANCE
// =====================================================

app.get(
  "/api/wallet/:email",
  async (req, res) => {

    try {

      const email =
        String(req.params.email)
          .trim()
          .toLowerCase();

      const result = await pool.query(
        `
        SELECT id, email, balance
        FROM wallets
        WHERE email = $1
        `,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Wallet not found"
        });
      }

      res.json({
        status: "success",
        wallet: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Wallet balance error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to get wallet balance"
      });
    }
  }
);

// =====================================================
// PAYSTACK INITIALIZE PAYMENT
// =====================================================

app.post(
  "/api/wallet/fund",
  async (req, res) => {

    try {

      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          status: "error",
          message:
            "Paystack secret key is not configured"
        });
      }

      const {
        email,
        amount
      } = req.body;

      if (!email || !amount) {
        return res.status(400).json({
          status: "error",
          message:
            "Email and amount are required"
        });
      }

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      const nairaAmount =
        Number(amount);

      if (
        !Number.isFinite(nairaAmount) ||
        nairaAmount <= 0
      ) {
        return res.status(400).json({
          status: "error",
          message:
            "Amount must be greater than zero"
        });
      }

      if (nairaAmount < 100) {
        return res.status(400).json({
          status: "error",
          message:
            "Minimum funding amount is ₦100"
        });
      }

      // Make sure wallet exists
      await pool.query(
        `
        INSERT INTO wallets (email)
        VALUES ($1)
        ON CONFLICT (email) DO NOTHING
        `,
        [cleanEmail]
      );

      const reference =
        `YSB-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 10)
          .toUpperCase()}`;

      const amountKobo =
        Math.round(nairaAmount * 100);

      // Save pending transaction
      await pool.query(
        `
        INSERT INTO wallet_transactions
        (
          reference,
          email,
          amount,
          type,
          status
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          reference,
          cleanEmail,
          nairaAmount,
          "wallet_funding",
          "pending"
        ]
      );

      const paystackResponse =
        await fetch(
          `${PAYSTACK_BASE_URL}/transaction/initialize`,
          {
            method: "POST",

            headers: {
              "Authorization":
                `Bearer ${PAYSTACK_SECRET_KEY}`,

              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              email: cleanEmail,
              amount: amountKobo,
              reference
            })
          }
        );

      const paystackData =
        await paystackResponse.json();

      if (
        !paystackResponse.ok ||
        !paystackData.status
      ) {

        await pool.query(
          `
          UPDATE wallet_transactions
          SET
            status = 'failed',
            updated_at = CURRENT_TIMESTAMP
          WHERE reference = $1
          `,
          [reference]
        );

        return res.status(400).json({
          status: "error",
          message:
            paystackData.message ||
            "Unable to initialize payment"
        });
      }

      res.json({
        status: "success",
        reference,
        authorization_url:
          paystackData.data.authorization_url,
        access_code:
          paystackData.data.access_code
      });

    } catch (error) {

      console.error(
        "Wallet funding error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to initialize wallet funding"
      });
    }
  }
);

// =====================================================
// VERIFY PAYSTACK PAYMENT
// =====================================================

app.get(
  "/api/wallet/verify/:reference",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          status: "error",
          message:
            "Paystack secret key is not configured"
        });
      }

      const reference =
        String(req.params.reference);

      // Get our transaction first
      const transactionResult =
        await client.query(
          `
          SELECT *
          FROM wallet_transactions
          WHERE reference = $1
          `,
          [reference]
        );

      if (
        transactionResult.rows.length === 0
      ) {
        return res.status(404).json({
          status: "error",
          message:
            "Transaction not found"
        });
      }

      const transaction =
        transactionResult.rows[0];

      // Already credited
      if (transaction.status === "success") {

        return res.json({
          status: "success",
          message:
            "Payment was already credited",
          reference,
          amount:
            Number(transaction.amount)
        });
      }

      // Ask Paystack for the real payment status
      const paystackResponse =
        await fetch(
          `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
          {
            method: "GET",
            headers: {
              "Authorization":
                `Bearer ${PAYSTACK_SECRET_KEY}`
            }
          }
        );

      const paystackData =
        await paystackResponse.json();

      if (
        !paystackResponse.ok ||
        !paystackData.status
      ) {
        return res.status(400).json({
          status: "error",
          message:
            paystackData.message ||
            "Unable to verify payment"
        });
      }

      const payment =
        paystackData.data;

      // Payment must be successful
      if (payment.status !== "success") {

        await client.query(
          `
          UPDATE wallet_transactions
          SET
            status = 'failed',
            paystack_status = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE reference = $2
          `,
          [
            payment.status || "failed",
            reference
          ]
        );

        return res.json({
          status: "pending",
          message:
            "Payment has not been completed",
          payment_status:
            payment.status
        });
      }

      // Check amount
      const expectedAmount =
        Math.round(
          Number(transaction.amount) * 100
        );

      if (
        Number(payment.amount) !==
        expectedAmount
      ) {

        await client.query(
          `
          UPDATE wallet_transactions
          SET
            status = 'failed',
            paystack_status = 'amount_mismatch',
            updated_at = CURRENT_TIMESTAMP
          WHERE reference = $1
          `,
          [reference]
        );

        return res.status(400).json({
          status: "error",
          message:
            "Payment amount does not match"
        });
      }

      // =================================================
      // ATOMIC WALLET CREDIT
      // =================================================

      await client.query("BEGIN");

      const lockedTransaction =
        await client.query(
          `
          SELECT *
          FROM wallet_transactions
          WHERE reference = $1
          FOR UPDATE
          `,
          [reference]
        );

      if (
        lockedTransaction.rows[0].status ===
        "success"
      ) {

        await client.query("COMMIT");

        return res.json({
          status: "success",
          message:
            "Payment was already credited",
          reference
        });
      }

      await client.query(
        `
        UPDATE wallets
        SET
          balance = balance + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE email = $2
        `,
        [
          Number(transaction.amount),
          transaction.email
        ]
      );

      await client.query(
        `
        UPDATE wallet_transactions
        SET
          status = 'success',
          paystack_status = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE reference = $2
        `,
        [
          payment.status,
          reference
        ]
      );

      await client.query("COMMIT");

      // Get new balance
      const walletResult =
        await pool.query(
          `
          SELECT email, balance
          FROM wallets
          WHERE email = $1
          `,
          [transaction.email]
        );

      res.json({
        status: "success",
        message:
          "Wallet funded successfully",
        reference,
        amount:
          Number(transaction.amount),
        balance:
          Number(walletResult.rows[0].balance)
      });

    } catch (error) {

      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "Payment verification error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to verify payment"
      });

    } finally {

      client.release();
    }
  }
);

// =====================================================
// WALLET TRANSACTION HISTORY
// =====================================================

app.get(
  "/api/wallet/:email/transactions",
  async (req, res) => {

    tapp.get(
  "/api/wallet/:email/transactions",
  async (req, res) => {

    try {

      const email =
        String(req.params.email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `
          SELECT
            reference,
            amount,
            type,
            status,
            paystack_status,
            created_at
          FROM wallet_transactions
          WHERE email = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [email]
        );

      res.json({
        status: "success",
        transactions:
          result.rows.map(row => ({
            ...row,
            amount: Number(row.amount)
          }))
      });

    } catch (error) {

      console.error(
        "Transaction history error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to get transaction history"
      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, async () => {

  console.log(
    `Ya Salam Business backend running on port ${PORT}`
  );

  await initializeDatabase()app.get(
  "/api/wallet/:email/transactions",
  async (req, res) => {

    try {

      const email =
        String(req.params.email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `
          SELECT
            reference,
            amount,
            type,
            status,
            paystack_status,
            created_at
          FROM wallet_transactions
          WHERE email = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [email]
        );

      res.json({
        status: "success",
        transactions:
          result.rows.map(row => ({
            ...row,
            amount: Number(row.amount)
          }))
      });

    } catch (error) {

      console.error(
        "Transaction history error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to get transaction history"
      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, async () => {

  console.log(
    `Ya Salam Business backend running on port ${PORT}`
  );

  await initializeDatabase();app.get(
  "/api/wallet/:email/transactions",
  async (req, res) => {

    try {

      const email =
        String(req.params.email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `
          SELECT
            reference,
            amount,
            type,
            status,
            paystack_status,
            created_at
          FROM wallet_transactions
          WHERE email = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [email]
        );

      res.json({
        status: "success",
        transactions:
          result.rows.map(row => ({
            ...row,
            amount: Number(row.amount)
          }))
      });

    } catch (error) {

      console.error(
        "Transaction history error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to get transaction history"
      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, async () => {

  console.log(
    `Ya Salam Business backend running on port ${PORT}`
  );

  await initializeDatabase();app.get(
  "/api/wallet/:email/transactions",
  async (req, res) => {

    try {

      const email =
        String(req.params.email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `
          SELECT
            reference,
            amount,
            type,
            status,
            paystack_status,
            created_at
          FROM wallet_transactions
          WHERE email = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [email]
        );

      res.json({
        status: "success",
        transactions:
          result.rows.map(row => ({
            ...row,
            amount: Number(row.amount)
          }))
      });

    } catch (error) {

      console.error(
        "Transaction history error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message:
          "Unable to get transaction history"
      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, async () => {

  console.log(
    `Ya Salam Business backend running on port ${PORT}`
  );

  await initializeDatabase();

});

});

});
