'use strict';

const { db }            = require('./_lib/firebase-admin');
const { requireTenant } = require('./_lib/auth');

// POST /api/optout
// Programmatic opt-out for stores — use when a customer cancels an order,
// requests a refund, or asks to stop emails outside the unsubscribe flow.
//
// Body: { orderId?, email? }  — at least one is required.
//   orderId — opts out that specific order's follow-up sequence
//   email   — opts out ALL follow-up sequences for that email address
//             (use when a customer asks to never receive emails again)
//
// Both can be supplied together; orderId takes priority and email is ignored.
//
// Returns: { ok: true, optedOut: <number of records updated> }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = await requireTenant(req, res);
  if (!tenantId) return;

  const { orderId, email } = req.body || {};

  if (!orderId && !email) {
    return res.status(400).json({ error: 'Provide orderId or email (or both)' });
  }

  const followUpsRef = db.collection('tenants').doc(tenantId).collection('followUps');
  let optedOut = 0;

  if (orderId) {
    // O(1) direct lookup
    const doc = await followUpsRef.doc(String(orderId)).get();
    if (doc.exists && !doc.data().optedOut) {
      await optOutDoc(doc, tenantId);
      optedOut++;
    }
  } else {
    // O(n) query over this tenant's followUps — scoped to one tenant so safe
    const snap = await followUpsRef
      .where('email', '==', email)
      .where('optedOut', '==', false)
      .get();

    await Promise.all(snap.docs.map(doc => optOutDoc(doc, tenantId)));
    optedOut = snap.docs.length;
  }

  return res.status(200).json({ ok: true, optedOut });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function optOutDoc(doc, tenantId) {
  const fu  = doc.data();
  const now = new Date().toISOString();

  await doc.ref.update({ optedOut: true, optedOutAt: now });

  // Delete the unsubscribe token so it can't be replayed after opt-out
  if (fu.unsubscribeToken) {
    await db.collection('unsubscribeTokens').doc(fu.unsubscribeToken).delete();
  }

  await db.collection('tenants').doc(tenantId)
    .collection('events').add({
      orderId:   doc.id,
      type:      'optout_programmatic',
      metadata:  { email: fu.email },
      createdAt: now,
    });
}
