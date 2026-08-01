'use strict';

const { db } = require('./firebase-admin');

const CHARS      = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN   = 6;
const DISC_PCT   = 10;
const EXPIRY_HRS = 72;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

async function getPromoSettings(tenantId) {
  try {
    const snap = await db.collection('tenants').doc(tenantId)
      .collection('settings').doc('promoConfig').get();
    if (snap.exists) {
      const d = snap.data();
      return {
        discPct:   d.promoDiscountPct != null ? d.promoDiscountPct : DISC_PCT,
        expiryHrs: d.promoExpiryHrs   != null ? d.promoExpiryHrs   : EXPIRY_HRS,
      };
    }
  } catch (_) {}
  return { discPct: DISC_PCT, expiryHrs: EXPIRY_HRS };
}

async function createPromo({ tenantId, followUpId }) {
  const { discPct, expiryHrs } = await getPromoSettings(tenantId);
  const code      = generateCode();
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + expiryHrs * 3600 * 1000).toISOString();

  const data = {
    code, followUpId, tenantId,
    discountPct: discPct,
    expiresAt,
    createdAt:   now.toISOString(),
    redeemed:    false,
    redeemedAt:  null,
  };

  await db.collection('tenants').doc(tenantId)
    .collection('promoCodes').doc(code).set(data);

  return data;
}

module.exports = { createPromo, DISC_PCT, EXPIRY_HRS };
