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

## Robokassa configuration

### Preview (test payments only)

The `previews` block in `wrangler.jsonc` sets `ROBOKASSA_IS_TEST=1`, binds the isolated Preview D1 database and enables Workers AI.

Preview secrets must be added to the **Previews Base** configuration, not to Production:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_TEST_PASSWORD1`
- `ROBOKASSA_TEST_PASSWORD2`

Cloudflare Wrangler commands (enter the values only in the secure CLI prompt; never commit them):

```bash
npx wrangler preview base-config secret put ROBOKASSA_MERCHANT_LOGIN
npx wrangler preview base-config secret put ROBOKASSA_TEST_PASSWORD1
npx wrangler preview base-config secret put ROBOKASSA_TEST_PASSWORD2
```

Do not add the test passwords to Production.

Configure the Robokassa technical settings:

- Result URL: `https://<preview-host>/webhooks/robokassa`, method POST, Password #2.
- Success URL: the Preview site URL, method GET.
- Failure URL: the Preview site URL.
- Hash algorithm must match the merchant cabinet; the Worker defaults to MD5.

Robokassa returns the supplied `Shp_*` values to SuccessURL, including `Shp_client_ref`.

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
npm run db:migrations:list:preview
npm run db:migrate:preview
npm run preview
```

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
