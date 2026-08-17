import { StyleSheet, View } from "react-native";

import { tierColor } from "@/components/scan/screening-row";
import { ScreeningThumbnail } from "@/components/scan/screening-thumbnail";
import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Elevation, Radius, Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { CLASS_DISPLAY } from "@/lib/triage/recommendations";
import type { ScreeningRecord, TriageTier } from "@/lib/triage/types";

const TIER_LABEL: Record<TriageTier, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Priority",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Split for the rail's stacked day/month, e.g. { day: "13", month: "Aug" }. */
function fmtDayMonth(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString(undefined, { day: "numeric" }),
    month: d.toLocaleDateString(undefined, { month: "short" }),
  };
}

export type ScanTimelineProps = {
  /** Oldest first. The last entry is treated as the latest scan. */
  screenings: ScreeningRecord[];
  onOpen: (screening: ScreeningRecord) => void;
};

/**
 * The scan history for one tracked spot.
 *
 * Two shapes, because one photo and six photos are different problems. A single
 * scan gets a full-width hero card: a lone thumbnail on an otherwise empty screen
 * reads as an uploaded picture rather than as the first entry in a record. Two or
 * more become a vertical timeline, newest at top, under a continuous rail — the
 * same reading order as opening the record itself.
 */
export function ScanTimeline({ screenings, onOpen }: ScanTimelineProps) {
  if (screenings.length === 0) return null;
  if (screenings.length === 1)
    return <SoloScan screening={screenings[0]} onOpen={onOpen} />;
  return <ScanRail screenings={screenings} onOpen={onOpen} />;
}

/** The first scan, given room so the record reads as started rather than sparse. */
function SoloScan({
  screening,
  onOpen,
}: {
  screening: ScreeningRecord;
  onOpen: ScanTimelineProps["onOpen"];
}) {
  const theme = useTheme();
  const c = tierColor(theme, screening.triage.tier);
  const cls = CLASS_DISPLAY[screening.classification.topClass];

  return (
    // Shadow lives on this outer layer, not the clipped card below: a shadow and
    // `overflow: hidden` on the same view fight on iOS, and the card needs the
    // clip to keep the photo's corners rounded. A solid backgroundColor here is
    // what gives iOS a backing to derive the shadow's shape from.
    <View
      style={[
        styles.soloShadow,
        { backgroundColor: theme.surface, shadowColor: c.fg },
      ]}
    >
      <PressableScale
        onPress={() => onOpen(screening)}
        accessibilityRole="button"
        accessibilityLabel={`First scan, ${fmtDate(screening.createdAt)}, ${TIER_LABEL[screening.triage.tier]}`}
        style={[styles.soloCard, { borderColor: theme.hairline }]}
      >
        <View style={styles.soloPhotoWrap}>
          <ScreeningThumbnail
            uri={screening.imageUri}
            style={styles.soloPhoto}
            iconSize={32}
          />
          <View
            style={[
              styles.tierPill,
              styles.soloTier,
              { backgroundColor: theme.surface },
            ]}
          >
            <View style={[styles.tierDot, { backgroundColor: c.fg }]} />
            <ThemedText type="caption" style={{ color: c.fg }}>
              {TIER_LABEL[screening.triage.tier]}
            </ThemedText>
          </View>
          {/* Same chip as the capture screen's multi-shot indicator, so "more than one
              angle was taken" reads the same way everywhere it shows up. */}
          {screening.images.length > 1 ? (
            <View
              style={[
                styles.countChip,
                styles.soloCount,
                { backgroundColor: theme.surface },
              ]}
            >
              <Icon
                name="square.stack.3d.up.fill"
                tintColor={theme.textSecondary}
                size={12}
              />
              <ThemedText type="caption" themeColor="textSecondary">
                {screening.images.length}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.soloFooter, { borderTopColor: theme.hairline }]}>
          {/* Date and AI read stacked as one column, so the "Latest Scan" pill can sit
              beside both of them at once — centered on their combined height — rather
              than pinned to just the top row. */}
          <View style={styles.soloFooterLeft}>
            <View style={styles.soloFooterItem}>
              <Icon name="calendar" tintColor={theme.text} size={14} />
              <ThemedText type="subhead">
                {fmtDate(screening.createdAt)}
              </ThemedText>
            </View>
            {/* What the AI actually read, not just how urgent it scored — the tier pill
                on the photo already covers urgency. `doc.text.fill` ties it to the same
                "report/result" icon the app already uses for the screening summary. */}
            <View style={styles.soloFooterItem}>
              <Icon
                name="doc.text.fill"
                tintColor={theme.textSecondary}
                size={13}
              />
              <ThemedText type="caption" themeColor="textSecondary">
                {cls.name}
              </ThemedText>
            </View>
          </View>
          {/* A contained pill, not bare text floating at the row's edge — it reads as
              the status badge it is, the same way the tier pill on the photo does,
              instead of looking like a stray label that wandered next to the date. */}
          <View
            style={[styles.latestPill, { backgroundColor: theme.brandTint }]}
          >
            <ThemedText type="caption" style={{ color: theme.brand }}>
              Latest Scan
            </ThemedText>
          </View>
        </View>
      </PressableScale>
    </View>
  );
}

/**
 * Two or more scans, newest at top, under a continuous vertical rail.
 *
 * Rendered newest-first for display — most relevant entry surfaces without
 * scrolling — but `i`/`isLatest`/`isFirst` are still computed against the
 * original oldest-first order, so the prop's documented contract doesn't change.
 */
function ScanRail({ screenings, onOpen }: ScanTimelineProps) {
  const theme = useTheme();
  const last = screenings.length - 1;
  const ordered = screenings.map((s, i) => ({ s, i })).reverse();

  return (
    <View>
      {ordered.map(({ s, i }, row) => {
        const c = tierColor(theme, s.triage.tier);
        const cls = CLASS_DISPLAY[s.classification.topClass];
        const isLatest = i === last;
        const isFirst = i === 0;
        const isLastRow = row === ordered.length - 1;
        const { day, month } = fmtDayMonth(s.createdAt);

        return (
          <View key={s.id} style={styles.row}>
            {/* The rail column stretches to match the card's height (row's default
                cross-axis stretch), so the line-below-the-dot — a flex:1 fill, not a
                fixed pixel line — stays continuous through the gap under every card
                regardless of how many lines its text wraps to. */}
            <View style={styles.railCol}>
              <View style={styles.railDate}>
                <ThemedText type="headline">{day}</ThemedText>
                <ThemedText type="caption" themeColor="muted">
                  {month}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.railDotV,
                  {
                    borderColor: c.fg,
                    backgroundColor: isLatest ? c.fg : theme.surface,
                  },
                ]}
              />
              {!isLastRow ? (
                <View
                  style={[
                    styles.railLineV,
                    { backgroundColor: theme.hairline },
                  ]}
                />
              ) : (
                <View style={styles.railLineV} />
              )}
            </View>

            <PressableScale
              onPress={() => onOpen(s)}
              accessibilityRole="button"
              accessibilityLabel={`Scan ${i + 1} of ${screenings.length}, ${fmtDate(s.createdAt)}, ${TIER_LABEL[s.triage.tier]}`}
              style={styles.rowCardWrap}
            >
              <Card padded={false} style={styles.rowCard}>
                <View>
                  <ScreeningThumbnail
                    uri={s.imageUri}
                    style={styles.rowPhoto}
                    iconSize={22}
                  />
                  {s.images.length > 1 ? (
                    <View
                      style={[
                        styles.countBadge,
                        { backgroundColor: theme.text },
                      ]}
                    >
                      <ThemedText type="caption" style={styles.countBadgeText}>
                        ×{s.images.length}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                <View style={styles.rowText}>
                  <View style={styles.rowTopLine}>
                    <View
                      style={[styles.rowTierPill, { backgroundColor: c.bg }]}
                    >
                      <ThemedText type="caption" style={{ color: c.fg }}>
                        {TIER_LABEL[s.triage.tier]}
                      </ThemedText>
                    </View>
                    {isLatest ? (
                      <View
                        style={[
                          styles.latestPill,
                          { backgroundColor: theme.brandTint },
                        ]}
                      >
                        <ThemedText
                          type="caption"
                          style={{ color: theme.brand }}
                        >
                          Latest Scan
                        </ThemedText>
                      </View>
                    ) : isFirst ? (
                      <ThemedText type="caption" themeColor="muted">
                        First scan
                      </ThemedText>
                    ) : null}
                  </View>
                  <ThemedText type="headline" numberOfLines={1}>
                    {cls.name}
                  </ThemedText>
                  <ThemedText
                    type="footnote"
                    themeColor="textSecondary"
                    numberOfLines={1}
                  >
                    {fmtShort(s.createdAt)}
                  </ThemedText>
                </View>

                <Icon name="chevron.right" tintColor={theme.muted} size={16} />
              </Card>
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Shared tier pill. A 10px dot alone floating on a photo disappears against a
  // light lesion and reads as an artifact, so it sits on a solid chip.
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    ...Elevation.sm,
  },
  tierDot: { width: 6, height: 6, borderRadius: 3 },
  // Multi-photo count. Same shape as the capture screen's countChip, scaled per context.
  countChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    ...Elevation.sm,
  },
  soloCount: { position: "absolute", right: Space.md, top: Space.md },

  // A soft tier-tinted shadow (rather than the usual flat warm-brown one) ties the
  // container back to the status it's showing, without spending a second color on it.
  soloShadow: { borderRadius: Radius.xl, ...Elevation.md, shadowOpacity: 0.18 },
  soloCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  soloPhotoWrap: { width: "100%" },
  // 4:3 rather than square: closer to how the capture screen frames a lesion,
  // so the stored photo is not cropped a second time on the way in.
  soloPhoto: { width: "100%", aspectRatio: 4 / 3 },
  soloTier: { position: "absolute", left: Space.md, bottom: Space.md },
  soloFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Space.base,
    paddingTop: Space.md,
    paddingBottom: Space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  soloFooterLeft: { gap: Space.xs },
  soloFooterItem: { flexDirection: "row", alignItems: "center", gap: Space.xs },
  latestPill: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },

  // Vertical timeline (2+ scans). No gap between rows: the rail's line-below-the-dot
  // spans each row's *full* height, so it has to butt against the next row's to read as
  // continuous — the visual space between cards comes from rowCardWrap's own margin.
  row: { flexDirection: "row" },
  railCol: { width: 44, alignItems: "center" },
  railDate: { alignItems: "center", marginBottom: Space.sm },
  railDotV: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5 },
  railLineV: { width: 2, flex: 1, marginTop: 2 },

  rowCardWrap: { flex: 1, marginBottom: Space.base },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    padding: Space.md,
  },
  rowPhoto: { width: 64, height: 64, borderRadius: Radius.md },
  countBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    minWidth: 22,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    alignItems: "center",
  },
  countBadgeText: { color: "#FFFFFF" },
  rowText: { flex: 1, gap: 2 },
  rowTopLine: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  rowTierPill: {
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
});
