-- Compatibility no-op.
-- expires_at is part of the canonical subscriptions table in 0002_service.sql.
-- The previously used combined D1 schema also already contains this column.
-- Do not ALTER TABLE here: it would fail with "duplicate column name" on the existing database.
SELECT 1;
