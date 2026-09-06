const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

app.use(cors());

// =========================
// PAYSTACK WEBHOOK
// IMPORTANT: must come BEFORE express.json()
// =========================

app.post(
"/api/paystack/webhook",
express.raw({ type: "application/json" }),
async (req, res) => {
try {
const secret = process.env.PAYSTACK_SECRET_KEY;
const signature = req.headers["x-paystack-signature"];

  if (!secret || !signature) {
    return res.sendStatus(401);
  }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(req.body)
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "utf8");
  const signatureBuffer = Buffer.from(
    String(signature),
    "utf8"
  );

  if (
    hashBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(
      hashBuffer,
      signatureBuffer
    )
  ) {
    return res.sendStatus(401);
  }

  const event = JSON.parse(req.body.toString());

  console.log(
    "PAYSTACK WEBHOOK:",
    event.event
  );

  if (event.event !== "charge.success") {
    return res.sendStatus(200);
  }

  const data = event.data;

  if (
    !data ||
    data.status !== "success" ||
    !data.reference
  ) {
    return res.sendStatus(200);
  }

  const reference = data.reference;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const tx = await client.query(
      `SELECT *
       FROM wallet_transactions
       WHERE reference=$1
       FOR UPDATE`,
      [reference]
    );

    if (!tx.rows.length) {
      await client.query("ROLLBACK");

      console.log(
        "Webhook transaction not found:",
        reference
      );

      return res.sendStatus(200);
    }

    if (tx.rows[0].status === "success") {
      await client.query("ROLLBACK");

      console.log(
        "Webhook already processed:",
        reference
      );

      return res.sendStatus(200);
    }

    const paid =
      Number(data.amount) / 100;

    const expected =
      Number(tx.rows[0].amount);

    if (paid !== expected) {
      await client.query("ROLLBACK");

      console.log(
        "Webhook amount mismatch:",
        reference,
        paid,
        expected
      );

      return res.sendStatus(200);
    }

    const wallet = await client.query(
      `UPDATE wallets
       SET balance = balance + $1
       WHERE email=$2
       RETURNING balance`,
      [paid, tx.rows[0].email]
    );

    if (!wallet.rows.length) {
      await client.query("ROLLBACK");

      console.log(
        "Wallet not found:",
        tx.rows[0].email
      );

      return res.sendStatus(200);
    }

    await client.query(
      `UPDATE wallet_transactions
       SET status='success'
       WHERE reference=$1`,
      [reference]
    );

    await client.query("COMMIT");

    console.log(
      "WALLET AUTO-CREDITED:",
      tx.rows[0].email,
      paid,
      reference
    );

    return res.sendStatus(200);

  } catch (e) {
    await client
      .query("ROLLBACK")
      .catch(() => {});

    console.error(
      "PAYSTACK WEBHOOK ERROR:",
      e
    );

    return res.sendStatus(500);

  } finally {
    client.release();
  }

} catch (e) {
  console.error(
    "PAYSTACK WEBHOOK ERROR:",
    e
  );

  return res.sendStatus(400);
}

}
);

// Normal JSON requests
app.use(express.json());

const PORT =
process.env.PORT || 10000;

const db = new Pool({
connectionString:
process.env.DATABASE_URL,
ssl: {
rejectUnauthorized: false
}
});

// =========================
// NINJA
// =========================

const NINJA_BASE_URL =
"https://api.sandbox.ninja.boucloud.io";

const VERIFICATION_FEE = 100;

// =========================
// DIDIT
// =========================

const DIDIT_BASE_URL =
"https://verification.didit.me";

const DIDIT_WORKFLOW_ID =
"9879f04a-af0b-44eb-9d6f-1a0f83894514";

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

CREATE TABLE IF NOT EXISTS didit_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  vendor_data TEXT,
  status TEXT DEFAULT 'Not Started',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS didit_webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT,
  session_id TEXT,
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
message:
"Ya Salam Business backend is running"
});
});

// =========================
// STATUS
// =========================

app.get("/api/status", (req, res) => {
res.json({
status: "success",
database:
!!process.env.DATABASE_URL,
paystack:
!!process.env.PAYSTACK_SECRET_KEY,
ninja:
!!process.env.NINJA_SECRET_KEY,
didit:
!!process.env.DIDIT_API_KEY,
diditWebhook:
!!process.env.DIDIT_WEBHOOK_SECRET
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
   ON CONFLICT(email)
   DO NOTHING`,
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

app.get(
"/api/wallet/:email",
async (req, res) => {
try {
const r = await db.query(
"SELECT email,balance FROM wallets WHERE email=$1",
[req.params.email]
);

  res.json({
    status: "success",
    wallet:
      r.rows[0] || null
  });

} catch (e) {
  res.status(500).json({
    status: "error",
    message: e.message
  });
}

}
);

// =========================
// FUND WALLET
// =========================

app.post(
"/api/wallet/fund",
async (req, res) => {
try {
const {
email,
amount
} = req.body;

  if (
    !email ||
    !amount ||
    Number(amount) < 100
  ) {
    return res.status(400).json({
      status: "error",
      message:
        "Minimum amount is ₦100"
    });
  }

  await db.query(
    `INSERT INTO wallets(email)
     VALUES($1)
     ON CONFLICT(email)
     DO NOTHING`,
    [email]
  );

  const reference =
    "YSB-" +
    Date.now() +
    "-" +
    Math.floor(
      Math.random() * 10000
    );

  await db.query(
    `INSERT INTO wallet_transactions
     (reference,email,amount)
     VALUES($1,$2,$3)`,
    [
      reference,
      email,
      Number(amount)
    ]
  );

  const pay = await fetch(
    "https://api.paystack.co/transaction/initialize",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        email,
        amount:
          Math.round(
            Number(amount) * 100
          ),
        reference
      })
    }
  );

  const data =
    await pay.json();

  if (!data.status) {
    return res.status(400).json(
      data
    );
  }

  res.json({
    status: "success",
    reference,
    authorization_url:
      data.data.authorization_url
  });

} catch (e) {
  res.status(500).json({
    status: "error",
    message: e.message
  });
}

}
);

// =========================
// VERIFY PAYSTACK PAYMENT
// =========================

app.get(
"/api/wallet/verify/:reference",
async (req, res) => {
const client =
await db.connect();

try {
  const reference =
    req.params.reference;

  await client.query("BEGIN");

  const tx =
    await client.query(
      `SELECT *
       FROM wallet_transactions
       WHERE reference=$1
       FOR UPDATE`,
      [reference]
    );

  if (!tx.rows.length) {
    await client.query(
      "ROLLBACK"
    );

    return res.status(404).json({
      status: "error",
      message:
        "Transaction not found"
    });
  }

  if (
    tx.rows[0].status ===
    "success"
  ) {
    await client.query(
      "ROLLBACK"
    );

    return res.json({
      status: "success",
      message:
        "Wallet already credited"
    });
  }

  const pay =
    await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

  const data =
    await pay.json();

  if (
    !data.status ||
    data.data.status !==
      "success"
  ) {
    await client.query(
      "ROLLBACK"
    );

    return res.json({
      status: "pending",
      message:
        "Payment not successful yet"
    });
  }

  const paid =
    Number(
      data.data.amount
    ) / 100;

  const expected =
    Number(
      tx.rows[0].amount
    );

  if (paid !== expected) {
    await client.query(
      "ROLLBACK"
    );

    return res.status(400).json({
      status: "error",
      message:
        "Amount mismatch"
    });
  }

  await client.query(
    `UPDATE wallets
     SET balance =
       balance + $1
     WHERE email=$2`,
    [
      paid,
      tx.rows[0].email
    ]
  );

  await client.query(
    `UPDATE wallet_transactions
     SET status='success'
     WHERE reference=$1`,
    [reference]
  );

  await client.query(
    "COMMIT"
  );

  const wallet =
    await db.query(
      `SELECT balance
       FROM wallets
       WHERE email=$1`,
      [
        tx.rows[0].email
      ]
    );

  res.json({
    status: "success",
    message:
      "Wallet credited",
    balance:
      wallet.rows[0].balance
  });

} catch (e) {
  await client
    .query("ROLLBACK")
    .catch(() => {});

  console.error(
    "PAYMENT VERIFY ERROR:",
    e
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

// =========================
// NINJA SESSION TOKEN
// =========================

async function getNinjaToken() {
const response =
await fetch(
"${NINJA_BASE_URL}/auth/session",
{
method: "POST",
headers: {
"Content-Type":
"application/json"
},
body: JSON.stringify({
client_key:
process.env.NINJA_PUBLIC_KEY,
client_secret:
process.env.NINJA_SECRET_KEY
})
}
);

const data =
await response.json();

if (
!response.ok ||
!data.token
) {
throw new Error(
data.message ||
"Unable to authenticate with Ninja"
);
}

return data.token;
}

// =========================
// NIN / BVN VERIFICATION
// =========================

async function verifyIdentity(
req,
res,
idType
) {
const client =
await db.connect();

try {
const {
email,
idNumber
} = req.body;

if (!email || !idNumber) {
  return res.status(400).json({
    status: "error",
    message:
      "Email and ID number are required"
  });
}

if (
  !/^\d{11}$/.test(
    String(idNumber)
  )
) {
  return res.status(400).json({
    status: "error",
    message:
      "ID number must contain 11 digits"
  });
}

const wallet =
  await client.query(
    `SELECT balance
     FROM wallets
     WHERE email=$1`,
    [email]
  );

if (
  !wallet.rows.length ||
  Number(
    wallet.rows[0].balance
  ) < VERIFICATION_FEE
) {
  return res.status(400).json({
    status: "error",
    message:
      "Insufficient wallet balance. Please fund your wallet."
  });
}

const token =
  await getNinjaToken();

const ninjaResponse =
  await fetch(
    `${NINJA_BASE_URL}/api/identity/identify`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${token}`,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        idType,
        mode: "lookup",
        idNumber:
          String(idNumber),
        reference:
          "YSB-" +
          Date.now() +
          "-" +
          Math.floor(
            Math.random() * 10000
          )
      })
    }
  );

const ninjaData =
  await ninjaResponse.json();

console.log(
  "NINJA RESPONSE KEYS:",
  Object.keys(
    ninjaData || {}
  )
);

if (
  ninjaData &&
  typeof ninjaData.data ===
    "object" &&
  ninjaData.data !== null
) {
  console.log(
    "NINJA DATA KEYS:",
    Object.keys(
      ninjaData.data
    )
  );
}

if (
  !ninjaResponse.ok ||
  ninjaData.status !==
    "found"
) {
  return res.status(400).json({
    status: "error",
    message:
      ninjaData.message ||
      "Verification failed. Wallet was not charged."
  });
}

await client.query(
  "BEGIN"
);

const debit =
  await client.query(
    `UPDATE wallets
     SET balance =
       balance - $1
     WHERE email=$2
     AND balance >= $1
     RETURNING balance`,
    [
      VERIFICATION_FEE,
      email
    ]
  );

if (!debit.rows.length) {
  await client.query(
    "ROLLBACK"
  );

  return res.status(400).json({
    status: "error",
    message:
      "Insufficient wallet balance."
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

await client.query(
  "COMMIT"
);

// Only return necessary verification data
const v =
  ninjaData.data ||
  ninjaData;

res.json({
  status: "success",
  message:
    `${idType.toUpperCase()} verification successful`,
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

console.error(
  "NIN/BVN ERROR:",
  e
);

res.status(500).json({
  status: "error",
  message:
    "Verification service error"
});

} finally {
client.release();
}
}

// =========================
// NIN
// =========================

app.post(
"/api/nin/verify",
(req, res) =>
verifyIdentity(
req,
res,
"nin"
)
);

// =========================
// BVN
// =========================

app.post(
"/api/bvn/verify",
(req, res) =>
verifyIdentity(
req,
res,
"bvn"
)
);

// =====================================================
// DIDIT — CREATE VERIFICATION SESSION
// =====================================================

app.post(
"/api/didit/session",
async (req, res) => {
try {
if (!process.env.DIDIT_API_KEY) {
return res.status(500).json({
status: "error",
message:
"Didit API key is not configured"
});
}

  const {
    email
  } = req.body;

  if (!email) {
    return res.status(400).json({
      status: "error",
      message:
        "Email required"
    });
  }

  // Make sure wallet exists
  await db.query(
    `INSERT INTO wallets(email)
     VALUES($1)
     ON CONFLICT(email)
     DO NOTHING`,
    [email]
  );

  const vendorData =
    "YSB-" +
    Date.now() +
    "-" +
    Math.floor(
      Math.random() * 10000
    );

  const response =
    await fetch(
      `${DIDIT_BASE_URL}/v3/session/`,
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
            DIDIT_WORKFLOW_ID,
          vendor_data:
            vendorData,
          callback:
            "https://ya-salam-business-api.onrender.com/api/didit/done"
        })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.session_id ||
    !data.url
  ) {
    console.error(
      "DIDIT SESSION ERROR:",
      response.status,
      data.message ||
        "Unable to create session"
    );

    return res.status(400).json({
      status: "error",
      message:
        data.message ||
        "Unable to create Didit verification session"
    });
  }

  await db.query(
    `INSERT INTO didit_sessions
     (session_id,email,vendor_data,status)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(session_id)
     DO NOTHING`,
    [
      data.session_id,
      email,
      vendorData,
      data.status ||
        "Not Started"
    ]
  );

  res.json({
    status: "success",
    session_id:
      data.session_id,
    url:
      data.url
  });

} catch (e) {
  console.error(
    "DIDIT SESSION ERROR:",
    e
  );

  res.status(500).json({
    status: "error",
    message:
      "Unable to create Didit verification session"
  });
}

}
);

// =====================================================
// DIDIT — CHECK SESSION
// =====================================================

app.get(
"/api/didit/session/:sessionId",
async (req, res) => {
try {
if (!process.env.DIDIT_API_KEY) {
return res.status(500).json({
status: "error",
message:
"Didit API key is not configured"
});
}

  const sessionId =
    req.params.sessionId;

  const response =
    await fetch(
      `${DIDIT_BASE_URL}/v3/session/${encodeURIComponent(sessionId)}/`,
      {
        headers: {
          "x-api-key":
            process.env.DIDIT_API_KEY
        }
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    return res.status(
      response.status
    ).json({
      status: "error",
      message:
        data.message ||
        "Unable to check Didit session"
    });
  }

  const sessionStatus =
    data.status ||
    "Not Started";

  await db.query(
    `UPDATE didit_sessions
     SET status=$1,
         updated_at=CURRENT_TIMESTAMP
     WHERE session_id=$2`,
    [
      sessionStatus,
      sessionId
    ]
  );

  res.json({
    status: "success",
    session_id:
      sessionId,
    verification_status:
      sessionStatus
  });

} catch (e) {
  console.error(
    "DIDIT CHECK ERROR:",
    e
  );

  res.status(500).json({
    status: "error",
    message:
      "Unable to check Didit session"
  });
}

}
);

// =====================================================
// DIDIT — CALLBACK
// =====================================================

app.get(
"/api/didit/done",
(req, res) => {
res.send(
"Didit verification completed. You can return to Ya Salam Business."
);
}
);

// =====================================================
// DIDIT — WEBHOOK SIGNATURE HELPERS
// =====================================================

function shortenWholeNumberFloats(
value
) {
if (
typeof value ===
"number" &&
Number.isFinite(value) &&
Number.isInteger(value)
) {
return value;
}

if (Array.isArray(value)) {
return value.map(
shortenWholeNumberFloats
);
}

if (
value &&
typeof value === "object"
) {
const out = {};

for (
  const key of Object.keys(
    value
  )
) {
  out[key] =
    shortenWholeNumberFloats(
      value[key]
    );
}

return out;

}

return value;
}

function sortObjectKeys(
value
) {
if (Array.isArray(value)) {
return value.map(
sortObjectKeys
);
}

if (
value &&
typeof value === "object"
) {
const out = {};

for (
  const key of Object.keys(
    value
  ).sort()
) {
  out[key] =
    sortObjectKeys(
      value[key]
    );
}

return out;

}

return value;
}

function diditCanonicalJson(
payload
) {
const shortened =
shortenWholeNumberFloats(
payload
);

const sorted =
sortObjectKeys(
shortened
);

return JSON.stringify(
sorted
);
}

function const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

app.use(cors());

// =========================
// PAYSTACK WEBHOOK
// IMPORTANT: must come BEFORE express.json()
// =========================

app.post(
"/api/paystack/webhook",
express.raw({ type: "application/json" }),
async (req, res) => {
try {
const secret = process.env.PAYSTACK_SECRET_KEY;
const signature = req.headers["x-paystack-signature"];

  if (!secret || !signature) {
    return res.sendStatus(401);
  }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(req.body)
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "utf8");
  const signatureBuffer = Buffer.from(
    String(signature),
    "utf8"
  );

  if (
    hashBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(
      hashBuffer,
      signatureBuffer
    )
  ) {
    return res.sendStatus(401);
  }

  const event = JSON.parse(req.body.toString());

  console.log(
    "PAYSTACK WEBHOOK:",
    event.event
  );

  if (event.event !== "charge.success") {
    return res.sendStatus(200);
  }

  const data = event.data;

  if (
    !data ||
    data.status !== "success" ||
    !data.reference
  ) {
    return res.sendStatus(200);
  }

  const reference = data.reference;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const tx = await client.query(
      `SELECT *
       FROM wallet_transactions
       WHERE reference=$1
       FOR UPDATE`,
      [reference]
    );

    if (!tx.rows.length) {
      await client.query("ROLLBACK");

      console.log(
        "Webhook transaction not found:",
        reference
      );

      return res.sendStatus(200);
    }

    if (tx.rows[0].status === "success") {
      await client.query("ROLLBACK");

      console.log(
        "Webhook already processed:",
        reference
      );

      return res.sendStatus(200);
    }

    const paid =
      Number(data.amount) / 100;

    const expected =
      Number(tx.rows[0].amount);

    if (paid !== expected) {
      await client.query("ROLLBACK");

      console.log(
        "Webhook amount mismatch:",
        reference,
        paid,
        expected
      );

      return res.sendStatus(200);
    }

    const wallet = await client.query(
      `UPDATE wallets
       SET balance = balance + $1
       WHERE email=$2
       RETURNING balance`,
      [paid, tx.rows[0].email]
    );

    if (!wallet.rows.length) {
      await client.query("ROLLBACK");

      console.log(
        "Wallet not found:",
        tx.rows[0].email
      );

      return res.sendStatus(200);
    }

    await client.query(
      `UPDATE wallet_transactions
       SET status='success'
       WHERE reference=$1`,
      [reference]
    );

    await client.query("COMMIT");

    console.log(
      "WALLET AUTO-CREDITED:",
      tx.rows[0].email,
      paid,
      reference
    );

    return res.sendStatus(200);

  } catch (e) {
    await client
      .query("ROLLBACK")
      .catch(() => {});

    console.error(
      "PAYSTACK WEBHOOK ERROR:",
      e
    );

    return res.sendStatus(500);

  } finally {
    client.release();
  }

} catch (e) {
  console.error(
    "PAYSTACK WEBHOOK ERROR:",
    e
  );

  return res.sendStatus(400);
}

}
);

// Normal JSON requests
app.use(express.json());

const PORT =
process.env.PORT || 10000;

const db = new Pool({
connectionString:
process.env.DATABASE_URL,
ssl: {
rejectUnauthorized: false
}
});

// =========================
// NINJA
// =========================

const NINJA_BASE_URL =
"https://api.sandbox.ninja.boucloud.io";

const VERIFICATION_FEE = 100;

// =========================
// DIDIT
// =========================

const DIDIT_BASE_URL =
"https://verification.didit.me";

const DIDIT_WORKFLOW_ID =
"9879f04a-af0b-44eb-9d6f-1a0f83894514";

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

CREATE TABLE IF NOT EXISTS didit_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  vendor_data TEXT,
  status TEXT DEFAULT 'Not Started',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS didit_webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT,
  session_id TEXT,
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
message:
"Ya Salam Business backend is running"
});
});

// =========================
// STATUS
// =========================

app.get("/api/status", (req, res) => {
res.json({
status: "success",
database:
!!process.env.DATABASE_URL,
paystack:
!!process.env.PAYSTACK_SECRET_KEY,
ninja:
!!process.env.NINJA_SECRET_KEY,
didit:
!!process.env.DIDIT_API_KEY,
diditWebhook:
!!process.env.DIDIT_WEBHOOK_SECRET
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
   ON CONFLICT(email)
   DO NOTHING`,
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

app.get(
"/api/wallet/:email",
async (req, res) => {
try {
const r = await db.query(
"SELECT email,balance FROM wallets WHERE email=$1",
[req.params.email]
);

  res.json({
    status: "success",
    wallet:
      r.rows[0] || null
  });

} catch (e) {
  res.status(500).json({
    status: "error",
    message: e.message
  });
}

}
);

// =========================
// FUND WALLET
// =========================

app.post(
"/api/wallet/fund",
async (req, res) => {
try {
const {
email,
amount
} = req.body;

  if (
    !email ||
    !amount ||
    Number(amount) < 100
  ) {
    return res.status(400).json({
      status: "error",
      message:
        "Minimum amount is ₦100"
    });
  }

  await db.query(
    `INSERT INTO wallets(email)
     VALUES($1)
     ON CONFLICT(email)
     DO NOTHING`,
    [email]
  );

  const reference =
    "YSB-" +
    Date.now() +
    "-" +
    Math.floor(
      Math.random() * 10000
    );

  await db.query(
    `INSERT INTO wallet_transactions
     (reference,email,amount)
     VALUES($1,$2,$3)`,
    [
      reference,
      email,
      Number(amount)
    ]
  );

  const pay = await fetch(
    "https://api.paystack.co/transaction/initialize",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        email,
        amount:
          Math.round(
            Number(amount) * 100
          ),
        reference
      })
    }
  );

  const data =
    await pay.json();

  if (!data.status) {
    return res.status(400).json(
      data
    );
  }

  res.json({
    status: "success",
    reference,
    authorization_url:
      data.data.authorization_url
  });

} catch (e) {
  res.status(500).json({
    status: "error",
    message: e.message
  });
}

}
);

// =========================
// VERIFY PAYSTACK PAYMENT
// =========================

app.get(
"/api/wallet/verify/:reference",
async (req, res) => {
const client =
await db.connect();

try {
  const reference =
    req.params.reference;

  await client.query("BEGIN");

  const tx =
    await client.query(
      `SELECT *
       FROM wallet_transactions
       WHERE reference=$1
       FOR UPDATE`,
      [reference]
    );

  if (!tx.rows.length) {
    await client.query(
      "ROLLBACK"
    );

    return res.status(404).json({
      status: "error",
      message:
        "Transaction not found"
    });
  }

  if (
    tx.rows[0].status ===
    "success"
  ) {
    await client.query(
      "ROLLBACK"
    );

    return res.json({
      status: "success",
      message:
        "Wallet already credited"
    });
  }

  const pay =
    await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

  const data =
    await pay.json();

  if (
    !data.status ||
    data.data.status !==
      "success"
  ) {
    await client.query(
      "ROLLBACK"
    );

    return res.json({
      status: "pending",
      message:
        "Payment not successful yet"
    });
  }

  const paid =
    Number(
      data.data.amount
    ) / 100;

  const expected =
    Number(
      tx.rows[0].amount
    );

  if (paid !== expected) {
    await client.query(
      "ROLLBACK"
    );

    return res.status(400).json({
      status: "error",
      message:
        "Amount mismatch"
    });
  }

  await client.query(
    `UPDATE wallets
     SET balance =
       balance + $1
     WHERE email=$2`,
    [
      paid,
      tx.rows[0].email
    ]
  );

  await client.query(
    `UPDATE wallet_transactions
     SET status='success'
     WHERE reference=$1`,
    [reference]
  );

  await client.query(
    "COMMIT"
  );

  const wallet =
    await db.query(
      `SELECT balance
       FROM wallets
       WHERE email=$1`,
      [
        tx.rows[0].email
      ]
    );

  res.json({
    status: "success",
    message:
      "Wallet credited",
    balance:
      wallet.rows[0].balance
  });

} catch (e) {
  await client
    .query("ROLLBACK")
    .catch(() => {});

  console.error(
    "PAYMENT VERIFY ERROR:",
    e
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

// =========================
// NINJA SESSION TOKEN
// =========================

async function getNinjaToken() {
const response =
await fetch(
"${NINJA_BASE_URL}/auth/session",
{
method: "POST",
headers: {
"Content-Type":
"application/json"
},
body: JSON.stringify({
client_key:
process.env.NINJA_PUBLIC_KEY,
client_secret:
process.env.NINJA_SECRET_KEY
})
}
);

const data =
await response.json();

if (
!response.ok ||
!data.token
) {
throw new Error(
data.message ||
"Unable to authenticate with Ninja"
);
}

return data.token;
}

// =========================
// NIN / BVN VERIFICATION
// =========================

async function verifyIdentity(
req,
res,
idType
) {
const client =
await db.connect();

try {
const {
email,
idNumber
} = req.body;

if (!email || !idNumber) {
  return res.status(400).json({
    status: "error",
    message:
      "Email and ID number are required"
  });
}

if (
  !/^\d{11}$/.test(
    String(idNumber)
  )
) {
  return res.status(400).json({
    status: "error",
    message:
      "ID number must contain 11 digits"
  });
}

const wallet =
  await client.query(
    `SELECT balance
     FROM wallets
     WHERE email=$1`,
    [email]
  );

if (
  !wallet.rows.length ||
  Number(
    wallet.rows[0].balance
  ) < VERIFICATION_FEE
) {
  return res.status(400).json({
    status: "error",
    message:
      "Insufficient wallet balance. Please fund your wallet."
  });
}

const token =
  await getNinjaToken();

const ninjaResponse =
  await fetch(
    `${NINJA_BASE_URL}/api/identity/identify`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${token}`,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        idType,
        mode: "lookup",
        idNumber:
          String(idNumber),
        reference:
          "YSB-" +
          Date.now() +
          "-" +
          Math.floor(
            Math.random() * 10000
          )
      })
    }
  );

const ninjaData =
  await ninjaResponse.json();

console.log(
  "NINJA RESPONSE KEYS:",
  Object.keys(
    ninjaData || {}
  )
);

if (
  ninjaData &&
  typeof ninjaData.data ===
    "object" &&
  ninjaData.data !== null
) {
  console.log(
    "NINJA DATA KEYS:",
    Object.keys(
      ninjaData.data
    )
  );
}

if (
  !ninjaResponse.ok ||
  ninjaData.status !==
    "found"
) {
  return res.status(400).json({
    status: "error",
    message:
      ninjaData.message ||
      "Verification failed. Wallet was not charged."
  });
}

await client.query(
  "BEGIN"
);

const debit =
  await client.query(
    `UPDATE wallets
     SET balance =
       balance - $1
     WHERE email=$2
     AND balance >= $1
     RETURNING balance`,
    [
      VERIFICATION_FEE,
      email
    ]
  );

if (!debit.rows.length) {
  await client.query(
    "ROLLBACK"
  );

  return res.status(400).json({
    status: "error",
    message:
      "Insufficient wallet balance."
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

await client.query(
  "COMMIT"
);

// Only return necessary verification data
const v =
  ninjaData.data ||
  ninjaData;

res.json({
  status: "success",
  message:
    `${idType.toUpperCase()} verification successful`,
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

console.error(
  "NIN/BVN ERROR:",
  e
);

res.status(500).json({
  status: "error",
  message:
    "Verification service error"
});

} finally {
client.release();
}
}

// =========================
// NIN
// =========================

app.post(
"/api/nin/verify",
(req, res) =>
verifyIdentity(
req,
res,
"nin"
)
);

// =========================
// BVN
// =========================

app.post(
"/api/bvn/verify",
(req, res) =>
verifyIdentity(
req,
res,
"bvn"
)
);

// =====================================================
// DIDIT — CREATE VERIFICATION SESSION
// =====================================================

app.post(
"/api/didit/session",
async (req, res) => {
try {
if (!process.env.DIDIT_API_KEY) {
return res.status(500).json({
status: "error",
message:
"Didit API key is not configured"
});
}

  const {
    email
  } = req.body;

  if (!email) {
    return res.status(400).json({
      status: "error",
      message:
        "Email required"
    });
  }

  // Make sure wallet exists
  await db.query(
    `INSERT INTO wallets(email)
     VALUES($1)
     ON CONFLICT(email)
     DO NOTHING`,
    [email]
  );

  const vendorData =
    "YSB-" +
    Date.now() +
    "-" +
    Math.floor(
      Math.random() * 10000
    );

  const response =
    await fetch(
      `${DIDIT_BASE_URL}/v3/session/`,
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
            DIDIT_WORKFLOW_ID,
          vendor_data:
            vendorData,
          callback:
            "https://ya-salam-business-api.onrender.com/api/didit/done"
        })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.session_id ||
    !data.url
  ) {
    console.error(
      "DIDIT SESSION ERROR:",
      response.status,
      data.message ||
        "Unable to create session"
    );

    return res.status(400).json({
      status: "error",
      message:
        data.message ||
        "Unable to create Didit verification session"
    });
  }

  await db.query(
    `INSERT INTO didit_sessions
     (session_id,email,vendor_data,status)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(session_id)
     DO NOTHING`,
    [
      data.session_id,
      email,
      vendorData,
      data.status ||
        "Not Started"
    ]
  );

  res.json({
    status: "success",
    session_id:
      data.session_id,
    url:
      data.url
  });

} catch (e) {
  console.error(
    "DIDIT SESSION ERROR:",
    e
  );

  res.status(500).json({
    status: "error",
    message:
      "Unable to create Didit verification session"
  });
}

}
);

// =====================================================
// DIDIT — CHECK SESSION
// =====================================================

app.get(
"/api/didit/session/:sessionId",
async (req, res) => {
try {
if (!process.env.DIDIT_API_KEY) {
return res.status(500).json({
status: "error",
message:
"Didit API key is not configured"
});
}

  const sessionId =
    req.params.sessionId;

  const response =
    await fetch(
      `${DIDIT_BASE_URL}/v3/session/${encodeURIComponent(sessionId)}/`,
      {
        headers: {
          "x-api-key":
            process.env.DIDIT_API_KEY
        }
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    return res.status(
      response.status
    ).json({
      status: "error",
      message:
        data.message ||
        "Unable to check Didit session"
    });
  }

  const sessionStatus =
    data.status ||
    "Not Started";

  await db.query(
    `UPDATE didit_sessions
     SET status=$1,
         updated_at=CURRENT_TIMESTAMP
     WHERE session_id=$2`,
    [
      sessionStatus,
      sessionId
    ]
  );

  res.json({
    status: "success",
    session_id:
      sessionId,
    verification_status:
      sessionStatus
  });

} catch (e) {
  console.error(
    "DIDIT CHECK ERROR:",
    e
  );

  res.status(500).json({
    status: "error",
    message:
      "Unable to check Didit session"
  });
}

}
);

// =====================================================
// DIDIT — CALLBACK
// =====================================================

app.get(
"/api/didit/done",
(req, res) => {
res.send(
"Didit verification completed. You can return to Ya Salam Business."
);
}
);

// =====================================================
// DIDIT — WEBHOOK SIGNATURE HELPERS
// =====================================================

function shortenWholeNumberFloats(
value
) {
if (
typeof value ===
"number" &&
Number.isFinite(value) &&
Number.isInteger(value)
) {
return value;
}

if (Array.isArray(value)) {
return value.map(
shortenWholeNumberFloats
);
}

if (
value &&
typeof value === "object"
) {
const out = {};

for (
  const key of Object.keys(
    value
  )
) {
  out[key] =
    shortenWholeNumberFloats(
      value[key]
    );
}

return out;

}

return value;
}

function sortObjectKeys(
value
) {
if (Array.isArray(value)) {
return value.map(
sortObjectKeys
);
}

if (
value &&
typeof value === "object"
) {
const out = {};

for (
  const key of Object.keys(
    value
  ).sort()
) {
  out[key] =
    sortObjectKeys(
      value[key]
    );
}

return out;

}

return value;
}

function diditCanonicalJson(
payload
) {
const shortened =
shortenWholeNumberFloats(
payload
);

const sorted =
sortObjectKeys(
shortened
);

return JSON.stringify(
sorted
);
}

function verifyDiditSignature(
payload,
signature,
timestamp,
secret
) {
if (
!signature ||
!timestamp ||
!secret
) {
return false;
}

const timestampNumber =
Number(timestamp);

if (
!Number.isFinite(
timestampNumber
)
) {
return false;
}

const now =
Math.floor(
Date.now() / 1000
);

if (
Math.abs(
now -
timestampNumber
) > 300
) {
return false;
}

const canonical =
diditCanonicalJson(
payload
);

const expected =
crypto
.createHmac(
"sha256",
secret
)
.update(
canonical
)
.digest("hex");

const a =
Buffer.from(
expected,
"utf8"
);

const b =
Buffer.from(
String(signature),
"utf8"
);

if (
a.length !== b.length
) {
return false;
}

return crypto.timingSafeEqual(
a,
b
);
}

// =====================================================
// DIDIT — WEBHOOK
// =====================================================

app.post(
"/api/didit/webhook",
async (req, res) => {
try {
const secret =
process.env.DIDIT_WEBHOOK_SECRET;

  if (!secret) {
    console.error(
      "DIDIT WEBHOOK SECRET NOT CONFIGURED"
    );

    return res.sendStatus(
      500
    );
  }

  const signature =
    req.headers[
      "x-signature-v2"
    ];

  const timestamp =
    req.headers[
      "x-timestamp"
    ];

  const valid =
    verifyDiditSignature(
      req.body,
      signature,
      timestamp,
      secret
    );

  if (!valid) {
    console.log(
      "DIDIT WEBHOOK: INVALID SIGNATURE"
    );

    return res.sendStatus(
      401
    );
  }

  const event =
    req.body || {};

  const eventId =
    event.event_id ||
    event.id;

  const eventType =
    event.event_type ||
    event.type ||
    "unknown";

  const sessionId =
    event.session_id ||
    event.data?.session_id ||
    event.data?.id ||
    null;

  if (!eventId) {
    return res.sendStatus(
      400
    );
  }

  // Deduplicate webhook events
  const inserted =
    await db.query(
      `INSERT INTO didit_webhook_events
       (event_id,event_type,session_id)
       VALUES($1,$2,$3)
       ON CONFLICT(event_id)
       DO NOTHING
       RETURNING id`,
      [
        String(eventId),
        String(eventType),
        sessionId
      ]
    );

  if (!inserted.rows.length) {
    return res.sendStatus(
      200
    );
  }

  // Update session status when available
  if (sessionId) {
    const status =
      event.status ||
      event.data?.status ||
      "Not Started";

    await db.query(
      `UPDATE didit_sessions
       SET status=$1,
           updated_at=CURRENT_TIMESTAMP
       WHERE session_id=$2`,
      [
        status,
        String(sessionId)
      ]
    );
  }

  console.log(
    "DIDIT WEBHOOK:",
    eventType,
    sessionId || ""
  );

  return res.sendStatus(
    200
  );

} catch (e) {
  console.error(
    "DIDIT WEBHOOK ERROR:",
    e
  );

  return res.sendStatus(
    500
  );
}

}
);

// =========================
// START SERVER
// =========================

setup()
.then(() => {
app.listen(
PORT,
() => {
console.log(
"Ya Salam Business backend running on port " +
PORT
);
}
);
})
.catch((e) => {
console.error(
"DATABASE SETUP ERROR:",
e
);

process.exit(1);

});(
payload,
signature,
timestamp,
secret
) {
if (
!signature ||
!timestamp ||
!secret
) {
return false;
}

const timestampNumber =
Number(timestamp);
