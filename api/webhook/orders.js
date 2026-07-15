'use strict';

const crypto                = require('crypto');
const { db }                = require('../_lib/firebase-admin');
const { requireTenant }     = require('../_lib/auth');
const { checkRateLimit }    = require('../_lib/rate-limit');

function generateUnsubscribeToken() {
  return crypto.randomBytes(32).toString('hex');
}

const ALLOWED_EVENTS = new Set([
  'order.created',
  'order.updated',
  'order.paid',
  'order.delivered',
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = await requireTenant(req, res);
  if (!tenantId) return;

  // Fetch tenant to get tier for rate limiting
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  const tier = (tenantSnap.data() || {}).tier || 'mini';

  const { allowed, reason, retryAfterSeconds } = await checkRateLimit(tenantId, tier);
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: reason });
  }

  const { event, order } = req.body || {};

  if (!event || !ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: 'Invalid or missing event. Allowed: ' + [...ALLOWED_EVENTS].join(', ') });
  }
  if (!order?.orderId || !order?.customerEmail) {
    return res.status(400).json({ error: 'order.orderId and order.customerEmail are required' });
  }

  const tenantBase = db.collection('tenants').doc(tenantId);
  const orderRef   = tenantBase.collection('orders').doc(order.orderId);

  if (event === 'order.created' || event === 'order.updated') {
    await orderRef.set({
      customerEmail:     order.customerEmail,
      customerName:      order.customerName   || '',
      orderRef:          order.orderRef       || order.orderId,
      orderStatus:       order.orderStatus    || 'awaiting_payment',
      items:             order.items          || [],
      totalAmount:       order.totalAmount    || '',
      createdAt:         order.createdAt      || new Date().toISOString(),
      awaitingReminders: order.awaitingReminders || {},
    }, { merge: true });
  }

  if (event === 'order.paid') {
    await orderRef.update({ orderStatus: 'paid' });
  }

  if (event === 'order.delivered') {
    await orderRef.update({ orderStatus: 'delivered' });

    // Idempotency guard: if a followUp doc already exists this is a duplicate
    // delivery event (retry / double-fire). Skip re-enrollment to avoid
    // overwriting the unsubscribeToken and orphaning the old one.
    const fuRef  = tenantBase.collection('followUps').doc(order.orderId);
    const fuSnap = await fuRef.get();

    if (!fuSnap.exists) {
      const token = generateUnsubscribeToken();

      await fuRef.set({
        email:            order.customerEmail,
        customerName:     order.customerName || '',
        orderRef:         order.orderRef     || order.orderId,
        items:            order.items        || [],
        deliveredAt:      order.deliveredAt  || new Date().toISOString(),
        unsubscribeToken: token,
        optedOut:         false,
        optedOutAt:       null,
        day3: false, day6: false, day8: false,
      });

      // Top-level lookup so /api/unsubscribe can resolve token → tenant without a full scan
      await db.collection('unsubscribeTokens').doc(token).set({
        tenantId,
        followUpId: order.orderId,
        createdAt:  new Date().toISOString(),
      });
    }
  }

  return res.status(200).json({ ok: true, tenantId, orderId: order.orderId, event });
};
