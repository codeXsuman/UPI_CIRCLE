-- Run this once against the existing production database.
-- Mobile numbers are optional for new account registrations.
ALTER TABLE users
ALTER COLUMN mobile DROP NOT NULL;
