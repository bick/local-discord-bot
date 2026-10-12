import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type AnyThreadChannel,
} from "discord.js";
import * as chrono from "chrono-node";
import { Prisma } from "@prisma/client";
import { TIME_ZONE } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

const DEFAULT_DURATION_MS = 3 * 3600_000;
export const TITLE_EXAMPLE = "Rangers game Sat 7pm @ Globe Life Field";

// The casual time parser reads "night"/"morning" as today, so "Game night Friday 8pm" would land tonight. Drop it.
const dates = chrono.casual.clone();
dates.parsers = dates.parsers.filter((p) => p.constructor.name !== "ENCasualTimeParser");

export type ParsedTitle = { name: string; start: Date; end: Date; location: string | null };

/**
 * Pull an event out of a forum post title like "Rangers game Sat 7pm @ Globe Life Field".
 * Only the title is used: without the Message Content intent we can't read the post body.
 * Dates without a time land at noon. Returns null when there's no date or it's already passed.
 */
export function parseForumTitle(title: string, now = new Date()): ParsedTitle | null {
  const [hit] = dates.parse(title, { instant: now, timezone: TIME_ZONE }, { forwardDate: true });
  if (!hit) return null;
  const start = hit.start.date();
  // Discord rejects scheduled events that start in the past.
  if (start.getTime() < now.getTime() + 60_000) return null;
  const parsedEnd = hit.end?.date();
  const end = parsedEnd && parsedEnd > start ? parsedEnd : new Date(start.getTime() + DEFAULT_DURATION_MS);

  const rest = (title.slice(0, hit.index) + " " + title.slice(hit.index + hit.text.length)).replace(/\s+/g, " ");
  const at = rest.match(/\s@\s*(.+)$/) ?? rest.match(/^@\s*(.+)$/);
  const location = at?.[1]?.trim() || null;
  const name = (at ? rest.slice(0, at.index) : rest).replace(/^[\s\-–—·|,:]+|[\s\-–—·|,:]+$/g, "");
  return { name: (name || title).slice(0, 100), start, end, location: location?.slice(0, 100) ?? null };
}

async function isEventsForum(thread: AnyThreadChannel): Promise<boolean> {
  if (thread.parent?.type !== ChannelType.GuildForum) return false;
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: thread.guildId } });
  return !!settings?.eventsForumId && settings.eventsForumId === thread.parentId;
}

function eventOptions(thread: AnyThreadChannel, parsed: ParsedTitle) {
  return {
    name: parsed.name,
    scheduledStartTime: parsed.start,
    scheduledEndTime: parsed.end,
    entityMetadata: { location: parsed.location ?? "See the forum post" },
    description: `Posted by <@${thread.ownerId}>. Details and chat: ${thread.url}`,
  };
}

// The first message in a new forum thread can fail while Discord is still creating the post, so retry once.
async function say(thread: AnyThreadChannel, content: string): Promise<void> {
  const send = () => thread.send({ content, allowedMentions: { parse: [] } });
  await send().catch(async () => {
    await new Promise((r) => setTimeout(r, 2000));
    await send();
  });
}

/** A new post in the events forum becomes a Discord Scheduled Event. */
export async function handleForumThreadCreate(thread: AnyThreadChannel, newlyCreated: boolean): Promise<void> {
  if (!newlyCreated || thread.ownerId === thread.client.user.id || !(await isEventsForum(thread))) return;
  const created = await createForThread(thread);
  if (!created) {
    await say(thread, `I couldn't find a date in the title. Edit it to something like \`${TITLE_EXAMPLE}\` and I'll make a server event for it.`);
  }
}

/** Renaming a post fixes up its event, or creates one if the first title had no date. */
export async function handleForumThreadUpdate(before: AnyThreadChannel, after: AnyThreadChannel): Promise<void> {
  if (before.name === after.name || !(await isEventsForum(after))) return;
  const row = await prisma.forumEvent.findUnique({ where: { threadId: after.id } });
  if (!row) {
    await createForThread(after);
    return;
  }
  const parsed = parseForumTitle(after.name);
  if (!parsed || !row.scheduledEventId) return;
  try {
    const se = await after.guild.scheduledEvents.fetch(row.scheduledEventId);
    if (se.status === GuildScheduledEventStatus.Scheduled) await se.edit(eventOptions(after, parsed));
  } catch (err) {
    logger.warn({ err, threadId: after.id }, "could not update forum event");
  }
}

/** Deleting the post cancels its event. */
export async function handleForumThreadDelete(thread: AnyThreadChannel): Promise<void> {
  const row = await prisma.forumEvent.findUnique({ where: { threadId: thread.id } });
  if (!row) return;
  await prisma.forumEvent.delete({ where: { threadId: thread.id } });
  if (!row.scheduledEventId) return;
  try {
    const se = await thread.guild.scheduledEvents.fetch(row.scheduledEventId);
    if (se.status === GuildScheduledEventStatus.Scheduled) await se.delete();
  } catch (err) {
    logger.warn({ err, threadId: thread.id }, "could not delete forum event");
  }
}

async function createForThread(thread: AnyThreadChannel): Promise<boolean> {
  const parsed = parseForumTitle(thread.name);
  if (!parsed) return false;

  // Claim the thread first so a quick rename right after posting can't create a second event.
  try {
    await prisma.forumEvent.create({ data: { threadId: thread.id, guildId: thread.guildId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
    throw err;
  }

  try {
    const se = await thread.guild.scheduledEvents.create({
      ...eventOptions(thread, parsed),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
    });
    await prisma.forumEvent.update({ where: { threadId: thread.id }, data: { scheduledEventId: se.id } });
    logger.info({ guildId: thread.guildId, threadId: thread.id, scheduledEventId: se.id }, "created forum event");
    await say(thread, `📅 Made a server event for this: ${se.url}\nHit **Interested** on it so you get a reminder. Rename the post to change the time.`);
    return true;
  } catch (err) {
    await prisma.forumEvent.delete({ where: { threadId: thread.id } }).catch(() => undefined);
    logger.warn({ err, guildId: thread.guildId, threadId: thread.id }, "could not create forum event (missing Manage Events?)");
    return true; // don't tell the poster their title was bad when it was a permissions problem
  }
}
