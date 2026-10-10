import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
} from "discord.js";
import { logger } from "../logger.js";

// Handles the role picker panel that the old /roles-setup command posted in #roles.
// The command is gone, but the panel and its roles still live in the server.

const COLOR_EMOJI: Record<string, string> = {
  Red: "🔴",
  Orange: "🟠",
  "Burnt Orange": "🤘",
  Gold: "⭐",
  Yellow: "🟡",
  Lime: "🍏",
  Green: "🟢",
  Teal: "🦚",
  "Sky Blue": "💧",
  Blue: "🔵",
  Navy: "⚓",
  Purple: "🟣",
  Lavender: "💜",
  Pink: "🌸",
  "Cups Pink": "🥤",
  Maroon: "🍷",
  Brown: "🟤",
  White: "⚪",
};

const COLOR_SELECT_ID = "roles:color";
const POLITICS_BUTTON_ID = "roles:politics";

/** Colors added after the panel was posted: each gets its role created and a menu option on boot, right after `after`. */
const ADDED_COLORS = [{ name: "Cups Pink", color: 0xffd1dc, after: "Pink" }];

/** Opt-in buttons on the panel: each toggles one role that unlocks hidden channels. */
const TOGGLES: Record<string, { role: string; on: string; off: string; optIn: string; optOut: string }> = {
  [POLITICS_BUTTON_ID]: {
    role: "Politics",
    on: "🗳️ Politics channel unlocked. Keep it civil, y'all.",
    off: "🙈 Politics channel hidden. Peace and quiet.",
    optIn: "Opted into politics in #roles",
    optOut: "Opted out of politics in #roles",
  },
  "roles:nsfw": {
    role: "NSFW",
    on: "🔞 NSFW channels unlocked. Adults only, and keep it within the rules.",
    off: "🙈 NSFW channels hidden.",
    optIn: "Opted into NSFW in #roles",
    optOut: "Opted out of NSFW in #roles",
  },
};
const NO_COLOR = "none";

const MISSING_ROLE = "That role doesn't exist anymore. Ask a server manager to recreate it.";
const NO_PERMISSION =
  "I couldn't change your roles. A manager needs to give me **Manage Roles** and drag my role above the color, Politics, and NSFW roles in Server Settings → Roles.";

/** Handles the #roles color menu and Politics button. Returns false if the interaction isn't ours. */
export async function handleRoleComponent(interaction: MessageComponentInteraction): Promise<boolean> {
  const isColor = interaction.isStringSelectMenu() && interaction.customId === COLOR_SELECT_ID;
  const toggle = interaction.isButton() ? TOGGLES[interaction.customId] : undefined;
  if (!isColor && !toggle) return false;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This only works inside the server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const { guild, member } = interaction;
  try {
    if (interaction.isStringSelectMenu()) {
      const choice = interaction.values[0];
      const current = member.roles.cache.filter((r) => r.name in COLOR_EMOJI);
      const target = choice === NO_COLOR ? null : guild.roles.cache.find((r) => r.name === choice);
      if (choice !== NO_COLOR && !target) {
        await interaction.reply({ content: MISSING_ROLE, flags: MessageFlags.Ephemeral });
        return true;
      }
      const toRemove = current.filter((r) => r.id !== target?.id);
      if (toRemove.size) await member.roles.remove(toRemove, "Picked a new color in #roles");
      if (target && !member.roles.cache.has(target.id)) await member.roles.add(target, "Picked a color in #roles");
      await interaction.reply({
        content: target ? `${COLOR_EMOJI[target.name] ?? "🎨"} You're now **${target.name}**.` : "Color removed.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const t = toggle!;
    const role = guild.roles.cache.find((r) => r.name === t.role);
    if (!role) {
      await interaction.reply({ content: MISSING_ROLE, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, t.optOut);
      await interaction.reply({ content: t.off, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(role, t.optIn);
      await interaction.reply({ content: t.on, flags: MessageFlags.Ephemeral });
    }
    return true;
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.MissingPermissions) {
      logger.warn({ guildId: guild.id }, "role change blocked by permissions or role hierarchy");
      await interaction.reply({ content: NO_PERMISSION, flags: MessageFlags.Ephemeral });
      return true;
    }
    throw err;
  }
}

const NSFW_BUTTON_ID = "roles:nsfw";
const NSFW_PANEL_TEXT = "**🔞 NSFW:** the NSFW channels are opt-in and adults only. Hit the button to show them, and hit it again to hide them.";

/**
 * The #roles panel was posted by the old /roles-setup command, so it predates the NSFW button.
 * Add the button (and the NSFW role) to any panel that doesn't have it yet. Safe to run on every boot.
 */
export async function addNsfwToRolePanels(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await addNsfwToRolePanel(guild);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "could not add NSFW button to role panel");
    }
    try {
      await addColorsToRolePanel(guild);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "could not add new colors to role panel");
    }
  }
}

async function addNsfwToRolePanel(guild: Guild): Promise<void> {
  const channel = guild.channels.cache.find((c) => c.name === "roles" && c.type === ChannelType.GuildText);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const messages = await channel.messages.fetch({ limit: 50 });
  const panel = messages.find(
    (m) =>
      m.author.id === guild.client.user.id &&
      m.components.some((row) => row.type === ComponentType.ActionRow && row.components.some((c) => c.customId === POLITICS_BUTTON_ID)),
  );
  if (!panel) return;
  const hasNsfw = panel.components.some((row) => row.type === ComponentType.ActionRow && row.components.some((c) => c.customId === NSFW_BUTTON_ID));
  if (hasNsfw) return;

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (me.permissions.has(PermissionFlagsBits.ManageRoles) && !guild.roles.cache.some((r) => r.name === "NSFW")) {
    await guild.roles.create({ name: "NSFW", permissions: [], mentionable: false, reason: "Big Tex: NSFW opt-in role for #roles" });
  }

  const nsfw = new ButtonBuilder().setCustomId(NSFW_BUTTON_ID).setLabel("NSFW channels").setEmoji("🔞").setStyle(ButtonStyle.Secondary);
  const rows = panel.components
    .filter((row) => row.type === ComponentType.ActionRow)
    .map((row) => ActionRowBuilder.from<MessageActionRowComponentBuilder>(row));
  const buttonRow = rows.find((row) => row.components.length < 5 && row.components.every((c) => c.data.type === ComponentType.Button));
  if (buttonRow) buttonRow.addComponents(nsfw);
  else rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(nsfw));

  const embeds = panel.embeds.map((e, i) => {
    const b = EmbedBuilder.from(e);
    return i === 0 ? b.setDescription(`${e.description ?? ""}\n\n${NSFW_PANEL_TEXT}`.trim()) : b;
  });

  await panel.edit({ embeds, components: rows });
  logger.info({ guildId: guild.id, messageId: panel.id }, "added NSFW button to role panel");
}

/** Creates any missing ADDED_COLORS roles and adds their options to the panel's color menu. Safe to run on every boot. */
async function addColorsToRolePanel(guild: Guild): Promise<void> {
  const channel = guild.channels.cache.find((c) => c.name === "roles" && c.type === ChannelType.GuildText);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const messages = await channel.messages.fetch({ limit: 50 });
  const panel = messages.find(
    (m) =>
      m.author.id === guild.client.user.id &&
      m.components.some((row) => row.type === ComponentType.ActionRow && row.components.some((c) => c.customId === COLOR_SELECT_ID)),
  );
  if (!panel) return;

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    for (const c of ADDED_COLORS) {
      if (guild.roles.cache.some((r) => r.name === c.name)) continue;
      const neighbor = guild.roles.cache.find((r) => r.name === c.after);
      await guild.roles.create({
        name: c.name,
        color: c.color,
        permissions: [],
        mentionable: false,
        position: neighbor?.position,
        reason: "Big Tex: color role for #roles",
      });
    }
  }

  let changed = false;
  const rows = panel.components
    .filter((row) => row.type === ComponentType.ActionRow)
    .map((row) => {
      const builder = ActionRowBuilder.from<MessageActionRowComponentBuilder>(row);
      const select = builder.components[0];
      if (!(select instanceof StringSelectMenuBuilder) || select.data.custom_id !== COLOR_SELECT_ID) return builder;
      for (const c of ADDED_COLORS) {
        if (select.options.some((o) => o.data.value === c.name)) continue;
        const i = select.options.findIndex((o) => o.data.value === c.after);
        const at = i === -1 ? select.options.findIndex((o) => o.data.value === NO_COLOR) : i + 1;
        select.spliceOptions(at === -1 ? select.options.length : at, 0, { label: c.name, value: c.name, emoji: { name: COLOR_EMOJI[c.name] } });
        changed = true;
      }
      return builder;
    });
  if (!changed) return;

  await panel.edit({ components: rows });
  logger.info({ guildId: guild.id, messageId: panel.id }, "added new colors to role panel");
}
