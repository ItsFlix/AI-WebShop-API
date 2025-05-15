import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import admin from 'firebase-admin';
import fs from 'fs';

// ======= Firebase Admin Initialization =======
const serviceAccount = JSON.parse(
  fs.readFileSync('./firebaseServiceAccountKey.json', 'utf-8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ======= Stripe Initialization =======
const stripe = new Stripe('sk_test_51ROeDnRqXej72CsPpKoFNSBlwcYHodrzvTFnqEbbsHAxL2nN4D80jOdydGd7oLtQQEgPUbUpR5om56Y3cp4uCfyP00HW80ErNn');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper: Get next order ID (incrementing document name)
async function getNextOrderId() {
  const ordersRef = db.collection('Orders');
  const snapshot = await ordersRef
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) return '1';
  const lastId = parseInt(snapshot.docs[0].id, 10);
  return (lastId + 1).toString();
}

// ======= Endpoint: Create PaymentIntent + Order =======
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { productid, amountbought } = req.body;

    // Extract and verify ID token
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const idToken = authHeader.split(' ')[1];

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (verifyErr) {
      return res.status(401).json({ error: 'Invalid or expired ID token' });
    }

    const userid = decodedToken.uid;

    // Validate input
    if (!productid || !amountbought) {
      return res.status(400).json({ error: 'productid and amountbought are required' });
    }

    // Fetch product data
    const productSnap = await db.collection('Products').doc(productid).get();
    if (!productSnap.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const productData = productSnap.data();
    const { price, status } = productData;

    if (status !== 'available') {
      return res.status(400).json({ error: 'Product is not available for purchase' });
    }

    const totalAmount = price * amountbought;

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      metadata: {
        productid,
        userid,
        amountbought: amountbought.toString(),
      },
    });

    // Create order object
    const orderData = {
      price,
      productid,
      amountbought,
      status,
      boughtAt: admin.firestore.Timestamp.now(),
      userid,
      paymentintent: paymentIntent.id,
    };

    const orderId = await getNextOrderId();

    // Save order to Firestore
    await db.collection('Orders').doc(orderId).set(orderData);

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      orderId,
    });
  } catch (error) {
    console.error('Error creating payment and order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
