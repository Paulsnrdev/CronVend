'use strict';

const FEATURES = {
  free: {
    awaitingPayment:     true,
    awaitingPaymentFull: false, // only the 1-hour reminder; no 12h/24h stages
    followUpDay3:        false,
    followUpDay6:        false,
    followUpDay8:        false,
    aiUpsellCopy:        false,
    promoCodes:          false,
    customSenderDomain:  false,
  },
  mini: {
    awaitingPayment:     true,
    awaitingPaymentFull: true,
    followUpDay3:        true,
    followUpDay6:        true,
    followUpDay8:        false,
    aiUpsellCopy:        false,
    promoCodes:          false,
    customSenderDomain:  false,
  },
  pro: {
    awaitingPayment:     true,
    awaitingPaymentFull: true,
    followUpDay3:        true,
    followUpDay6:        true,
    followUpDay8:        true,
    aiUpsellCopy:        true,
    promoCodes:          true,
    customSenderDomain:  false,
  },
  max: {
    awaitingPayment:     true,
    awaitingPaymentFull: true,
    followUpDay3:        true,
    followUpDay6:        true,
    followUpDay8:        true,
    aiUpsellCopy:        true,
    promoCodes:          true,
    customSenderDomain:  true,
  },
};

// Maximum emails a single tenant may send in one hourly cron run.
const EMAIL_CAPS = {
  free: 10,
  mini: 50,
  pro:  200,
  max:  1000,
};

// Returns true if the given tier has access to the feature.
// Falls back to mini if tier is unrecognised.
function can(tier, feature) {
  const t = FEATURES[tier] || FEATURES.mini;
  return t[feature] === true;
}

// Returns the max emails this tier may send per cron run.
function emailCap(tier) {
  return EMAIL_CAPS[tier] || EMAIL_CAPS.mini;
}

module.exports = { can, emailCap, FEATURES };
