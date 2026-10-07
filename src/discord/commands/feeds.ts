import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { addDays } from "date-fns";
import { prisma } from "../../db.js";
import { CalendarSource } from "../../sources/calendar.js";
import type { Command } from "./types.js";

export const feeds: Command = {
  data: new SlashCommandBuilder()
    .setName("feeds")
    .setDescription("Manage calendar feeds the bot pulls events from")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add an iCal or RSS calendar feed")
        .addStringOption((o) => o.setName("name").setDescription("e.g. City of Frisco events").setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName("url").setDescription("Feed URL (https://...)").setRequired(true).setMaxLength(500))
        .addStringOption((o) => o.setName("format").setDescription("Feed format").addChoices({ name: "iCal (.ics)", value: "ical" }, { name: "RSS", value: "rss" }))
        .addStringOption((o) => o.setName("city").setDescription("Default city for events without a location").setMaxLength(50))
        .addIntegerOption((o) => o.setName("trust").setDescription("0-100: how 'big' this feed's events usually are (default 50)").setMinValue(0).setMaxValue(100)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List calendar feeds"))
    .addSubcommand((s) =>
      s
        .setName("disable")
        .setDescription("Stop pulling from a feed")
        .addStringOption((o) => o.setName("id").setDescription("Feed id from /feeds list").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("enable")
        .setDescription("Resume pulling from a feed")
        .addStringOption((o) => o.setName("id").setDescription("Feed id from /feeds list").setRequired(true)),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const rows = await prisma.calendarFeed.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { events: true } } } });
      const lines = rows.map(
        (f) =>
          `${f.enabled ? "🟢" : "⚪"} **${f.name}** (\`${f.id}\`) · ${f.format} · trust ${f.trustWeight} · ${f._count.events} events` +
          (f.lastError ? `\n  ⚠️ ${f.lastError.slice(0, 120)}` : f.lastFetched ? `\n  fetched <t:${Math.floor(f.lastFetched.getTime() / 1000)}:R>` : ""),
      );
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: (lines.join("\n") || "No feeds yet. Add one with `/feeds add`.").slice(0, 2000) });
      return;
    }

    if (sub === "disable" || sub === "enable") {
      const id = interaction.options.getString("id", true);
      const updated = await prisma.calendarFeed.update({ where: { id }, data: { enabled: sub === "enable" } }).catch(() => null);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: updated ? `${sub === "enable" ? "Enabled" : "Disabled"} **${updated.name}**.` : `No feed with id \`${id}\`.`,
      });
      return;
    }

    // add
    const url = interaction.options.getString("url", true).trim();
    if (!/^https?:\/\//i.test(url)) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Feed URL must start with http:// or https://." });
      return;
    }
    const format = interaction.options.getString("format") ?? (/\.ics(\?|$)|ical|webcal/i.test(url) ? "ical" : "rss");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Try it before saving so a typo doesn't sit there failing silently.
    const draft = {
      id: "preview",
      name: interaction.options.getString("name", true),
      url,
      format,
      defaultCity: interaction.options.getString("city"),
      trustWeight: interaction.options.getInteger("trust") ?? 50,
    };
    let preview: string;
    try {
      const { events } = await new CalendarSource(draft).fetchUpcoming({ from: new Date(), to: addDays(new Date(), 90) });
      preview = `Found ${events.length} upcoming events${events[0] ? `, e.g. "${events[0].title}"` : ""}.`;
    } catch (err) {
      await interaction.editReply(`Couldn't read that feed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000));
      return;
    }

    const { id: _preview, ...data } = draft;
    const feed = await prisma.calendarFeed.upsert({ where: { url }, create: data, update: { ...data, enabled: true } });
    await interaction.editReply(`Added **${feed.name}** (\`${feed.id}\`). ${preview} Events show up after the next poll.`);
  },
};
