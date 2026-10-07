import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "../../db.js";
import { eventListEmbed } from "../embeds.js";
import type { Command } from "./types.js";

export const going: Command = {
  data: new SlashCommandBuilder().setName("going").setDescription("Upcoming events you RSVP'd Going or Interested to"),
  async execute(interaction) {
    const rsvps = await prisma.rsvp.findMany({
      where: {
        userId: interaction.user.id,
        status: { in: ["GOING", "INTERESTED"] },
        event: { OR: [{ startsAt: { gte: new Date() } }, { endsAt: { gt: new Date() } }] },
      },
      include: { event: true },
      orderBy: { event: { startsAt: "asc" } },
      take: 20,
    });
    const goingList = rsvps.filter((r) => r.status === "GOING").map((r) => r.event);
    const interested = rsvps.filter((r) => r.status === "INTERESTED").map((r) => r.event);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        eventListEmbed("✅ You're going", goingList, { empty: "Nothing yet. Hit **Going** on a post in the events channel." }),
        ...(interested.length ? [eventListEmbed("⭐ You're interested", interested)] : []),
      ],
    });
  },
};
