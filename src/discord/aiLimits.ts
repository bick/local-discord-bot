import { chicagoDay } from "../lib/time.js";

export type Allowance = "ok" | "user-limit" | "daily-limit";

/**
 * Daily caps on Claude calls, per user and overall, reset at midnight Central.
 * Kept in memory, so a redeploy resets today's counts; the Anthropic Console spend limit is the hard backstop.
 */
export class AiLimiter {
  private day = "";
  private total = 0;
  private perUser = new Map<string, number>();

  constructor(
    private readonly dailyLimit: number,
    private readonly userDailyLimit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private rollover(): void {
    const today = chicagoDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.total = 0;
      this.perUser.clear();
    }
  }

  check(userId: string): Allowance {
    this.rollover();
    if (this.total >= this.dailyLimit) return "daily-limit";
    if ((this.perUser.get(userId) ?? 0) >= this.userDailyLimit) return "user-limit";
    return "ok";
  }

  record(userId: string): void {
    this.rollover();
    this.total++;
    this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + 1);
  }
}

export const LIMIT_REPLIES: Record<Exclude<Allowance, "ok">, string> = {
  "user-limit": "Whew, partner, you've asked me a heap of questions today and this old cowboy's jaw needs a rest. Try `/events` or `/weekend`, and come holler at me tomorrow. 🤠",
  "daily-limit": "Y'all have talked my 75-gallon hat clean off today! I'm done answering questions until tomorrow, but `/events` and `/weekend` still work. 🤠",
};
