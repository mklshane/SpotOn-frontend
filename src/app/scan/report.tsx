import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ImageViewer, Logo, Screen, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  discardReportPdf,
  generateReportPdf,
  printReportPdf,
  ReportError,
  shareReportPdf,
  type GeneratedReport,
} from '@/lib/report/report-pdf';
import { buildReportModel, type ReportModel, type ReportSymptom } from '@/lib/report/summary-report';
import { useScanHistory } from '@/lib/scan-history';
import type { TriageTier } from '@/lib/triage/types';

/**
 * Screening Summary Report.
 *
 * Shows the report's contents in the app's own visual language — warm cards, risk-tier
 * colors, answer chips — rather than a facsimile of the printed page, then hands off to
 * Share or Print. The PDF itself (report-html.ts) keeps the clinical navy/cream layout a
 * clinician expects. Generation is entirely on-device: the page embeds the lesion photo and
 * patient details and never touches the network.
 */

type PdfState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'ready'; report: GeneratedReport }
  | { status: 'error'; message: string };

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById, loading } = useScanHistory();
  const { user } = useAuth();
  const record = id ? getById(id) : undefined;

  const model = useMemo(() => (record ? buildReportModel(record, user) : null), [record, user]);
  const [pdf, setPdf] = useState<PdfState>({ status: 'idle' });
  const [viewerOpen, setViewerOpen] = useState(false);

  // One in-flight generation at a time; a second tap awaits the first rather than re-rendering.
  const inFlight = useRef<Promise<GeneratedReport> | null>(null);
  const generated = useRef<GeneratedReport | null>(null);

  const ensurePdf = useCallback(async (): Promise<GeneratedReport | null> => {
    if (!model) return null;
    if (generated.current) return generated.current;
    if (!inFlight.current) inFlight.current = generateReportPdf(model);
    setPdf({ status: 'working' });
    try {
      const report = await inFlight.current;
      generated.current = report;
      setPdf({ status: 'ready', report });
      return report;
    } catch (e) {
      inFlight.current = null;
      const message =
        e instanceof ReportError ? e.message : 'The summary could not be prepared. Please try again.';
      setPdf({ status: 'error', message });
      return null;
    }
  }, [model]);

  // Pre-render once the push animation has settled, so Share and Print feel instant.
  useEffect(() => {
    if (!model) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void ensurePdf();
    });
    return () => task.cancel();
  }, [model, ensurePdf]);

  // The PDF holds PII and lives in the cache directory — drop it when the screen goes away.
  useEffect(
    () => () => {
      const report = generated.current;
      if (report) void discardReportPdf(report);
    },
    [],
  );

  const onShare = useCallback(async () => {
    const report = await ensurePdf();
    if (!report) return;
    try {
      await shareReportPdf(report);
    } catch (e) {
      setPdf({
        status: 'error',
        message: e instanceof ReportError ? e.message : 'The summary could not be shared.',
      });
    }
  }, [ensurePdf]);

  const onPrint = useCallback(async () => {
    const report = await ensurePdf();
    if (!report) return;
    try {
      await printReportPdf(report);
    } catch (e) {
      setPdf({
        status: 'error',
        message: e instanceof ReportError ? e.message : 'The summary could not be printed.',
      });
    }
  }, [ensurePdf]);

  if (!model || !record) {
    return (
      <Screen>
        <Header />
        <View style={styles.emptyBody}>
          <ThemedText type="body" themeColor="muted" style={styles.center}>
            {loading ? 'Loading summary…' : 'This screening could not be found.'}
          </ThemedText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      <Header />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + BAR_HEIGHT + Space.xl },
        ]}
        showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown}>
          <ReportHead model={model} />
        </Animated.View>

        {model.patient.incomplete ? (
          <Animated.View entering={FadeInDown.delay(40)}>
            <IncompleteProfileCard />
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.delay(80)}>
          <PatientCard model={model} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120)}>
          <LesionCard model={model} onPressPhoto={() => setViewerOpen(true)} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160)}>
          <SymptomsCard model={model} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200)}>
          <UrgencyCard model={model} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(240)}>
          <DisclaimerCard model={model} />
        </Animated.View>

        {pdf.status === 'error' ? <ErrorCard message={pdf.message} onRetry={() => void ensurePdf()} /> : null}
      </ScrollView>

      <ActionBar busy={pdf.status === 'working'} onShare={onShare} onPrint={onPrint} />

      {record.imageUri ? (
        <ImageViewer visible={viewerOpen} uri={record.imageUri} onClose={() => setViewerOpen(false)} />
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ sections */

/** Title block: what this document is and when it was made. */
function ReportHead({ model }: { model: ReportModel }) {
  return (
    <Card style={styles.head}>
      <Logo variant="wordmark" width={72} />
      <View style={styles.headText}>
        <ThemedText type="title2">Screening Summary Report</ThemedText>
        <ThemedText type="subhead" themeColor="textSecondary">
          {model.dateLabel} · {model.timeLabel}
        </ThemedText>
      </View>
    </Card>
  );
}

function PatientCard({ model }: { model: ReportModel }) {
  const { patient } = model;
  return (
    <Card style={styles.card}>
      <SectionHeader variant="label" title="Patient" />
      <View style={styles.grid}>
        <Field label="Name" value={patient.name} />
        <Field label="Date of birth" value={patient.dobLine} />
        <Field label="Sex" value={patient.sex} />
        <Field label="Contact" value={patient.contact} />
      </View>
    </Card>
  );
}

function LesionCard({ model, onPressPhoto }: { model: ReportModel; onPressPhoto: () => void }) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <SectionHeader variant="label" title="Lesion image and result" />
      <View style={styles.lesion}>
        {model.imageUri ? (
          <Pressable
            onPress={onPressPhoto}
            accessibilityRole="button"
            accessibilityLabel="View photo full screen"
            style={({ pressed }) => [styles.photoPress, pressed && styles.photoPressed]}>
            <Image source={{ uri: model.imageUri }} style={styles.photo} contentFit="cover" />
            <View style={styles.photoExpand}>
              <Icon
                name="arrow.up.left.and.arrow.down.right"
                tintColor="#FFFFFF"
                size={11}
                weight="semibold"
              />
            </View>
          </Pressable>
        ) : (
          <View style={[styles.photo, styles.photoMissing, { borderColor: theme.hairline }]}>
            <Icon name="photo" tintColor={theme.muted} size={20} />
          </View>
        )}
        <View style={styles.lesionText}>
          <ThemedText type="title2">{model.classificationFull}</ThemedText>
          <ThemedText type="subhead" themeColor="textSecondary">
            {model.classificationCode} · {model.confidenceLabel} model confidence
          </ThemedText>
        </View>
      </View>
    </Card>
  );
}

function SymptomsCard({ model }: { model: ReportModel }) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <SectionHeader
        variant="label"
        title="Reported symptoms"
        subtitle={`You answered yes to ${model.yesCount} of ${model.symptoms.length}`}
      />
      <View style={styles.rows}>
        {model.symptoms.map((s, i) => (
          <View
            key={s.id}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline }]}>
            <ThemedText type="subhead" style={styles.rowQuestion}>
              {s.question}
            </ThemedText>
            <AnswerChip answer={s.answer} />
          </View>
        ))}
      </View>
    </Card>
  );
}

function AnswerChip({ answer }: { answer: ReportSymptom['answer'] }) {
  const theme = useTheme();
  const tone =
    answer === 'Yes'
      ? { fg: theme.riskCritical, bg: theme.riskCriticalBg }
      : answer === 'Unsure'
        ? { fg: theme.riskModerate, bg: theme.riskModerateBg }
        : { fg: theme.muted, bg: theme.elementBg };
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <ThemedText type="caption" style={[styles.chipText, { color: tone.fg }]}>
        {answer}
      </ThemedText>
    </View>
  );
}

function UrgencyCard({ model }: { model: ReportModel }) {
  const tone = useTierColors(model.tier);
  return (
    <Card style={styles.card}>
      <SectionHeader variant="label" title="Urgency and recommendation" />
      <View style={[styles.tierBanner, { backgroundColor: tone.bg }]}>
        <ThemedText type="title2" style={{ color: tone.fg }}>
          {model.urgencyTier}
        </ThemedText>
        <ThemedText type="subhead" style={{ color: tone.fg }}>
          {model.urgencyHeadline}
        </ThemedText>
      </View>
      <ThemedText type="body" themeColor="textSecondary">
        {model.recommendation}
      </ThemedText>
    </Card>
  );
}

function DisclaimerCard({ model }: { model: ReportModel }) {
  const theme = useTheme();
  return (
    <Card style={[styles.card, { backgroundColor: theme.elementBg }]} elevation="sm">
      <View style={styles.disclaimerRow}>
        <Icon name="exclamationmark.triangle.fill" tintColor={theme.muted} size={18} />
        <View style={styles.disclaimerText}>
          <ThemedText type="headline" themeColor="textSecondary">
            Printed on the report
          </ThemedText>
          <ThemedText type="footnote" themeColor="muted">
            {model.printDisclaimer}
          </ThemedText>
        </View>
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ small parts */

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.field}>
      <ThemedText type="caption" themeColor="muted" style={styles.fieldLabel}>
        {label.toUpperCase()}
      </ThemedText>
      <ThemedText type="callout">{value ?? '—'}</ThemedText>
    </View>
  );
}

function useTierColors(tier: TriageTier) {
  const theme = useTheme();
  return tier === 'low'
    ? { fg: theme.riskLow, bg: theme.riskLowBg }
    : tier === 'moderate'
      ? { fg: theme.riskModerate, bg: theme.riskModerateBg }
      : tier === 'high'
        ? { fg: theme.riskHigh, bg: theme.riskHighBg }
        : { fg: theme.riskCritical, bg: theme.riskCriticalBg };
}

function IncompleteProfileCard() {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.disclaimerRow}>
        <Icon name="person.crop.circle.badge.exclamationmark" tintColor={theme.brand} size={22} />
        <View style={styles.disclaimerText}>
          <ThemedText type="headline">Finish your profile</ThemedText>
          <ThemedText type="subhead" themeColor="textSecondary">
            Your name, birth date, sex and contact number sit at the top of the report. Anything
            missing prints as a dash.
          </ThemedText>
        </View>
      </View>
      <Button label="Complete profile" variant="outline" onPress={() => router.push('/profile/edit')} />
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <Card style={[styles.card, { backgroundColor: theme.riskCriticalBg }]}>
      <ThemedText type="subhead" style={{ color: theme.riskCritical }}>
        {message}
      </ThemedText>
      <Button label="Try again" variant="ghost" onPress={onRetry} />
    </Card>
  );
}

function ActionBar({
  busy,
  onShare,
  onPrint,
}: {
  busy: boolean;
  onShare: () => void;
  onPrint: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        Elevation.lg,
        {
          backgroundColor: theme.surface,
          borderTopColor: theme.hairline,
          paddingBottom: insets.bottom + Space.md,
        },
      ]}>
      <Button
        label="Share or save"
        variant="brand"
        icon="square.and.arrow.up"
        loading={busy}
        onPress={onShare}
        style={styles.barButton}
      />
      <Button
        label="Print"
        variant="outline"
        icon="printer.fill"
        onPress={onPrint}
        style={styles.barButton}
      />
    </View>
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
        Screening summary
      </ThemedText>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const BAR_HEIGHT = 76;

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.xl,
  },
  headerSpacer: { width: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Space.base, paddingTop: Space.sm, gap: Space.md },
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },

  card: { gap: Space.base },

  head: { gap: Space.base },
  headText: { gap: Space.xs },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space.base, columnGap: Space.sm },
  // Two per row, wide enough that "July 7, 2001 (25 y/o)" stays on one line.
  field: { flexGrow: 1, flexShrink: 1, flexBasis: '47%', gap: 2 },
  fieldLabel: { fontWeight: '700', letterSpacing: 0.5 },

  lesion: { flexDirection: 'row', gap: Space.base, alignItems: 'center' },
  photoPress: { borderRadius: Radius.md, overflow: 'hidden' },
  photoPressed: { opacity: 0.85 },
  photo: { width: 96, height: 96, borderRadius: Radius.md },
  photoMissing: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed' },
  photoExpand: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  lesionText: { flex: 1, gap: Space.xs },

  rows: { marginTop: -Space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
  },
  rowQuestion: { flex: 1 },
  chip: {
    minWidth: 64,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  chipText: { fontWeight: '700', textAlign: 'center' },

  tierBanner: {
    gap: 2,
    borderRadius: Radius.md,
    paddingVertical: Space.base,
    paddingHorizontal: Space.base,
  },

  disclaimerRow: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  disclaimerText: { flex: 1, gap: Space.xs },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barButton: { flex: 1 },
});
