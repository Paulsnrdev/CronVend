'use strict';

const crypto = require('crypto');
const { db } = require('./firebase-admin');

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function resolveTenant(req) {
  const raw = req.headers['x-api-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;

  const snap = await db.collection('apiKeys').doc(hashApiKey(raw)).get();
  if (!snap.exists) return null;
  return snap.data().tenantId;
}

// Resolves tenant from API key and writes 401 if missing. Returns tenantId or null.
async function requireTenant(req, res) {
  const tenantId = await resolveTenant(req);
  if (!tenantId) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return null;
  }
  return tenantId;
}

module.exports = { hashApiKey, resolveTenant, requireTenant };
