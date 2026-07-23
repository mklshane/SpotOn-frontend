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
  const [viewerOpen, setViewerOpen] = useState(false);

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

        {/* 2 · Disclaimer */}
        <Animated.View entering={FadeInDown.delay(60)}>
          <Card style={styles.section}>
            <ThemedText type="headline">Disclaimer</ThemedText>
            <ThemedText type="subhead" themeColor="textSecondary">
              {DISCLAIMER}
            </ThemedText>
          </Card>
        </Animated.View>

        {/* 3 · Priority action */}
        <Animated.View entering={FadeInDown.delay(110)}>
          <View style={[styles.priority, { backgroundColor: colors.bg }]}>
            <View style={[styles.priorityDot, { backgroundColor: colors.fg }]} />
            <ThemedText type="subhead" style={[styles.priorityText, { color: colors.fg }]}>
              Priority action: {tier.priorityAction}
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
                based on your photo and your symptom answers.{' '}
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

        {/* 7 · Photo, location, date */}
        <Animated.View entering={FadeInDown.delay(310)}>
          <Card style={styles.metaCard}>
            {record.imageUri ? (
              <Pressable
                onPress={() => setViewerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="View photo full screen"
                style={({ pressed }) => [styles.thumbPress, pressed && styles.thumbPressed]}>
                <Image source={{ uri: record.imageUri }} style={styles.thumb} contentFit="cover" />
                <View style={styles.thumbExpand}>
                  <Icon name="arrow.up.left.and.arrow.down.right" tintColor="#FFFFFF" size={11} weight="semibold" />
                </View>
              </Pressable>
            ) : null}
            <View style={styles.metaText}>
              <ThemedText type="headline">{mark?.region ?? 'Location not marked'}</ThemedText>
              <ThemedText type="subhead" themeColor="textSecondary">
                Checked on {date}
              </ThemedText>
            </View>
          </Card>
        </Animated.View>

        {/* 8 · Next steps */}
        <Animated.View entering={FadeInDown.delay(360)} style={styles.actions}>
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
              label="Learn the ABCDE self-check"
              variant="brand"
              icon="book.fill"
              onPress={() => router.push('/(tabs)/learn')}
            />
          ) : null}
          {tier.offerReminder ? <ReminderRow /> : null}
        </Animated.View>
      </ScrollView>
      <ImageViewer visible={viewerOpen} uri={record.imageUri} onClose={() => setViewerOpen(false)} />
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
  // Priority action
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
  metaCard: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  thumbPress: { width: 64, height: 64 },
  thumbPressed: { opacity: 0.85 },
  thumb: { width: 64, height: 64, borderRadius: Radius.md },
  thumbExpand: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(33,26,21,0.55)',
  },
  metaText: { flex: 1, gap: 2 },
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
