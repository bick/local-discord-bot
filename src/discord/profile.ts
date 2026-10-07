import { Team, type Client, type User } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

/** Rename the bot account to BOT_NAME if it differs. Discord allows ~2 username changes per hour. */
export async function ensureBotName(client: Client<true>): Promise<void> {
  const name = config().BOT_NAME;
  if (client.user.username === name) return;
  try {
    await client.user.setUsername(name);
    logger.info({ name }, "bot username updated");
  } catch (err) {
    logger.warn({ err, name }, "could not update bot username (rate limited or name taken?)");
  }
}

/** BOT_OWNER_IDS if set, otherwise the application owner or its team members. */
export async function isBotOwner(client: Client<true>, user: User): Promise<boolean> {
  const explicit = config().BOT_OWNER_IDS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (explicit?.length) return explicit.includes(user.id);
  const app = await client.application.fetch();
  if (app.owner instanceof Team) return app.owner.members.has(user.id);
  return app.owner?.id === user.id;
}
