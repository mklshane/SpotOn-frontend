import { t, useLocale } from '@/lib/i18n';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
 * Shows the report's contents in the app's own visual language - warm cards, risk-tier
 * colors, answer chips - rather than a facsimile of the printed page, then hands off to
 * Share or Print. The PDF itself (report-html.ts) keeps the clinical navy/cream layout a
 * clinician expects. Generation is entirely on-device: the page embeds the lesion photo and
 * patient details and never touches the network.
 */

type PdfState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'ready'; report: GeneratedReport }
  | { status: 'error'; message: string };

const PDF_PREPARE_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ReportError('render-failed', 'The report took too long to prepare. Please try again.'));
    }, timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export default function ReportScreen() {
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById, loading } = useScanHistory();
  const { user } = useAuth();
  const record = id ? getById(id) : undefined;

  const model = useMemo(() => {
    if (!record) return null;
    // The locale is intentionally read here so a language change rebuilds the report model.
    void locale;
    return buildReportModel(record, user);
  }, [record, user, locale]);
  const [pdf, setPdf] = useState<PdfState>({ status: 'idle' });
  const [viewerOpen, setViewerOpen] = useState(false);

  // One in-flight generation at a time; a second tap awaits the first rather than re-rendering.
  const modelVersion = useRef(0);
  const inFlight = useRef<{ version: number; promise: Promise<GeneratedReport> } | null>(null);
  const generated = useRef<GeneratedReport | null>(null);

  // A locale change must regenerate the preview/PDF so its copy matches the app.
  useEffect(() => {
    modelVersion.current += 1;
    const previous = generated.current;
    generated.current = null;
    // A profile or locale refresh invalidates an in-progress render. Re-enable the actions so
    // the stale request cannot leave both buttons spinning after it settles.
    setPdf((state) => (state.status === 'working' ? { status: 'idle' } : state));
    if (previous) void discardReportPdf(previous);
  }, [model]);

  const ensurePdf = useCallback(async (): Promise<GeneratedReport | null> => {
    if (!model) return null;
    if (generated.current) return generated.current;
    const requestedVersion = modelVersion.current;
    let request = inFlight.current;

    // If the profile or locale changed while an older request was rendering, let that native
    // request settle before starting another one. Expo Print can otherwise leave two WebViews
    // competing for the print renderer on some Android devices.
    if (request && request.version !== requestedVersion) {
      try {
        await request.promise;
      } catch {
        // The newer request below is still allowed to try.
      }
      if (modelVersion.current !== requestedVersion) return null;
      if (inFlight.current === request) inFlight.current = null;
      request = null;
    }

    if (!request) {
      request = {
        version: requestedVersion,
        promise: withTimeout(generateReportPdf(model), PDF_PREPARE_TIMEOUT_MS),
      };
      inFlight.current = request;
    }

    setPdf({ status: 'working' });
    try {
      const report = await request.promise;
      if (inFlight.current !== request || modelVersion.current !== requestedVersion) {
        await discardReportPdf(report);
        return null;
      }
      generated.current = report;
      inFlight.current = null;
      setPdf({ status: 'ready', report });
      return report;
    } catch (e) {
      if (inFlight.current !== request || modelVersion.current !== requestedVersion) return null;
      inFlight.current = null;
      const message =
        e instanceof ReportError ? e.message : 'The summary could not be prepared. Please try again.';
      setPdf({ status: 'error', message });
      return null;
    }
  }, [model]);

  // The PDF holds PII and lives in the cache directory - drop it when the screen goes away.
  useEffect(
    () => () => {
      inFlight.current = null;
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

        {pdf.status === 'error' ? <ErrorCard message={t(pdf.message)} onRetry={() => void ensurePdf()} /> : null}
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
  useLocale();
  return (
    <Card style={styles.head}>
      <Logo variant="wordmark" width={72} />
      <View style={styles.headText}>
        <ThemedText type="title2">{t("Screening Summary Report")}</ThemedText>
        <ThemedText type="subhead" themeColor="textSecondary">
          {model.dateLabel} · {model.timeLabel}
        </ThemedText>
      </View>
      <View style={styles.reportWarning}>
        <Icon name="exclamationmark.triangle.fill" tintColor="#B25E09" size={17} />
        <View style={styles.disclaimerText}>
          <ThemedText type="subhead" style={{ color: '#9A6510' }}>
            {t('Avoid self-medication')}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {model.avoidSelfMedicationWarning.replace('Avoid self-medication. ', '')}
          </ThemedText>
        </View>
      </View>
    </Card>
  );
}

function PatientCard({ model }: { model: ReportModel }) {
  useLocale();
  const { patient } = model;
  return (
    <Card style={styles.card}>
      <SectionHeader variant="label" title={t("Patient")} />
      <View style={styles.grid}>
        <Field label={t("Name")} value={patient.name} />
        <Field label={t("Date of birth")} value={patient.dobLine} />
        <Field label={t("Sex")} value={patient.sex} />
        <Field label={t("Contact")} value={patient.contact} />
      </View>
    </Card>
  );
}

function LesionCard({ model, onPressPhoto }: { model: ReportModel; onPressPhoto: () => void }) {
  useLocale();
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <SectionHeader variant="label" title={t("Lesion image and result")} />
      <View style={styles.lesion}>
        {model.imageUri ? (
          <Pressable
            onPress={onPressPhoto}
            accessibilityRole="button"
            accessibilityLabel={t("View photo full screen")}
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
            {model.classificationCode} · {model.confidenceLabel} {t("model confidence")}</ThemedText>
        </View>
      </View>
    </Card>
  );
}

function SymptomsCard({ model }: { model: ReportModel }) {
  useLocale();
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <SectionHeader
        variant="label"
        title={t("Reported symptoms")}
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
  useLocale();
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
  useLocale();
  const tone = useTierColors(model.tier);
  return (
    <Card style={styles.card}>
      <SectionHeader variant="label" title={t("Urgency and recommendation")} />
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
  useLocale();
  const theme = useTheme();
  return (
    <Card style={[styles.card, { backgroundColor: theme.elementBg }]} elevation="sm">
      <View style={styles.disclaimerRow}>
        <Icon name="exclamationmark.triangle.fill" tintColor={theme.muted} size={18} />
        <View style={styles.disclaimerText}>
          <ThemedText type="headline" themeColor="textSecondary">
            {t("Printed on the report")}</ThemedText>
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
  useLocale();
  return (
    <View style={styles.field}>
      <ThemedText type="caption" themeColor="muted" style={styles.fieldLabel}>
        {label.toUpperCase()}
      </ThemedText>
      <ThemedText type="callout">{value ?? '-'}</ThemedText>
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
  useLocale();
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.disclaimerRow}>
        <Icon name="person.crop.circle.badge.exclamationmark" tintColor={theme.brand} size={22} />
        <View style={styles.disclaimerText}>
          <ThemedText type="headline">{t("Finish your profile")}</ThemedText>
          <ThemedText type="subhead" themeColor="textSecondary">
            {t("Your name, birth date, sex and contact number sit at the top of the report. Anything missing prints as a dash.")}</ThemedText>
        </View>
      </View>
      <Button label={t("Complete profile")} variant="outline" onPress={() => router.push('/profile/edit')} />
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  useLocale();
  const theme = useTheme();
  return (
    <Card style={[styles.card, { backgroundColor: theme.riskCriticalBg }]}>
      <ThemedText type="subhead" style={{ color: theme.riskCritical }}>
        {message}
      </ThemedText>
      <Button label={t("Try again")} variant="ghost" onPress={onRetry} />
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
  useLocale();
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
      {Platform.OS === 'web' ? (
        // Both actions open the browser's print dialog. Without this the screen looked inert:
        // the dialog is chrome, not DOM, so nothing on the page changes when it appears.
        <ThemedText type="caption" themeColor="textSecondary" style={styles.barNote}>
          {t("Opens your browser's print dialog - choose \"Save as PDF\" there to keep a copy.")}
        </ThemedText>
      ) : null}
      <Button
        // On web there is no share sheet: report-pdf.web.ts routes both actions through the
        // browser's own print dialog, from which the user saves a PDF. Naming it "Share or save"
        // there promises a sheet that never appears.
        label={Platform.OS === 'web' ? t("Save as PDF") : t("Share or save")}
        variant="brand"
        icon="square.and.arrow.up"
        loading={busy}
        onPress={onShare}
        style={styles.barButton}
      />
      <Button
        label={t("Print")}
        variant="outline"
        icon="printer.fill"
        loading={busy}
        onPress={onPrint}
        style={styles.barButton}
      />
    </View>
  );
}

function Header() {
  useLocale();
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Pressable
        hitSlop={12}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
        accessibilityRole="button"
        accessibilityLabel={t("Back")}>
        <Icon name="chevron.left" tintColor={theme.brand} size={20} />
      </Pressable>
      <ThemedText type="headline" themeColor="textSecondary">
        {t("Screening summary")}</ThemedText>
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
  reportWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: '#FFF4DE',
    borderWidth: 1,
    borderColor: '#F2C77D',
  },

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
    // The web-only print note is a full-width row child; without wrapping it would compete with
    // the buttons for horizontal space instead of sitting above them.
    flexWrap: 'wrap',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barNote: { width: '100%', textAlign: 'center', marginBottom: Space.xs },
  barButton: { flex: 1 },
});
