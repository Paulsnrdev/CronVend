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
  mini: 7,
  pro:  19,
  max:  43,
};

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
    subscriptionStatus: 'pending',
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
          <p style="margin:0 0 16px;color:#444;line-height:1.6">Here's your API key. Save it now: it will not be shown again.</p>
          <p style="margin:0 0 16px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:14px;color:#111;word-break:break-all">${apiKey}</p>
          <p style="margin:0 0 8px;color:#444;line-height:1.6">Point your order system at this endpoint to start sending order events:</p>
          <p style="margin:0 0 16px;padding:14px 16px;background:#f4f4f4;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:13px;color:#111;word-break:break-all">POST ${webhookUrl}<br>x-api-key: ${apiKey}</p>
          <p style="margin:0;color:#777;line-height:1.6;font-size:13px">Questions? Just reply to this email.</p>
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
    if (!tier || !TIER_PLAN_ENV[tier]) {
      return res.status(400).json({ error: 'tier must be mini, pro, or max' });
    }

    ({ tenantId } = await createTenant({ storeName, email, tier }));
  }

  try {
    const { link, txRef } = await createCheckoutLink({ tenantId, tier, email, name, secretKey });
    return res.status(200).json({ ok: true, link, txRef });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
