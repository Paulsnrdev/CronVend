'use strict';

const { db, admin } = require('../_lib/firebase-admin');

// Flutterwave sends a verif-hash header on every webhook.
// The value is the secret hash you configure in your FLW dashboard under
// "Webhooks" — store it as FLUTTERWAVE_WEBHOOK_HASH in your env vars.
function verifySignature(req) {
  const hash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
  if (!hash) return true; // not configured — allow in dev; block in prod below
  return req.headers['verif-hash'] === hash;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.FLUTTERWAVE_WEBHOOK_HASH) {
    console.error('[billing/webhook] FLUTTERWAVE_WEBHOOK_HASH not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const { event, data } = req.body || {};

  if (!event || !data) {
    return res.status(400).json({ error: 'Missing event or data' });
  }

  try {
    if (event === 'charge.completed' && data.status === 'successful') {
      await handleChargeCompleted(data);
    } else if (event === 'subscription.cancelled') {
      await handleSubscriptionCancelled(data);
    }
    // All other events (charge.failed etc.) are acknowledged but not acted on yet.
  } catch (err) {
    console.error('[billing/webhook] handler error', event, err.message);
    return res.status(500).json({ error: err.message });
  }

  // Flutterwave expects a 200 quickly — always return 200 after processing.
  return res.status(200).json({ ok: true });
};

// ── charge.completed ──────────────────────────────────────────────────────────
// Fires on both the initial subscription payment and every renewal charge.

async function handleChargeCompleted(data) {
  const meta     = data.meta   || {};
  const customer = data.customer || {};
  const tenantId = meta.tenantId;
  const tier     = meta.tier;

  if (!tenantId) {
    // Renewal charge — FLW may not carry meta forward on auto-charges.
    // Fall back to the billingCustomers lookup by FLW customer ID.
    if (customer.id) {
      await renewByCustomerId(String(customer.id), data);
    }
    return;
  }

  await activateTenant({ tenantId, tier, data });
}

async function activateTenant({ tenantId, tier, data }) {
  const customer   = data.customer || {};
  const flwCustId  = String(customer.id || '');
  const now        = new Date().toISOString();

  const tenantRef = db.collection('tenants').doc(tenantId);

  await tenantRef.update({
    tier:                   tier || 'mini',
    subscriptionStatus:     'active',
    subscriptionActivatedAt: now,
    subscriptionRenewedAt:  now,
    flwCustomerId:          flwCustId,
    flwPlanId:              String(data.plan || ''),
    billingEmail:           customer.email || '',
  });

  // Top-level lookup: flwCustomerId → tenantId
  // Used when a renewal charge arrives without meta.tenantId
  if (flwCustId) {
    await db.collection('billingCustomers').doc(flwCustId).set(
      { tenantId, updatedAt: now },
      { merge: true }
    );
  }

  console.log('[billing/webhook] activated', tenantId, tier);
}

async function renewByCustomerId(flwCustId, data) {
  const snap = await db.collection('billingCustomers').doc(flwCustId).get();
  if (!snap.exists) {
    console.warn('[billing/webhook] unknown FLW customer', flwCustId);
    return;
  }

  const { tenantId } = snap.data();
  await db.collection('tenants').doc(tenantId).update({
    subscriptionStatus:    'active',
    subscriptionRenewedAt: new Date().toISOString(),
  });

  console.log('[billing/webhook] renewed', tenantId, 'customer', flwCustId);
}

// ── subscription.cancelled ────────────────────────────────────────────────────

async function handleSubscriptionCancelled(data) {
  const customer  = data.customer || {};
  const flwCustId = String(customer.id || '');

  if (!flwCustId) {
    console.warn('[billing/webhook] subscription.cancelled without customer id');
    return;
  }

  const snap = await db.collection('billingCustomers').doc(flwCustId).get();
  if (!snap.exists) {
    console.warn('[billing/webhook] unknown FLW customer on cancel', flwCustId);
    return;
  }

  const { tenantId } = snap.data();
  await db.collection('tenants').doc(tenantId).update({
    subscriptionStatus:      'cancelled',
    subscriptionCancelledAt: new Date().toISOString(),
  });

  console.log('[billing/webhook] cancelled', tenantId);
}
