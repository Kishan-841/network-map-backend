-- The finance role: records payouts against partner earnings.
-- Additive; no existing row changes.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTS';
