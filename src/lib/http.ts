const USER_AGENT = "dfw-events-bot/0.1 (+https://github.com/bick/local-discord-bot)";

export async function fetchText(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new Error(`GET ${redact(url)} failed: ${res.status} ${res.statusText}`);
  return res.text();
}

export async function fetchJson(url: string, opts: { timeoutMs?: number } = {}): Promise<unknown> {
  return JSON.parse(await fetchText(url, opts));
}

/** Strip credentials from URLs before they reach logs or error messages. */
export function redact(url: string): string {
  return url.replace(/(client_id|client_secret)=[^&]+/g, "$1=***");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
