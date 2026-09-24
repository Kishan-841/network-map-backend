-- An activity type is recorded at most once per visit (a set, not counted
-- events). No existing rows to dedupe — the table is new to production.
CREATE UNIQUE INDEX "VisitActivity_visitId_type_key" ON "VisitActivity"("visitId", "type");
