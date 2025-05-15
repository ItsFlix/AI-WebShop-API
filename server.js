import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import admin from 'firebase-admin';
import fs from 'fs';

// ======= Firebase Admin Initialization =======
// Replace with your own service account key path
const serviceAccount = JSON.parse(
  fs.readFileSync('./firebaseServiceAccountKey.json', 'utf-8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ======= Stripe Initialization =======
const stripe = new Stripe('sk_test_YOUR_SECRET_KEY');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper function to get the next numeric document ID in "Orders"
async function getNextOrderId() {
  const ordersRef = db.collection('Orders');
  const snapshot = await ordersRef.orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(1).get();

  if (snapshot.empty) {
    return '1'; // first order ID
  } else {
    const lastDocId = snapshot.docs[0].id;
    const lastIdNum = parseInt(lastDocId, 10);
    return (lastIdNum + 1).toString();
  }
}

app.post('/create-payment-intent', async (req, res) => {
  try {
    const { productid, amountbought } = req.body;
    if (!productid || !amountbought) {
      return res.status(400).json({ error: 'productid and amountbought are required' });
    }

    // Extract userid from Authorization header (assuming a Bearer token or just userId sent)
    // For simplicity, we assume the header contains the userid directly.
    const userid = req.headers['authorization'];
    if (!userid) {
      return res.status(401).json({ error: 'Unauthorized: Missing userid in Authorization header' });
    }

    // Get product info from Firestore
    const productDoc = await db.collection('Products').doc(productid).get();
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const productData = productDoc.data();
    if (!productData) {
      return res.status(500).json({ error: 'Invalid product data' });
    }

    // Check status, if needed (e.g., only allow if status === 'available')
    if (productData.status !== 'available') {
      return res.status(400).json({ error: 'Product is not available for purchase' });
    }

    const price = productData.price; // assuming price is in smallest currency unit (cents)

    // Calculate total amount (price * amountbought)
    const totalAmount = price * amountbought;

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',  // You may want to store currency per product or per user
      metadata: {
        productid,
        userid,
        amountbought: amountbought.toString(),
      },
    });

    // Prepare order data
    const orderData = {
      price,
      productid,
      amountbought,
      status: productData.status,
      boughtAt: admin.firestore.Timestamp.now(),
      userid,
      paymentintent: paymentIntent.id,
    };

    // Generate next order ID
    const newOrderId = await getNextOrderId();

    // Save order in Firestore
    await db.collection('Orders').doc(newOrderId).set(orderData);

    // Return client secret for payment
    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      orderId: newOrderId,
    });
  } catch (error) {
    console.error('Error creating payment intent and order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

