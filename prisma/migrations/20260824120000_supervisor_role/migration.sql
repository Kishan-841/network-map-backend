-- A cross-registry oversight role: sees and edits every building, coverage or
-- acquisition, regardless of who logged it. Additive only — no existing row
-- changes, so this is safe to apply to a live database.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPERVISOR';
