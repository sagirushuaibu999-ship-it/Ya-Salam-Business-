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

async function setup() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      balance NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business backend is running"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "success",
    database: !!process.env.DATABASE_URL,
    paystack: !!process.env.PAYSTACK_SECRET_KEY,
    ninja: !!process.env.NINJA_SECRET_KEY
  });
});

app.post("/api/wallet", async (req, res) => {
  try {
    const { email } = req.body;

    await db.query(
      `INSERT INTO wallets(email)
       VALUES($1)
       ON CONFLICT(email) DO NOTHING`,
      [email]
    );

    res.json({ status: "success", email });
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

app.get("/api/wallet/:email", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT email,balance FROM wallets WHERE email=$1",
      [req.params.email]
    );

    res.json({
      status: "success",
      wallet: r.rows[0] || null
    });
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

app.post("/api/wallet/fund", async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || !amount || amount < 100)
      return res.status(400).json({
        status: "error",
        message: "Minimum amount is ₦100"
      });

    await db.query(
      `INSERT INTO wallets(email)
       VALUES($1)
       ON CONFLICT(email) DO NOTHING`,
      [email]
    );

    const reference = "YSB-" + Date.now();

    await db.query(
      `INSERT INTO wallet_transactions
       (reference,email,amount)
       VALUES($1,$2,$3)`,
      [reference, email, amount]
    );

    const pay = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: Math.round(amount * 100),
          reference
        })
      }
    );

    const data = await pay.json();

    res.json({
      status: data.status ? "success" : "error",
      reference,
      authorization_url: data.data?.authorization_url || null
    });

  } catch (e) {
    res.status(500).json({
      status: "error",
      message: e.message
    });
  }
});

setup()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Ya Salam Business backend running on port " + PORT);
    });
  })
  .catch(console.error);
