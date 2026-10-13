import { t, localizedCopy, useLocale } from "@/lib/i18n";
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

const TIER_LABEL: Record<TriageTier, string> = localizedCopy({
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Priority",
});

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
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
  /** Starts a follow-up scan. When set, a single scan is followed by an empty "next scan" slot. */
  onAddScan?: () => void;
};

/**
 * The scan history for one tracked spot.
 *
 * Two shapes, because one photo and six photos are different problems. A single
 * scan gets a full-width hero card: a lone thumbnail on an otherwise empty screen
 * reads as an uploaded picture rather than as the first entry in a record. Two or
 * more become a vertical timeline, newest at top, under a continuous rail - the
 * same reading order as opening the record itself.
 */
export function ScanTimeline({
  screenings,
  onOpen,
  onAddScan,
}: ScanTimelineProps) {
  useLocale();
  if (screenings.length === 0) return null;
  if (screenings.length === 1)
    return (
      <View style={styles.soloStack}>
        <SoloScan screening={screenings[0]} onOpen={onOpen} />
        <NextScanSlot onPress={onAddScan} />
      </View>
    );
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
  useLocale();
  const theme = useTheme();
  const cls = CLASS_DISPLAY[screening.classification.topClass];

  return (
    // Shadow lives on this outer layer, not the clipped card below: a shadow and
    // `overflow: hidden` on the same view fight on iOS. The solid white backing
    // creates the framed-card treatment from the reference UI.
    <View style={[styles.soloShadow, { backgroundColor: theme.surface }]}>
      <PressableScale
        onPress={() => onOpen(screening)}
        accessibilityRole="button"
        accessibilityLabel={`First scan, ${fmtDate(screening.createdAt)}, ${TIER_LABEL[screening.triage.tier]}`}
        style={[styles.soloCard, { borderColor: theme.hairline }]}
      >
        <View style={styles.soloPhotoWrap}>
          <View style={styles.soloMedia}>
            <ScreeningThumbnail
              uri={screening.imageUri}
              style={styles.soloPhoto}
              iconSize={32}
              contentFit="contain"
            />
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
        </View>

        <View style={styles.soloFooter}>
          {/* Date and AI read stacked as one column, so the "Latest Scan" pill can sit
              beside both of them at once - centered on their combined height - rather
              than pinned to just the top row. */}
          <View style={styles.soloFooterLeft}>
            <View style={styles.soloFooterItem}>
              <Icon name="calendar" tintColor={theme.text} size={14} />
              <ThemedText type="headline">
                {fmtDate(screening.createdAt)}
              </ThemedText>
            </View>
            {/* What the AI actually read, not just how urgent it scored - the tier pill
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
          <View style={styles.soloOpen}>
            <ThemedText type="subhead" themeColor="brand">
              {t("View result")}
            </ThemedText>
            <Icon name="chevron.right" tintColor={theme.brand} size={14} />
          </View>
        </View>
      </PressableScale>
    </View>
  );
}

/**
 * The empty second entry under a first scan. A tracked spot with one photo has nothing to compare
 * yet; this says what the record becomes, and doubles as the way to add to it.
 */
function NextScanSlot({ onPress }: { onPress?: () => void }) {
  useLocale();
  const theme = useTheme();
  const body = (
    <>
      <View style={[styles.slotIcon, { backgroundColor: theme.brandTint }]}>
        <Icon
          name={onPress ? "plus.circle.fill" : "clock.arrow.circlepath"}
          tintColor={theme.brand}
          size={20}
        />
      </View>
      <View style={styles.slotText}>
        <ThemedText type="headline">{t("Your next scan goes here")}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {t(
            "Scan this spot again later and the photos will line up here, so changes are easy to see.",
          )}
        </ThemedText>
      </View>
    </>
  );
  const frame = [styles.slot, { borderColor: theme.muted }];
  return onPress ? (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("Re-scan this spot")}
      style={frame}
    >
      {body}
    </PressableScale>
  ) : (
    <View style={frame}>{body}</View>
  );
}

/**
 * Two or more scans, newest at top, under a continuous vertical rail.
 *
 * Rendered newest-first for display - most relevant entry surfaces without
 * scrolling - but `i`/`isLatest`/`isFirst` are still computed against the
 * original oldest-first order, so the prop's documented contract doesn't change.
 */
function ScanRail({ screenings, onOpen }: ScanTimelineProps) {
  useLocale();
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
                cross-axis stretch), so the line-below-the-dot - a flex:1 fill, not a
                fixed pixel line - stays continuous through the gap under every card
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
                  <ThemedText type="headline" numberOfLines={1}>
                    {cls.name}
                  </ThemedText>
                  <View style={styles.rowTopLine}>
                    <View
                      style={[styles.rowTierPill, { backgroundColor: c.bg }]}
                    >
                      <View
                        style={[styles.tierDot, { backgroundColor: c.fg }]}
                      />
                      <ThemedText type="caption" style={styles.rowTierText}>
                        {TIER_LABEL[s.triage.tier]}
                      </ThemedText>
                    </View>
                    {isLatest ? (
                      <ThemedText type="caption" themeColor="brand">
                        {t("Latest Scan")}
                      </ThemedText>
                    ) : isFirst ? (
                      <ThemedText type="caption" themeColor="muted">
                        {t("First scan")}
                      </ThemedText>
                    ) : null}
                  </View>
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

  // The white outer layer creates the same framed-card silhouette as the reference.
  soloShadow: { borderRadius: Radius.xl, ...Elevation.sm },
  soloCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  soloPhotoWrap: {
    width: "100%",
    paddingTop: Space.md,
    paddingHorizontal: Space.md,
  },
  soloMedia: {
    width: "100%",
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  // 4:3 rather than square: closer to how the capture screen frames a lesion,
  // so the stored photo is not cropped a second time on the way in.
  soloPhoto: { width: "100%", aspectRatio: 4 / 3 },
  soloFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Space.base,
    paddingTop: Space.md,
    paddingBottom: Space.base,
  },
  soloFooterLeft: { gap: Space.xs },
  soloOpen: { flexDirection: "row", alignItems: "center", gap: 2 },
  soloStack: { gap: Space.md },
  slot: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    padding: Space.base,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
  slotIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  slotText: { flex: 1, gap: 2 },
  soloFooterItem: { flexDirection: "row", alignItems: "center", gap: Space.xs },

  // Vertical timeline (2+ scans). No gap between rows: the rail's line-below-the-dot
  // spans each row's *full* height, so it has to butt against the next row's to read as
  // continuous - the visual space between cards comes from rowCardWrap's own margin.
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
  rowText: { flex: 1, gap: Space.xs },
  rowTierText: { fontWeight: "600" },
  rowTopLine: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  rowTierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
});
