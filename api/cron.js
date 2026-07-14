'use strict';

const { db }                      = require('./_lib/firebase-admin');
const { sendEmail }               = require('./_lib/resend');
const { createPromo }             = require('./_lib/promo');
const { getUpsellRecommendations} = require('./_lib/claude');
const { awaitingPaymentHtml }     = require('./_lib/templates/awaiting-payment');
const { satisfactionHtml, reviewRequestHtml } = require('./_lib/templates/delivery-followup');
const { upsellHtml }              = require('./_lib/templates/upsell');

const AWAITING_STAGES = [
  { key: 'h1',  ms:  1 * 3600 * 1000 },
  { key: 'h12', ms: 12 * 3600 * 1000 },
  { key: 'h24', ms: 24 * 3600 * 1000 },
];

const THREE_DAYS = 3 * 86400 * 1000;
const SIX_DAYS   = 6 * 86400 * 1000;
const EIGHT_DAYS = 8 * 86400 * 1000;

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '').trim() !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now     = Date.now();
  const summary = { tenants: 0, emails: 0, errors: [] };

  const tenantsSnap = await db.collection('tenants').get();

  await Promise.all(tenantsSnap.docs.map(async tenantDoc => {
    const tenantId = tenantDoc.id;
    const tenant   = tenantDoc.data();
    summary.tenants++;

    try {
      const sent = await processTenant({ tenantId, tenant, now });
      summary.emails += sent;
    } catch (err) {
      console.error('[cron] tenant error', tenantId, err.message);
      summary.errors.push({ tenantId, error: err.message });
    }
  }));

  return res.status(200).json({ ok: true, ...summary });
};

async function processTenant({ tenantId, tenant, now }) {
  const [ap, fu] = await Promise.all([
    runAwaitingPayment({ tenantId, tenant, now }),
    runFollowUps({ tenantId, tenant, now }),
  ]);
  return ap + fu;
}

// ── Awaiting-payment reminders ────────────────────────────────────────────────

async function runAwaitingPayment({ tenantId, tenant, now }) {
  const storeName = tenant.storeName || 'Our Store';
  const storeUrl  = tenant.storeUrl  || '#';
  let sent = 0;

  const snap = await db.collection('tenants').doc(tenantId)
    .collection('orders')
    .where('orderStatus', '==', 'awaiting_payment')
    .get();

  await Promise.all(snap.docs.map(async doc => {
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

      await sendEmail({ to: order.customerEmail, subject, html });
      await doc.ref.update({ [`awaitingReminders.${stage.key}`]: true });
      await logEvent(tenantId, { orderId: doc.id, type: `awaiting_${stage.key}`, metadata: { email: order.customerEmail } });
      sent++;
      break; // one stage per hourly run
    }
  }));

  return sent;
}

// ── Post-delivery follow-up sequences ────────────────────────────────────────

async function runFollowUps({ tenantId, tenant, now }) {
  const storeName = tenant.storeName || 'Our Store';
  const storeUrl  = tenant.storeUrl  || '#';
  const reviewUrl = tenant.reviewUrl || storeUrl;
  let sent = 0;

  const snap = await db.collection('tenants').doc(tenantId)
    .collection('followUps')
    .where('optedOut', '==', false)
    .get();

  await Promise.all(snap.docs.map(async doc => {
    const fu  = doc.data();
    const age = now - new Date(fu.deliveredAt).getTime();

    // day 3 — satisfaction check-in
    if (age >= THREE_DAYS && !fu.day3) {
      const { subject, html } = satisfactionHtml({
        customerName: fu.customerName,
        orderRef:     fu.orderRef || doc.id,
        storeName,
        reviewUrl,
      });
      await sendEmail({ to: fu.email, subject, html });
      await doc.ref.update({ day3: true });
      await logEvent(tenantId, { orderId: doc.id, type: 'followup_day3' });
      sent++;
      return;
    }

    // day 6 — review request
    if (age >= SIX_DAYS && fu.day3 && !fu.day6) {
      const { subject, html } = reviewRequestHtml({
        customerName: fu.customerName,
        orderRef:     fu.orderRef || doc.id,
        storeName,
        reviewUrl,
      });
      await sendEmail({ to: fu.email, subject, html });
      await doc.ref.update({ day6: true });
      await logEvent(tenantId, { orderId: doc.id, type: 'followup_day6' });
      sent++;
      return;
    }

    // day 8 — AI upsell + promo code
    if (age >= EIGHT_DAYS && fu.day6 && !fu.day8) {
      const [promo, aiParagraph] = await Promise.all([
        createPromo({ tenantId, followUpId: doc.id }),
        getUpsellRecommendations({ customerName: fu.customerName, previousItems: fu.items || [], storeName }),
      ]);

      const { subject, html } = upsellHtml({
        customerName: fu.customerName,
        storeName,
        storeUrl,
        promoCode:   promo.code,
        discountPct: promo.discountPct,
        expiresAt:   promo.expiresAt,
        aiParagraph,
      });

      await sendEmail({ to: fu.email, subject, html });
      await doc.ref.update({ day8: true });
      await logEvent(tenantId, { orderId: doc.id, type: 'followup_day8', metadata: { promoCode: promo.code } });
      sent++;
    }
  }));

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
