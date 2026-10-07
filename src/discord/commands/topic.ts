import { SlashCommandBuilder } from "discord.js";
import { CATEGORY_LABELS, pickTopic, TOPIC_CATEGORIES, type TopicCategory } from "../topics.js";
import type { Command } from "./types.js";

export const topic: Command = {
  data: new SlashCommandBuilder()
    .setName("topic")
    .setDescription("Get a fun conversation starter")
    .addStringOption((o) =>
      o
        .setName("category")
        .setDescription("Kind of topic (random if left blank)")
        .addChoices(...TOPIC_CATEGORIES.map((c) => ({ name: CATEGORY_LABELS[c], value: c }))),
    ),
  async execute(interaction) {
    const requested = interaction.options.getString("category") as TopicCategory | null;
    const { category, topic } = pickTopic(requested ?? undefined);
    await interaction.reply({ content: `**${CATEGORY_LABELS[category]}**\n${topic}`, allowedMentions: { parse: [] } });
  },
};
