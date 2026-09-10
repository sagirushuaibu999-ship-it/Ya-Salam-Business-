const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const NINJA = "https://api.sandbox.ninja.boucloud.io";
const DIDIT = "https://verification.didit.me";

const DIDIT_WORKFLOW =
  "9879f04a-af0b-44eb-9d6f-1a0f83894514";

const FEE = 100;


// PAYSTACK WEBHOOK
app.post(
  "/api/paystack/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      const signature =
        req.headers["x-paystack-signature"];

      if (!secret || !signature)
        return res.sendStatus(401);

      const hash = crypto
        .createHmac("sha512", secret)
        .update(req.body)
        .digest("hex");

      if (hash !== String(signature))
        return res.sendStatus(401);

      const event = JSON.parse(req.body);

      if (event.event !== "charge.success")
        return res.sendStatus(200);

      const data = event.data;
      const reference = data.reference;

      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const tx = await client.query(
          `SELECT * FROM wallet_transactions
           WHERE reference=$1 FOR UPDATE`,
          [reference]
        );

        if (!tx.rows.length) {
          await client.query("ROLLBACK");
          return res.sendStatus(200);
        }

        if (tx.rows[0].status === "success") {
          await client.query("ROLLBACK");
          return res.sendStatus(200);
        }

        const paid = Number(data.amount) / 100;

        if (paid !== Number(tx.rows[0].amount)) {
          await client.query("ROLLBACK");
          return res.sendStatus(200);
        }

        await client.query(
          `UPDATE wallets
           SET balance=balance+$1
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

        return res.sendStatus(200);

      } catch (e) {
        await client.query("ROLLBACK");
        return res.sendStatus(500);

      } finally {
        client.release();
      }

    } catch (e) {
      return res.sendStatus(400);
    }
  }
);


app.use(express.json());


// HOME
app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Ya Salam Business backend is running"
  });
});


// STATUS
app.get("/api/status", (req, res) => {
  res.json({
    status: "success",
    database: !!process.env.DATABASE_URL,
    paystack: !!process.env.PAYSTACK_SECRET_KEY,
    ninja: !!process.env.NINJA_SECRET_KEY,
    didit: !!process.env.DIDIT_API_KEY
  });
});


// DATABASE
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


// WALLET
app.post("/api/wallet", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return res.status(400).json({
        message: "Email required"
      });

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
      message: e.message
    });
  }
});


// CHECK WALLET
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
      message: e.message
    });
  }
});


// FUND WALLET
app.post("/api/wallet/fund", async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || Number(amount) < 100)
      return res.status(400).json({
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
      [reference, email, Number(amount)]
    );

    const r = await fetch(
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
          amount: Math.round(
            Number(amount) * 100
          ),
          reference
        })
      }
    );

    const data = await r.json();

    if (!data.status)
      return res.status(400).json(data);

    res.json({
      status: "success",
      reference,
      authorization_url:
        data.data.authorization_url
    });

  } catch (e) {
    res.status(500).json({
      message: e.message
    });
  }
});


// NINJA TOKEN
async function ninjaToken() {
  const r = await fetch(
    `${NINJA}/auth/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_key:
          process.env.NINJA_PUBLIC_KEY,
        client_secret:
          process.env.NINJA_SECRET_KEY
      })
    }
  );

  const data = await r.json();

  if (!r.ok || !data.token)
    throw new Error(
      "Ninja authentication failed"
    );

  return data.token;
}


// NIN / BVN
async function verify(req, res, type) {
  const client = await db.connect();

  try {
    const {
      email,
      idNumber
    } = req.body;

    if (
      !email ||
      !/^\d{11}$/.test(String(idNumber))
    ) {
      return res.status(400).json({
        message:
          "Email and valid 11-digit ID required"
      });
    }

    const wallet = await client.query(
      `SELECT balance
       FROM wallets
       WHERE email=$1`,
      [email]
    );

    if (
      !wallet.rows.length ||
      Number(wallet.rows[0].balance) < FEE
    ) {
      return res.status(400).json({
        message:
          "Insufficient wallet balance"
      });
    }

    const token = await ninjaToken();

    const r = await fetch(
      `${NINJA}/api/identity/identify`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${token}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          idType: type,
          mode: "lookup",
          idNumber: String(idNumber),
          reference:
            "YSB-" + Date.now()
        })
      }
    );

    const data = await r.json();

    if (
      !r.ok ||
      data.status !== "found"
    ) {
      return res.status(400).json({
        message:
          "Verification failed. Wallet was not charged."
      });
    }

    await client.query("BEGIN");

    const debit = await client.query(
      `UPDATE wallets
       SET balance=balance-$1
       WHERE email=$2
       AND balance >= $1
       RETURNING balance`,
      [FEE, email]
    );

    if (!debit.rows.length) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message:
          "Insufficient wallet balance"
      });
    }

    const v = data.data || data;

    await client.query(
      `INSERT INTO verification_transactions
       (email,id_type,id_number,amount)
       VALUES($1,$2,$3,$4)`,
      [
        email,
        type,
        String(idNumber),
        FEE
      ]
    );

    await client.query("COMMIT");

    res.json({
      status: "success",
      message:
        `${type.toUpperCase()} verification successful`,
      balance:
        debit.rows[0].balance,
      verification: {
        first_name:
          v.first_name || "",
        last_name:
          v.last_name || "",
        date_of_birth:
          v.date_of_birth || "",
        gender:
          v.gender || "",
        status:
          v.status || ""
      }
    });

  } catch (e) {
    await client
      .query("ROLLBACK")
      .catch(() => {});

    res.status(500).json({
      message:
        "Verification service error"
    });

  } finally {
    client.release();
  }
}


app.post(
  "/api/nin/verify",
  (req, res) =>
    verify(req, res, "nin")
);


app.post(
  "/api/bvn/verify",
  (req, res) =>
    verify(req, res, "bvn")
);


// DIDIT
app.post(
  "/api/didit/session",
  async (req, res) => {
    try {
      const { email } = req.body;

      if (!email)
        return res.status(400).json({
          message: "Email required"
        });

      const r = await fetch(
        `${DIDIT}/v3/session/`,
        {
          method: "POST",
          headers: {
            "x-api-key":
              process.env.DIDIT_API_KEY,
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            workflow_id:
              DIDIT_WORKFLOW,
            vendor_data:
              email
          })
        }
      );

      const data = await r.json();

      if (!r.ok)
        return res.status(400).json(data);

      res.json({
        status: "success",
        session_id:
          data.session_id,
        url:
          data.url || data.session_url
      });

    } catch (e) {
      res.status(500).json({
        message:
          "Didit connection failed"
      });
    }
  }
);


// START
setup()
  .then(() => {
    app.listen(
      PORT,
      () => {
        console.log(
          `Ya Salam Business API running on ${PORT}`
        );
      }
    );
  })
  .catch((e) => {
    console.error(
      "DATABASE ERROR:",
      e
    );

    process.exit(1);
  });
