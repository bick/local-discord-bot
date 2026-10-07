import { DiscordAPIError, MessageFlags, RESTJSONErrorCodes, type MessageComponentInteraction } from "discord.js";
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
  Maroon: "🍷",
  Brown: "🟤",
  White: "⚪",
};

const POLITICS_ROLE_NAME = "Politics";
const COLOR_SELECT_ID = "roles:color";
const POLITICS_BUTTON_ID = "roles:politics";
const NO_COLOR = "none";

const MISSING_ROLE = "That role doesn't exist anymore. Ask a server manager to recreate it.";
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

    const role = guild.roles.cache.find((r) => r.name === POLITICS_ROLE_NAME);
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
