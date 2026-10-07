-- CreateTable
CREATE TABLE "HallOfFameEntry" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "hofMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallOfFameEntry_pkey" PRIMARY KEY ("messageId")
);
