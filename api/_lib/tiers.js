'use strict';

const FEATURES = {
  mini: {
    awaitingPayment:    true,
    followUpDay3:       true,
    followUpDay6:       true,
    followUpDay8:       false,
    aiUpsellCopy:       false,
    promoCodes:         false,
    customSenderDomain: false,
  },
  pro: {
    awaitingPayment:    true,
    followUpDay3:       true,
    followUpDay6:       true,
    followUpDay8:       true,
    aiUpsellCopy:       true,
    promoCodes:         true,
    customSenderDomain: false,
  },
  max: {
    awaitingPayment:    true,
    followUpDay3:       true,
    followUpDay6:       true,
    followUpDay8:       true,
    aiUpsellCopy:       true,
    promoCodes:         true,
    customSenderDomain: true,
  },
};

// Maximum emails a single tenant may send in one hourly cron run.
// Prevents a tenant with thousands of orders from exhausting shared Resend quota.
const EMAIL_CAPS = {
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
