'use strict';

const { db }                      = require('../_lib/firebase-admin');
const { sendEmail }               = require('../_lib/resend');
const { createPromo }             = require('../_lib/promo');
const { getUpsellRecommendations} = require('../_lib/claude');
const { can, emailCap }           = require('../_lib/tiers');
const { awaitingPaymentHtml }     = require('../_lib/templates/awaiting-payment');
const { satisfactionHtml, reviewRequestHtml } = require('../_lib/templates/delivery-followup');
const { upsellHtml }              = require('../_lib/templates/upsell');

const AWAITING_STAGES = [
  { key: 'h1',  ms:  1 * 3600 * 1000 },
  { key: 'h12', ms: 12 * 3600 * 1000 },
  { key: 'h24', ms: 24 * 3600 * 1000 },
];

const THREE_DAYS = 3 * 86400 * 1000;
const SIX_DAYS   = 6 * 86400 * 1000;
const EIGHT_DAYS = 8 * 86400 * 1000;

// Called by /api/cron once per tenant. Runs in its own Vercel function
// invocation so each tenant gets a full independent 60-second timeout budget.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '').trim() !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { tenantId } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) return res.status(404).json({ error: 'Tenant not found' });

  const now    = Date.now();
  const tenant = tenantDoc.data();

  // Skip tenants whose subscription is not active.
  // Tenants without a subscriptionStatus field (pre-billing or in trial) are allowed through.
  const subStatus = tenant.subscriptionStatus;
  if (subStatus && subStatus !== 'active') {
    console.log('[cron/tenant] skipping', tenantId, 'subscription:', subStatus);
    return res.status(200).json({ ok: true, tenantId, sent: 0, capped: false, skipped: true });
  }

  try {
    const { sent, capped } = await processTenant({ tenantId, tenant, now });
    return res.status(200).json({ ok: true, tenantId, sent, capped });
  } catch (err) {
    console.error('[cron/tenant] error', tenantId, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// ── Tenant processing ─────────────────────────────────────────────────────────

async function processTenant({ tenantId, tenant, now }) {
  const tier = tenant.tier || 'mini';
  const cap  = { sent: 0, max: emailCap(tier) };

  const ap = await runAwaitingPayment({ tenantId, tenant, now, cap });
  const fu = await runFollowUps({ tenantId, tenant, now, cap });
  return { sent: ap + fu, capped: cap.sent >= cap.max };
}

// ── Awaiting-payment reminders ────────────────────────────────────────────────

async function runAwaitingPayment({ tenantId, tenant, now, cap }) {
  const tier      = tenant.tier || 'mini';
  const storeName = tenant.storeName || 'Our Store';
  const storeUrl  = tenant.storeUrl  || '#';
  const from      = can(tier, 'customSenderDomain') && tenant.customFrom ? tenant.customFrom : undefined;
  let sent = 0;

  const snap = await db.collection('tenants').doc(tenantId)
    .collection('orders')
    .where('orderStatus', '==', 'awaiting_payment')
    .get();

  for (const doc of snap.docs) {
    if (cap.sent >= cap.max) break;

    const order = doc.data();
    const age   = now - new Date(order.createdAt).getTime();
    const done  = order.awaitingReminders || {};

    for (const stage of AWAITING_STAGES) {
      if (age < stage.ms || done[stage.key]) continue;

      const { subject, html } = awaitingPaymentHtml({
        customerName: order.customerName,
        orderRef:     order.orderRef,
        totalAmount:  order.totalAmount,
        storeUrl,
        storeName,
        stage:        stage.key,
      });

      await sendEmail({ to: order.customerEmail, subject, html, from, tenantId, orderId: doc.id, emailType: `awaiting_${stage.key}` });
      await doc.ref.update({ [`awaitingReminders.${stage.key}`]: true });
      await logEvent(tenantId, { orderId: doc.id, type: `awaiting_${stage.key}`, metadata: { email: order.customerEmail } });
      sent++;
      cap.sent++;
      break; // one stage per hourly run per order
    }
  }

  return sent;
}

// ── Post-delivery follow-up sequences ────────────────────────────────────────

async function runFollowUps({ tenantId, tenant, now, cap }) {
  const tier      = tenant.tier || 'mini';
  const storeName = tenant.storeName || 'Our Store';
  const storeUrl  = tenant.storeUrl  || '#';
  const reviewUrl = tenant.reviewUrl || storeUrl;
  const baseUrl   = process.env.SITE_URL || '';
  const from      = can(tier, 'customSenderDomain') && tenant.customFrom ? tenant.customFrom : undefined;
  let sent = 0;

  const snap = await db.collection('tenants').doc(tenantId)
    .collection('followUps')
    .where('optedOut', '==', false)
    .get();

  for (const doc of snap.docs) {
    if (cap.sent >= cap.max) break;

    const fu             = doc.data();
    const age            = now - new Date(fu.deliveredAt).getTime();
    const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${fu.unsubscribeToken}`;

    // day 3 — satisfaction check-in
    if (age >= THREE_DAYS && !fu.day3) {
      const { subject, html } = satisfactionHtml({
        customerName: fu.customerName,
        orderRef:     fu.orderRef || doc.id,
        storeName,
        reviewUrl,
        unsubscribeUrl,
      });
      await sendEmail({ to: fu.email, subject, html, from, tenantId, orderId: doc.id, emailType: 'followup_day3' });
      await doc.ref.update({ day3: true });
      await logEvent(tenantId, { orderId: doc.id, type: 'followup_day3' });
      sent++;
      cap.sent++;
      continue;
    }

    // day 6 — review request
    if (age >= SIX_DAYS && fu.day3 && !fu.day6) {
      const { subject, html } = reviewRequestHtml({
        customerName: fu.customerName,
        orderRef:     fu.orderRef || doc.id,
        storeName,
        reviewUrl,
        unsubscribeUrl,
      });
      await sendEmail({ to: fu.email, subject, html, from, tenantId, orderId: doc.id, emailType: 'followup_day6' });
      await doc.ref.update({ day6: true });
      await logEvent(tenantId, { orderId: doc.id, type: 'followup_day6' });
      sent++;
      cap.sent++;
      continue;
    }

    // day 8 — AI upsell + promo code (Pro and Max only)
    if (age >= EIGHT_DAYS && fu.day6 && !fu.day8) {
      if (!can(tier, 'followUpDay8')) continue;

      const promo = can(tier, 'promoCodes')
        ? await createPromo({ tenantId, followUpId: doc.id })
        : null;

      const aiParagraph = can(tier, 'aiUpsellCopy')
        ? await getUpsellRecommendations({ customerName: fu.customerName, previousItems: fu.items || [], storeName })
        : null;

      const { subject, html } = upsellHtml({
        customerName: fu.customerName,
        storeName,
        storeUrl,
        promoCode:   promo?.code        || null,
        discountPct: promo?.discountPct || null,
        expiresAt:   promo?.expiresAt   || null,
        aiParagraph,
        unsubscribeUrl,
      });

      await sendEmail({ to: fu.email, subject, html, from, tenantId, orderId: doc.id, emailType: 'followup_day8' });
      await doc.ref.update({ day8: true });
      await logEvent(tenantId, { orderId: doc.id, type: 'followup_day8', metadata: { promoCode: promo?.code || null } });
      sent++;
      cap.sent++;
    }
  }

  return sent;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logEvent(tenantId, { orderId, type, metadata }) {
  await db.collection('tenants').doc(tenantId)
    .collection('events').add({
      orderId,
      type,
      metadata: metadata || {},
      createdAt: new Date().toISOString(),
    });
}
