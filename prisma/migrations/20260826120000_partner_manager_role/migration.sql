-- Staff role for recruiting external referral partners. Additive only, so
-- this is safe to apply to a live database.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARTNER_MANAGER';
