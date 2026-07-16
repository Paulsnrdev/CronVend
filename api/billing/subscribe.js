'use strict';

const crypto = require('crypto');
const { db, admin } = require('../_lib/firebase-admin');
const { hashApiKey } = require('../_lib/auth');
const { sendEmail }  = require('../_lib/resend');

// POST /api/billing/subscribe
//
// Two ways to call this:
//
// 1. Admin — generate a checkout link for an already-registered tenant.
//    Headers: x-admin-key: <ADMIN_SECRET>
//    Body:    { tenantId, tier, email, name }
//
// 2. Public self-serve signup — used by the pricing page. Creates the
//    tenant and the checkout link in one call. Rate-limited by IP since
//    it's unauthenticated.
//    Body:    { storeName, email, tier }
//
// Returns: { link }

const TIER_PLAN_ENV = {
  mini: 'FLUTTERWAVE_PLAN_MINI',
  pro:  'FLUTTERWAVE_PLAN_PRO',
  max:  'FLUTTERWAVE_PLAN_MAX',
};

// Display prices shown on the checkout page — must match what you set in FLW.
const TIER_PRICES = {
  free: 0,
  mini: 7,
  pro:  19,
  max:  43,
};

const PAID_TIERS = new Set(['mini', 'pro', 'max']);

const SIGNUP_LIMIT_PER_HOUR = 5;

function generateApiKey() {
  return 'cv_live_' + crypto.randomBytes(24).toString('hex');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Rate-limits by IP instead of tenantId — there's no tenant yet at this point.
async function checkSignupRateLimit(ip) {
  const now  = new Date();
  const hour = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
  const ref  = db.collection('rateLimits').doc(`signup:${ip}:${hour}`);

  let allowed = true;
  await db.runTransaction(async tx => {
    const doc   = await tx.get(ref);
    const count = (doc.exists ? doc.data().count : 0) + 1;
    if (count > SIGNUP_LIMIT_PER_HOUR) { allowed = false; return; }
    tx.set(ref, {
      count,
      expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 3600 * 1000),
    });
  });
  return allowed;
}

async function createTenant({ storeName, email, tier }) {
  const apiKey   = generateApiKey();
  const keyHash  = hashApiKey(apiKey);
  const tenantId = db.collection('tenants').doc().id;
  const now      = new Date().toISOString();

  await db.collection('tenants').doc(tenantId).set({
    tenantId,
    email,
    storeName,
    storeUrl:           '',
    reviewUrl:          '',
    tier,
    subscriptionStatus: tier === 'free' ? 'active' : 'pending',
    createdAt:          now,
  });

  await db.collection('apiKeys').doc(keyHash).set({ tenantId, createdAt: now });

  // The raw key only ever exists here — the browser is about to redirect to
  // Flutterwave checkout, so email it now rather than relying on the
  // payment webhook (which never sees the raw key, only the hash).
  await sendWelcomeEmail({ email, storeName, apiKey });

  return { tenantId };
}

async function sendWelcomeEmail({ email, storeName, apiKey }) {
  const siteUrl    = process.env.SITE_URL || '';
  const webhookUrl = `${siteUrl}/api/webhook/orders`;

  try {
    await sendEmail({
      to:      email,
      subject: 'Your CronVend API key',
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px">
        <tr><td style="background:#111;padding:24px 32px">
          <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px">CronVend</span>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 16px;font-size:22px;color:#111">Welcome, ${storeName}</h1>
          <p style="margin:0 0 16px;color:#444;line-height:1.6">Here's your API key. Save it now — it will not be shown again.</p>
          <p style="margin:0 0 24px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:14px;color:#111;word-break:break-all">${apiKey}</p>

          <h2 style="margin:0 0 6px;font-size:16px;color:#111">Connect your store</h2>
          <p style="margin:0 0 20px;color:#666;font-size:13px;line-height:1.5">Pick your platform below. It's a one-time setup — after that, CronVend runs automatically.</p>

          <!-- ── Node.js ── -->
          <p style="margin:0 0 12px;padding:8px 14px;background:#111;border-radius:6px;font-size:12px;font-weight:700;color:#fff;letter-spacing:.4px">Node.js / Express</p>

          <p style="margin:0 0 6px;color:#444;font-size:13px;font-weight:600">Step 1 — Add cronvend.js to your project:</p>
          <p style="margin:0 0 14px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#111;white-space:pre-wrap;word-break:break-all">const CRONVEND_KEY = '${apiKey}';
const CRONVEND_URL = '${webhookUrl}';

async function notifyCronVend(event, order) {
  await fetch(CRONVEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CRONVEND_KEY },
    body: JSON.stringify({ event, order })
  });
}

module.exports = { notifyCronVend };</p>

          <p style="margin:0 0 6px;color:#444;font-size:13px;font-weight:600">Step 2 — Call it in your order routes:</p>
          <p style="margin:0 0 28px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#111;white-space:pre-wrap;word-break:break-all">const { notifyCronVend } = require('./cronvend');

// When order is placed
await notifyCronVend('order.created', {
  orderId: order.id,
  customerEmail: order.email,
  customerName: order.name,
  orderRef: order.reference,
  totalAmount: order.total
});

// When payment confirmed
await notifyCronVend('order.paid', { orderId: order.id });

// When order is delivered
await notifyCronVend('order.delivered', { orderId: order.id });</p>

          <!-- ── PHP ── -->
          <p style="margin:0 0 12px;padding:8px 14px;background:#777bb3;border-radius:6px;font-size:12px;font-weight:700;color:#fff;letter-spacing:.4px">PHP &nbsp;·&nbsp; WooCommerce &nbsp;·&nbsp; Laravel</p>

          <p style="margin:0 0 6px;color:#444;font-size:13px;font-weight:600">Step 1 — Add cronvend.php to your project:</p>
          <p style="margin:0 0 14px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#111;white-space:pre-wrap;word-break:break-all">&lt;?php
define('CRONVEND_KEY', '${apiKey}');
define('CRONVEND_URL', '${webhookUrl}');

function notify_cronvend($event, $order = []) {
  $ch = curl_init(CRONVEND_URL);
  curl_setopt_array($ch, [
    CURLOPT_POST           =&gt; true,
    CURLOPT_HTTPHEADER     =&gt; [
      'Content-Type: application/json',
      'x-api-key: ' . CRONVEND_KEY,
    ],
    CURLOPT_POSTFIELDS     =&gt; json_encode(['event' =&gt; $event, 'order' =&gt; $order]),
    CURLOPT_RETURNTRANSFER =&gt; true,
    CURLOPT_TIMEOUT        =&gt; 5,
  ]);
  curl_exec($ch);
  curl_close($ch);
}</p>

          <p style="margin:0 0 6px;color:#444;font-size:13px;font-weight:600">Step 2 — Call it in your order hooks:</p>
          <p style="margin:0 0 28px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#111;white-space:pre-wrap;word-break:break-all">require_once 'cronvend.php';

// When order is placed (e.g. woocommerce_checkout_order_created)
notify_cronvend('order.created', [
  'orderId'       =&gt; $order-&gt;get_id(),
  'customerEmail' =&gt; $order-&gt;get_billing_email(),
  'customerName'  =&gt; $order-&gt;get_billing_first_name() . ' ' . $order-&gt;get_billing_last_name(),
  'orderRef'      =&gt; $order-&gt;get_order_number(),
  'totalAmount'   =&gt; (float) $order-&gt;get_total(),
]);

// When payment confirmed (e.g. woocommerce_payment_complete)
notify_cronvend('order.paid', ['orderId' =&gt; $order-&gt;get_id()]);

// When order completed (e.g. woocommerce_order_status_completed)
notify_cronvend('order.delivered', ['orderId' =&gt; $order-&gt;get_id()]);</p>

          <!-- ── Shopify ── -->
          <p style="margin:0 0 12px;padding:8px 14px;background:#5c6ac4;border-radius:6px;font-size:12px;font-weight:700;color:#fff;letter-spacing:.4px">Shopify</p>
          <p style="margin:0 0 10px;color:#444;font-size:13px;line-height:1.6">A one-click <strong>CronVend Shopify App</strong> is coming soon. Until then, use this adapter — deploy it as a route on any Node.js server, then point your Shopify webhooks at it.</p>

          <p style="margin:0 0 6px;color:#444;font-size:13px;font-weight:600">adapter.js — Shopify webhook receiver:</p>
          <p style="margin:0 0 14px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#111;white-space:pre-wrap;word-break:break-all">const crypto = require('crypto');
const CRONVEND_KEY = '${apiKey}';
const CRONVEND_URL = '${webhookUrl}';

const EVENT_MAP = {
  'orders/create':    'order.created',
  'orders/paid':      'order.paid',
  'orders/fulfilled': 'order.delivered',
};

// express.raw() is required so we can verify the Shopify HMAC signature
app.post('/shopify-to-cronvend', express.raw({ type: 'application/json' }), async (req, res) =&gt; {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const hash = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(req.body).digest('base64');
  if (hmac !== hash) return res.status(401).end();

  const event = EVENT_MAP[req.headers['x-shopify-topic']];
  if (!event) return res.status(200).end();

  const o = JSON.parse(req.body);
  const name = [o.billing_address?.first_name, o.billing_address?.last_name]
    .filter(Boolean).join(' ');

  await fetch(CRONVEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CRONVEND_KEY },
    body: JSON.stringify({
      event,
      order: {
        orderId:       String(o.id),
        customerEmail: o.email,
        customerName:  name,
        orderRef:      String(o.order_number),
        totalAmount:   parseFloat(o.total_price),
      },
    }),
  });

  res.status(200).end();
});</p>

          <p style="margin:0 0 28px;color:#666;font-size:12px;line-height:1.6">Then go to <strong>Shopify Admin → Settings → Notifications → Webhooks</strong> and add webhooks for <em>Order creation</em>, <em>Order payment</em>, and <em>Order fulfillment</em> — all pointing to your adapter URL.</p>

          <!-- ── Footer ── -->
          <p style="margin:0 0 16px;color:#444;line-height:1.6;font-size:14px">That's it. CronVend will automatically send payment reminders, follow-up emails, and promo codes from that point.</p>
          <p style="margin:0 0 16px;"><a href="${siteUrl}/dashboard.html" style="display:inline-block;background:#6c63ff;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px;">View your dashboard →</a></p>
          <p style="margin:0;color:#999;line-height:1.6;font-size:13px">Questions? Just reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });
  } catch (err) {
    console.error('[billing/subscribe] welcome email failed', err.message);
  }
}

async function createCheckoutLink({ tenantId, tier, email, name, secretKey }) {
  const planId = process.env[TIER_PLAN_ENV[tier]];
  if (!planId) throw new Error(`${TIER_PLAN_ENV[tier]} env var not set`);

  const siteUrl = process.env.SITE_URL || '';
  const txRef   = `${tenantId}-${Date.now()}`;

  const payload = {
    tx_ref:       txRef,
    amount:       TIER_PRICES[tier],
    currency:     'USD',
    payment_plan: planId,
    redirect_url: `${siteUrl}/signup-success.html`,
    customer: {
      email,
      name: name || email,
    },
    customizations: {
      title:       'CronVend',
      description: `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan: email automation for your store`,
      logo:        `${siteUrl}/logo.png`,
    },
    meta: {
      tenantId,
      tier,
    },
  };

  const flwRes = await fetch('https://api.flutterwave.com/v3/payments', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });

  const flwBody = await flwRes.json();

  if (!flwRes.ok || flwBody.status !== 'success') {
    console.error('[billing/subscribe] FLW error', flwBody);
    throw new Error(flwBody.message || 'Flutterwave error');
  }

  return { link: flwBody.data.link, txRef };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: 'FLUTTERWAVE_SECRET_KEY not configured' });

  const adminSecret = process.env.ADMIN_SECRET;
  const isAdmin     = !!adminSecret && req.headers['x-admin-key'] === adminSecret;

  let tenantId, tier, email, name;

  if (isAdmin) {
    ({ tenantId, tier, email, name } = req.body || {});

    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
    if (!tier || !TIER_PLAN_ENV[tier]) {
      return res.status(400).json({ error: 'tier must be mini, pro, or max' });
    }
    if (!email) return res.status(400).json({ error: 'email required' });

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res.status(404).json({ error: 'Tenant not found' });

  } else {
    const ip      = clientIp(req);
    const allowed = await checkSignupRateLimit(ip);
    if (!allowed) return res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });

    const body      = req.body || {};
    const storeName = (body.storeName || '').trim();
    email = (body.email || '').trim();
    tier  = body.tier;
    name  = storeName;

    if (!storeName) return res.status(400).json({ error: 'storeName is required' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!tier || !TIER_PRICES.hasOwnProperty(tier)) {
      return res.status(400).json({ error: 'tier must be free, mini, pro, or max' });
    }

    ({ tenantId } = await createTenant({ storeName, email, tier }));

    if (tier === 'free') {
      return res.status(200).json({ ok: true, free: true, redirect: '/signup-success.html' });
    }
  }

  try {
    const { link, txRef } = await createCheckoutLink({ tenantId, tier, email, name, secretKey });
    return res.status(200).json({ ok: true, link, txRef });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
