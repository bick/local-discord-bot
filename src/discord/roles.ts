import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
  StringSelectMenuBuilder,
  type Guild,
  type MessageComponentInteraction,
  type Role,
} from "discord.js";
import { logger } from "../logger.js";

/** Name colors members can pick from #roles. Order is the order shown in the menu. */
export const COLOR_ROLES = [
  { name: "Red", color: 0xe74c3c, emoji: "🔴" },
  { name: "Orange", color: 0xf39c12, emoji: "🟠" },
  { name: "Burnt Orange", color: 0xbf5700, emoji: "🤘" },
  { name: "Gold", color: 0xd4af37, emoji: "⭐" },
  { name: "Yellow", color: 0xf1c40f, emoji: "🟡" },
  { name: "Lime", color: 0xa3e635, emoji: "🍏" },
  { name: "Green", color: 0x2ecc71, emoji: "🟢" },
  { name: "Teal", color: 0x1abc9c, emoji: "🦚" },
  { name: "Sky Blue", color: 0x5dade2, emoji: "💧" },
  { name: "Blue", color: 0x3498db, emoji: "🔵" },
  { name: "Navy", color: 0x3b5bdb, emoji: "⚓" },
  { name: "Purple", color: 0x9b59b6, emoji: "🟣" },
  { name: "Lavender", color: 0xc4b5fd, emoji: "💜" },
  { name: "Pink", color: 0xff69b4, emoji: "🌸" },
  { name: "Maroon", color: 0x9b2335, emoji: "🍷" },
  { name: "Brown", color: 0x8b5a2b, emoji: "🟤" },
  { name: "White", color: 0xf5f5f5, emoji: "⚪" },
] as const;

export const POLITICS_ROLE = { name: "Politics", emoji: "🗳️" } as const;

const COLOR_SELECT_ID = "roles:color";
const POLITICS_BUTTON_ID = "roles:politics";
const NO_COLOR = "none";
const COLOR_NAMES = new Set<string>(COLOR_ROLES.map((c) => c.name));

/** Find a role by exact name, or create it. Returns whether it was created. */
export async function ensureRole(guild: Guild, name: string, color?: number): Promise<{ role: Role; created: boolean }> {
  const existing = guild.roles.cache.find((r) => r.name === name);
  if (existing) return { role: existing, created: false };
  const role = await guild.roles.create({
    name,
    ...(color != null ? { colors: { primaryColor: color } } : {}),
    permissions: [],
    mentionable: false,
    reason: "Big Tex /roles-setup",
  });
  return { role, created: true };
}

export function rolePanel() {
  const embed = new EmbedBuilder()
    .setColor(0xc1440e)
    .setTitle("🎨 Pick your roles")
    .setDescription(
      [
        "**Name color:** pick one from the menu below. Picking a new one swaps it out; choose **No color** to go back to default.",
        "",
        `**${POLITICS_ROLE.emoji} Politics:** the politics channel is opt-in. Hit the button to show it, and hit it again to hide it.`,
      ].join("\n"),
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId(COLOR_SELECT_ID)
    .setPlaceholder("Choose a name color")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      ...COLOR_ROLES.map((c) => ({ label: c.name, value: c.name, emoji: c.emoji })),
      { label: "No color", value: NO_COLOR, emoji: "✖️" },
    );

  const politics = new ButtonBuilder()
    .setCustomId(POLITICS_BUTTON_ID)
    .setLabel("Politics channel")
    .setEmoji(POLITICS_ROLE.emoji)
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(politics),
    ],
  };
}

const MISSING_ROLE = "That role doesn't exist anymore. Ask a manager to run `/roles-setup` again.";
const NO_PERMISSION =
  "I couldn't change your roles. A manager needs to give me **Manage Roles** and drag my role above the color and Politics roles in Server Settings → Roles.";

/** Handles the #roles color menu and Politics button. Returns false if the interaction isn't ours. */
export async function handleRoleComponent(interaction: MessageComponentInteraction): Promise<boolean> {
  const isColor = interaction.isStringSelectMenu() && interaction.customId === COLOR_SELECT_ID;
  const isPolitics = interaction.isButton() && interaction.customId === POLITICS_BUTTON_ID;
  if (!isColor && !isPolitics) return false;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This only works inside the server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const { guild, member } = interaction;
  try {
    if (interaction.isStringSelectMenu()) {
      const choice = interaction.values[0];
      const current = member.roles.cache.filter((r) => COLOR_NAMES.has(r.name));
      const target = choice === NO_COLOR ? null : guild.roles.cache.find((r) => r.name === choice);
      if (choice !== NO_COLOR && !target) {
        await interaction.reply({ content: MISSING_ROLE, flags: MessageFlags.Ephemeral });
        return true;
      }
      const toRemove = current.filter((r) => r.id !== target?.id);
      if (toRemove.size) await member.roles.remove(toRemove, "Picked a new color in #roles");
      if (target && !member.roles.cache.has(target.id)) await member.roles.add(target, "Picked a color in #roles");
      await interaction.reply({
        content: target ? `${COLOR_ROLES.find((c) => c.name === target.name)?.emoji ?? "🎨"} You're now **${target.name}**.` : "Color removed.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const role = guild.roles.cache.find((r) => r.name === POLITICS_ROLE.name);
    if (!role) {
      await interaction.reply({ content: MISSING_ROLE, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, "Opted out of politics in #roles");
      await interaction.reply({ content: "🙈 Politics channel hidden. Peace and quiet.", flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(role, "Opted into politics in #roles");
      await interaction.reply({ content: "🗳️ Politics channel unlocked. Keep it civil, y'all.", flags: MessageFlags.Ephemeral });
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
