import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { Category, Event } from "@prisma/client";
import { spanDays, unix } from "../lib/time.js";
import type { RsvpCounts } from "./rsvp.js";

export const CATEGORY_LABEL: Record<Category, string> = {
  FESTIVAL: "🎪 Festival",
  CONCERT: "🎤 Concert",
  SPORTS: "🏟️ Sports",
  FAMILY: "👨‍👩‍👧 Family",
  FOOD: "🍔 Food & Drink",
  OTHER: "📍 Event",
};

const CATEGORY_COLOR: Record<Category, number> = {
  FESTIVAL: 0xf59e0b,
  CONCERT: 0x8b5cf6,
  SPORTS: 0x2563eb,
  FAMILY: 0x10b981,
  FOOD: 0xef4444,
  OTHER: 0x64748b,
};

type EventLike = Pick<
  Event,
  "id" | "title" | "description" | "category" | "venueName" | "city" | "startsAt" | "endsAt" | "allDay" | "url" | "imageUrl" | "priceMin" | "bigScore" | "cancelled" | "source"
>;

const HALF_DAY = 12 * 3600_000;

export function isHttpUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * Discord timestamp markup. All-day dates are anchored at noon Chicago so viewers
 * a few time zones away still see the right calendar day.
 */
export function whenText(e: Pick<Event, "startsAt" | "endsAt" | "allDay">, style: "long" | "short" = "long"): string {
  const days = spanDays(e.startsAt, e.endsAt, e.allDay);
  if (e.allDay) {
    const start = unix(new Date(e.startsAt.getTime() + HALF_DAY));
    if (days <= 1) return `<t:${start}:D>`;
    const lastDay = unix(new Date(e.endsAt!.getTime() - HALF_DAY));
    return `<t:${start}:D> – <t:${lastDay}:D>`;
  }
  const start = unix(e.startsAt);
  if (days > 1 && e.endsAt) return `<t:${start}:F> – <t:${unix(e.endsAt)}:D>`;
  return style === "long" ? `<t:${start}:F> (<t:${start}:R>)` : `<t:${start}:f>`;
}

export function whereText(e: Pick<Event, "venueName" | "city">): string | null {
  const parts = [e.venueName, e.city].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export function eventEmbed(e: EventLike, counts?: RsvpCounts): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(truncate(e.cancelled ? `❌ CANCELLED: ${e.title}` : e.title, 256))
    .setColor(e.cancelled ? 0x991b1b : CATEGORY_COLOR[e.category])
    .addFields({ name: "When", value: whenText(e), inline: false });

  if (isHttpUrl(e.url)) embed.setURL(e.url);
  if (e.description) embed.setDescription(truncate(e.description, 350));
  const where = whereText(e);
  if (where) embed.addFields({ name: "Where", value: truncate(where, 1024), inline: true });
  if (e.priceMin != null) embed.addFields({ name: "Tickets", value: `From $${Number(e.priceMin).toFixed(0)}`, inline: true });
  embed.addFields({ name: "Type", value: CATEGORY_LABEL[e.category], inline: true });
  if (counts) {
    embed.addFields({
      name: "Who's in",
      value: `✅ ${counts.GOING} going · ⭐ ${counts.INTERESTED} interested`,
      inline: false,
    });
  }
  if (isHttpUrl(e.imageUrl)) embed.setImage(e.imageUrl);
  embed.setFooter({ text: `Big score ${e.bigScore} · via ${e.source === "SEATGEEK" ? "SeatGeek" : "official calendar"}` });
  return embed;
}

export function rsvpCustomId(status: "GOING" | "INTERESTED" | "NOT_FOR_ME", eventId: string): string {
  return `rsvp:${status}:${eventId}`;
}

export function parseRsvpCustomId(customId: string): { status: "GOING" | "INTERESTED" | "NOT_FOR_ME"; eventId: string } | null {
  const m = /^rsvp:(GOING|INTERESTED|NOT_FOR_ME):(.+)$/.exec(customId);
  return m ? { status: m[1] as "GOING" | "INTERESTED" | "NOT_FOR_ME", eventId: m[2]! } : null;
}

export function rsvpButtons(e: Pick<Event, "id" | "url" | "cancelled">, counts?: RsvpCounts): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(rsvpCustomId("GOING", e.id))
      .setLabel(counts ? `Going (${counts.GOING})` : "Going")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(e.cancelled),
    new ButtonBuilder()
      .setCustomId(rsvpCustomId("INTERESTED", e.id))
      .setLabel(counts ? `Interested (${counts.INTERESTED})` : "Interested")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(e.cancelled),
    new ButtonBuilder()
      .setCustomId(rsvpCustomId("NOT_FOR_ME", e.id))
      .setLabel("Not for me")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(e.cancelled),
  );
  if (isHttpUrl(e.url)) row.addComponents(new ButtonBuilder().setLabel("Details").setStyle(ButtonStyle.Link).setURL(e.url));
  return row;
}

/** Compact multi-event list for /events, /weekend, /going and the digest. */
export function eventListEmbed(title: string, events: EventLike[], opts: { description?: string; empty?: string } = {}): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(0xf59e0b);
  if (events.length === 0) return embed.setDescription(opts.empty ?? "Nothing big on the calendar. Check back soon!");
  const lines = events.map((e, i) => {
    const name = isHttpUrl(e.url) ? `[${truncate(e.title, 90)}](${e.url})` : truncate(e.title, 90);
    const where = whereText(e);
    return `**${i + 1}. ${name}**${e.cancelled ? " ❌ cancelled" : ""}\n${whenText(e, "short")}${where ? ` · ${truncate(where, 80)}` : ""} · ${CATEGORY_LABEL[e.category]}`;
  });
  return embed.setDescription(truncate([opts.description, ...lines].filter(Boolean).join("\n\n"), 4096));
}

export function threadName(title: string): string {
  return truncate(`Carpool and meetup: ${title}`, 100);
}
