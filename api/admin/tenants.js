'use strict';

const { db } = require('../_lib/firebase-admin');

// GET /api/admin/tenants — returns all tenants for the admin panel.
// Protected by x-admin-key header.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
  if (req.headers['x-admin-key'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const snap = await db.collection('tenants').get();

  const tenants = snap.docs.map(doc => {
    const d = doc.data();
    return {
      tenantId:           doc.id,
      storeName:          d.storeName          || '',
      storeUrl:           d.storeUrl           || '',
      tier:               d.tier               || 'mini',
      subscriptionStatus: d.subscriptionStatus || null,
      billingEmail:       d.billingEmail        || '',
      createdAt:          d.createdAt          || null,
    };
  });

  // Sort: newest first (if createdAt is stored), otherwise alphabetical
  tenants.sort((a, b) => {
    if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return a.storeName.localeCompare(b.storeName);
  });

  return res.status(200).json({ ok: true, tenants });
};
