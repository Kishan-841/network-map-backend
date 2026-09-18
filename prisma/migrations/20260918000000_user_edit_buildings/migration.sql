-- A surveyor could log a building but never correct it afterwards, and the
-- fix had to go through an admin. This grant, handed out per user the same way
-- fiber drawing is, lets a surveyor edit what they logged themselves.
-- Ownership is still checked on every write; nobody starts with the grant.
ALTER TABLE "User" ADD COLUMN "canEditBuildings" BOOLEAN NOT NULL DEFAULT false;
