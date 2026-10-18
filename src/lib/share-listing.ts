/**
 * Share a clinic or doctor as plain text - the system share sheet reaches Messenger, SMS, Viber
 * and the rest, so a patient can send a family member where to go and when.
 *
 * On web, react-native's Share needs navigator.share (missing on most desktop browsers); then the
 * text is copied to the clipboard instead, and the caller tells the user so.
 */
import { Platform, Share } from "react-native";

import { t } from "./i18n/core";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export interface ShareListing {
  title: string;
  lines: (string | null | undefined | false)[];
  mapsUrl?: string | null;
}

/** The message body: title, the non-empty detail lines, a map link, and where it came from. */
export function shareMessage(l: ShareListing): string {
  return [
    l.title,
    ...l.lines.filter((x): x is string => typeof x === "string" && x.trim().length > 0),
    l.mapsUrl ? t("Map: {{url}}", { url: l.mapsUrl }) : null,
    t("Shared from SpotOn - call ahead to confirm schedules."),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Google Maps link for a place: its stored maps URL, else a coordinate search. */
export function mapsLink(googleMapsUrl: string | null | undefined, lat: number, lng: number): string {
  return googleMapsUrl && /^https?:\/\//.test(googleMapsUrl)
    ? googleMapsUrl
    : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export async function shareListing(l: ShareListing): Promise<ShareOutcome> {
  const message = shareMessage(l);
  if (Platform.OS === "web") {
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> }) : null;
    if (nav?.share) {
      try {
        await nav.share({ title: l.title, text: message });
        return "shared";
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return "cancelled";
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      return "copied";
    } catch {
      return "failed";
    }
  }
  try {
    const res = await Share.share({ title: l.title, message });
    return res.action === Share.dismissedAction ? "cancelled" : "shared";
  } catch {
    return "failed";
  }
}
