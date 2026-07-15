'use strict';

const { db } = require('../_lib/firebase-admin');

// Admin-only endpoint. Call this after registering a new tenant to generate
// a Flutterwave hosted checkout link you can send to the client.
//
// POST /api/billing/subscribe
// Headers: x-admin-key: <ADMIN_SECRET>
// Body: { tenantId, tier, email, name }
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
  if (req.headers['x-admin-key'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: 'FLUTTERWAVE_SECRET_KEY not configured' });

  const { tenantId, tier, email, name } = req.body || {};

  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  if (!tier || !TIER_PLAN_ENV[tier]) {
    return res.status(400).json({ error: 'tier must be mini, pro, or max' });
  }
  if (!email) return res.status(400).json({ error: 'email required' });

  // Verify tenant exists
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return res.status(404).json({ error: 'Tenant not found' });

  const planId = process.env[TIER_PLAN_ENV[tier]];
  if (!planId) {
    return res.status(500).json({ error: `${TIER_PLAN_ENV[tier]} env var not set` });
  }

  const siteUrl = process.env.SITE_URL || '';
  const txRef   = `${tenantId}-${Date.now()}`;

  const payload = {
    tx_ref:       txRef,
    amount:       TIER_PRICES[tier],
    currency:     'USD',
    payment_plan: planId,
    redirect_url: `${siteUrl}/api/billing/callback`,
    customer: {
      email,
      name: name || email,
    },
    customizations: {
      title:       'CronVend',
      description: `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan — email automation for your store`,
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
    return res.status(502).json({ error: 'Flutterwave error', detail: flwBody.message });
  }

  return res.status(200).json({
    ok:   true,
    link: flwBody.data.link,
    txRef,
  });
};
