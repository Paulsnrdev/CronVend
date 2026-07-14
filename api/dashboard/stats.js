'use strict';

const { db }            = require('../_lib/firebase-admin');
const { requireTenant } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = await requireTenant(req, res);
  if (!tenantId) return;

  const base = db.collection('tenants').doc(tenantId);

  const [eventsSnap, promoSnap, ordersSnap, fuSnap] = await Promise.all([
    base.collection('events').get(),
    base.collection('promoCodes').get(),
    base.collection('orders').get(),
    base.collection('followUps').get(),
  ]);

  const events = eventsSnap.docs.map(d => d.data());
  const orders = ordersSnap.docs.map(d => d.data());

  const byType = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const recoveredOrders = orders.filter(o =>
    o.orderStatus === 'paid' &&
    (o.awaitingReminders?.h1 || o.awaitingReminders?.h12 || o.awaitingReminders?.h24)
  ).length;

  return res.status(200).json({
    ok: true,
    tenantId,
    stats: {
      totalOrders:         orders.length,
      awaitingPayment:     orders.filter(o => o.orderStatus === 'awaiting_payment').length,
      recoveredOrders,
      activeFollowUps:     fuSnap.docs.filter(d => !d.data().optedOut).length,
      emailsSent:          events.length,
      byType,
      promoCodesIssued:    promoSnap.size,
      promoCodesRedeemed:  promoSnap.docs.filter(d => d.data().redeemed).length,
    },
  });
};
