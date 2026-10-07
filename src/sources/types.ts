import type { Category, Source } from "@prisma/client";

/** What every source produces. Mirrors the Event model minus derived fields (bigScore, dedupeKey). */
export interface NormalizedEvent {
  source: Source;
  sourceId: string;
  feedId?: string;
  feedTrustWeight?: number;
  title: string;
  description: string | null;
  category: Category;
  venueName: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  url: string;
  imageUrl: string | null;
  priceMin: number | null;
  /** 0..1, SeatGeek only. */
  popularity?: number;
  cancelled?: boolean;
}

export interface FetchResult {
  events: NormalizedEvent[];
  /** False if the source stopped early (page cap), so absence doesn't imply cancellation. */
  complete: boolean;
}

export interface EventSource {
  name: string;
  fetchUpcoming(opts: { from: Date; to: Date }): Promise<FetchResult>;
}
