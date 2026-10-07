import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildBasedChannel,
  type NewsChannel,
  type TextChannel,
} from "discord.js";
import { logger } from "../../logger.js";
import { COLOR_ROLES, POLITICS_ROLE, ensureRole, rolePanel } from "../roles.js";
import type { Command } from "./types.js";

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

function findByName(channels: Iterable<GuildBasedChannel>, name: string): TextChannel | NewsChannel | undefined {
  for (const c of channels) if (c.name === name && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)) return c;
  return undefined;
}

export const rolesSetup: Command = {
  data: new SlashCommandBuilder()
    .setName("roles-setup")
    .setDescription("Create the color and Politics roles and post the role picker (managers only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addChannelOption((o) => o.setName("channel").setDescription("Where to post the role picker (default #roles)").addChannelTypes(...TEXT_CHANNELS))
    .addChannelOption((o) =>
      o.setName("politics-channel").setDescription("Channel only the Politics role can see (default #politics)").addChannelTypes(...TEXT_CHANNELS),
    ),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Only server managers can run this.", flags: MessageFlags.Ephemeral });
      return;
    }

    const { guild } = interaction;
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "I need the **Manage Roles** permission first. Server Settings → Roles → my role → turn on Manage Roles, then run this again.",
      });
      return;
    }

    const rolesChannel = interaction.options.getChannel("channel", false, TEXT_CHANNELS) ?? findByName(guild.channels.cache.values(), "roles");
    const politicsChannel = interaction.options.getChannel("politics-channel", false, TEXT_CHANNELS) ?? findByName(guild.channels.cache.values(), "politics");
    if (!rolesChannel) {
      await interaction.reply({ content: "I couldn't find a #roles channel. Create one or pass `channel:`.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const notes: string[] = [];

    let created = 0;
    for (const c of COLOR_ROLES) {
      if ((await ensureRole(guild, c.name, c.color)).created) created++;
    }
    notes.push(`🎨 ${COLOR_ROLES.length} color roles ready (${created} new).`);

    const { role: politicsRole, created: politicsCreated } = await ensureRole(guild, POLITICS_ROLE.name);
    notes.push(`${POLITICS_ROLE.emoji} Politics role ${politicsCreated ? "created" : "already existed"}.`);

    if (politicsChannel) {
      try {
        // Keep my own access first so hiding it from @everyone doesn't lock me out.
        await politicsChannel.permissionOverwrites.edit(me, { ViewChannel: true }, { reason: "Big Tex /roles-setup" });
        await politicsChannel.permissionOverwrites.edit(politicsRole, { ViewChannel: true }, { reason: "Big Tex /roles-setup" });
        await politicsChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, { reason: "Big Tex /roles-setup" });
        notes.push(`🔒 <#${politicsChannel.id}> is now hidden unless you have the Politics role. Admins can still see it.`);
      } catch (err) {
        logger.warn({ err, guildId: guild.id }, "could not lock politics channel");
        notes.push(`⚠️ I couldn't change permissions on <#${politicsChannel.id}>. Give me **Manage Roles** (Manage Permissions) on that channel and run this again.`);
      }
    } else {
      notes.push("⚠️ No #politics channel found, so nothing was locked. Create one or pass `politics-channel:` and run this again.");
    }

    try {
      const message = await rolesChannel.send(rolePanel());
      notes.push(`📌 Role picker posted: ${message.url}`);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "could not post role panel");
      notes.push(`⚠️ I couldn't post in <#${rolesChannel.id}>. Check that I can view it and send messages there.`);
    }

    notes.push(
      "",
      "Heads up: new roles go at the bottom of the list. If someone already has a colored role ranked higher, that color wins. Drag the color roles up in Server Settings → Roles (they must stay below my role).",
    );
    await interaction.editReply(notes.join("\n"));
  },
};
