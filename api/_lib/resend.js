'use strict';

const FROM_ADDRESS = process.env.EMAIL_FROM      || 'CronVend <hello@cronvend.com>';
const REPLY_TO     = process.env.EMAIL_REPLY_TO  || 'hello@cronvend.com';
const DRY_RUN      = process.env.DRY_RUN === 'true';

function htmlToText(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#8358;/g, '₦').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// tags let the Resend delivery webhook route events back to the right
// tenant + order without scanning Firestore. Max 50 chars per value.
function buildTags({ tenantId, orderId, emailType }) {
  const tags = [];
  if (tenantId)  tags.push({ name: 'tenantId',  value: String(tenantId).slice(0, 50) });
  if (orderId)   tags.push({ name: 'orderId',   value: String(orderId).slice(0, 50) });
  if (emailType) tags.push({ name: 'emailType', value: String(emailType).slice(0, 50) });
  return tags;
}

async function sendEmail({ to, subject, html, from, tenantId, orderId, emailType }) {
  if (DRY_RUN) {
    console.log('[DRY_RUN] sendEmail', JSON.stringify({ to, subject, from, tenantId, orderId, emailType }));
    return { id: 'dry-run-' + Date.now() };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:     from || FROM_ADDRESS,
      reply_to: REPLY_TO,
      to:       Array.isArray(to) ? to : [to],
      subject,
      html,
      text:     htmlToText(html),
      tags:     buildTags({ tenantId, orderId, emailType }),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error('Resend ' + res.status + ': ' + text);
  }

  return res.json();
}

module.exports = { sendEmail, buildTags };
