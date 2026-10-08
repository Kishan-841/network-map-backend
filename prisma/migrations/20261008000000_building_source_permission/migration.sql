-- Society permissions (phase 1): a Permission Executive's societies are their
-- own registry, hidden from the coverage views. On its own migration because
-- Postgres cannot use a new enum value inside the transaction that adds it.
ALTER TYPE "BuildingSource" ADD VALUE IF NOT EXISTS 'PERMISSION';
