-- AlterTable
ALTER TABLE "FiberRoute" ADD COLUMN     "operatorId" TEXT;

-- AddForeignKey
ALTER TABLE "FiberRoute" ADD CONSTRAINT "FiberRoute_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
