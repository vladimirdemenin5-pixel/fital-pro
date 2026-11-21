-- A saved AI plan draft can back only one active or successful payment.
-- Failed/expired payment rows may be retried only by creating a fresh plan draft.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_checkout_per_draft
ON payments(draft_id)
WHERE draft_id IS NOT NULL AND status IN ('pending','succeeded');
