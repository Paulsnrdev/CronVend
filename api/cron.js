'use strict';

const { db } = require('./_lib/firebase-admin');

// Called hourly by GitHub Actions.
// Fetches all tenant IDs (no field data — cheap) then fans out one HTTP
// request per tenant to /api/cron/tenant, which runs in its own Vercel
// function invocation with its own 60-second timeout budget.
// Wall-clock time here is dominated by the single slowest tenant, not
// the sum of all tenants, so this stays well within the 60-second limit
// regardless of how many clients are on the platform.

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '').trim() !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseUrl = process.env.SITE_URL;
  if (!baseUrl) {
    return res.status(500).json({ error: 'SITE_URL env var required for cron fan-out' });
  }

  // .select() fetches doc IDs only — no field reads, minimal Firestore cost.
  const tenantsSnap = await db.collection('tenants').select().get();
  const tenantIds   = tenantsSnap.docs.map(d => d.id);

  if (!tenantIds.length) {
    return res.status(200).json({ ok: true, tenants: 0, emails: 0 });
  }

  // Fire one request per tenant. Each runs in its own isolated function
  // invocation. A 55-second abort per request leaves headroom before
  // Vercel's 60-second hard limit on the orchestrator itself.
  const results = await Promise.allSettled(
    tenantIds.map(tenantId => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 55_000);
      return fetch(`${baseUrl}/api/cron/tenant`, {
        method:  'POST',
        headers: {
          'Authorization': 'Bearer ' + secret,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify({ tenantId }),
        signal: ctrl.signal,
      })
        .then(r => r.json())
        .finally(() => clearTimeout(timer));
    })
  );

  const summary = { tenants: tenantIds.length, emails: 0, cappedTenants: 0, errors: [] };

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value?.ok) {
      summary.emails       += result.value.sent  || 0;
      if (result.value.capped) summary.cappedTenants++;
    } else {
      const reason = result.status === 'rejected'
        ? result.reason?.message
        : (result.value?.error || 'unknown');
      console.error('[cron] tenant failed', tenantIds[i], reason);
      summary.errors.push({ tenantId: tenantIds[i], error: reason });
    }
  });

  return res.status(200).json({ ok: true, ...summary });
};
