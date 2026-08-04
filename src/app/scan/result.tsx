import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LayoutAnimationConfig } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ImageViewer, Screen } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { scheduleSelfCheckReminder } from '@/lib/notifications';
import { useScanHistory } from '@/lib/scan-history';
import { QUESTIONS } from '@/lib/triage/questions';
import {
  CLASS_DISPLAY,
  CONFIDENCE_QUALIFIER,
  DISCLAIMER,
  MALIGNANT_GATE,
  TIER_CONTENT,
} from '@/lib/triage/recommendations';
import { CLASS_WEIGHTS } from '@/lib/triage/tps-core';
import type { LesionClass, ScreeningRecord, TriageTier } from '@/lib/triage/types';

/** Order the probability breakdown by clinical urgency, matching the spec tables. */
const CLASS_BY_URGENCY = (Object.keys(CLASS_WEIGHTS) as LesionClass[]).sort(
  (a, b) => CLASS_WEIGHTS[b] - CLASS_WEIGHTS[a],
);

/** Short pattern word for the "…melanoma pattern (MEL)" phrasing (avoids "-like"/"pattern pattern"). */
const PATTERN_WORD: Record<LesionClass, string> = {
  MEL: 'melanoma',
  SCC: 'squamous cell carcinoma',
  BCC: 'basal cell carcinoma',
  OTHER: 'uncertain',
  BENIGN: 'benign',
};

export default function ResultScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById, loading } = useScanHistory();
  const record = id ? getById(id) : undefined;
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const tierColor = (tier: TriageTier) =>
    tier === 'low'
      ? { fg: theme.riskLow, bg: theme.riskLowBg }
      : tier === 'moderate'
        ? { fg: theme.riskModerate, bg: theme.riskModerateBg }
        : tier === 'high'
          ? { fg: theme.riskHigh, bg: theme.riskHighBg }
          : { fg: theme.riskCritical, bg: theme.riskCriticalBg };

  if (!record) {
    return (
      <Screen>
        <Header />
        <View style={styles.emptyBody}>
          <ThemedText type="body" themeColor="muted" style={styles.center}>
            {loading ? 'Loading result…' : 'This result could not be found.'}
          </ThemedText>
        </View>
      </Screen>
    );
  }

  const { triage, questionnaire, classification, mark } = record;
  const tier = TIER_CONTENT[triage.tier];
  const colors = tierColor(triage.tier);
  const qualifier = triage.confidenceQualifier;
  // The gate raising the tier is only worth explaining when the photo *was* readable — otherwise
  // the precautionary copy already covers why the urgency outruns the headline pattern.
  const gated = triage.malignantGateApplied && !qualifier;
  const cls = CLASS_DISPLAY[classification.topClass];
  const pct = Math.round(classification.topConfidence * 100);
  const date = new Date(record.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Reported findings = questions answered "yes", split by clinical weight (major first).
  const reported = QUESTIONS.filter((q) => questionnaire.answers[q.id] === 'yes');
  const majorFindings = reported.filter((q) => q.kind === 'major');
  const minorFindings = reported.filter((q) => q.kind === 'minor');

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      <Header />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + Space.xl }]}
        showsVerticalScrollIndicator={false}>
        {/* 1 · Hero — classified type, tier, confidence ring. A gradient + colored glow keyed to
            the risk level so it lifts off the page while staying tonally on-tier. */}
        <Animated.View entering={FadeInDown}>
          <LinearGradient
            colors={[mix(colors.fg, '#FFFFFF', 0.82), mix(colors.fg, '#FFFFFF', 0.5)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.hero, { shadowColor: colors.fg }]}>
            <View style={styles.heroTop}>
              <ThemedText type="title1" style={styles.heroTitle}>
                {cls.full}
              </ThemedText>
              <View style={[styles.tierBadge, { backgroundColor: colors.fg, shadowColor: colors.fg }]}>
                <ThemedText type="subhead" style={{ color: theme.onBrand }}>
                  {qualifier ? 'Precautionary' : tier.name}
                </ThemedText>
              </View>
            </View>
            <View style={styles.heroBottom}>
              <ConfidenceRing pct={pct} color={colors.fg} />
              <View style={styles.heroConfText}>
                <ThemedText type="headline">AI confidence</ThemedText>
                <ThemedText type="subhead" themeColor="textSecondary">
                  {pct}% probability for {classification.topClass} pattern.
                </ThemedText>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* 2 · The photo, straight under the verdict — it's what the user just captured, so it
            belongs in the first screenful rather than buried below the explanations. */}
        <Animated.View entering={FadeInDown.delay(60)}>
          <Card padded={false} style={styles.photoCard}>
            {record.imageUri ? (
              <Pressable
                onPress={() => setViewerUri(record.imageUri)}
                accessibilityRole="button"
                accessibilityLabel="View photo full screen"
                style={({ pressed }) => pressed && styles.pressed}>
                <Image source={{ uri: record.imageUri }} style={styles.photo} contentFit="cover" />
                <View style={styles.photoExpand}>
                  <Icon
                    name="arrow.up.left.and.arrow.down.right"
                    tintColor="#FFFFFF"
                    size={12}
                    weight="semibold"
                  />
                </View>
              </Pressable>
            ) : (
              <View style={[styles.photo, styles.photoEmpty, { backgroundColor: theme.elementBg }]}>
                <Icon name="photo" tintColor={theme.muted} size={28} />
              </View>
            )}
            {/* Extra angles, when the user took more than one. The main photo above is what the
                classifier read and what the report carries; these are the fuller record. */}
            {record.images.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbStrip}>
                {record.images.map((img) => (
                  <Pressable
                    key={img.uri}
                    onPress={() => setViewerUri(img.uri)}
                    accessibilityRole="button"
                    accessibilityLabel={`View photo ${img.index + 1} of ${record.images.length}`}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <Image source={{ uri: img.uri }} style={styles.thumbSmall} contentFit="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <View style={[styles.photoCaption, { borderTopColor: theme.hairline }]}>
              <Icon name="mappin.circle.fill" tintColor={theme.brand} size={18} />
              <View style={styles.photoCaptionText}>
                <ThemedText type="headline">{mark?.region ?? 'Location not marked'}</ThemedText>
                <ThemedText type="subhead" themeColor="textSecondary">
                  Checked on {date}
                  {record.images.length > 1 ? ` · ${record.images.length} photos` : ''}
                </ThemedText>
              </View>
            </View>
          </Card>
        </Animated.View>

        {/* 3 · The one action to take, with the disclaimer riding underneath as a light footnote
            rather than a card of its own. */}
        <Animated.View entering={FadeInDown.delay(110)} style={styles.priorityBlock}>
          <View style={[styles.priority, { backgroundColor: colors.bg }]}>
            <View style={[styles.priorityDot, { backgroundColor: colors.fg }]} />
            <ThemedText type="subhead" style={[styles.priorityText, { color: colors.fg }]}>
              Priority action: {tier.priorityAction}
            </ThemedText>
          </View>
          <View style={styles.disclaimerRow}>
            <Icon name="info.circle" tintColor={theme.muted} size={14} />
            <ThemedText type="footnote" themeColor="muted" style={styles.disclaimerText}>
              {DISCLAIMER}
            </ThemedText>
          </View>
        </Animated.View>

        {/* 4 · What this means */}
        <Animated.View entering={FadeInDown.delay(160)}>
          <Card style={styles.section}>
            <ThemedText type="headline">What this means</ThemedText>
            {qualifier ? (
              <ThemedText type="body" themeColor="textSecondary">
                {CONFIDENCE_QUALIFIER.body} {tier.recommendation}
              </ThemedText>
            ) : gated ? (
              <ThemedText type="body" themeColor="textSecondary">
                {MALIGNANT_GATE.body} {tier.recommendation}
              </ThemedText>
            ) : (
              <ThemedText type="body" themeColor="textSecondary">
                This result suggests a{' '}
                <ThemedText type="body" style={{ color: colors.fg }}>
                  {PATTERN_WORD[classification.topClass]} pattern ({classification.topClass})
                </ThemedText>{' '}
                based on your photo.{' '}
                <ThemedText type="body">It is not a confirmed diagnosis.</ThemedText>{' '}
                {tier.recommendation}
              </ThemedText>
            )}
          </Card>
        </Animated.View>

        {/* 5 · About the classified type (factual) + full probability breakdown */}
        <Animated.View entering={FadeInDown.delay(210)}>
          <AboutType record={record} />
        </Animated.View>

        {/* 6 · Symptom recap */}
        <Animated.View entering={FadeInDown.delay(260)}>
          <Card style={styles.section}>
            <View style={styles.sectionHead}>
              <ThemedText type="headline">Symptoms you reported</ThemedText>
              {reported.length > 0 ? (
                <View style={[styles.countPill, { backgroundColor: colors.bg }]}>
                  <ThemedText type="caption" style={{ color: colors.fg }}>
                    {reported.length} of {QUESTIONS.length}
                  </ThemedText>
                </View>
              ) : null}
            </View>

            {reported.length === 0 ? (
              <View style={[styles.noneRow, { backgroundColor: theme.riskLowBg }]}>
                <Icon name="checkmark.circle.fill" tintColor={theme.riskLow} size={20} />
                <ThemedText type="subhead" themeColor="textSecondary" style={styles.noneText}>
                  You didn’t report any warning signs for this spot.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.findingGroups}>
                <FindingGroup title="Major warning signs" items={majorFindings} accent={colors} />
                <FindingGroup title="Additional signs" items={minorFindings} accent={colors} muted />
              </View>
            )}
          </Card>
        </Animated.View>

        {/* 7 · Next steps */}
        <Animated.View entering={FadeInDown.delay(310)} style={styles.actions}>
          <ThemedText type="title2">Next steps</ThemedText>
          {tier.showReport ? (
            <Button
              label="View screening summary"
              variant="brand"
              icon="doc.text.fill"
              onPress={() => router.push({ pathname: '/scan/report', params: { id: record.id } })}
            />
          ) : null}
          {tier.showDirectory ? (
            <Button
              label="Find a clinic near you"
              variant={tier.showReport ? 'outline' : 'brand'}
              icon="mappin.circle.fill"
              onPress={() => router.push('/(tabs)/directory')}
            />
          ) : null}
          {tier.showEducation ? (
            <Button
              label="Learn more about skin cancer"
              variant="brand"
              icon="book.fill"
              onPress={() => router.push('/(tabs)/learn')}
            />
          ) : null}
          <Button
            label="See this spot over time"
            variant={tier.showReport || tier.showEducation ? 'outline' : 'brand'}
            icon="clock.arrow.circlepath"
            onPress={() => router.push({ pathname: '/scan/lesion', params: { id: record.lesionId! } })}
            disabled={!record.lesionId}
          />
          {tier.offerReminder ? <ReminderRow /> : null}
        </Animated.View>
      </ScrollView>
      <ImageViewer visible={viewerUri != null} uri={viewerUri ?? ''} onClose={() => setViewerUri(null)} />
    </Screen>
  );
}

function Header() {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Pressable
        hitSlop={12}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
        accessibilityRole="button"
        accessibilityLabel="Back">
        <Icon name="chevron.left" tintColor={theme.brand} size={20} />
      </Pressable>
      <ThemedText type="headline" themeColor="textSecondary">
        Result
      </ThemedText>
      <View style={styles.headerSpacer} />
    </View>
  );
}

/** Circular AI-confidence ring: tier-colored arc over a tint of that color, percentage centered. */
function ConfidenceRing({ pct, color }: { pct: number; color: string }) {
  const size = 78;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const mid = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={mid} cy={mid} r={r} stroke={withAlpha(color, 0.22)} strokeWidth={stroke} fill="none" />
        <Circle
          cx={mid}
          cy={mid}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </Svg>
      <ThemedText type="headline">{pct}%</ThemedText>
    </View>
  );
}

/** Factual, non-alarming description of the classified type + expandable per-class probabilities. */
function AboutType({ record }: { record: ScreeningRecord }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { classification } = record;
  const cls = CLASS_DISPLAY[classification.topClass];

  return (
    <Card style={styles.section}>
      <ThemedText type="headline">About {cls.full.toLowerCase()}</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        {cls.about}
      </ThemedText>
      <LayoutAnimationConfig skipEntering={false}>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.expandRow}>
          <ThemedText type="subhead" themeColor="brand">
            {open ? 'Hide pattern breakdown' : 'See pattern breakdown'}
          </ThemedText>
          <Icon name={open ? 'chevron.up' : 'chevron.down'} tintColor={theme.brand} size={14} />
        </Pressable>
        {open ? (
          <Animated.View entering={FadeInDown} style={styles.bars}>
            {CLASS_BY_URGENCY.map((c) => {
              const p = classification.probs[c] ?? 0;
              const top = c === classification.topClass;
              return (
                <View key={c} style={styles.barRow}>
                  <ThemedText type="footnote" themeColor={top ? 'text' : 'textSecondary'} style={styles.barLabel}>
                    {CLASS_DISPLAY[c].name}
                  </ThemedText>
                  <View style={[styles.barTrack, { backgroundColor: theme.elementBg }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.max(2, Math.round(p * 100))}%`,
                          backgroundColor: top ? theme.brand : theme.muted,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText type="caption" themeColor="muted" style={styles.barPct}>
                    {Math.round(p * 100)}%
                  </ThemedText>
                </View>
              );
            })}
            <ThemedText type="caption" themeColor="muted">
              These are pattern similarities seen by the on-device model — not a diagnosis.
            </ThemedText>
          </Animated.View>
        ) : null}
      </LayoutAnimationConfig>
    </Card>
  );
}

/**
 * One group of reported symptoms (major or minor) as a clean checklist. Each row is the
 * declarative "finding" phrasing with a filled marker; nothing renders when the group is empty.
 */
function FindingGroup({
  title,
  items,
  accent,
  muted = false,
}: {
  title: string;
  items: typeof QUESTIONS;
  accent: { fg: string; bg: string };
  muted?: boolean;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;
  const dot = muted ? theme.muted : accent.fg;
  return (
    <View style={styles.findingGroup}>
      <ThemedText type="caption" themeColor="muted" style={styles.findingGroupTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {items.map((q) => (
        <View key={q.id} style={styles.findingRow}>
          <View style={[styles.findingMarker, { backgroundColor: muted ? 'transparent' : dot, borderColor: dot }]}>
            <Icon name="checkmark" tintColor={muted ? dot : theme.onBrand} size={11} />
          </View>
          <ThemedText type="subhead" style={styles.findingText}>
            {q.finding}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** Low-tier 30-day self-monitoring reminder opt-in. */
function ReminderRow() {
  const theme = useTheme();
  const [done, setDone] = useState(false);

  async function enable() {
    try {
      await scheduleSelfCheckReminder(30);
      setDone(true);
    } catch (e) {
      console.warn('[result] reminder opt-in failed', e);
    }
  }

  return done ? (
    <View style={[styles.reminderDone, { backgroundColor: theme.riskLowBg }]}>
      <Icon name="checkmark.circle.fill" tintColor={theme.riskLow} size={18} />
      <ThemedText type="subhead" themeColor="textSecondary" style={styles.reminderText}>
        We’ll remind you to re-check this spot in 30 days.
      </ThemedText>
    </View>
  ) : (
    <Button label="Remind me in 30 days" variant="outline" icon="bell.fill" onPress={enable} />
  );
}

/** Append an alpha channel to a #RRGGBB hex (used for the confidence-ring track tint). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Blend two #RRGGBB hex colors; t=0 → a, t=1 → b. Used to build the tier gradient stops. */
function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, '0');
  const l = (x: number, y: number) => x + (y - x) * Math.max(0, Math.min(1, t));
  return `#${to(l(ch(a, 1), ch(b, 1)))}${to(l(ch(a, 3), ch(b, 3)))}${to(l(ch(a, 5), ch(b, 5)))}`;
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Space.xl, paddingTop: Space.sm, gap: Space.base },
  center: { textAlign: 'center' },
  // Hero — gradient is set inline from the tier color; shadowColor is the tier color too.
  hero: {
    borderRadius: Radius.xl,
    padding: Space.xl,
    gap: Space.lg,
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  heroTitle: { flex: 1 },
  tierBadge: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  heroBottom: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  heroConfText: { flex: 1, gap: 2 },
  // The lesion photo: fills the card's top edge-to-edge (hence padded={false} + overflow
  // hidden), with the location/date caption as a divided row inside the same card.
  photoCard: { overflow: 'hidden' },
  pressed: { opacity: 0.9 },
  photo: { width: '100%', height: 200 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoExpand: {
    position: 'absolute',
    right: Space.md,
    bottom: Space.md,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(33,26,21,0.55)',
  },
  photoCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thumbStrip: { gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.md },
  thumbSmall: { width: 56, height: 56, borderRadius: Radius.sm },
  photoCaptionText: { flex: 1, gap: 2 },
  // Priority action, with the disclaimer as a footnote beneath.
  priorityBlock: { gap: Space.md },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.base,
    paddingVertical: Space.base,
    borderRadius: Radius.md,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priorityText: { flex: 1 },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  disclaimerText: { flex: 1 },
  // Cards
  section: { gap: Space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  countPill: { paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.pill },
  expandRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingVertical: Space.xs },
  bars: { gap: Space.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  barLabel: { width: 132 },
  barTrack: { flex: 1, height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.pill },
  barPct: { width: 36, textAlign: 'right' },
  noneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.base,
    borderRadius: Radius.md,
  },
  noneText: { flex: 1 },
  findingGroups: { gap: Space.base },
  findingGroup: { gap: Space.sm },
  findingGroupTitle: { letterSpacing: 0.8 },
  findingRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  findingMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findingText: { flex: 1 },
  actions: { gap: Space.md, marginTop: Space.sm },
  reminderDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.base,
    borderRadius: Radius.md,
  },
  reminderText: { flex: 1 },
});
