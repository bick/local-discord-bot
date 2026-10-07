import { SlashCommandBuilder } from "discord.js";
import type { Category } from "@prisma/client";
import { CATEGORY_LABEL, eventListEmbed } from "../embeds.js";
import { guildMinScore, upcomingBigEvents } from "../queries.js";
import type { Command } from "./types.js";

export const CATEGORY_CHOICES = (Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ name: CATEGORY_LABEL[c], value: c }));

export const events: Command = {
  data: new SlashCommandBuilder()
    .setName("events")
    .setDescription("The next 10 big events around DFW")
    .addStringOption((o) => o.setName("category").setDescription("Only this kind of event").addChoices(...CATEGORY_CHOICES))
    .addStringOption((o) => o.setName("city").setDescription("e.g. Dallas, Fort Worth, Plano, Frisco").setMaxLength(50)),
  async execute(interaction) {
    const category = interaction.options.getString("category") as Category | null;
    const city = interaction.options.getString("city");
    const list = await upcomingBigEvents({
      from: new Date(),
      minScore: await guildMinScore(interaction.guildId),
      category,
      city,
      take: 10,
    });
    const filters = [category ? CATEGORY_LABEL[category] : null, city ? `in ${city}` : null].filter(Boolean).join(" ");
    await interaction.reply({
      embeds: [eventListEmbed(`Upcoming big events in DFW${filters ? ` (${filters})` : ""}`, list)],
    });
  },
};
