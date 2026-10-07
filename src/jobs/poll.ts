import type { Client } from "discord.js";
import { logger } from "../logger.js";
import { runIngest } from "../pipeline/ingest.js";
import { postNewEvents, syncPostsForEvents } from "../discord/posting.js";
import { alert } from "../discord/alerts.js";

/** Every 6 hours: ingest, score, update changed posts, post anything new above threshold. */
export async function pollJob(client: Client): Promise<void> {
  const started = Date.now();
  const summary = await runIngest();
  await syncPostsForEvents(client, summary.changedEventIds);
  const posted = await postNewEvents(client);
  const { changedEventIds, ...rest } = summary;
  logger.info({ ...rest, changed: changedEventIds.length, posted, ms: Date.now() - started }, "poll complete");
  if (summary.errors.length) {
    await alert(client, `Poll finished with ${summary.errors.length} source error(s):\n${summary.errors.map((e) => `• ${e.source}: ${e.error}`).join("\n")}`);
  }
}
