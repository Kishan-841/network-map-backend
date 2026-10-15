-- Two more kinds of visit field work (owner's request, 15 Oct 2026). Additive:
-- existing activity rows are untouched.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'KITE';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'NOTICE_BOARD';
