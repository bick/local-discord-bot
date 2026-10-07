import http from "node:http";
import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { Cron } from "croner";
import { config, TIME_ZONE } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { alert } from "./discord/alerts.js";
import { handleRsvpButton } from "./discord/buttons.js";
import { commandsByName } from "./discord/commands/index.js";
import { digestJob } from "./jobs/digest.js";
import { pollJob } from "./jobs/poll.js";
import { remindersJob } from "./jobs/reminders.js";

const cfg = config(); // fail fast on bad env

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function onInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (command) await command.execute(interaction);
    } else if (interaction.isButton()) {
      await handleRsvpButton(interaction);
    }
  } catch (err) {
    logger.error({ err, interaction: interaction.id }, "interaction failed");
    if (interaction.isRepliable()) {
      const reply = { content: "Something went wrong. Try again in a bit.", flags: MessageFlags.Ephemeral } as const;
      await (interaction.deferred || interaction.replied ? interaction.followUp(reply) : interaction.reply(reply)).catch(() => undefined);
    }
    await alert(client, `Interaction error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function schedule(name: string, pattern: string, job: () => Promise<void>): Cron {
  return new Cron(pattern, { name, timezone: TIME_ZONE, protect: true }, async () => {
    try {
      await job();
    } catch (err) {
      logger.error({ err, job: name }, "job failed");
      await alert(client, `Job \`${name}\` failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function startHealthServer(port: number): http.Server {
  return http
    .createServer((req, res) => {
      if (req.url !== "/health") {
        res.writeHead(404).end();
        return;
      }
      const ok = client.isReady();
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok, ping: client.ws.ping, guilds: client.guilds.cache.size }));
    })
    .listen(port, () => logger.info({ port }, "health server listening"));
}

client.once(Events.ClientReady, async (c) => {
  logger.info({ user: c.user.tag, guilds: c.guilds.cache.size }, "logged in");
  for (const guildId of c.guilds.cache.keys()) {
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId }, update: {} });
  }

  const jobs = [
    schedule("poll", cfg.POLL_CRON, () => pollJob(c)),
    schedule("digest", cfg.DIGEST_CRON, () => digestJob(c)),
    schedule("reminders", cfg.REMINDER_CRON, () => remindersJob(c)),
  ];
  for (const job of jobs) logger.info({ job: job.name, next: job.nextRun()?.toISOString() }, "scheduled");

  // Kick off a poll at boot so a fresh deploy has data without waiting six hours.
  void jobs[0]!.trigger();
});

client.on(Events.InteractionCreate, (i) => void onInteraction(i));

client.on(Events.GuildCreate, async (guild) => {
  await prisma.guildSettings.upsert({ where: { guildId: guild.id }, create: { guildId: guild.id }, update: {} });
  logger.info({ guildId: guild.id, name: guild.name }, "joined guild; run /setup to pick a channel");
});

client.on(Events.Error, (err) => logger.error({ err }, "discord client error"));
client.on(Events.ShardDisconnect, (_e, id) => logger.warn({ shard: id }, "gateway disconnected"));

const health = cfg.PORT ? startHealthServer(cfg.PORT) : null;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  health?.close();
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));

await client.login(cfg.DISCORD_TOKEN);
