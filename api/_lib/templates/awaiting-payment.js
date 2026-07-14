'use strict';

const STAGE_COPY = {
  h1:  { subject: (ref) => `Complete your order – ${ref}`,          headline: 'You left something behind!' },
  h12: { subject: (ref) => `Your order is still waiting – ${ref}`,  headline: 'Still thinking it over?' },
  h24: { subject: ()    => `Last chance to complete your order`,     headline: 'Your cart expires soon' },
};

function awaitingPaymentHtml({ customerName, orderRef, totalAmount, storeUrl, storeName, stage }) {
  const copy = STAGE_COPY[stage] || STAGE_COPY.h1;

  return {
    subject: copy.subject(orderRef),
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${copy.subject(orderRef)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px">
        <tr><td style="background:#111;padding:24px 32px">
          <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px">CronVend</span>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 16px;font-size:24px;color:#111">${copy.headline}</h1>
          <p style="margin:0 0 12px;color:#444;line-height:1.6">Hi ${customerName},</p>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">
            Your order <strong>${orderRef}</strong> at <strong>${storeName}</strong> is waiting to be completed.
          </p>
          <div style="background:#f9f9f9;border-radius:6px;padding:16px 20px;margin:0 0 24px">
            <p style="margin:0;color:#666;font-size:14px">Order total</p>
            <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#111">${totalAmount}</p>
          </div>
          <a href="${storeUrl}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Complete My Order
          </a>
          <p style="margin:24px 0 0;color:#999;font-size:13px;line-height:1.5">
            Questions? Just reply to this email — we're happy to help.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

module.exports = { awaitingPaymentHtml };
