# Fital Pro

Production-ready Fital Pro web service for the existing Cloudflare Worker `red-waterfall-2af8`.

## Repository structure

```text
.
├── _worker.js                 # Cloudflare Worker API + business logic
├── wrangler.jsonc             # Worker, AI, D1 and assets configuration
├── package.json               # Cloudflare/Wrangler scripts
├── migrations/                # D1 migrations 0001–0006
├── public/                    # Production frontend
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── assets/
├── .dev.vars.example         # Local secret template only
├── .gitignore
├── DEPLOY.md
└── SETUP.md
```

No Telegram integration is included.

## Cloudflare architecture

- Worker: `red-waterfall-2af8`
- Static assets: `public/`
- Worker entry point: `_worker.js`
- Workers AI binding: `AI`
- D1 binding: `DB`
- D1 database name: `fital-pro-db`
- YooKassa secrets: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`

The Wrangler configuration is the source of truth for the Worker deployment. Cloudflare recommends keeping this configuration in the repository when using Workers Builds. citeturn0search1

## API

- `GET /health`
- `POST /api/chat`
- `GET|POST /api/profile`
- `GET /api/plan`
- `GET|POST /api/progress`
- `POST /api/lead`
- `POST /api/checkout`
- `GET /api/payment-status`
- `GET /api/me`
- `POST /webhooks/yookassa`

## Deployment model

The repository is prepared for **Cloudflare Workers Builds**. The production deploy command is deliberately only:

```bash
npx wrangler deploy
```

D1 migrations are kept as a separate operation:

```bash
npx wrangler d1 migrations apply fital-pro-db --remote
```

This separation is intentional: a Git-connected Worker build should deploy the Worker, while database schema changes are applied separately. Cloudflare's Workers Builds documentation defines `npx wrangler deploy` as the normal deploy command. citeturn0search2

## One account-specific value remains

Cloudflare D1 requires the real `database_id` UUID for the production database binding. The project already contains the complete `migrations/` set and the binding name/database name; the UUID must come from the user's Cloudflare account and must not be invented. citeturn1search0turn1search2

## Production order

1. Put these repository files at the root of GitHub repository `fital-pro`.
2. Connect the existing Worker `red-waterfall-2af8` to that GitHub repository in **Settings → Builds**.
3. Configure the real D1 `database_id` for `fital-pro-db` and keep binding name `DB`.
4. Apply migrations.
5. Add the two YooKassa secrets in Cloudflare.
6. Configure YooKassa `payment.succeeded` webhook at `/webhooks/yookassa`.
7. Verify `/health` returns `ok: true`, `ai: true`, `db: true`, `payments: true`.
8. Only then test a real payment.

Cloudflare explicitly supports connecting an existing Worker to GitHub from **Settings → Builds** and then deploying on pushes to the connected repository. citeturn0search0
