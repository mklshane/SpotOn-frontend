import { t, useLocale } from '@/lib/i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { IconCircle } from '@/components/ui/icon-circle';
import type { IconName } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RESEARCH_RETENTION_END } from '@/lib/research-core';

export type ResearchConsentSheetProps = {
  visible: boolean;
  /**
   * `'ask'` - the one-time choice after a first result: Share / Not now, equal weight.
   * `'info'` - the same explainer from Settings ("What's shared?"), with a single Close.
   */
  mode: 'ask' | 'info';
  /** Ask mode: record the yes. A rejection is shown on the sheet and the sheet stays open. */
  onShare?: () => Promise<void>;
  /** Ask mode: "Not now", a backdrop tap or Android back. Counts as an answer - we don't re-nag. */
  onNotNow?: () => void;
  /** Hide without answering: Close in info mode, and "Learn more" in either mode. */
  onClose?: () => void;
};

function Point({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.point}>
      <IconCircle icon={icon} size={40} />
      <View style={styles.pointText}>
        <ThemedText type="headline">{title}</ThemedText>
        {children}
      </View>
    </View>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText type="footnote" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

/**
 * "Help improve SpotOn (optional)" - the research-sharing explainer and its one-time ask.
 *
 * The copy answers, in order, what research on donation prompts says people need before saying
 * yes (23andMe / Apple Research / Google DermAssist; NPC Circular 2023-04): what exactly leaves the
 * phone, why, how it is protected, that saying no costs nothing, how long it is kept, and how to
 * take it back. Share and Not now are the same button style on purpose - no dark pattern.
 *
 * Changing this copy means bumping RESEARCH_CONSENT_VERSION (research-core.ts), which re-asks
 * everyone who already answered.
 */
export function ResearchConsentSheet({ visible, mode, onShare, onNotNow, onClose }: ResearchConsentSheetProps) {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = mode === 'ask';
  const dismiss = saving ? () => {} : ask ? () => onNotNow?.() : () => onClose?.();

  async function handleShare() {
    if (!onShare) return;
    setSaving(true);
    setError(null);
    try {
      await onShare();
    } catch (e) {
      console.warn('[research] consent failed', e);
      setError(t("Couldn't save your choice. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  }

  function learnMore() {
    // Hides the sheet without answering: in ask mode the choice stays open for the next result.
    onClose?.();
    router.push({ pathname: '/profile/privacy', params: { section: 'research' } });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        {/* The dismiss target sits BEHIND the sheet rather than wrapping it: a Pressable around the
            sheet claims every touch and the ScrollView inside never gets to scroll. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel={t('Dismiss')} />
        <View
          style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + Space.base }]}>
          <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.head}>
              <ThemedText type="title2">{t('Help improve SpotOn (optional)')}</ThemedText>
              <ThemedText type="callout" themeColor="textSecondary">
                {ask
                  ? t('You can share scans like this one with the SpotOn research team. If you say yes, only scans you make from now on are shared - not this one, and not your past history.')
                  : t('Sharing is off unless you turn it on. When it is on, only scans you make after saying yes are shared - never your past history.')}
              </ThemedText>
            </View>

            <Point icon="photo.on.rectangle" title={t("What's shared")}>
              <Body>{t("Only a small cropped photo of the spot, your age range, sex, skin type, body area, your answers and the app's result.")}</Body>
              <Body>{t('Never your name, email, birthday, face, location or full photo.')}</Body>
            </Point>

            <Point icon="chart.bar.fill" title={t('Why')}>
              <Body>{t("To retrain and check SpotOn's model, especially for Filipino skin tones, which are under-represented in the data it was trained on.")}</Body>
              <Body>{t('Not used for ads, never sold, and not shared outside the research team.')}</Body>
            </Point>

            <Point icon="lock.shield.fill" title={t("How it's protected")}>
              <Body>{t('Location and camera details are removed on your phone before anything is sent.')}</Body>
              <Body>{t('Photos are stored under a random code, not your account.')}</Body>
              <Body>{t('Only approved admins can view them, and every view is logged.')}</Body>
              <Body>{t('Spots on the head or face, and photos that look like a face, are never sent.')}</Body>
            </Point>

            <Point icon="checkmark.circle.fill" title={t('No penalty')}>
              <Body>{t('Saying no changes nothing. Every feature works the same either way.')}</Body>
            </Point>

            <Point icon="clock.fill" title={t("How long it's kept")}>
              <Body>{t('Kept until the study ends ({{date}}), then deleted.', { date: t(RESEARCH_RETENTION_END) })}</Body>
            </Point>

            <Point icon="arrow.counterclockwise" title={t('Withdraw anytime')}>
              <Body>{t("Turn it off in Settings and your shared photos are deleted. Models already trained with them can't un-learn them.")}</Body>
            </Point>

            {error ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {ask ? (
              <View style={styles.choices}>
                <Button
                  label={t('Not now')}
                  variant="outline"
                  disabled={saving}
                  onPress={() => onNotNow?.()}
                  style={styles.choice}
                />
                <Button
                  label={t('Share')}
                  variant="outline"
                  loading={saving}
                  onPress={handleShare}
                  style={styles.choice}
                />
              </View>
            ) : (
              <Button label={t('Close')} variant="outline" onPress={() => onClose?.()} />
            )}
            <Button label={t('Learn more')} variant="ghost" disabled={saving} onPress={learnMore} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(33,26,21,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Space.md,
  },
  // Shrink to fit under the sheet's maxHeight so the footer buttons stay on screen and the body scrolls.
  scroll: { flexGrow: 0, flexShrink: 1 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Space.sm },
  content: { paddingHorizontal: Space.xl, paddingTop: Space.sm, paddingBottom: Space.base, gap: Space.lg },
  head: { gap: Space.sm },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  pointText: { flex: 1, gap: Space.xs },
  error: { textAlign: 'center' },
  footer: { paddingHorizontal: Space.xl, paddingTop: Space.sm, gap: Space.xs },
  choices: { flexDirection: 'row', gap: Space.md },
  choice: { flex: 1 },
});
