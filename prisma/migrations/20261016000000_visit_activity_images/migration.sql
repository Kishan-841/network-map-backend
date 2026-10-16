-- Proof photos per field-work activity (owner's request, 16 Oct 2026). Additive:
-- existing activity rows keep an empty list.
ALTER TABLE "VisitActivity" ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
