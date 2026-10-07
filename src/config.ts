import { z } from "zod";

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
  /** Optional: without it the bot only ingests calendar feeds. */
  SEATGEEK_CLIENT_ID: z.string().min(1).optional(),
  /** Optional: lets Big Tex answer questions with Claude. Without it he only sends canned greetings. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Max Claude answers per day across all servers, and per user. Reset at midnight Central. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(200),
  AI_USER_DAILY_LIMIT: z.coerce.number().int().min(0).default(15),
  DATABASE_URL: z.string().url(),
  TZ: z.literal("America/Chicago").default("America/Chicago"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  BOT_LOG_CHANNEL_ID: z.string().optional(),
  BOT_NAME: z.string().min(2).max(32).default("Big Tex"),
  /** Comma-separated Discord user IDs allowed to change the bot's profile. Defaults to the app owner / team. */
  BOT_OWNER_IDS: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  POLL_CRON: z.string().default("0 */6 * * *"),
  DIGEST_CRON: z.string().default("0 17 * * 4"), // Thursday 5pm
  REMINDER_CRON: z.string().default("15 * * * *"), // hourly
  LOOKAHEAD_DAYS: z.coerce.number().int().min(7).max(365).default(90),
});

export type Config = z.infer<typeof EnvSchema>;

// Treat empty strings from .env files as unset so optional vars stay optional.
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(cleanEnv(env));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

let cached: Config | undefined;

/** Lazily parsed config so pure modules (and tests) can import without a full env. */
export function config(): Config {
  cached ??= loadConfig();
  return cached;
}

export const TIME_ZONE = "America/Chicago";
