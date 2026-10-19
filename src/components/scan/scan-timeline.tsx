import { t, localizedCopy, useLocale } from "@/lib/i18n";
import { StyleSheet, View } from "react-native";

import { tierColor } from "@/components/scan/screening-row";
import { ScreeningThumbnail } from "@/components/scan/screening-thumbnail";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Elevation, Radius, Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { resultDisplay } from "@/lib/triage/recommendations";
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

export type ScanTimelineProps = {
  /** Oldest first. The last entry is treated as the latest scan. */
  screenings: ScreeningRecord[];
  onOpen: (screening: ScreeningRecord) => void;
};

/** A consistent, newest-first history for both one scan and many scans. */
export function ScanTimeline({ screenings, onOpen }: ScanTimelineProps) {
  useLocale();
  const theme = useTheme();
  const last = screenings.length - 1;
  if (last < 0) return null;

  return (
    <View style={styles.list}>
      {screenings.length > 1 ? (
        <View style={[styles.railLine, { backgroundColor: theme.hairline }]} />
      ) : null}
      {screenings.map((screening, index) => ({ screening, index })).reverse().map(({ screening, index }) => {
        const colors = tierColor(theme, screening.triage.tier);
        const classification = resultDisplay(screening.classification.topClass, screening.classification.topConfidence, screening.triage);
        return (
          <View key={screening.id} style={styles.row}>
            <View style={styles.railPointWrap}>
              <View style={[styles.railPoint, { borderColor: colors.fg, backgroundColor: index === last ? colors.fg : theme.background }]} />
            </View>
            <PressableScale
              onPress={() => onOpen(screening)}
              accessibilityRole="button"
              accessibilityLabel={`Scan ${index + 1} of ${screenings.length}, ${fmtDate(screening.createdAt)}, ${classification.name}, ${TIER_LABEL[screening.triage.tier]}`}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: index === last ? theme.brandTint : theme.hairline }]}
            >
              <View style={styles.photoWrap}>
                <ScreeningThumbnail uri={screening.imageUri} style={styles.photo} iconSize={24} />
                {screening.images.length > 1 ? (
                  <View style={[styles.countBadge, { backgroundColor: theme.text }]}>
                    <ThemedText type="caption" style={styles.countText}>×{screening.images.length}</ThemedText>
                  </View>
                ) : null}
              </View>
              <View style={styles.details}>
                <View style={styles.dateRow}>
                  <ThemedText type="subhead" themeColor="textSecondary">{fmtDate(screening.createdAt)}</ThemedText>
                  {index === last ? (
                    <ThemedText type="caption" themeColor="brand">{t("Latest Scan")}</ThemedText>
                  ) : null}
                </View>
                <ThemedText type="headline" numberOfLines={1}>{classification.name}</ThemedText>
                <View style={[styles.tierPill, { backgroundColor: colors.bg }]}>
                  <View style={[styles.tierDot, { backgroundColor: colors.fg }]} />
                  <ThemedText type="caption" style={{ color: colors.fg }}>{TIER_LABEL[screening.triage.tier]}</ThemedText>
                </View>
              </View>
              <Icon name="chevron.right" tintColor={theme.muted} size={16} />
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Space.md, position: "relative" },
  railLine: { position: "absolute", left: 7, top: 56, bottom: 56, width: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: Space.md },
  railPointWrap: { width: 16, alignItems: "center", justifyContent: "center" },
  railPoint: { width: 16, height: 16, borderRadius: 8, borderWidth: 3 },
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Space.base,
    padding: Space.md,
    borderRadius: Radius.xl,
    borderWidth: 1,
    ...Elevation.sm,
  },
  photoWrap: { width: 88, height: 88 },
  photo: { width: 88, height: 88, borderRadius: Radius.md },
  countBadge: {
    position: "absolute",
    right: Space.xs,
    bottom: Space.xs,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.pill,
  },
  countText: { color: "#FFFFFF" },
  details: { flex: 1, alignItems: "flex-start", gap: Space.xs },
  dateRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Space.sm },
  tierPill: { flexDirection: "row", alignItems: "center", gap: Space.xs, paddingHorizontal: Space.sm, paddingVertical: Space.xs, borderRadius: Radius.pill },
  tierDot: { width: 6, height: 6, borderRadius: 3 },
});
