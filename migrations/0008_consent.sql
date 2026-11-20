-- Compatibility no-op.
-- pd_consent_at and pd_policy_version are part of the canonical leads table in 0001_init.sql.
-- The existing production D1 already contains both columns; adding them again fails.
SELECT 1;
