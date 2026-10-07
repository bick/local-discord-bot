/**
 * Register slash commands. With DISCORD_DEV_GUILD_ID set, commands register to that
 * guild instantly; otherwise they register globally (can take up to an hour to appear).
 * Pass --global to force global registration even when a dev guild is configured.
 */
import { REST, Routes } from "discord.js";
import { commands } from "../src/discord/commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const devGuild = process.argv.includes("--global") ? undefined : process.env.DISCORD_DEV_GUILD_ID || undefined;
if (!token || !clientId) {
  console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
  process.exit(1);
}

const rest = new REST().setToken(token);
const body = commands.map((c) => c.data.toJSON());
const route = devGuild ? Routes.applicationGuildCommands(clientId, devGuild) : Routes.applicationCommands(clientId);
await rest.put(route, { body });
console.log(`Registered ${body.length} commands ${devGuild ? `to guild ${devGuild}` : "globally"}: ${body.map((c) => `/${c.name}`).join(" ")}`);
