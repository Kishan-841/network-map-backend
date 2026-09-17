-- Fiber drawing stops being a role privilege and becomes a per-user grant:
-- an ADMIN ticks the users (MANAGER / SURVEYOR / SUPERVISOR) who may draw
-- fiber and closures. Everyone starts unticked — including managers, who
-- could write before — so access is handed out deliberately after deploy.
ALTER TABLE "User" ADD COLUMN "canManageFiber" BOOLEAN NOT NULL DEFAULT false;
