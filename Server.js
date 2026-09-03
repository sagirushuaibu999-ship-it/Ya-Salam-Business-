const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const NINJA_BASE_URL =
  "https://api.sandbox.ninja.boucloud.io";

const VERIFICATION_FEE = 100;

// =========================
// DATABASE SETUP
// =========================

async function setup() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      balance NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS verification_transactions (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      id_type TEXT NOT NULL,
      id_number TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      status TEXT DEFAULT 'success',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// =========================
// HOME
// =========================

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business backend is running"
  });
});

// =========================
// STATUS
// =========================

app.get("/api/status", (req, res) => {
  res.json({
    status: "success",
    database: !!process.env.DATABASE_URL,
    paystack: !!process.env.PAYSTACK_SECRET_KEY,
    ninja: !!process.env.NINJA_SECRET_KEY
  });
});

// =========================
// CREATE WALLET
// =========================

app.post("/api/wallet", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: "error",
        message: "Email required"
      });
    }

    await db.query(
      `INSERT INTO wallets(email)
       VALUES($1)
       ON CONFLICT(email) DO NOTHING`,
      [email]
    );

    res.json({
      status: "success"
    });

  } catch (e) {
    res.status(500).json({
      status: "error",
      message: e.message
    });
  }
});

// =========================
// CHECK WALLET
// =========================

app.get("/api/wallet/:email", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT email,balance
       FROM wallets
       WHERE email=$1`,
      [req.params.email]
    );

    res.json({
      status: "success",
      wallet: r.rows[0] || null
    });

  } catch (e) {
    res.status(500).json({
      status: "error",
      message: e.message
    });
  }
});

// =========================
// FUND WALLET
// =========================

app.post("/api/wallet/fund", async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || !amount || Number(amount) < 100) {
      return res.status(400).json({
        status: "error",
        message: "Minimum amount is ₦100"
      });
    }

    await db.query(
      `INSERT INTO wallets(email)
       VALUES($1)
       ON CONFLICT(email) DO NOTHING`,
      [email]
    );

    const reference =
      "YSB-" +
      Date.now() +
      "-" +
      Math.floor(Math.random() * 10000);

    await db.query(
      `INSERT INTO wallet_transactions
       (reference,email,amount)
       VALUES($1,$2,$3)`,
      [reference, email, Number(amount)]
    );

    const pay = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: Math.round(Number(amount) * 100),
          reference
        })
      }
    );

    const data = await pay.json();

    if (!data.status) {
      return res.status(400).json(data);
    }

    res.json({
      status: "success",
      reference,
      authorization_url: data.data.authorization_url
    });

  } catch (e) {
    res.status(500).json({
      status: "error",
      message: e.message
    });
  }
});

// =========================
// VERIFY PAYSTACK PAYMENT
// =========================

app.get("/api/wallet/verify/:reference", async (req, res) => {
  const client = await db.connect();

  try {
    const reference = req.params.reference;

    const tx = await client.query(
      `SELECT *
       FROM wallet_transactions
       WHERE reference=$1`,
      [reference]
    );

    if (!tx.rows.length) {
      return res.status(404).json({
        status: "error",
        message: "Transaction not found"
      });
    }

    if (tx.rows[0].status === "success") {
      return res.json({
        status: "success",
        message: "Wallet already credited"
      });
    }

    const pay = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const data = await pay.json();

    if (!data.status || data.data.status !== "success") {
      return res.json({
        status: "pending",
        message: "Payment not successful yet"
      });
    }

    const paid = Number(data.data.amount) / 100;
    const expected = Number(tx.rows[0].amount);

    if (paid !== expected) {
      return res.status(400).json({
        status: "error",
        message: "Amount mismatch"
      });
    }

    await client.query("BEGIN");

    await client.query(
      `UPDATE wallets
       SET balance = balance + $1
       WHERE email=$2`,
      [paid, tx.rows[0].email]
    );

    await client.query(
      `UPDATE wallet_transactions
       SET status='success'
       WHERE reference=$1`,
      [reference]
    );

    await client.query("COMMIT");

    const wallet = await client.query(
      `SELECT balance
       FROM wallets
       WHERE email=$1`,
      [tx.rows[0].email]
    );

    res.json({
      status: "success",
      message: "Wallet credited",
      balance: wallet.rows[0].balance
    });

  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});

    res.status(500).json({
      status: "error",
      message: "Unable to verify payment"
    });

  } finally {
    client.release();
  }
});

// =========================
// NINJA SESSION TOKEN
// =========================

async function getNinjaToken() {
  const response = await fetch(
    `${NINJA_BASE_URL}/auth/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_key: process.env.NINJA_PUBLIC_KEY,
        client_secret: process.env.NINJA_SECRET_KEY
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.token) {
    throw new Error(
      data.message || "Unable to authenticate with Ninja"
    );
  }

  return data.token;
}

// =========================
// NIN / BVN VERIFICATION
// =========================

async function verifyIdentity(req, res, idType) {
  const client = await db.connect();

  try {
    const { email, idNumber } = req.body;

    if (!email || !idNumber) {
      return res.status(400).json({
        status: "error",
        message: "Email and ID number are required"
      });
    }

    if (!/^\d{11}$/.test(String(idNumber))) {
      return res.status(400).json({
        status: "error",
        message: "ID number must contain 11 digits"
      });
    }

    // Check wallet
    const wallet = await client.query(
      `SELECT balance
       FROM wallets
       WHERE email=$1`,
      [email]
    );

    if (
      !wallet.rows.length ||
      Number(wallet.rows[0].balance) < VERIFICATION_FEE
    ) {
      return res.status(400).json({
        status: "error",
        message: "Insufficient wallet balance. Please fund your wallet."
      });
    }

    // Get Ninja token
    const token = await getNinjaToken();

    // Call Ninja lookup
    const ninjaResponse = await fetch(
      `${NINJA_BASE_URL}/api/identity/identify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          idType,
          mode: "lookup",
          idNumber: String(idNumber),
          reference:
            "YSB-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 10000)
        })
      }
    );

    const ninjaData = await ninjaResponse.json();

    // Verification failed - DO NOT CHARGE
    if (
      !ninjaResponse.ok ||
      ninjaData.status !== "found"
    ) {
      return res.status(400).json({
        status: "error",
        message:
          ninjaData.message ||
          "Verification failed. Wallet was not charged."
      });
    }

    // Charge wallet only after successful Ninja response
    await client.query("BEGIN");

    const debit = await client.query(
      `UPDATE wallets
       SET balance = balance - $1
       WHERE email=$2
       AND balance >= $1
       RETURNING balance`,
      [VERIFICATION_FEE, email]
    );

    if (!debit.rows.length) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        status: "error",
        message: "Insufficient wallet balance."
      });
    }

    await client.query(
      `INSERT INTO verification_transactions
       (email,id_type,id_number,amount,status)
       VALUES($1,$2,$3,$4,'success')`,
      [
        email,
        idType,
        String(idNumber),
        VERIFICATION_FEE
      ]
    );

    await client.query("COMMIT");

    res.json({
      status: "success",
      message:
        `${idType.toUpperCase()} verification successful`,
      balance: debit.rows[0].balance
    });

  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("NIN/BVN ERROR:", e);

    res.status(500).json({
      status: "error",
      message: "Verification service error"
    });

  } finally {
    client.release();
  }
}

// NIN
app.post("/api/nin/verify", (req, res) => {
  verifyIdentity(req, res, "nin");
});

// BVN
app.post("/api/bvn/verify", (req, res) => {
  verifyIdentity(req, res, "bvn");
});

// =========================
// START SERVER
// =========================

setup()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        "Ya Salam Business backend running on port " + PORT
      );
    });
  })
  .catch(console.error);
