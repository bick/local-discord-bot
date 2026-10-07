import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { logger } from "../../logger.js";
import { isBotOwner } from "../profile.js";
import type { Command } from "./types.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

export const avatar: Command = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Change the bot's profile picture (bot owner only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption((o) => o.setName("image").setDescription("PNG, JPG, GIF, or WebP, square works best").setRequired(true)),
  async execute(interaction) {
    if (!(await isBotOwner(interaction.client, interaction.user))) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Only the bot's owner can change its profile picture." });
      return;
    }
    const image = interaction.options.getAttachment("image", true);
    if (!image.contentType || !IMAGE_TYPES.includes(image.contentType.split(";")[0]!)) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "That doesn't look like a PNG, JPG, GIF, or WebP image." });
      return;
    }
    if (image.size > MAX_BYTES) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "That image is too big (8 MB max)." });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.client.user.setAvatar(image.url);
      await interaction.editReply("Profile picture updated. 🤠");
    } catch (err) {
      logger.warn({ err }, "avatar update failed");
      const reason = err instanceof Error ? err.message : String(err);
      await interaction.editReply(`Discord rejected the change: ${reason}. Avatar changes are rate limited, so try again in a few minutes.`.slice(0, 2000));
    }
  },
};
