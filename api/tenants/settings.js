'use strict';

const { db }            = require('../_lib/firebase-admin');
const { requireTenant } = require('../_lib/auth');

const ALLOWED_FIELDS    = ['storeName', 'storeUrl', 'reviewUrl'];
const MAX_ONLY_FIELDS   = ['customFrom'];

module.exports = async function handler(req, res) {
  const tenantId = await requireTenant(req, res);
  if (!tenantId) return;

  const tenantRef = db.collection('tenants').doc(tenantId);

  if (req.method === 'GET') {
    const [tenantSnap, promoSnap] = await Promise.all([
      tenantRef.get(),
      tenantRef.collection('settings').doc('promoConfig').get(),
    ]);

    return res.status(200).json({
      ...(tenantSnap.data() || {}),
      promoConfig: promoSnap.exists ? promoSnap.data() : {},
    });
  }

  if (req.method === 'PATCH') {
    const body    = req.body || {};
    const updates = {};

    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    // customFrom is Max-tier only
    const tenantSnap = await tenantRef.get();
    const tier = (tenantSnap.data() || {}).tier || 'mini';

    for (const field of MAX_ONLY_FIELDS) {
      if (body[field] !== undefined) {
        if (tier !== 'max') {
          return res.status(403).json({ error: `'${field}' requires the Max tier` });
        }
        updates[field] = body[field];
      }
    }

    if (body.promoConfig) {
      const pc = body.promoConfig;
      const promoUpdates = {};
      if (pc.promoDiscountPct != null) promoUpdates.promoDiscountPct = Number(pc.promoDiscountPct);
      if (pc.promoExpiryHrs   != null) promoUpdates.promoExpiryHrs   = Number(pc.promoExpiryHrs);
      if (Object.keys(promoUpdates).length) {
        await tenantRef.collection('settings').doc('promoConfig').set(promoUpdates, { merge: true });
      }
    }

    if (Object.keys(updates).length) {
      await tenantRef.update(updates);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
