import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildReportModel } from '@/lib/report/summary-report';
import { useScanHistory } from '@/lib/scan-history';

/**
 * Screening Summary Report — placeholder screen. Exercises the buildReportModel()
 * data contract now; the shareable PDF (expo-print, screeningsummary.png layout)
 * is planned as its own follow-up phase.
 */
export default function ReportScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById } = useScanHistory();
  const record = id ? getById(id) : undefined;
  const model = record ? buildReportModel(record) : null;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Screening summary
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <IconCircle icon="list.bullet.clipboard.fill" variant="gradient" size={84} />
        <View style={[styles.badge, { backgroundColor: theme.brandTint }]}>
          <ThemedText type="caption" themeColor="brand" style={styles.badgeText}>
            SHAREABLE PDF — COMING SOON
          </ThemedText>
        </View>
        <ThemedText type="body" themeColor="muted" style={styles.center}>
          A clinic-ready summary you can bring to your consultation. Here’s what it will include:
        </ThemedText>

        {model ? (
          <Card style={styles.preview}>
            <Row label="Urgency" value={`${model.urgencyTier} — ${model.urgencyHeadline}`} />
            <Row label="Model result" value={`${model.classificationName} (${model.confidencePct}%)`} />
            <Row label="Triage score" value={model.tps} />
            <Row label="Body location" value={model.bodyRegion ?? 'Not marked'} />
            <Row
              label="Reported signs"
              value={
                model.symptoms.filter((s) => s.answer !== 'No').map((s) => s.label).join(', ') || 'None'
              }
            />
            <Row label="Combined cancer-type probability" value={`${model.malignantPct}%`} />
            {model.safetyFloorApplied ? (
              <Row label="Note" value="Precautionary result — photo could not be assessed confidently" />
            ) : null}
            {model.malignantGateApplied ? (
              <Row
                label="Note"
                value="Urgency raised — cancer-type probability was spread across several types"
              />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="subhead" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="body" style={styles.rowValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  body: { alignItems: 'center', gap: Space.base, paddingTop: Space.xxl, paddingBottom: Space.giant },
  badge: { paddingHorizontal: Space.md, paddingVertical: Space.xs, borderRadius: Radius.pill },
  badgeText: { letterSpacing: 1 },
  center: { textAlign: 'center' },
  preview: { alignSelf: 'stretch', gap: Space.base, marginTop: Space.sm },
  row: { gap: 2 },
  rowValue: {},
});
