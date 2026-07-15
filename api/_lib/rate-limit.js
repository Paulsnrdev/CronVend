'use strict';

const { db, admin } = require('./firebase-admin');

// Requests allowed per tier per window.
// To change limits, edit here only — no other file needs updating.
const LIMITS = {
  mini: { perMinute: 20,  perHour: 300   },
  pro:  { perMinute: 60,  perHour: 1000  },
  max:  { perMinute: 200, perHour: 5000  },
};

// Window keys are deterministic strings so counters are naturally scoped to their time window.
// e.g. "tid123:min:2026-07-15-14-32" and "tid123:hr:2026-07-15-14"
function windowKeys(tenantId) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const hour = `${date}-${pad(now.getUTCHours())}`;
  const min  = `${hour}-${pad(now.getUTCMinutes())}`;
  return {
    minuteKey: `${tenantId}:min:${min}`,
    hourKey:   `${tenantId}:hr:${hour}`,
    // TTLs: keep docs alive for 2x the window so stale reads still work
    minuteTtl: admin.firestore.Timestamp.fromMillis(Date.now() + 2  * 60   * 1000),
    hourTtl:   admin.firestore.Timestamp.fromMillis(Date.now() + 2  * 3600 * 1000),
  };
}

// Atomically increments both window counters inside a Firestore transaction.
// Returns { allowed: true } or { allowed: false, reason, retryAfterSeconds }.
//
// NOTE: Enable Firestore TTL on collection "rateLimits", field "expireAt"
// in the Firebase console to auto-delete old counter docs.
async function checkRateLimit(tenantId, tier) {
  const limits = LIMITS[tier] || LIMITS.mini;
  const { minuteKey, hourKey, minuteTtl, hourTtl } = windowKeys(tenantId);
  const col = db.collection('rateLimits');

  let allowed = true;
  let reason  = '';
  let retryAfterSeconds = 60;

  await db.runTransaction(async tx => {
    const [minDoc, hrDoc] = await Promise.all([
      tx.get(col.doc(minuteKey)),
      tx.get(col.doc(hourKey)),
    ]);

    const minCount = (minDoc.exists ? minDoc.data().count : 0) + 1;
    const hrCount  = (hrDoc.exists  ? hrDoc.data().count  : 0) + 1;

    if (minCount > limits.perMinute) {
      allowed = false;
      reason  = `Rate limit exceeded: ${limits.perMinute} requests/minute on ${tier} tier`;
      retryAfterSeconds = 60;
      return; // abort — do not increment
    }

    if (hrCount > limits.perHour) {
      allowed = false;
      reason  = `Rate limit exceeded: ${limits.perHour} requests/hour on ${tier} tier`;
      retryAfterSeconds = 3600;
      return;
    }

    tx.set(col.doc(minuteKey), { count: minCount, expireAt: minuteTtl });
    tx.set(col.doc(hourKey),   { count: hrCount,  expireAt: hourTtl   });
  });

  return { allowed, reason, retryAfterSeconds };
}

module.exports = { checkRateLimit };
