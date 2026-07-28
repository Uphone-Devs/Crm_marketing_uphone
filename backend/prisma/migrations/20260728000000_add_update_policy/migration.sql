-- CreateTable (aditivo — no toca tablas existentes)
CREATE TABLE IF NOT EXISTS "update_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "start_time" TEXT NOT NULL DEFAULT '13:00',
    "end_time" TEXT NOT NULL DEFAULT '14:00',
    "days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "check_interval_min" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_policy_pkey" PRIMARY KEY ("id")
);
