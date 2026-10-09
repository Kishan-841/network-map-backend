-- Visit plan series (9 Oct): every task made from one sheet row shares a
-- seriesId, so a planner can change or remove "this and the later repeats".
-- Additive: existing tasks keep NULL ("this visit only").
ALTER TABLE "VisitTask" ADD COLUMN "seriesId" TEXT;
CREATE INDEX "VisitTask_seriesId_taskDate_idx" ON "VisitTask"("seriesId", "taskDate");
