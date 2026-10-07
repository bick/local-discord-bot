import { MessageFlags, type ButtonInteraction } from "discord.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { eventEmbed, parseRsvpCustomId, rsvpButtons } from "./embeds.js";
import { rsvpCounts } from "./rsvp.js";

const CONFIRMATION = {
  GOING: "✅ You're going! You've been added to the event thread. Coordinate rides and meetups there.",
  INTERESTED: "⭐ Marked as interested. We'll keep you posted.",
  NOT_FOR_ME: "👍 Got it, not for you.",
} as const;

export async function handleRsvpButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseRsvpCustomId(interaction.customId);
  if (!parsed || !interaction.guildId) return false;
  const { status, eventId } = parsed;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    await interaction.reply({ content: "That event no longer exists.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (event.cancelled) {
    await interaction.reply({ content: "That event was cancelled.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await prisma.rsvp.upsert({
    where: { eventId_userId: { eventId, userId: interaction.user.id } },
    create: { eventId, userId: interaction.user.id, guildId: interaction.guildId, status },
    update: { status, guildId: interaction.guildId },
  });

  const counts = await rsvpCounts(eventId, interaction.guildId);
  await interaction.update({ embeds: [eventEmbed(event, counts)], components: [rsvpButtons(event, counts)] });

  // Pull Going folks into the carpool thread so they see the planning.
  const post = await prisma.post.findUnique({ where: { eventId_guildId: { eventId, guildId: interaction.guildId } } });
  let content: string = CONFIRMATION[status];
  if (post?.threadId) {
    const thread = await interaction.client.channels.fetch(post.threadId).catch(() => null);
    if (thread?.isThread()) {
      if (status === "GOING") await thread.members.add(interaction.user.id).catch((err) => logger.debug({ err }, "thread add failed"));
      content += `\nThread: <#${thread.id}>`;
    }
  } else if (status === "GOING") {
    content = "✅ You're going!";
  }
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  return true;
}
