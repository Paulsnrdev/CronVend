'use strict';

function upsellHtml({ customerName, storeName, storeUrl, promoCode, discountPct, expiresAt, aiParagraph, unsubscribeUrl }) {
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const fallbackCopy = `Since you've shopped with us before, we think you'll love what else we have to offer. Browse our latest collection and find your next favourite piece.`;

  return {
    subject: `A special offer just for you – ${discountPct}% off inside`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px">
        <tr><td style="background:#111;padding:24px 32px">
          <span style="color:#fff;font-size:20px;font-weight:700">${storeName}</span>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 16px;font-size:24px;color:#111">A little thank-you from us</h1>
          <p style="margin:0 0 12px;color:#444;line-height:1.6">Hi ${customerName},</p>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">${aiParagraph || fallbackCopy}</p>

          ${promoCode ? `
          <div style="background:#f5f5f5;border:2px dashed #ddd;border-radius:8px;padding:24px;text-align:center;margin:0 0 28px">
            <p style="margin:0 0 8px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:1px">Your exclusive code</p>
            <p style="margin:0;font-size:32px;font-weight:800;letter-spacing:6px;color:#111">${promoCode}</p>
            <p style="margin:8px 0 0;color:#666;font-size:13px">${discountPct}% off your next order · Expires ${expiryLabel}</p>
          </div>` : ''}

          <a href="${storeUrl}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Shop Now
          </a>
          <p style="margin:24px 0 0;color:#999;font-size:13px;line-height:1.5">
            You're receiving this because you've shopped with us before.<br>
            <a href="${unsubscribeUrl}" style="color:#bbb;font-size:12px">Unsubscribe from follow-up emails</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

module.exports = { upsellHtml };
