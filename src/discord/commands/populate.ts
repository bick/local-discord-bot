import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { runIngest } from "../../pipeline/ingest.js";
import { postToGuild } from "../posting.js";
import type { Command } from "./types.js";

export const populate: Command = {
  data: new SlashCommandBuilder()
    .setName("populate")
    .setDescription("Fetch the latest events and post the ones this server hasn't seen yet, right now")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName("count").setDescription("Max events to post (default 10). Ignores the daily cap.").setMinValue(1).setMaxValue(25))
    .addBooleanOption((o) => o.setName("refresh").setDescription("Re-fetch SeatGeek and calendar feeds first (default true)")),
  async execute(interaction) {
    if (!interaction.guildId) return;
    const count = interaction.options.getInteger("count") ?? 10;
    const refresh = interaction.options.getBoolean("refresh") ?? true;

    const settings = await prisma.guildSettings.findUnique({ where: { guildId: interaction.guildId } });
    if (!settings?.eventsChannelId) {
      await interaction.reply({ content: "No events channel yet. Run `/setup channel:#events` first.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Fetching feeds and posting threads can take well past Discord's 3s reply window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let refreshNote = "";
    if (refresh) {
      const summary = await runIngest();
      logger.info({ guildId: interaction.guildId, fetched: summary.fetched, created: summary.created }, "populate refreshed feeds");
      refreshNote = `Refreshed feeds: ${summary.fetched} fetched, ${summary.created} new.`;
      if (summary.errors.length) refreshNote += ` ${summary.errors.length} source error(s): ${summary.errors.map((e) => e.source).join(", ")}.`;
    }

    const result = await postToGuild(interaction.client, settings, count);
    const channel = `<#${settings.eventsChannelId}>`;
    let outcome: string;
    switch (result.status) {
      case "busy":
        outcome = "Already posting events here. Give it a minute and try again.";
        break;
      case "no-channel":
        outcome = `I can't post in ${channel}. Check that it still exists and I have Send Messages and Embed Links there.`;
        break;
      case "no-guild":
        outcome = "I couldn't find this server in my cache. Try again in a moment.";
        break;
      case "posted":
        outcome =
          result.posted > 0
            ? `Posted ${result.posted} event${result.posted === 1 ? "" : "s"} to ${channel}.`
            : `Nothing new to post. Everything scoring ${settings.minBigScore}+ in the next 45 days is already in ${channel}. Lower the bar with \`/setup min-score:\`.`;
    }

    await interaction.editReply([refreshNote, outcome].filter(Boolean).join("\n"));
  },
};
