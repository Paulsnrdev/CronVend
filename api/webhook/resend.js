'use strict';

const crypto = require('crypto');
const { db } = require('../_lib/firebase-admin');

// POST /api/webhook/resend
// Receives delivery/engagement events from Resend.
// Configure in Resend Dashboard → Webhooks → Add endpoint.
//
// Tracked events: email.sent, email.delivered, email.opened, email.clicked,
//                 email.bounced, email.complained
//
// Resend signs each request with HMAC-SHA256 using your webhook signing secret.
// Set RESEND_WEBHOOK_SECRET in your env (Resend Dashboard → Webhooks → Signing secret).

const TRACKED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
]);

function verifySignature(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  const signature = req.headers['svix-signature'] || '';
  const msgId     = req.headers['svix-id']        || '';
  const timestamp = req.headers['svix-timestamp']  || '';

  if (!signature || !msgId || !timestamp) return false;

  // Resend uses Svix under the hood: signed payload = "msgId.timestamp.rawBody"
  const rawBody    = JSON.stringify(req.body);
  const toSign     = `${msgId}.${timestamp}.${rawBody}`;
  const hmac       = crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'));
  const computed   = 'v1,' + hmac.update(toSign).digest('base64');

  // svix-signature may contain multiple space-separated signatures
  return signature.split(' ').some(s => s === computed);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.RESEND_WEBHOOK_SECRET) {
    console.error('[webhook/resend] RESEND_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type, data } = req.body || {};

  if (!type || !TRACKED_EVENTS.has(type)) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  // Resend embeds our metadata in the email's `tags` array: [{ name, value }]
  const tags     = (data?.tags || []).reduce((acc, t) => { acc[t.name] = t.value; return acc; }, {});
  const tenantId = tags.tenantId;
  const orderId  = tags.orderId;
  const emailType = tags.emailType; // e.g. "awaiting_h1", "followup_day3"

  if (!tenantId) {
    // Email sent before tagging was in place — acknowledge and move on
    return res.status(200).json({ ok: true, ignored: true });
  }

  await db.collection('tenants').doc(tenantId)
    .collection('events').add({
      orderId:   orderId || null,
      type:      `resend_${type.replace('email.', '')}`, // e.g. "resend_delivered"
      metadata:  {
        emailType:  emailType  || null,
        emailId:    data?.email_id || data?.id || null,
        recipient:  data?.to?.[0]  || null,
      },
      createdAt: new Date().toISOString(),
    });

  return res.status(200).json({ ok: true });
};
