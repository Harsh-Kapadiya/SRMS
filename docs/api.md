# SRMS API

One Express 5 API serves all four web apps. Source: `backend/api/src`.

## How the apps talk to it

- Each Next.js app proxies `/api/*` to the API (a Vercel rewrite), so the browser only ever talks to its own domain.
- Every request carries **`X-SRMS-App: beneficiary | dealer | official | admin`**.
- Login sets an **httpOnly session cookie** for that app (`srms_<app>`). The API stores only a SHA-256 of the token, so logout or suspension revokes it immediately.
- A cross-site form can't set the custom header, which makes the header also the CSRF protection.
- Staff can only log into their own role's app. A dealer's password is rejected by the admin app.
- Errors always look like `{ "error": { "code": "QUOTA_EXCEEDED", "message": "Remaining monthly quota is 3; requested 5" } }`. Database rule violations come back as 409/422 with the rule's code (see [database.md](database.md)).
- Request bodies are validated with the zod schemas in `@srms/shared` (`schemas.ts`), which the web apps reuse for their forms.
- **Demo mode** (`DEMO_MODE=true`): OTP responses include `devOtp`, so the system can be tried without an SMS gateway.

## Endpoints

### Auth, `/auth`
| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/otp` | beneficiary app | Send login / registration OTP to a mobile |
| POST | `/auth/otp/verify` | beneficiary app | Log in, or `{ needsRegistration: true }` for a new number |
| POST | `/auth/register` | beneficiary app | FR-1 registration (mobile OTP + Aadhaar + family); status `PENDING` |
| POST | `/auth/login` | staff apps | Email + password, only into the matching app |
| POST | `/auth/logout` | all | End session |
| GET | `/auth/me` | all | Current user + profile (beneficiary / dealer shops / official district) |
| POST | `/auth/change-password` | staff | Change password (other sessions logged out) |

### Public, `/public`
`GET /public/districts` · `GET /public/shops?districtId=` · `GET /public/commodities`

### Beneficiary, `/me`
| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/me` | Language, address, home shop |
| POST | `/me/aadhaar/otp` · `/me/aadhaar/verify` | FR-2 Aadhaar authentication (mock UIDAI) → ration card no. + quota |
| GET | `/me/entitlement?month=` | This month's quota per commodity + whether the home shop has stock |
| GET | `/me/distributions` · `/me/distributions/:id` | History and receipt |
| GET | `/me/notifications` · POST `/me/notifications/read` | SMS / alerts inbox |
| POST | `/me/attachments` | Upload complaint evidence (raw body, JPEG/PNG/WebP/PDF ≤ 1 MB) |
| POST · GET | `/me/complaints` · `/me/complaints/:id` · POST `/me/complaints/:id/reopen` | FR-9 |

### Dealer, `/dealer`
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dealer/shops` | My shops (≤ 3) with stock and today's / month's numbers |
| GET | `/dealer/shops/:id/stock` | Stock + last 50 ledger entries |
| GET | `/dealer/shops/:id/roster` | Home beneficiaries + remaining quota (cached for offline use) |
| GET | `/dealer/lookup?shopId=&q=` | Search by ration card no. / registration no. / mobile → eligibility, quota, stock, max issuable |
| POST | `/dealer/auth-otp` | Send the beneficiary a point-of-sale OTP (R2) |
| POST | `/dealer/distributions` | FR-3 issue ration (`otp`), or an offline sync (`clientRef` + `capturedOfflineAt`, idempotent) |
| GET | `/dealer/distributions` · `/dealer/distributions/:id` | Transactions and receipts |
| POST | `/dealer/stock/receipts` | FR-4 goods received from godown |
| POST | `/dealer/shops/:id/notify-ready` | R7 "ration has arrived" SMS to beneficiaries who haven't collected yet |
| GET | `/dealer/notifications` · POST `/dealer/notifications/read` | Low-stock alerts etc. |

### Govt Official, `/official`
District officers see their district only; state-level officers may pass `?districtId=`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/official/dashboard?month=` | FR-6 KPIs (coverage, offtake, leakage, wastage), 6-month trend, district table, low stock, leaking shops, complaints |
| GET | `/official/reports/monthly?month=&format=json\|xlsx` | FR-8 district-wise + shop-wise + stock ledger (Excel has 3 sheets; PDF = print view in the app) |
| GET | `/official/shops` · `/official/shops/:id` | Shops, stock, ledger |
| POST | `/official/inspections` | Physical stock count → shortage/excess adjustment (the leakage signal) |
| GET | `/official/distributions` · `/official/distributions/:id` | Transactions (filter by month, shop, offline) |
| POST | `/official/distributions/:id/void` | Void a wrong transaction (quota + stock returned) |
| GET · PATCH | `/official/beneficiaries` · `/official/beneficiaries/:id` | Review registrations, card type, status |
| GET · PATCH | `/official/complaints` · `/official/complaints/:id` · GET `…/attachment` | FR-9 resolution workflow |

### System Admin, `/admin`
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/overview` | Counts, SMS queue, failed logins |
| GET · POST · PATCH | `/admin/dealers` · `/admin/officials` | FR-5 onboarding (returns a one-time temporary password) |
| GET · POST · PATCH | `/admin/shops` · PUT `/admin/shops/:id/quotas` | Shops, dealer assignment (≤ 3), monthly allocation |
| GET · POST · PATCH | `/admin/commodities` · GET · PUT `/admin/entitlements` | Commodities, NFSA entitlement rules |
| POST | `/admin/quotas/generate` | Generate a month's quotas (also runs hourly automatically) |
| GET · PATCH | `/admin/settings` | Low-stock %, max shops, POS OTP, SMS on/off, … |
| GET | `/admin/users` · PATCH `…/:id/status` · POST `…/:id/reset-password` | Manage all users |
| GET | `/admin/audit-logs` | NFR-4 audit trail |
| GET | `/admin/notifications` · POST `/admin/notifications/retry` | SMS delivery monitor |

## Background worker

Runs inside the API process (`WORKER_ENABLED=true`):

- **Every 4 s:** delivers queued notifications through `SMS_PROVIDER` (`log`, `twilio` or `fast2sms`). It retries up to 5 times and redacts OTP texts after sending.
- **Hourly:** generates the current month's quotas, so a new month "just works", and purges expired OTPs and sessions.

## Running

```bash
cp backend/api/.env.example backend/api/.env      # fill in the secrets
pnpm --filter @srms/api dev                  # http://localhost:4000
pnpm --filter @srms/api test                 # 20 end-to-end tests (TEST_DATABASE_URL)
pnpm --filter @srms/api build && node backend/api/dist/run-migrations.js && node backend/api/dist/server.js   # production
```
