'use strict';

const { db }            = require('./_lib/firebase-admin');
const { requireTenant } = require('./_lib/auth');

// Handles two public routes, split by method (merged into one file to stay
// under Vercel's Hobby-plan function limit — see vercel.json rewrite for
// /api/unsubscribe -> /api/optout):
//
// GET /api/unsubscribe?token=...
//   Public unsubscribe link sent in follow-up emails. Token-authenticated,
//   single-use. Returns an HTML confirmation page.
//
// POST /api/optout
//   Programmatic opt-out for stores — use when a customer cancels an order,
//   requests a refund, or asks to stop emails outside the unsubscribe flow.
//   Body: { orderId?, email? } — at least one is required.
//     orderId — opts out that specific order's follow-up sequence
//     email   — opts out ALL follow-up sequences for that email address
//   Both can be supplied together; orderId takes priority and email is ignored.
//   Returns: { ok: true, optedOut: <number of records updated> }

module.exports = async function handler(req, res) {
  if (req.method === 'GET')  return handleUnsubscribe(req, res);
  if (req.method === 'POST') return handleOptOut(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

// ── GET: token-based unsubscribe link ───────────────────────────────────────

async function handleUnsubscribe(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).send(page('Invalid link', 'This unsubscribe link is invalid or missing.'));

  const tokenSnap = await db.collection('unsubscribeTokens').doc(token).get();
  if (!tokenSnap.exists) {
    return res.status(404).send(page('Already unsubscribed', "You're not subscribed to any follow-up emails, or this link has already been used."));
  }

  const { tenantId, followUpId } = tokenSnap.data();

  await db.collection('tenants').doc(tenantId)
    .collection('followUps').doc(followUpId)
    .update({ optedOut: true, optedOutAt: new Date().toISOString() });

  // Token is single-use — delete it after use
  await tokenSnap.ref.delete();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(page(
    "You've been unsubscribed",
    "You won't receive any more follow-up emails for this order. If this was a mistake, contact the store directly.",
  ));
}

function page(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;background:#f4f4f4">
    <tr><td align="center" valign="middle" style="padding:48px 16px">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:480px">
        <tr><td style="background:#111;padding:24px 32px">
          <span style="color:#fff;font-size:18px;font-weight:700">CronVend</span>
        </td></tr>
        <tr><td style="padding:40px 32px;text-align:center">
          <p style="font-size:40px;margin:0 0 16px">✓</p>
          <h1 style="margin:0 0 12px;font-size:22px;color:#111">${title}</h1>
          <p style="margin:0;color:#555;line-height:1.6;font-size:15px">${message}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── POST: programmatic opt-out API ──────────────────────────────────────────

async function handleOptOut(req, res) {
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
}

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
