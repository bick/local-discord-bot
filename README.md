# Big Tex: DFW Events Discord Bot

Big Tex finds big events around Dallas/Fort Worth (State Fair, Fort Worth Stock Show, Mavs/Stars/Cowboys games, big concerts), posts them to an `#events` channel, and nudges people to actually go together: RSVP buttons, a carpool thread per event, native Discord Scheduled Events, a Thursday "this weekend" digest, and day-before reminders.

TypeScript (strict), discord.js v14, Prisma + Postgres, deployed as a single Railway worker.

## How it works

```
every 6h  poll    SeatGeek + calendar feeds ─▶ normalize ─▶ dedupe/merge ─▶ score ─▶ Postgres
                  changed/cancelled events ─▶ edit posted messages + scheduled events
                  new events ≥ minBigScore ─▶ post (embed + RSVP buttons + thread [+ scheduled event])
Thu 5pm   digest  top 5 events Fri–Sun per server
hourly    remind  day-before ping to everyone Going; 3-days-out nudge when ≥3 people RSVP'd
                  (quiet hours 9pm–9am Chicago)
```

| Path | What |
|---|---|
| `src/sources/seatgeek.ts` | SeatGeek `/2/events`, 40mi around downtown Dallas, paginated, zod-validated |
| `src/sources/calendar.ts` | iCal (`node-ical`, RRULEs expanded only within the window, max 12 per series) and RSS (RSS event module + CivicPlus fields). One instance per `CalendarFeed` row. `file:` URLs read from the repo. |
| `src/pipeline/score.ts` | Pure `bigScore()` 0–100: SeatGeek popularity, feed trust, venue capacity, category, multi-day, keywords, civic-meeting penalty |
| `src/pipeline/dedupe.ts` | `title|chicago-day|venue` key with loose venue matching; SeatGeek wins price/image/time, the official calendar wins title/description/URL |
| `src/pipeline/ingest.ts` | Idempotent upserts, merge, cancellation sweep (missing from SeatGeek two polls in a row) |
| `src/discord/` | Embeds, RSVP buttons, posting, scheduled events, slash commands |
| `src/jobs/` | `poll`, `digest`, `reminders` |
| `feeds/dfw-annual.ics` | Hand-curated big annual festivals (seeded as a high-trust feed) |

### Slash commands

| Command | Who | |
|---|---|---|
| `/events [category] [city]` | everyone | Next 10 big events |
| `/weekend` | everyone | Friday through Sunday |
| `/topic [category]` | everyone | A fun conversation starter (would you rather, hot takes, hypotheticals, nostalgia, get to know you) |
| ⭐ reactions | everyone | A message that gets 5 or more ⭐ reactions is forwarded to `#hall-of-fame` (once). Create a text channel with that exact name to turn it on |
| `/going` | everyone | Your Going / Interested events (private reply) |
| `/setup [channel] [min-score] [max-posts-per-day] [digest] [categories]` | Manage Server | Per-server config |
| `/feeds add\|list\|enable\|disable` | Manage Server | Manage calendar feeds (test-fetches before saving) |
| `/avatar image:` | bot owner | Change the bot's profile picture |
| `/ping` | everyone | Health check |
| `@Big Tex` anything (or a DM) | everyone | Bare hellos get one of 50 canned greetings; questions get an in-character answer from Claude (needs `ANTHROPIC_API_KEY`), using the upcoming events list for "what's going on" questions |

## Setup

### 1. Discord application

1. Create an app at <https://discord.com/developers/applications>, add a Bot, copy the token (`DISCORD_TOKEN`) and Application ID (`DISCORD_CLIENT_ID`).
2. No privileged intents are needed. The bot uses `Guilds`, `GuildMessages` and `DirectMessages`; without Message Content it only sees the text of messages that mention it or DM it, which is all the greeting needs.
3. Invite it with scopes `bot applications.commands` and permissions **View Channels, Send Messages, Send Messages in Threads, Embed Links, Create Public Threads, Manage Events** (permissions integer `317827599360`):
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=317827599360`

**Name and profile picture.** On startup the bot renames itself to `BOT_NAME` (default `Big Tex`) if its username is different. To change the picture, run `/avatar image:<upload>` in any server the bot is in. Only the app's owner (or its team members, or anyone listed in `BOT_OWNER_IDS`) can use it. You can also set both on the Bot page of the Developer Portal. Discord rate-limits username and avatar changes (about two per hour).

### 2. SeatGeek

Register an app at <https://seatgeek.com/account/develop> and copy the client ID (`SEATGEEK_CLIENT_ID`). Optional: without it the bot runs on calendar feeds only.

### 3. Local development

```bash
cp .env.example .env            # fill in the values
docker run -d --name dfw-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dfw_events -p 5432:5432 postgres:16
pnpm install
pnpm db:migrate                 # applies prisma/migrations
pnpm db:seed                    # curated festival feed
pnpm register                   # slash commands (instant if DISCORD_DEV_GUILD_ID is set)
pnpm dev                        # tsx watch
```

Then in your test server run `/setup channel:#events`. The bot polls on boot and every 6 hours.

Handy without Discord: `pnpm poll:once` (or `--no-seatgeek`) ingests and prints the top-scoring events, for tuning `score.ts`.

### 4. Tests

```bash
pnpm test                       # unit tests
# integration tests against a throwaway database (it gets TRUNCATEd):
createdb dfw_events_test
DATABASE_URL=postgresql://.../dfw_events_test pnpm prisma migrate deploy
TEST_DATABASE_URL=postgresql://.../dfw_events_test pnpm test
```

## Deploying to Railway

1. New project → add **Postgres**.
2. Add a service from this GitHub repo. Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, optional `SEATGEEK_CLIENT_ID`
   - optional `ANTHROPIC_API_KEY` (lets Big Tex answer questions with Claude), capped by `AI_DAILY_LIMIT` (default 200/day) and `AI_USER_DAILY_LIMIT` (default 15/user/day). Also set a monthly spend limit in the Anthropic Console as a hard backstop.
   - optional `BOT_LOG_CHANNEL_ID` (private `#bot-logs` channel for poll and job errors)
3. `railway.json` builds with `pnpm build` and starts with `pnpm start`, which runs `prisma migrate deploy` before booting.
4. Once: `railway run pnpm db:seed` and `railway run pnpm register --global`.

Notes:
- **Run exactly one replica.** Two replicas means two gateway connections and duplicate cron jobs (double posts). `railway.json` pins `numReplicas: 1`.
- It's a worker: no public domain needed. If you want a healthcheck, set `PORT` and point Railway at `GET /health`, which returns 503 until the gateway is ready.

## Configuration

| Env var | Default | |
|---|---|---|
| `POLL_CRON` | `0 */6 * * *` | Ingest + post |
| `DIGEST_CRON` | `0 17 * * 4` | Thursday 5pm Chicago |
| `REMINDER_CRON` | `15 * * * *` | Hourly |
| `LOOKAHEAD_DAYS` | `90` | How far ahead to ingest (auto posts only go 45 days out) |
| `LOG_LEVEL` | `info` | pino level |
| `BOT_NAME` | `Big Tex` | Bot username, applied on startup |
| `BOT_OWNER_IDS` | app owner/team | Who may run `/avatar` |

All cron schedules run in `America/Chicago`.

Per server (`/setup`): `minBigScore` (default 60), `maxPostsPerDay` (5), categories, and whether the digest is on. Events scoring at least `max(75, minBigScore + 15)` also get a Discord Scheduled Event.

## Calendar feeds

Only the curated `feeds/dfw-annual.ics` is seeded. Add city and venue feeds with `/feeds add`; the bot test-fetches the URL before saving. Good candidates: many DFW cities run CivicPlus, which publishes per-category iCal feeds at `https://<city>/iCalendar.aspx` (for example McKinney and Frisco). Give official festival or tourism feeds a high `trust` (80+) and general city calendars a low one (30–40) so council meetings and story time stay out of posts.

**Keeping `dfw-annual.ics` current:** add next year's dates once they're announced on the official site. Not yet in the file: Plano Balloon Festival 2027 and Kaboom Town 2027 (not announced), Dallas Blooms 2027 (not announced), and the Dallas Holiday Parade 2026 (exact date unconfirmed; it's usually the first Saturday of December).

## Schema changes from the original plan

- `Rsvp.guildId`: per-server RSVP counts and reminders.
- `Post.reminderSentAt` / `nudgeSentAt` / `syncedAt`: so reminders and nudges fire once.
- `Event.popularity` (re-scoring after merges) and `Event.missedPolls` (cancellation sweep).
- `CalendarFeed.lastError`: surfaced in `/feeds list`.

## Not yet done / known gaps

- Nothing here has run against live Discord or SeatGeek yet. The sandbox it was built in had no outbound network, so the first real poll is the real test of the SeatGeek response schema.
- `/feeds` is global across servers, so any server admin can add a feed for everyone. That's fine for a single community, but lock it down before making the bot public. It also fetches arbitrary URLs, so restrict it to trusted admins.
- Stretch ideas (weather, attendance leaderboard, Claude-written blurbs) aren't started.
