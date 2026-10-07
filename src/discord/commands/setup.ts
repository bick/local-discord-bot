import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Category } from "@prisma/client";
import { prisma } from "../../db.js";
import { CATEGORY_LABEL } from "../embeds.js";
import type { Command } from "./types.js";

const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export function parseCategories(input: string): Category[] | "invalid" {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "all" || trimmed === "") return [];
  const parts = trimmed.split(/[\s,]+/).filter(Boolean).map((p) => p.toUpperCase().replace(/[^A-Z_]/g, ""));
  const mapped = parts.map((p) => (p === "MUSIC" ? "CONCERT" : p === "SPORT" ? "SPORTS" : p));
  if (!mapped.every((p): p is Category => (ALL_CATEGORIES as string[]).includes(p))) return "invalid";
  return [...new Set(mapped)];
}

export const setup: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure where and what the bot posts")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel for event posts and the weekend digest").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addIntegerOption((o) => o.setName("min-score").setDescription("Only auto-post events scoring at least this (0-100, default 60)").setMinValue(0).setMaxValue(100))
    .addIntegerOption((o) => o.setName("max-posts-per-day").setDescription("Cap on auto posts per day (default 5)").setMinValue(0).setMaxValue(50))
    .addBooleanOption((o) => o.setName("digest").setDescription("Send the Thursday 'this weekend in DFW' digest"))
    .addStringOption((o) =>
      o.setName("categories").setDescription(`"all", or a comma list: ${ALL_CATEGORIES.join(", ").toLowerCase()}`).setMaxLength(100),
    ),
  async execute(interaction) {
    if (!interaction.guildId) return;
    const channel = interaction.options.getChannel("channel");
    const minBigScore = interaction.options.getInteger("min-score");
    const maxPostsPerDay = interaction.options.getInteger("max-posts-per-day");
    const digestEnabled = interaction.options.getBoolean("digest");
    const categoriesRaw = interaction.options.getString("categories");

    let categories: Category[] | undefined;
    if (categoriesRaw != null) {
      const parsed = parseCategories(categoriesRaw);
      if (parsed === "invalid") {
        await interaction.reply({ content: `Unknown category. Use "all" or any of: ${ALL_CATEGORIES.join(", ").toLowerCase()}.`, flags: MessageFlags.Ephemeral });
        return;
      }
      categories = parsed;
    }

    const data = {
      ...(channel ? { eventsChannelId: channel.id } : {}),
      ...(minBigScore != null ? { minBigScore } : {}),
      ...(maxPostsPerDay != null ? { maxPostsPerDay } : {}),
      ...(digestEnabled != null ? { digestEnabled } : {}),
      ...(categories ? { categories } : {}),
    };
    const s = await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId, ...data },
      update: data,
    });

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: [
        "**Big Tex settings**",
        `Channel: ${s.eventsChannelId ? `<#${s.eventsChannelId}>` : "not set (use `/setup channel:#events`)"}`,
        `Min score: ${s.minBigScore}`,
        `Max posts per day: ${s.maxPostsPerDay}`,
        `Weekend digest: ${s.digestEnabled ? "on" : "off"}`,
        `Categories: ${s.categories.length ? s.categories.map((c) => CATEGORY_LABEL[c]).join(", ") : "all"}`,
      ].join("\n"),
    });
  },
};
