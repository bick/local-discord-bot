import { SlashCommandBuilder } from "discord.js";
import { weekendWindow } from "../../lib/time.js";
import { eventListEmbed } from "../embeds.js";
import { guildMinScore, upcomingBigEvents } from "../queries.js";
import type { Command } from "./types.js";

export const weekend: Command = {
  data: new SlashCommandBuilder().setName("weekend").setDescription("Big DFW events this Friday through Sunday"),
  async execute(interaction) {
    const { from, to } = weekendWindow();
    const list = await upcomingBigEvents({ from, to, minScore: await guildMinScore(interaction.guildId), take: 15 });
    await interaction.reply({ embeds: [eventListEmbed("🌟 This weekend in DFW", list, { empty: "Quiet weekend. Nothing big on the radar." })] });
  },
};
