# SRMS — Smart Ration Distribution Monitoring System

A digital Public Distribution System (PDS) that gives government officials a live view of **where,
how and how much** ration is distributed, prevents misleading stock information at ration shops,
and keeps beneficiaries informed.

Built from the project's SE lab documents: SRS (FR-1 … FR-9, NFR-1 … NFR-5), Low-Level Design,
DFDs (Level 0–2), and UML use-case, class and sequence diagrams.

## Apps

| App | Users | Status |
| --- | --- | --- |
| `packages/db` | PostgreSQL schema, business-rule triggers, seed | ✅ Step 1 |
| `apps/api` | One Express API for all roles — [docs/api.md](docs/api.md) | ✅ Step 2 |
| `apps/beneficiary` | Ration card holders — register, Aadhaar OTP, quota, history, complaints | ⏳ Step 3 |
| `apps/official` | Govt officials — KPI dashboard, reports, complaint resolution | ⏳ Step 4 |
| `apps/admin` | System admin — dealers, shops, commodities, users, settings, audit | ⏳ Step 5 |
| `apps/dealer` | Ration dealers — issue ration, stock, low-stock alerts, offline mode | ⏳ Step 6 |

## Stack

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript
- **Database:** PostgreSQL 16 with Drizzle ORM; rules enforced by triggers (see [docs/database.md](docs/database.md))
- **API:** Node.js + Express 5
- **Web apps:** Next.js + Tailwind CSS, English and Hindi
- **Deploy:** Neon (Postgres) · Render (API) · Vercel (4 web apps)

## Quick start

```bash
corepack enable                 # provides pnpm
pnpm install
pnpm db:up                      # Postgres 16 in Docker (docker-compose.yml)
cp packages/db/.env.example packages/db/.env
#   fill AADHAAR_ENC_KEY with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
pnpm db:deploy && pnpm db:bootstrap && pnpm db:seed
pnpm test                       # 45 tests: DB rules + end-to-end API
cp apps/api/.env.example apps/api/.env   # same Aadhaar secrets as packages/db/.env
pnpm --filter @srms/api dev     # API on http://localhost:4000
```

Demo logins after `pnpm db:seed`:

| Role | Login | Password |
| --- | --- | --- |
| System Admin | admin@srms.demo | Admin@12345 |
| Govt Official (state) | official@srms.demo | Official@12345 |
| Govt Official (Patna) | dso.patna@srms.demo | Official@12345 |
| Dealer (3 Patna shops) | dealer@srms.demo | Dealer@12345 |
| Beneficiary | mobile 9876543210 | OTP shown on screen in demo mode |

## Repository layout

```
apps/api         Express API (routes per role, SMS worker, reports)
apps/…           the four web apps (steps 3–6)
packages/db      schema, migrations, bootstrap, seed, tests
packages/shared  constants, Aadhaar/mobile validation, month helpers
docs/            database design, API reference (deployment guide comes with step 7)
```

## License

MIT
