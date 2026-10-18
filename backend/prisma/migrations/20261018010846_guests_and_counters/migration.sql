-- AlterTable
ALTER TABLE "Establishment" ADD COLUMN     "counters" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "counter" INTEGER,
ADD COLUMN     "guestKeyHash" TEXT,
ADD COLUMN     "lastCallAt" TIMESTAMP(3);

-- Atendimentos em andamento antes dos guichês passam a ser do guichê 1.
UPDATE "Ticket" SET "counter" = 1 WHERE "status" = 'CALLED' AND "counter" IS NULL;
UPDATE "Ticket" SET "lastCallAt" = "calledAt" WHERE "calledAt" IS NOT NULL AND "lastCallAt" IS NULL;
