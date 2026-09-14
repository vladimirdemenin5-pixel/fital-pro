# Fital Pro — production deployment

## 1. Cloudflare login

Run:

```bash
npx wrangler login
```

## 2. Deploy

```bash
npm install
npm run deploy
```

Wrangler can automatically provision supported resources when the configuration declares bindings without IDs. If D1 is not auto-provisioned in your account, create `fital-pro-db` in D1 and add its `database_id` to `wrangler.jsonc`.

## 3. Apply database migrations

```bash
npm run db:migrate
```

## 4. Secrets

Set these as Cloudflare secrets, never in HTML/JS:

```bash
npx wrangler secret put YOOKASSA_SHOP_ID
npx wrangler secret put YOOKASSA_SECRET_KEY
```

## 5. YooKassa webhook

Set the webhook URL to:

`https://YOUR_WORKER_DOMAIN/webhooks/yookassa`

Enable at least `payment.succeeded`; optionally also `payment.canceled` and `payment.waiting_for_capture`.

## 6. Verify

Open:

`https://YOUR_WORKER_DOMAIN/health`

Expected fields:
- `ok: true`
- `ai: true`
- `db: true`
- `payments: true`

## 7. Custom domain

After the Worker is verified, attach `fitalpro.ru` as a custom domain in Cloudflare. Do not remove the existing site until the new Worker passes the health, AI, lead and payment tests.
