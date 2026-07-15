import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LayoutAnimationConfig, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
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
  TIER_CONTENT,
} from '@/lib/triage/recommendations';
import { CLASS_WEIGHTS } from '@/lib/triage/tps-core';
import type { LesionClass, ScreeningRecord, TriageTier } from '@/lib/triage/types';

/** Order the probability breakdown by clinical urgency, matching the spec tables. */
const CLASS_BY_URGENCY = (Object.keys(CLASS_WEIGHTS) as LesionClass[]).sort(
  (a, b) => CLASS_WEIGHTS[b] - CLASS_WEIGHTS[a],
);

export default function ResultScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById, loading } = useScanHistory();
  const record = id ? getById(id) : undefined;

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

  const { triage, questionnaire, mark } = record;
  const tier = TIER_CONTENT[triage.tier];
  const colors = tierColor(triage.tier);
  const qualifier = triage.confidenceQualifier;
  const date = new Date(record.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  // Reported findings = questions the user answered "yes" to, split by clinical weight so the
  // recap reads like a symptom checklist (major warning signs first, then additional signs).
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
        {/* 1 · Tier banner */}
        <Animated.View entering={FadeInDown}>
          <Card style={[styles.tierCard, { backgroundColor: colors.bg }]}>
            <Animated.View
              entering={ZoomIn.springify().damping(12)}
              style={[styles.tierBadge, { backgroundColor: colors.fg }]}>
              <Icon
                name={triage.tier === 'low' ? 'checkmark' : 'exclamationmark.triangle.fill'}
                tintColor="#FFFFFF"
                size={26}
              />
            </Animated.View>
            <ThemedText type="subhead" style={[styles.tierLabel, { color: colors.fg }]}>
              {qualifier ? 'PRECAUTIONARY' : tier.name.toUpperCase()} {qualifier ? '' : 'CONCERN'}
            </ThemedText>
            <ThemedText type="title2" style={styles.center}>
              {qualifier ? CONFIDENCE_QUALIFIER.title : tier.headline}
            </ThemedText>
            <ThemedText type="body" themeColor="textSecondary" style={styles.center}>
              {qualifier ? CONFIDENCE_QUALIFIER.body : tier.recommendation}
            </ThemedText>
            {qualifier ? (
              <ThemedText type="body" themeColor="textSecondary" style={styles.center}>
                {tier.recommendation}
              </ThemedText>
            ) : null}
            {tier.timeframe ? (
              <View style={[styles.timeframe, { backgroundColor: theme.surface }]}>
                <Icon name="clock.fill" tintColor={colors.fg} size={14} />
                <ThemedText type="subhead" style={{ color: colors.fg }}>
                  {tier.timeframe}
                </ThemedText>
              </View>
            ) : null}
          </Card>
        </Animated.View>

        {/* 2 · What the analysis saw */}
        <Animated.View entering={FadeInDown.delay(80)}>
          <WhatWeSaw record={record} />
        </Animated.View>

        {/* 3 · Symptom recap */}
        <Animated.View entering={FadeInDown.delay(140)}>
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

        {/* 4 · Photo, location, date */}
        <Animated.View entering={FadeInDown.delay(200)}>
          <Card style={styles.metaCard}>
            {record.imageUri ? (
              <Image source={{ uri: record.imageUri }} style={styles.thumb} contentFit="cover" />
            ) : null}
            <View style={styles.metaText}>
              <ThemedText type="headline">{mark?.region ?? 'Location not marked'}</ThemedText>
              <ThemedText type="subhead" themeColor="textSecondary">
                Checked on {date}
              </ThemedText>
            </View>
          </Card>
        </Animated.View>

        {/* 5 · Next steps */}
        <Animated.View entering={FadeInDown.delay(260)} style={styles.actions}>
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

        {/* 6 · Disclaimer */}
        <View style={[styles.disclaimer, { borderColor: theme.hairline }]}>
          <Icon name="info.circle.fill" tintColor={theme.muted} size={16} />
          <ThemedText type="footnote" themeColor="muted" style={styles.disclaimerText}>
            {DISCLAIMER}
          </ThemedText>
        </View>
      </ScrollView>
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

/** Top prediction in lay terms, with an expandable per-class probability breakdown. */
function WhatWeSaw({ record }: { record: ScreeningRecord }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { classification } = record;
  const display = CLASS_DISPLAY[classification.topClass];
  const pct = Math.round(classification.topConfidence * 100);

  return (
    <Card style={styles.section}>
      <ThemedText type="headline">What the analysis saw</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        The photo shows {display.lay} ({pct}% model confidence).
      </ThemedText>
      <LayoutAnimationConfig skipEntering={false}>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.expandRow}>
          <ThemedText type="subhead" themeColor="brand">
            {open ? 'Hide full analysis' : 'See full analysis'}
          </ThemedText>
          <Icon name={open ? 'chevron.up' : 'chevron.down'} tintColor={theme.brand} size={14} />
        </Pressable>
        {open ? (
          <Animated.View entering={FadeInDown} style={styles.bars}>
            {CLASS_BY_URGENCY.map((cls) => {
              const p = classification.probs[cls] ?? 0;
              const top = cls === classification.topClass;
              return (
                <View key={cls} style={styles.barRow}>
                  <ThemedText type="footnote" themeColor={top ? 'text' : 'textSecondary'} style={styles.barLabel}>
                    {CLASS_DISPLAY[cls].name}
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
  tierCard: { alignItems: 'center', gap: Space.md },
  tierBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  tierLabel: { letterSpacing: 1.5 },
  timeframe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
  },
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
  thumb: { width: 64, height: 64, borderRadius: Radius.md },
  metaText: { flex: 1, gap: 2 },
  actions: { gap: Space.md, marginTop: Space.sm },
  disclaimer: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingTop: Space.base,
    marginTop: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  disclaimerText: { flex: 1 },
  reminderDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.base,
    borderRadius: Radius.md,
  },
  reminderText: { flex: 1 },
});
