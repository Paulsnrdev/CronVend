'use strict';

const { db } = require('../_lib/firebase-admin');

// DELETE /api/tenants/data
// Admin-only GDPR erasure endpoint. Deletes all data stored under a tenant.
//
// Headers: x-admin-key: <ADMIN_SECRET>
// Body:    { tenantId }
//
// What is deleted:
//   tenants/{tenantId}                   — tenant doc
//   tenants/{tenantId}/orders/*          — all order docs
//   tenants/{tenantId}/followUps/*       — all follow-up docs
//   tenants/{tenantId}/events/*          — all event log docs
//   tenants/{tenantId}/promoCodes/*      — all promo code docs
//   tenants/{tenantId}/settings/*        — all settings docs
//   apiKeys/* where tenantId matches     — API key lookup docs
//   unsubscribeTokens/* where tenantId   — unsubscribe token docs
//   billingCustomers/* where tenantId    — billing customer lookup
//   rateLimits/* with tenantId prefix    — rate limit counters (best-effort)
//
// Firestore has no recursive delete in the Admin SDK — we page through
// subcollections manually in batches of 100.

const BATCH_SIZE = 100;

async function deleteCollection(colRef) {
  let deleted = 0;
  let snap;
  do {
    snap = await colRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.docs.length;
  } while (snap.docs.length === BATCH_SIZE);
  return deleted;
}

async function deleteTopLevelByTenant(colName, tenantId) {
  const snap = await db.collection(colName)
    .where('tenantId', '==', tenantId)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.docs.length;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
  if (req.headers['x-admin-key'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { tenantId } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) return res.status(404).json({ error: 'Tenant not found' });

  const counts = {};

  // Delete subcollections first, then the tenant doc itself
  const subcollections = ['orders', 'followUps', 'events', 'promoCodes', 'settings'];
  for (const sub of subcollections) {
    counts[sub] = await deleteCollection(tenantRef.collection(sub));
  }

  await tenantRef.delete();
  counts.tenant = 1;

  // Top-level cross-tenant lookup collections
  counts.apiKeys            = await deleteTopLevelByTenant('apiKeys',            tenantId);
  counts.unsubscribeTokens  = await deleteTopLevelByTenant('unsubscribeTokens',  tenantId);
  counts.billingCustomers   = await deleteTopLevelByTenant('billingCustomers',   tenantId);

  // Rate limit counters — keyed by tenantId prefix, no tenantId field to query on.
  // Use a prefix scan: Firestore range query on document ID.
  const rlSnap = await db.collection('rateLimits')
    .orderBy('__name__')
    .startAt(tenantId + ':')
    .endAt(tenantId + ':￿')
    .get();

  if (!rlSnap.empty) {
    const batch = db.batch();
    rlSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    counts.rateLimits = rlSnap.docs.length;
  } else {
    counts.rateLimits = 0;
  }

  console.log('[tenants/data] deleted tenant', tenantId, counts);

  return res.status(200).json({ ok: true, tenantId, deleted: counts });
};
