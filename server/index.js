require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const sendEmail = require('./send_email');

const app = express();
app.use(cors());
app.use(bodyParser.json());

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) return null;
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id, key_secret });
}

// Serve the existing static HTML as the homepage
app.use('/', express.static(path.join(__dirname, '..')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dsa-roadmap-landing (1).html'));
});

// Create an order and return order_id to frontend
app.post('/api/create-order', async (req, res) => {
  const { name, email, phone, amount } = req.body;
  if (!name || !email || !phone) return res.status(400).json({ error: 'Missing customer info' });
  const amt = amount || 99;
  const receipt = 'rcpt_' + uuidv4().replace(/-/g, '');
  try {
    const razorpay = getRazorpay();
    if (!razorpay) return res.status(500).json({ error: 'Payment gateway not configured on server' });
    const order = await razorpay.orders.create({ amount: amt * 100, currency: 'INR', receipt, payment_capture: 1 });
    // store provisional purchase with status 'created'
    db.insertPurchase({ name, email, phone, order_id: order.id, amount: amt, status: 'created' });
    res.json({ orderId: order.id, amount: amt * 100, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create order' });
  }
});

// Verify payment signature and finalize
app.post('/api/verify-payment', async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) return res.status(400).json({ error: 'Missing payment fields' });

  const generated_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generated_signature !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    // Update DB
    const purchase = db.getPurchaseByOrderId(razorpay_order_id);
    if (!purchase) return res.status(404).json({ error: 'Order not found' });

    db.updatePurchaseByOrderId(razorpay_order_id, {
      payment_id: razorpay_payment_id,
      status: 'paid',
      purchase_date: new Date().toISOString()
    });

    // generate secure download token (one-time or time-limited)
    const token = uuidv4();
    db.insertDownloadToken({ token, order_id: razorpay_order_id, email: purchase.email, created_at: new Date().toISOString(), used: 0 });

    // send email via Resend
    const downloadUrl = `${process.env.PDF_DOWNLOAD_URL}?token=${token}`;
    await sendEmail(purchase.name, purchase.email, downloadUrl);

    res.json({ success: true, downloadUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Secure download route: validate token
app.get('/download', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('Missing token');
  const rec = db.getDownloadToken(token);
  if (!rec) return res.status(404).send('Invalid or expired token');
  if (rec.used) return res.status(410).send('Token already used');

  // optional expiry: 7 days
  const created = new Date(rec.created_at);
  const now = new Date();
  const days = (now - created) / (1000 * 60 * 60 * 24);
  if (days > 30) return res.status(410).send('Token expired');

  // mark used
  db.markTokenUsed(token);

  // If a local PDF path is configured, stream it after validation.
  const localPdf = process.env.PDF_FILE_PATH; // optional
  if (localPdf) {
    const fs = require('fs');
    const stat = fs.statSync(localPdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="dsa-roadmap.pdf"`);
    const stream = fs.createReadStream(localPdf);
    return stream.pipe(res);
  }

  // Fallback: redirect to configured secure PDF URL (append token)
  const securePdf = process.env.PDF_DOWNLOAD_URL ? (process.env.PDF_DOWNLOAD_URL + '?token=' + token) : '/';
  res.redirect(302, securePdf);
});

// Webhook endpoint to validate events from Razorpay
app.post('/webhook/razorpay', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const signature = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (signature !== expected) return res.status(400).send('Invalid signature');

  // handle events
  const event = req.body.event;
  if (event === 'payment.captured') {
    const payload = req.body.payload.payment.entity;
    const order_id = payload.order_id;
    const payment_id = payload.id;
    // idempotent update
    const purchase = db.getPurchaseByOrderId(order_id);
    if (purchase && purchase.status !== 'paid') {
      db.updatePurchaseByOrderId(order_id, { payment_id, status: 'paid', purchase_date: new Date().toISOString() });
    }
  }

  res.json({ ok: true });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log('Server listening on', PORT));
