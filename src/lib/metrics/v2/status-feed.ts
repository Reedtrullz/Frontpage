import type { PublicStatusV2Model } from "./public-status";
import type { DataFreshness } from "./types";

const SITE_URL = "https://reidar.tech";
const FEED_URL = `${SITE_URL}/status/feed.json`;
const MAX_FEED_ITEMS = 256;

export interface PublicStatusFeedItem {
  id: string;
  title: string;
  content_text: string;
  date_published: string;
  date_modified?: string;
  tags: string[];
}

export interface PublicStatusFeed {
  version: "https://jsonfeed.org/version/1.1";
  title: string;
  home_page_url: string;
  feed_url: string;
  items: PublicStatusFeedItem[];
  _frontpage: {
    availability: "available" | "unavailable";
    freshness: DataFreshness;
    overall_state: PublicStatusV2Model["overallState"];
    checked_at: string;
    collected_at: string | null;
    incident_generated_at: string | null;
    event_count: number;
    truncated: boolean;
  };
}

function eventTime(item: PublicStatusFeedItem): string {
  return item.date_modified ?? item.date_published;
}

function uniqueItems(items: PublicStatusFeedItem[]): PublicStatusFeedItem[] {
  const byId = new Map<string, PublicStatusFeedItem>();
  for (const item of items) {
    const previous = byId.get(item.id);
    if (!previous || eventTime(item) > eventTime(previous)) byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (left, right) => eventTime(right).localeCompare(eventTime(left)) || left.id.localeCompare(right.id),
  );
}

export function createPublicStatusFeed(
  model: PublicStatusV2Model | null,
  options: {
    availability?: "available" | "unavailable";
    checkedAt?: string;
    incidentGeneratedAt?: string | null;
  } = {},
): PublicStatusFeed {
  const availability = options.availability ?? (model ? "available" : "unavailable");
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const candidates: PublicStatusFeedItem[] = model && availability === "available"
    ? [
        ...model.recentIncidents.map((incident) => ({
          id: `urn:reidar.tech:status:incident:${incident.id}`,
          title: incident.title,
          content_text: incident.summary,
          date_published: incident.openedAt,
          date_modified: incident.updatedAt,
          tags: ["incident", incident.state, incident.severity],
        })),
        ...model.maintenance.map((window) => ({
          id: `urn:reidar.tech:status:maintenance:${window.id}`,
          title: window.title,
          content_text: window.description,
          date_published: window.startsAt,
          tags: ["maintenance", window.status],
        })),
      ]
    : [];
  const unique = uniqueItems(candidates);
  const items = unique.slice(0, MAX_FEED_ITEMS);

  return {
    version: "https://jsonfeed.org/version/1.1",
    title: "reidar.tech status",
    home_page_url: `${SITE_URL}/status`,
    feed_url: FEED_URL,
    items,
    _frontpage: {
      availability,
      freshness: model?.freshness ?? "unavailable",
      overall_state: model?.overallState ?? "unknown",
      checked_at: checkedAt,
      collected_at: model?.collectedAt ?? null,
      incident_generated_at: options.incidentGeneratedAt ?? null,
      event_count: items.length,
      truncated: unique.length > items.length,
    },
  };
}
