# Fital Pro — deployment

## 1. GitHub

The project files must be in the **root** of the repository, not inside a ZIP file and not inside an extra parent directory.

## 2. Cloudflare Worker

Existing Worker: `red-waterfall-2af8`.

Connect it to the GitHub repository from:

**Workers & Pages → red-waterfall-2af8 → Settings → Builds → Connect**

Use branch `main` and root directory `/`.

Cloudflare requires the Worker name in the dashboard to match the `name` in `wrangler.jsonc`. This project keeps `red-waterfall-2af8` as the Worker name. citeturn0search0

## 3. D1

Database name: `fital-pro-db`.

Binding: `DB`.

The production D1 binding must contain the real Cloudflare `database_id` UUID. Do not invent this value. Cloudflare's D1 configuration uses `database_name` together with `database_id`. citeturn1search0

After the binding is correct, apply migrations:

```bash
npx wrangler d1 migrations apply fital-pro-db --remote
```

## 4. Workers AI

The Worker expects the binding:

`AI`

The code uses Cloudflare Workers AI for `/api/chat`.

## 5. YooKassa secrets

Set in Cloudflare Worker secrets, never in `public/`:

```bash
npx wrangler secret put YOOKASSA_SHOP_ID
npx wrangler secret put YOOKASSA_SECRET_KEY
```

## 6. Deploy

Workers Builds deploy command:

```bash
npx wrangler deploy
```

Do not combine D1 migrations with the automatic Git deployment command.

## 7. Verification

Open:

`https://<worker-domain>/health`

Expected after all bindings and secrets are ready:

```json
{
  "ok": true,
  "ai": true,
  "db": true,
  "payments": true
}
```

## 8. YooKassa webhook

Configure HTTP notification for:

`payment.succeeded`

Endpoint:

`https://<worker-domain>/webhooks/yookassa`
