'use strict';

const crypto         = require('crypto');
const { db }         = require('../_lib/firebase-admin');
const { hashApiKey } = require('../_lib/auth');

function generateApiKey() {
  return 'cv_live_' + crypto.randomBytes(24).toString('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
  if (req.headers['x-admin-key'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { email, storeName, storeUrl, reviewUrl } = req.body || {};
  if (!email)     return res.status(400).json({ error: 'email is required' });
  if (!storeName) return res.status(400).json({ error: 'storeName is required' });

  const apiKey   = generateApiKey();
  const keyHash  = hashApiKey(apiKey);
  const tenantId = db.collection('tenants').doc().id;
  const now      = new Date().toISOString();

  await db.collection('tenants').doc(tenantId).set({
    tenantId,
    email,
    storeName,
    storeUrl:  storeUrl  || '',
    reviewUrl: reviewUrl || '',
    tier:      'mini',
    createdAt: now,
  });

  await db.collection('apiKeys').doc(keyHash).set({ tenantId, createdAt: now });

  return res.status(201).json({
    tenantId,
    apiKey,
    message: 'Tenant created. Save your API key — it will not be shown again.',
    webhook: {
      url:    'https://YOUR_DOMAIN/api/webhook/orders',
      header: 'x-api-key: ' + apiKey,
    },
  });
};
