-- AlterTable
ALTER TABLE "FiberRoute" ADD COLUMN     "fiberId" TEXT,
ADD COLUMN     "fiberType" TEXT,
ADD COLUMN     "images" JSONB,
ADD COLUMN     "placement" TEXT,
ADD COLUMN     "remark" TEXT;
