# CronVend

Scheduled email sequences that recover unpaid orders, follow up after delivery, and upsell customers on autopilot.

Built for multi-tenant SaaS: any e-commerce store can plug in via webhook and CronVend handles the rest.

---

## How It Works

CronVend runs an hourly cron job that scans every connected store and fires the right email at the right time — automatically.

### Awaiting Payment Sequences
| Trigger | Email |
|---|---|
| 1 hour after order created | "You left something behind" |
| 12 hours after order created | "Still thinking it over?" |
| 24 hours after order created | "Last chance to complete your order" |

### Post-Delivery Sequences
| Trigger | Email |
|---|---|
| 3 days after delivery | Satisfaction check-in |
| 6 days after delivery | Review request |
| 8 days after delivery | AI-generated upsell + promo code |

The day-8 upsell email uses Claude AI to write personalised product recommendation copy based on what the customer previously bought.

---

## Tech Stack

| Layer | Tool |
|---|---|
| API / Functions | Node.js on Vercel (serverless) |
| Database | Firebase Firestore |
| Email delivery | Resend |
| Scheduler | GitHub Actions (hourly cron) |
| AI copy | Claude (Anthropic) |

---

## Project Structure

```
api/
├── cron.js                        # Main engine — called by GitHub Actions every hour
├── _lib/
│   ├── firebase-admin.js          # Firestore singleton
│   ├── resend.js                  # Email sender
│   ├── promo.js                   # Promo code generator
│   ├── auth.js                    # API key → tenantId resolver
│   ├── claude.js                  # AI upsell copy
│   └── templates/
│       ├── awaiting-payment.js    # h1 / h12 / h24 emails
│       ├── delivery-followup.js   # day3 + day6 emails
│       └── upsell.js              # day8 AI upsell + promo block
├── webhook/
│   └── orders.js                  # POST /api/webhook/orders
├── tenants/
│   ├── register.js                # POST /api/tenants/register
│   └── settings.js                # GET/PATCH /api/tenants/settings
└── dashboard/
    └── stats.js                   # GET /api/dashboard/stats
```

---

## Firestore Structure

```
tenants/{tenantId}/
  settings/promoConfig        → { promoDiscountPct, promoExpiryHrs }
  orders/{orderId}            → { customerEmail, customerName, orderStatus, orderRef,
                                  items[], totalAmount, createdAt,
                                  awaitingReminders: { h1, h12, h24 } }
  followUps/{orderId}         → { email, customerName, deliveredAt, optedOut,
                                  day3, day6, day8, items[] }
  promoCodes/{code}           → { code, discountPct, expiresAt, redeemed, redeemedAt }
  events/{eventId}            → { orderId, type, metadata, createdAt }

apiKeys/{sha256(apiKey)}/
  tenantId                    → string
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values.

| Variable | Description |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIREBASE_PRIVATE_KEY` | Service account private key |
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | From address (e.g. `CronVend <hello@cronvend.com>`) |
| `EMAIL_REPLY_TO` | Reply-to address |
| `ANTHROPIC_API_KEY` | Claude AI key (for upsell copy) |
| `CRON_SECRET` | Secret token — GitHub Actions sends this to authenticate cron runs |
| `ADMIN_SECRET` | Secret key — required to call the tenant registration endpoint |
| `DRY_RUN` | Set to `true` to log emails without sending (default: `false`) |

---

## Deployment

### 1. Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Add all environment variables in: **Vercel → Project → Settings → Environment Variables**

### 2. Set GitHub Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `CRON_SECRET` | Same value as your `CRON_SECRET` env var |
| `VERCEL_DOMAIN` | Your deployed domain e.g. `cronvend.vercel.app` |

The hourly cron in `.github/workflows/cron.yml` will start firing automatically.

---

## API Reference

### Register a Tenant

```
POST /api/tenants/register
x-admin-key: YOUR_ADMIN_SECRET
Content-Type: application/json

{
  "email": "owner@myshop.com",
  "storeName": "My Shop",
  "storeUrl": "https://myshop.com",
  "reviewUrl": "https://myshop.com/reviews"
}
```

Returns a `tenantId` and `apiKey`. **The API key is shown once — save it.**

---

### Send Order Events (Webhook)

```
POST /api/webhook/orders
x-api-key: cv_live_YOUR_API_KEY
Content-Type: application/json
```

**Events:**

| `event` | Effect |
|---|---|
| `order.created` | Starts awaiting-payment sequence |
| `order.updated` | Updates order fields |
| `order.paid` | Stops awaiting-payment sequence |
| `order.delivered` | Starts post-delivery sequence |

**Payload:**
```json
{
  "event": "order.created",
  "order": {
    "orderId": "ORD-001",
    "customerEmail": "customer@email.com",
    "customerName": "Jane Doe",
    "orderRef": "ORD-001",
    "orderStatus": "awaiting_payment",
    "totalAmount": "₦12,500",
    "items": [
      { "name": "Blue Sneakers", "quantity": 1 }
    ],
    "createdAt": "2026-07-14T10:00:00Z"
  }
}
```

---

### Get / Update Settings

```
GET  /api/tenants/settings
PATCH /api/tenants/settings
x-api-key: cv_live_YOUR_API_KEY
```

PATCH body (all fields optional):
```json
{
  "storeName": "My Shop",
  "storeUrl": "https://myshop.com",
  "reviewUrl": "https://myshop.com/reviews",
  "promoConfig": {
    "promoDiscountPct": 15,
    "promoExpiryHrs": 48
  }
}
```

---

### Dashboard Stats

```
GET /api/dashboard/stats
x-api-key: cv_live_YOUR_API_KEY
```

Returns total orders, recovered orders, emails sent by type, and promo code stats.

---

## Tiers

| Feature | Mini | Pro | Max |
|---|---|---|---|
| Awaiting-payment emails | ✓ | ✓ | ✓ |
| Post-delivery follow-ups | ✓ | ✓ | ✓ |
| AI upsell copy (Claude) | — | ✓ | ✓ |
| Promo code generation | — | ✓ | ✓ |
| Custom sender domain | — | — | ✓ |

---

## License

Proprietary. All rights reserved.
