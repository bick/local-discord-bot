-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "eventsForumId" TEXT;

-- CreateTable
CREATE TABLE "ForumEvent" (
    "threadId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "scheduledEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumEvent_pkey" PRIMARY KEY ("threadId")
);
