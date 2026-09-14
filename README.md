# Fital Pro

Production-ready Fital Pro service for Cloudflare Workers.

## Architecture

- Existing Worker name: `red-waterfall-2af8`
- Static frontend: `public/`
- Worker API: `_worker.js`
- Workers AI binding: `AI`
- D1 binding: `DB` (`fital-pro-db`)
- YooKassa server-side checkout and webhook
- No Telegram integration

## API

- `GET /health`
- `POST /api/chat`
- `POST|GET /api/profile`
- `GET /api/plan`
- `POST|GET /api/progress`
- `POST /api/lead`
- `POST /api/checkout`
- `GET /api/payment-status`
- `GET /api/me`
- `POST /webhooks/yookassa`

## Required Cloudflare configuration

1. Connect this repository to the existing Worker `red-waterfall-2af8` using **Settings → Builds**.
2. Keep the production branch as `main`.
3. Ensure the Worker has Workers AI enabled and the `AI` binding.
4. Ensure the D1 database `fital-pro-db` is bound as `DB` and migrations are applied.
5. Add secrets:
   - `YOOKASSA_SHOP_ID`
   - `YOOKASSA_SECRET_KEY`
6. Configure YooKassa HTTP notification for `payment.succeeded`:
   `https://<active-worker-domain>/webhooks/yookassa`

Do not put YooKassa credentials into `public/` or browser JavaScript.

## Deploy

The repository is configured for Cloudflare Workers Builds. The deploy script runs the Worker deployment and D1 migrations.

Before production payment testing, open `/health` and confirm:

- `ok: true`
- `ai: true`
- `db: true`
- `payments: true`

Only after those checks should a real YooKassa payment be tested.
