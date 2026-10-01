# SRMS — Smart Ration Distribution Monitoring System

A digital Public Distribution System (PDS) that gives government officials a live view of **where,
how and how much** ration is distributed, prevents misleading stock information at ration shops,
and keeps beneficiaries informed.

Built from the project's SE lab documents: SRS (FR-1 … FR-9, NFR-1 … NFR-5), Low-Level Design,
DFDs (Level 0–2), and UML use-case, class and sequence diagrams.

## Apps

| App | Users | Status |
| --- | --- | --- |
| `backend/database` | PostgreSQL schema, business-rule triggers, seed | ✅ Step 1 |
| `backend/api` | One Express API for all roles — [docs/api.md](docs/api.md) | ✅ Step 2 |
| `frontend/beneficiary` | Ration card holders — register, Aadhaar OTP, quota, history, complaints (EN/हिंदी, installable) | ✅ Step 3 |
| `frontend/official` | Govt officials — KPI dashboard, complaints, shop stock & inspections, receipts & voids, beneficiary review, monthly reports (Excel / PDF) | ✅ Step 4 |
| `frontend/admin` | System admin — onboard dealers & officials, shops & monthly allocation (max 3 per dealer), users, commodities & entitlements, settings, audit & SMS logs | ✅ Step 5 |
| `frontend/dealer` | Ration dealers — issue ration, stock, low-stock alerts, offline mode | ⏳ Step 6 |

## Stack

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript
- **Database:** PostgreSQL 16 with Drizzle ORM; rules enforced by triggers (see [docs/database.md](docs/database.md))
- **API:** Node.js + Express 5
- **Web apps:** Next.js + Tailwind CSS, English and Hindi
- **Deploy:** Neon (Postgres) · Render (API) · Vercel (4 web apps)

## Quick start

Needs Node.js 20.18+ (22 recommended) and Docker Desktop (for PostgreSQL).

```bash
corepack enable                 # provides pnpm   (or: npm install -g pnpm)
pnpm install
pnpm db:up                      # PostgreSQL 16 in Docker (docker-compose.yml)
cp backend/database/.env.example backend/database/.env
cp backend/api/.env.example backend/api/.env
#   fill in APP_SECRET, AADHAAR_ENC_KEY, AADHAAR_HASH_PEPPER — the two AADHAAR_* values
#   must be identical in both files. Generate each with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
pnpm db:reset                   # tables, business rules, reference + demo data (re-run any time to start fresh)
pnpm dev                        # API :4000 · beneficiary :3001 · official :3002 · admin :3003
pnpm test                       # 45 tests: DB rules + end-to-end API
```

Demo logins after `pnpm db:seed`:

| Role | Login | Password |
| --- | --- | --- |
| System Admin | admin@srms.demo | Admin@12345 |
| Govt Official (state) | official@srms.demo | Official@12345 |
| Govt Official (Patna) | dso.patna@srms.demo | Official@12345 |
| Dealer (3 Patna shops) | dealer@srms.demo | Dealer@12345 |
| Beneficiary | mobile 9876543210 | OTP shown on screen in demo mode |

## Folder layout

```
backend/
  api/          Express API — src/routes/<role>.ts holds every endpoint of one app
  database/     schema, SQL migrations (business rules), bootstrap, demo seed, tests
frontend/
  beneficiary/  Next.js app for ration card holders           → localhost:3001
  official/     Next.js app for government officials          → localhost:3002
  admin/        Next.js app for the system administrator      → localhost:3003
  dealer/       Next.js app for ration dealers (step 6)       → localhost:3004
  ui-kit/       theme, buttons, forms, login/sidebar shell and API client used by all apps
shared/         validation rules and constants used by the API and the apps
docs/           database design, API reference
```

Inside each web app:

```
app/login/            the sign-in page
app/(signed-in)/      every page behind sign-in; the folder path is the URL
                      e.g. app/(signed-in)/complaints/[id]/page.tsx  →  /complaints/123
lib/<app>-api.ts      the API client, signed-in user and helpers for this app
lib/<app>-types.ts    shapes of the API responses this app uses
components/           pieces used only by this app
```

`page.tsx` and `layout.tsx` are names Next.js requires, so many files share them.
`.vscode/settings.json` makes VS Code tabs show `admin · complaints/[id]` instead of `page.tsx`.

## License

MIT
