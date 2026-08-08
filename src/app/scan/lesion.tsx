import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lesionTitle } from '@/components/scan/lesion-row';
import { ScanTimeline } from '@/components/scan/scan-timeline';
import { tierColor } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, SectionHeader, TextField } from '@/components/ui';
import { Entrance, EntranceProvider } from '@/components/ui/entrance';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';
import { useScreeningSession } from '@/lib/screening-session';
import { CLASS_DISPLAY } from '@/lib/triage/recommendations';
import { QUESTIONS } from '@/lib/triage/questions';
import { summarizeLesionTrend } from '@/lib/triage/lesion-trend';
import type { ScreeningRecord, TriageTier } from '@/lib/triage/types';

const TIER_LABEL: Record<TriageTier, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Priority',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A tracked lesion over time.
 *
 * The photo strip is the point of this screen: a clinician reads *change*, and side-by-side photos
 * across months are the change. Everything else — the TPS sparkline, the since-first summary, the
 * answer-flip table — is a different projection of the same question, "is this getting worse?".
 */
export default function LesionDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getLesionById, screeningsForLesion, renameLesion, archiveLesion, loading } = useScanHistory();
  const session = useScreeningSession();

  const lesion = id ? getLesionById(id) : undefined;
  const screenings = useMemo(() => (id ? screeningsForLesion(id) : []), [id, screeningsForLesion]);
  const trend = useMemo(() => summarizeLesionTrend(screenings), [screenings]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!lesion) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <ThemedText type="body" themeColor="muted">
            {loading ? 'Loading…' : 'This lesion is no longer available.'}
          </ThemedText>
        </View>
      </Screen>
    );
  }

  const title = lesionTitle(lesion);
  const latest = trend.latest as ScreeningRecord | null;
  const tier = latest?.triage.tier ?? 'low';
  const { fg, bg } = tierColor(theme, tier);

  function startFollowUp() {
    if (!lesion || !latest) return;
    session.startFollowUp(lesion, latest);
    router.push('/scan/followup-confirm');
  }

  function commitRename() {
    setEditing(false);
    const next = draft.trim();
    if (lesion && next !== (lesion.label ?? '')) renameLesion(lesion.id, next || null);
  }

  function confirmArchive() {
    if (!lesion) return;
    const archiving = !lesion.archived;
    Alert.alert(
      archiving ? 'Stop tracking this spot?' : 'Track this spot again?',
      archiving
        ? 'It will be hidden from your lesion list and the body model. Your scans and photos are kept.'
        : 'It will reappear in your lesion list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: archiving ? 'Stop tracking' : 'Track again',
          style: archiving ? 'destructive' : 'default',
          onPress: () => archiveLesion(lesion.id, archiving),
        },
      ],
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Tracked spot
        </ThemedText>
        <Pressable hitSlop={12} onPress={confirmArchive} accessibilityRole="button" accessibilityLabel="Tracking options">
          <Icon name="ellipsis" tintColor={theme.brand} size={20} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.huge }]}
        showsVerticalScrollIndicator={false}>
        {/* Fade only, matching the Education module: nothing moves, so a spot
            being monitored does not slide around while it is being read. */}
        <EntranceProvider screen={`lesion-${lesion.id}`} replay>
        <Entrance index={0} style={styles.titleBlock}>
          {editing ? (
            <TextField
              value={draft}
              onChangeText={setDraft}
              placeholder={title}
              autoFocus
              onBlur={commitRename}
              onSubmitEditing={commitRename}
              returnKeyType="done"
            />
          ) : (
            <Pressable
              onPress={() => {
                setDraft(lesion.label ?? '');
                setEditing(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Rename ${title}`}
              style={styles.titleRow}>
              <ThemedText type="title1" numberOfLines={2} style={styles.titleText}>
                {title}
              </ThemedText>
              {/* The bare glyph read as a stray mark next to the title; a tinted chip reads as the
                  button it is, and gives the rename a real 32pt target inside the 44pt hitSlop. */}
              <View style={[styles.editChip, { backgroundColor: theme.elementBg }]}>
                <Icon name="pencil" tintColor={theme.textSecondary} size={14} />
              </View>
            </Pressable>
          )}
          {/* Pill beside a stacked pair rather than one long run-on line: the
              status, the place, and the record are three different facts, and
              on a narrow screen the single line wrapped mid-sentence. */}
          <View style={styles.metaRow}>
            <View style={[styles.tierPill, { backgroundColor: bg }]}>
              <ThemedText type="caption" style={{ color: fg }}>
                {TIER_LABEL[tier]}
              </ThemedText>
            </View>
            <View style={styles.metaText}>
              <ThemedText type="footnote" themeColor="textSecondary">
                {lesion.mark?.region ?? 'Location not marked'}
                {lesion.archived ? ' · not tracked' : ''}
              </ThemedText>
              {trend.count ? (
                <ThemedText type="caption" themeColor="muted">
                  {trend.count} {trend.count === 1 ? 'scan' : 'scans'}
                  {trend.firstAt
                    ? ` · ${trend.count === 1 ? 'Started' : 'Tracking since'} ${fmtDate(trend.firstAt)}`
                    : ''}
                </ThemedText>
              ) : null}
            </View>
          </View>
        </Entrance>

        {/* Photo timeline — the highest-value element on this screen */}
        {screenings.length > 0 ? (
          <Entrance index={1} style={styles.section}>
            <SectionHeader title="Over time" variant="label" />
            <ScanTimeline
              screenings={screenings}
              onOpen={(s) => router.push({ pathname: '/scan/result', params: { id: s.id } })}
            />
          </Entrance>
        ) : null}

        {/* Trend sparkline — hidden below 3 points, where a line chart is just noise */}
        {trend.tpsSeries.length >= 3 ? (
          <Entrance index={2} style={styles.section}>
            <SectionHeader title="Priority score" variant="label" />
            <Card style={styles.sparkCard}>
              <TpsSparkline series={trend.tpsSeries} />
              <ThemedText type="caption" themeColor="muted">
                Triage Priority Score, 0–8. Higher means seek care sooner.
              </ThemedText>
            </Card>
          </Entrance>
        ) : null}

        {/* Since-first summary */}
        {trend.count > 1 && trend.tierFrom && trend.tierTo ? (
          <Entrance index={3} style={styles.section}>
            <SectionHeader title="What changed" variant="label" />
            <Card style={styles.changeCard}>
              {/* The verdict leads, at headline weight, in the tier's own colour. The old paragraph
                  buried it mid-sentence and — because most spots hold steady — routinely rendered
                  "went from Low to Low", which reads as a bug rather than as reassurance. */}
              <View style={styles.verdict}>
                <ThemedText type="headline" style={{ color: tierColor(theme, trend.tierTo).fg }}>
                  {/* "Held steady" is last so it also catches a null direction: an unchanged
                      reading is the honest fallback, never an invented move in either direction. */}
                  {trend.tierDirection === 1
                    ? `Moved up to ${TIER_LABEL[trend.tierTo]}`
                    : trend.tierDirection === -1
                      ? `Eased to ${TIER_LABEL[trend.tierTo]}`
                      : `Held steady at ${TIER_LABEL[trend.tierTo]}`}
                </ThemedText>
                <ThemedText type="footnote" themeColor="muted">
                  {trend.spanDays === 0
                    ? `Both scans on ${fmtDate(trend.firstAt!)}`
                    : `Over ${trend.spanDays} ${trend.spanDays === 1 ? 'day' : 'days'} · ${fmtDate(trend.firstAt!)} → ${fmtDate(trend.lastAt!)}`}
                </ThemedText>
              </View>

              {trend.classChanged && latest ? (
                <View style={[styles.note, { backgroundColor: theme.elementBg }]}>
                  <Icon name="sparkles" tintColor={theme.textSecondary} size={14} />
                  <ThemedText type="footnote" themeColor="textSecondary" style={styles.noteText}>
                    The most likely pattern has changed across scans — it now reads as{' '}
                    {CLASS_DISPLAY[latest.classification.topClass].full}.
                  </ThemedText>
                </View>
              ) : null}

              {trend.answerFlips.length ? (
                <View style={styles.flips}>
                  <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
                  {trend.answerFlips.map((f) => {
                    const q = QUESTIONS.find((x) => x.id === f.id);
                    if (!q) return null;
                    const c = f.worsened ? theme.riskModerate : theme.riskLow;
                    const cBg = f.worsened ? theme.riskModerateBg : theme.riskLowBg;
                    return (
                      <View key={f.id} style={styles.flipRow}>
                        {/* Tinted chip instead of a loose glyph — it holds the row's left edge, so
                            the findings line up as a column instead of ragging off each icon. */}
                        <View style={[styles.flipChip, { backgroundColor: cBg }]}>
                          <Icon
                            name={f.worsened ? 'exclamationmark.circle.fill' : 'checkmark.circle.fill'}
                            tintColor={c}
                            size={14}
                          />
                        </View>
                        <View style={styles.flipText}>
                          {/* Finding at full contrast, the answer flip demoted beneath it: the old
                              single grey line gave the question and its answer equal weight. */}
                          <ThemedText type="subhead">{q.finding}</ThemedText>
                          <ThemedText type="caption" themeColor="muted">
                            {f.from} → <ThemedText type="caption" style={{ color: c }}>{f.to}</ThemedText>
                          </ThemedText>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <ThemedText type="footnote" themeColor="muted">
                  Your answers about this spot are unchanged since the last check.
                </ThemedText>
              )}
            </Card>
          </Entrance>
        ) : null}

        {/* One filled pill, one quiet link. Two outlined buttons of equal
            width read as an either/or choice; re-scanning is the action this
            screen exists to prompt, and the result is already one tap away
            from the timeline above. */}
        <Entrance index={4} style={styles.actions}>
          <Button label="Re-scan this spot" variant="brand" onPress={startFollowUp} disabled={!latest} />
          {latest ? (
            <Button
              label="View latest result"
              variant="ghost"
              onPress={() => router.push({ pathname: '/scan/result', params: { id: latest.id } })}
            />
          ) : null}
        </Entrance>
        </EntranceProvider>
      </ScrollView>
    </Screen>
  );
}

/** TPS over time on tier-coloured bands. Plain SVG — same approach as result.tsx's ConfidenceRing. */
function TpsSparkline({ series }: { series: { at: string; tps: number; tier: TriageTier }[] }) {
  const theme = useTheme();
  const W = 260;
  const H = 88;
  const pad = 6;
  const max = 8;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, series.length - 1);
  const y = (v: number) => H - pad - (Math.max(0, Math.min(max, v)) / max) * (H - pad * 2);
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.tps).toFixed(1)}`).join(' ');
  const bands: { from: number; to: number; tier: TriageTier }[] = [
    { from: 0, to: 2, tier: 'low' },
    { from: 2, to: 4, tier: 'moderate' },
    { from: 4, to: 6, tier: 'high' },
    { from: 6, to: 8, tier: 'critical' },
  ];

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {bands.map((b) => (
        <Rect
          key={b.tier}
          x={0}
          y={y(b.to)}
          width={W}
          height={y(b.from) - y(b.to)}
          fill={tierColor(theme, b.tier).bg}
          opacity={0.6}
        />
      ))}
      <Path d={path} stroke={theme.text} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((p, i) => (
        <Circle key={p.at} cx={x(i)} cy={y(p.tps)} r={4} fill={tierColor(theme, p.tier).fg} stroke={theme.surface} strokeWidth={1.5} />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: { paddingHorizontal: Space.xl, paddingTop: Space.sm, gap: Space.xxl },
  titleBlock: { gap: Space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  titleText: { flexShrink: 1 },
  editChip: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  metaText: { flex: 1, minWidth: 0, gap: 2 },
  tierPill: { paddingHorizontal: Space.md, paddingVertical: 3, borderRadius: Radius.pill },
  section: { gap: Space.md },

  pressed: { opacity: 0.85 },
  sparkCard: { gap: Space.md },
  changeCard: { gap: Space.base },
  verdict: { gap: Space.xs },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, padding: Space.md, borderRadius: Radius.md },
  noteText: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  flips: { gap: Space.base },
  flipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  flipChip: { width: 26, height: 26, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  flipText: { flex: 1, gap: 2 },
  actions: { gap: Space.md },
});
