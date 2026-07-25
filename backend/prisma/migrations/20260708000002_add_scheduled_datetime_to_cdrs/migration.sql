-- AddColumn scheduled_datetime to cdrs
ALTER TABLE "cdrs" ADD COLUMN "scheduled_datetime" TIMESTAMP(3);
