const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 1. FIREBASE SETUP (Optimized for Vercel) ---
if (process.env.FIREBASE_KEY) {
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

// --- 2. SECURITY HELPER: TELEGRAM VALIDATION ---
function verifyTelegramData(initData) {
  if (!initData || !process.env.TELEGRAM_BOT_TOKEN) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return calculatedHash === hash;
}

// --- 3. ROUTES (Inalis na ang /api prefix dahil nasa api folder na ito) ---

// Root check: babasahin ito as yourdomain.com/api
app.get('/', (req, res) => {
  res.send('Pinoy Pool Server is LIVE! 🎱 - Secured Version');
});

// Ad Reward: yourdomain.com/api/ad-reward
app.post('/ad-reward', async (req, res) => {
  const { uid, initData } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ error: "Unauthorized" });

  const FIXED_AD_REWARD = 50;
  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.update({ balance: admin.firestore.FieldValue.increment(FIXED_AD_REWARD) });
    const updatedDoc = await playerRef.get();
    res.json({ success: true, newBalance: updatedDoc.data().balance });
  } catch (error) { res.status(500).json({ error: "Failed" }); }
});

// Start Match: yourdomain.com/api/start-match
app.post('/start-match', async (req, res) => {
  const { uid, betAmount, initData } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ error: "Unauthorized" });

  const matchId = `match_${Date.now()}_${uid}`;
  try {
    const playerRef = db.collection('players').doc(uid);
    await db.runTransaction(async (t) => {
      const doc = await t.get(playerRef);
      if (!doc.exists) throw "User not found";
      const currentBalance = doc.data().balance || 0;
      if (currentBalance < betAmount) throw "Insufficient funds";

      t.update(playerRef, { balance: currentBalance - betAmount });
      t.set(db.collection('matches').doc(matchId), {
        uid, bet: betAmount, status: 'active', startTime: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    res.json({ success: true, matchId });
  } catch (error) { res.status(400).json({ error: error.toString() }); }
});

// Validate Win: yourdomain.com/api/validate-win
app.post('/validate-win', async (req, res) => {
  const { uid, matchId, initData } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const matchRef = db.collection('matches').doc(matchId);
    const playerRef = db.collection('players').doc(uid);
    const result = await db.runTransaction(async (t) => {
      const matchDoc = await t.get(matchRef);
      if (!matchDoc.exists || matchDoc.data().status !== 'active') throw "Invalid match";

      const WINNINGS = matchDoc.data().bet * 1.8;
      t.update(playerRef, {
        balance: admin.firestore.FieldValue.increment(WINNINGS),
        trophies: admin.firestore.FieldValue.increment(25),
        xp: admin.firestore.FieldValue.increment(50),
        wins: admin.firestore.FieldValue.increment(1)
      });
      t.update(matchRef, { status: 'completed', payout: WINNINGS });
      return { winnings: WINNINGS, trophies: 25, xp: 50 };
    });
    res.json({ success: true, data: result });
  } catch (error) { res.status(400).json({ error: error.toString() }); }
});

// Refund: yourdomain.com/api/refund
app.post('/refund', async (req, res) => {
  const { uid, amount, initData } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.update({ balance: admin.firestore.FieldValue.increment(amount) });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "Refund failed" }); }
});

// --- EXPORT FOR VERCEL ---
module.exports = app;
