# Fital Pro

Fital Pro is the existing Cloudflare Worker service with Workers AI and D1.

## Existing infrastructure

- Worker: `red-waterfall-2af8`
- Worker entry: `_worker.js`
- Static website: `public/`
- Workers AI: `AI`
- Production D1: `fital-pro-db`
- Preview D1: `fital-pro-preview-db`

No new Worker or database is required.

## User journey

1. Visitor chooses a tariff: Nutrition (7 days), PRO (14 days), or Premium (30 days).
2. The questionnaire collects the information needed for the selected program. Workout preferences are shown only for PRO and Premium.
3. Workers AI prepares exactly the tariff duration. The preview includes meals, macros, ingredient quantities, shopping list, substitutions and, for PRO/Premium, workouts.
4. The server saves a short-lived plan draft in D1. Checkout is allowed only when the draft tariff matches the selected tariff.
5. Robokassa receives the order. The ResultURL verifies the signature, invoice, amount, tariff and client reference before activating access.
6. The SuccessURL returns the customer to the site with Robokassa's Shp_* parameters. The browser retrieves the access token only for a confirmed active subscription.
7. The member area shows the purchased program, shopping list and progress tracking.

## Cloudflare Preview build settings

In the existing Worker `red-waterfall-2af8`, open **Settings → Builds → Previews Base** (do not change the Production tab). Keep **Builds for Preview branches** enabled and set:

- Build command: `npm run build`
- Preview command: `npx wrangler preview`
- Root directory: `/`

The `build` script runs `npm run check && npm test`; this makes the Preview build execute syntax checks and the regression suite before `wrangler preview` publishes the branch Preview. Cloudflare Workers Builds uses the Build command configured in the dashboard; the `build.command` field in `wrangler.jsonc` is not a substitute for that dashboard setting.

## Robokassa configuration

### Preview (test payments only)

The `previews` block in `wrangler.jsonc` sets `ROBOKASSA_IS_TEST=1`, binds the isolated Preview D1 database and enables Workers AI.

The branch Preview already exists, so configure secrets for that Preview itself first. Cloudflare does not copy later Previews Base secret changes into an already-created Preview. Also add the same secrets to **Previews Base** so future branch Previews inherit them. Never add test passwords to Production.

Required Preview-only secrets:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_TEST_PASSWORD1`
- `ROBOKASSA_TEST_PASSWORD2`

Run these commands from the repository root. Wrangler prompts for each value securely; do not put values in command arguments, files, GitHub, or chat:

```bash
npx wrangler preview secret put ROBOKASSA_MERCHANT_LOGIN --name robokassa-safe-repair-2026-11-19
npx wrangler preview secret put ROBOKASSA_TEST_PASSWORD1 --name robokassa-safe-repair-2026-11-19
npx wrangler preview secret put ROBOKASSA_TEST_PASSWORD2 --name robokassa-safe-repair-2026-11-19

npx wrangler preview base-config secret put ROBOKASSA_MERCHANT_LOGIN
npx wrangler preview base-config secret put ROBOKASSA_TEST_PASSWORD1
npx wrangler preview base-config secret put ROBOKASSA_TEST_PASSWORD2
```

Do not add the test passwords to Production.

Configure the Robokassa technical settings:

- Result URL: `https://<preview-host>/webhooks/robokassa`, method POST, Password #2.
- Success URL: the Preview site URL, method GET.
- Failure URL: `https://<preview-host>/?payment=failed`, method GET. The site displays a separate failed/cancelled-payment state and directs the customer to check the operation before creating a fresh plan draft.
- Hash algorithm must match the merchant cabinet; the Worker defaults to MD5.

Robokassa returns the supplied `Shp_*` values to SuccessURL, including `Shp_client_ref`.

### Preview payment acceptance checks

Use the branch Preview URL only. Before attempting checkout, `GET /health` must report `ai: true`, `db: true`, `payments: true` and `paymentMode: "test"`. If the payment mode is disabled, do not try to pay; configure the three Preview Base secrets first.

A complete test pass is:

1. Submit an adult test profile and generate the selected 7-, 14- or 30-day plan.
2. Start checkout. Confirm the returned Robokassa URL contains `IsTest=1` and the exact tariff amount. Never use a test URL if `IsTest=1` is missing.
3. Complete the test transaction in Robokassa. Its POST ResultURL must reach `/webhooks/robokassa` and return `OK{InvId}` only after signature, order reference, tariff and amount checks pass.
4. Return to the Preview SuccessURL. The browser must receive an access token only after the ResultURL has activated the subscription and saved the profile and plan.
5. Verify the purchased plan, expiry date, shopping list and (for PRO/Premium) progress and AI chat in the member area.
6. Repeat once with a failed/cancelled test transaction and confirm that no subscription is activated.

Only the Preview D1 database may receive test payment rows. A passing test does not enable or authorize Production payments.

### Production

Production passwords remain Worker Secrets:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_PASSWORD1`
- `ROBOKASSA_PASSWORD2`

Real payments are disabled unless the Production variable `ROBOKASSA_LIVE_ENABLED` is explicitly set to `1`. Leave it unset or `0` until Preview payment, webhook, legal pages and seller requisites are verified. Existing stored production secrets do not bypass this guard.

Never put payment passwords in HTML, browser JavaScript, repository files or chat messages.

## Commands

```bash
npm install
npm run check
npm test
npm run build
```

Preview-only workflow:

```bash
npm run db:migrations:check:preview
npm run db:migrations:list:preview
npm run db:migrate:preview
npm run db:migrations:list:preview
npm run preview
```

Before the remote commands, `scripts/verify-preview-db.mjs` checks that the Preview Worker binding and migration-only config use the same exact database name and ID, that this ID differs from Production, and that migration files are consecutively numbered. The apply/list commands target the stable database name `fital-pro-preview-db`, not a mutable binding alias. Wrangler maintains the `d1_migrations` history and applies pending migrations in order. Do not paste migration SQL manually into D1 Console; doing so bypasses Wrangler's migration history.

Review the migration list first. `db:migrate:preview` applies migrations only to `fital-pro-preview-db`. `preview` creates an isolated Worker Preview for the current branch; it does not publish the Production deployment.

Production-only commands:

- `npm run db:migrate` applies migrations remotely to the Production D1 database.
- `npm run deploy` publishes the Worker.

Do not run Production migrations or deploy until Preview tests pass and the owner explicitly approves the Production release.

## API

- `GET /health`
- `POST /api/plan-preview`
- `POST /api/checkout`
- `POST /webhooks/robokassa`
- `GET /api/payment-status?ref=<client_ref>`
- `GET /api/me`
- `GET|POST /api/profile`
- `GET /api/plan`
- `GET|POST /api/progress`
- `POST /api/chat`

`GET /health` reports AI, D1 and payment mode readiness. In Production the payment mode remains disabled until `ROBOKASSA_LIVE_ENABLED=1`.

## Legal and service limitations

The seller's real legal details and support contact must be completed in `/requisites.html` before live payments. Fital Pro provides informational recommendations, not medical care. AI-generated plans require user review and do not guarantee health or body-composition outcomes.


## Database migration 0011

`0011_one_payment_per_draft.sql` adds a unique partial index: a saved AI plan draft may have only one pending or successful payment. To retry an abandoned checkout, the customer must regenerate a fresh plan draft. Review and apply this migration to Preview first; Production remains untouched until the release is approved.
