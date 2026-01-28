const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto'); // Import para sa security validation

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 1. FIREBASE SETUP ---
if (!process.env.FIREBASE_KEY) {
  console.log("Warning: FIREBASE_KEY not found.");
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

// --- 2. SECURITY HELPER: TELEGRAM VALIDATION ---
// Tinitiyak nito na ang request ay galing talaga sa Telegram app mo.
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

// --- 3. API: HEALTH CHECK ---
app.get('/', (req, res) => {
  res.send('Pinoy Pool Server is LIVE! 🎱 - Secured Version');
});

// --- 4. API: AD REWARD (SECURED) ---
app.post('/api/ad-reward', async (req, res) => {
  const { uid, initData } = req.body;

  // Security Check: Galing ba sa Telegram?
  if (!verifyTelegramData(initData)) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  const FIXED_AD_REWARD = 50; // Dito mo i-set ang reward, hindi sa client!

  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.update({
      balance: admin.firestore.FieldValue.increment(FIXED_AD_REWARD)
    });
    const updatedDoc = await playerRef.get();
    res.json({ success: true, newBalance: updatedDoc.data().balance });
  } catch (error) {
    res.status(500).json({ error: "Reward failed" });
  }
});

// --- 5. API: START MATCH (NEW SECURITY LAYER) ---
// Tatawagin ito sa simula ng laro para magkaroon ng "Match Record"
app.post('/api/start-match', async (req, res) => {
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

      // Bawasan ang pera at i-record ang match
      t.update(playerRef, { balance: currentBalance - betAmount });
      t.set(db.collection('matches').doc(matchId), {
        uid,
        bet: betAmount,
        status: 'active',
        startTime: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.json({ success: true, matchId });
  } catch (error) {
    res.status(400).json({ error: error.toString() });
  }
});

// --- 6. API: VALIDATE WIN & PAYOUT (SECURED) ---
app.post('/api/validate-win', async (req, res) => {
  const { uid, matchId, initData } = req.body;

  if (!verifyTelegramData(initData)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const matchRef = db.collection('matches').doc(matchId);
    const playerRef = db.collection('players').doc(uid);

    const result = await db.runTransaction(async (t) => {
      const matchDoc = await t.get(matchRef);
      
      if (!matchDoc.exists || matchDoc.data().status !== 'active') {
        throw "Invalid or expired match";
      }

      const matchData = matchDoc.data();
      const WINNINGS = matchData.bet * 1.8; // 10% House Cut per player
      const TROPHIES = 25;
      const XP = 50;

      // I-update ang player
      t.update(playerRef, {
        balance: admin.firestore.FieldValue.increment(WINNINGS),
        trophies: admin.firestore.FieldValue.increment(TROPHIES),
        xp: admin.firestore.FieldValue.increment(XP),
        wins: admin.firestore.FieldValue.increment(1)
      });

      // Tapusin na ang match record para hindi na ma-claim ulit
      t.update(matchRef, { status: 'completed', payout: WINNINGS });

      return { winnings: WINNINGS, trophies: TROPHIES, xp: XP };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.toString() });
  }
});

// --- 7. API: REFUND (SECURED) ---
app.post('/api/refund', async (req, res) => {
  const { uid, amount, initData } = req.body;
  
  if (!verifyTelegramData(initData)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const playerRef = db.collection('players').doc(uid);
    await playerRef.update({
      balance: admin.firestore.FieldValue.increment(amount)
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Refund failed" });
  }
});

// --- HYBRID START ---
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Secured Server is RUNNING! Port: ${PORT}`);
  });
}

module.exports = app;
