const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 1. FIREBASE SETUP ---
if (!process.env.FIREBASE_KEY) {
  console.log("Warning: FIREBASE_KEY not found (OK for local test).");
} else {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
  } catch (e) {
    console.error("Firebase Init Error:", e);
  }
}

const db = admin.firestore();

// --- 2. HEALTH CHECK ---
app.get('/', (req, res) => {
  res.send('Pinoy Pool Server is LIVE! 🎱');
});

// --- 3. API: RECORD WIN ---
app.post('/api/record-win', async (req, res) => {
  const { uid, ballsPocketed, gameMode } = req.body;
  if (!uid) return res.status(400).json({ error: "Missing UID" });

  let REWARD_PER_BALL = 10;
  let XP_PER_BALL = 10;

  if (gameMode && (gameMode.includes('ai') || gameMode.includes('practice'))) {
      REWARD_PER_BALL = 2;
      XP_PER_BALL = 2;
  }

  const totalReward = (ballsPocketed || 0) * REWARD_PER_BALL;
  const totalXP = (ballsPocketed || 0) * XP_PER_BALL;

  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.set({
      balance: admin.firestore.FieldValue.increment(totalReward),
      xp: admin.firestore.FieldValue.increment(totalXP),
      lastPlayedTime: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- 4. API: DEDUCT BALANCE ---
app.post('/api/deduct-balance', async (req, res) => {
  const { uid, amount } = req.body;
  if (!uid || !amount) return res.status(400).json({ error: "Invalid data" });

  try {
    const playerRef = db.collection('players').doc(uid);
    await db.runTransaction(async (t) => {
      const doc = await t.get(playerRef);
      if (!doc.exists) throw "User not found";
      const currentBalance = doc.data().balance || 0;
      if (currentBalance < amount) throw "Insufficient funds";
      t.update(playerRef, { balance: currentBalance - amount });
    });
    const updatedDoc = await playerRef.get();
    res.json({ success: true, newBalance: updatedDoc.data().balance });
  } catch (error) {
    const msg = (error === "Insufficient funds") ? "Not enough balance" : "Transaction Failed";
    res.status(400).json({ success: false, message: msg });
  }
});

// --- 5. API: MATCH PAYOUT ---
app.post('/api/match-payout', async (req, res) => {
  const { uid, betAmount } = req.body;
  if (!uid) return res.json({ success: true });

  const WINNINGS = (betAmount || 0) * 1.8; // Simple 10% cut logic

  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.update({
        balance: admin.firestore.FieldValue.increment(WINNINGS)
    });
    const updatedDoc = await playerRef.get();
    res.json({ success: true, newBalance: updatedDoc.data().balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- 6. API: REFUND (CORRECTED) ---
app.post('/api/refund', async (req, res) => {
  const { uid, amount } = req.body;
  if (!uid || !amount) return res.status(400).json({ error: "Missing data" });

  try {
    const playerRef = db.collection('players').doc(uid);
    // ETO ANG AYOS NA CODE:
    await playerRef.update({
        balance: admin.firestore.FieldValue.increment(amount)
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Refund Error:", error);
    res.status(500).json({ error: "Refund failed" });
  }
});

// --- 7. API: AD REWARD ---
app.post('/api/ad-reward', async (req, res) => {
  const { uid, amount } = req.body;
  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.update({
        balance: admin.firestore.FieldValue.increment(amount)
    });
    const updatedDoc = await playerRef.get();
    res.json({ success: true, newBalance: updatedDoc.data().balance });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
  }
});

// --- HYBRID START (Magic Part) ---
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Server is RUNNING! Port: ${PORT}`);
  });
}
module.exports = app;