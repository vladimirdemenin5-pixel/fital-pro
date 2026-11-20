# Fital Pro

Fital Pro is a Cloudflare Worker service with Workers AI and D1.

## Existing infrastructure

- Worker: `red-waterfall-2af8`
- Worker entry: `_worker.js`
- Static frontend directory: `public/` (must be present before deployment)
- Workers AI binding: `AI`
- D1 binding: `DB` → `fital-pro-db`

## Payments: Robokassa

The Worker uses the Robokassa hosted payment page.

Required Worker secrets:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_PASSWORD1`
- `ROBOKASSA_PASSWORD2`

Optional Worker variables:

- `ROBOKASSA_HASH_ALGORITHM` — must match the hash algorithm selected in the Robokassa merchant cabinet; defaults to `MD5`.
- `ROBOKASSA_IS_TEST` — set to `1` to use `ROBOKASSA_TEST_PASSWORD1/2` and add `IsTest=1`; set to `0` to use live `ROBOKASSA_PASSWORD1/2`.

Configure the Robokassa technical settings:

- Result URL: `https://<active-worker-domain>/webhooks/robokassa`
- Result URL method: POST
- Result notification password: Password #2
- Payment request signature: Password #1
- Success URL: the active Fital Pro site URL, with GET method. Robokassa returns the supplied Shp_* parameters, including Shp_client_ref, to SuccessURL.
- Failure URL: the active Fital Pro site URL.
- Live checkout remains disabled until the Worker variable ROBOKASSA_LIVE_ENABLED is explicitly set to 1 after Preview testing and legal-page verification.

The ResultURL handler verifies the signature, checks the invoice against the pending D1 payment and the tariff amount, processes repeated notifications idempotently, and returns `OK{InvId}` only after successful processing. The plan duration is 7, 14, or 30 days according to the selected tariff.

Do not put payment passwords in browser code, repository files, or chat messages.

## API

- `GET /health` — reports whether AI, D1 and the configured payment mode are ready.
- `POST /api/chat`
- `POST|GET /api/profile`
- `GET /api/plan`
- `POST|GET /api/progress`
- `POST /api/lead`
- `POST /api/checkout`
- `POST /webhooks/robokassa`
- `GET /api/payment-status?ref=<client_ref>` — статус и токен доступа после подтверждённой оплаты; `?id=<payment_id>` возвращает только статус.
- `GET /api/me`

## Safe validation and deployment

- `npm run check` checks Worker JavaScript syntax.
- `npm run deploy` deploys the Worker only.
- `npm run db:migrate` applies remote migrations to the production D1 and must not be run during Preview testing.
- `npm run db:migrate:preview` applies migrations only to the isolated `fital-pro-preview-db`, using `wrangler.preview-migrations.jsonc`.
- `npm run db:migrations:list:preview` lists pending migrations for that Preview database.

GitHub Actions validates pull requests and does not deploy to Cloudflare. Production deployment must remain a separate, explicitly approved operation.

Before deployment, confirm that `public/` and `migrations/` exist and match the live D1 schema. Do not run remote migrations as part of deployment.


## Questionnaire and AI plan

- `POST /api/plan-preview` validates the adult questionnaire, generates exactly 7, 14 or 30 days according to the selected tariff, and stores a 24-hour draft in D1.
- `POST /api/checkout` requires that draft; payment cannot be started from a tariff button alone.
- The Robokassa ResultURL verifies the signature, exact amount, invoice, tariff, and the saved `client_ref`, then saves the profile and generated plan to the subscriber account.
- Migration `0009_plan_drafts.sql` extends the existing payments table and adds the draft table. Apply it only to the existing D1 after reviewing the schema; never create a new database.


Build validation is performed on the repair branch; production deployment and remote D1 migration remain separate approved steps.
