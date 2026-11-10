import { t, useLocale } from '@/lib/i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/api/client';
import { REPORT_CATEGORIES, submitDirectoryReport, type ReportCategory } from '@/lib/directory-reports';

/** Category labels as literal t() calls (the i18n coverage guard reads call sites). */
function categoryLabel(c: ReportCategory): string {
  switch (c) {
    case 'wrong_phone':
      return t('Wrong phone number');
    case 'wrong_address':
      return t('Wrong address or map pin');
    case 'wrong_schedule':
      return t('Wrong clinic schedule');
    case 'doctor_not_here':
      return t("Doctor doesn't practise here");
    case 'closed_or_moved':
      return t('Closed or moved');
    case 'not_dermatology':
      return t('Not a dermatology clinic');
    default:
      return t('Something else');
  }
}

/**
 * "Report incorrect info" for a clinic or doctor. Goes to the directory team (POST
 * /directory/reports); queued and sent later when offline.
 */
export default function DirectoryReportScreen() {
  useLocale();
  const theme = useTheme();
  const params = useLocalSearchParams<{ kind?: string; id?: string; name?: string }>();
  const kind = params.kind === 'doctor' ? 'doctor' : 'facility';
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<'sent' | 'queued' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/directory'));

  const submit = async () => {
    if (!category || !params.id) return;
    setSending(true);
    setError(null);
    try {
      setDone(await submitDirectoryReport({ target_kind: kind, target_id: params.id, category, message }));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? t("You've sent several reports recently. Please try again later.")
          : t("Couldn't send your report. Please try again."),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <ThemedText type="headline">{t('Report incorrect info')}</ThemedText>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close')}>
          <Icon name="xmark" size={18} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      {done ? (
        <View style={styles.done}>
          <Icon name="checkmark.circle.fill" size={44} tintColor={theme.riskLow} />
          <ThemedText type="title2" style={styles.center}>
            {done === 'sent' ? t('Thank you - report sent') : t("Saved - we'll send it when you're online")}
          </ThemedText>
          <ThemedText type="callout" themeColor="textSecondary" style={styles.center}>
            {t('The directory team checks every report against the official listings.')}
          </ThemedText>
          <Button label={t('Done')} onPress={close} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {params.name ? (
              <ThemedText type="callout" themeColor="textSecondary">
                {params.name}
              </ThemedText>
            ) : null}
            <ThemedText type="title2">{t("What's wrong?")}</ThemedText>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {REPORT_CATEGORIES.map((c) => (
                <Chip key={c} label={categoryLabel(c)} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
            <TextField
              label={t('Details (optional)')}
              placeholder={t('e.g. the correct number, or the new clinic days')}
              value={message}
              onChangeText={(v) => setMessage(v.slice(0, 1000))}
              multiline
              numberOfLines={4}
              style={styles.message}
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              {t("Please don't include health information about yourself.")}
            </ThemedText>
            {error ? (
              <ThemedText type="footnote" style={{ color: theme.riskHigh }} accessibilityLiveRegion="polite">
                {error}
              </ThemedText>
            ) : null}
            <Button
              label={t('Send report')}
              icon="flag"
              disabled={!category || !params.id}
              loading={sending}
              onPress={submit}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  message: { minHeight: 96, textAlignVertical: 'top' },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.base, paddingHorizontal: Space.xl },
  center: { textAlign: 'center' },
});
