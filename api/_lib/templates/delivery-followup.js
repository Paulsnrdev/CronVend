'use strict';

function satisfactionHtml({ customerName, orderRef, storeName, reviewUrl }) {
  return {
    subject: `How did we do? – Order ${orderRef}`,
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
          <h1 style="margin:0 0 16px;font-size:24px;color:#111">We hope you love it!</h1>
          <p style="margin:0 0 12px;color:#444;line-height:1.6">Hi ${customerName},</p>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">
            Your order from <strong>${storeName}</strong> should be with you by now.
            We'd love to know how everything went!
          </p>
          <a href="${reviewUrl}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Share Your Experience
          </a>
          <p style="margin:24px 0 0;color:#999;font-size:13px;line-height:1.5">
            Any issues? Reply to this email and we'll make it right.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function reviewRequestHtml({ customerName, orderRef, storeName, reviewUrl }) {
  return {
    subject: `A quick favour – your review of order ${orderRef}`,
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
          <h1 style="margin:0 0 16px;font-size:24px;color:#111">Your review means the world to us</h1>
          <p style="margin:0 0 12px;color:#444;line-height:1.6">Hi ${customerName},</p>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">
            We hope you're enjoying your purchase from <strong>${storeName}</strong>.
            Would you mind leaving a quick review? It helps other shoppers and means a lot to us.
          </p>
          <a href="${reviewUrl}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Write a Review
          </a>
          <p style="margin:24px 0 0;color:#999;font-size:13px">Takes less than 2 minutes. Thank you!</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

module.exports = { satisfactionHtml, reviewRequestHtml };
