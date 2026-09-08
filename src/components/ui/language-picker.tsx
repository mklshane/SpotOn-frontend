import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setLanguage, t, useLocale, type Locale } from '@/lib/i18n';
import { ThemedText } from '../themed-text';
import { Button } from './button';
import { Icon } from './icon';
import { SettingsRow } from './settings-row';

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  async function choose(next: Locale) {
    if (saving) return;
    setSaving(true);
    setError(false);
    try { await setLanguage(next); setVisible(false); }
    catch { setError(true); }
    finally { setSaving(false); }
  }
  return <>
    {compact ? <Pressable accessibilityRole="button" accessibilityLabel="Language / Wika" onPress={() => setVisible(true)} style={styles.compact}>
      <ThemedText type="subhead" themeColor="brand">English / Tagalog</ThemedText>
    </Pressable> : <SettingsRow icon="globe" label="Language / Wika" sublabel={locale === 'fil' ? 'Tagalog' : 'English'} onPress={() => setVisible(true)} />}
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!saving) setVisible(false); }}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <ThemedText type="title2">Language / Wika</ThemedText>
          <ThemedText type="body">{t('Choose your preferred language')}</ThemedText>
          {(['en', 'fil'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: locale === value, disabled: saving }} disabled={saving} onPress={() => void choose(value)} style={[styles.option, { backgroundColor: locale === value ? theme.brandTint : theme.elementBg }]}>
            <View style={styles.copy}>
              <ThemedText type="headline">{value === 'en' ? 'English' : 'Tagalog'}</ThemedText>
              {value === 'fil' && <ThemedText type="footnote" themeColor="textSecondary">Simpleng Tagalog na may English words na madalas gamitin</ThemedText>}
            </View>
            {locale === value && <Icon name="checkmark" size={20} tintColor={theme.brand} />}
          </Pressable>)}
          {error && <ThemedText accessibilityRole="alert" type="footnote" themeColor="riskCritical">{t('Could not save the language. Please try again.')}</ThemedText>}
          <Button label={t('Cancel')} variant="ghost" disabled={saving} loading={saving} onPress={() => setVisible(false)} />
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  compact: { minHeight: 44, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: Space.base },
  backdrop: { flex: 1, backgroundColor: 'rgba(33,26,21,0.35)', justifyContent: 'center', padding: Space.xl },
  sheet: { width: '100%', maxWidth: 430, alignSelf: 'center', borderRadius: Radius.xl, padding: Space.xl, gap: Space.base },
  option: { minHeight: 58, borderRadius: Radius.md, padding: Space.base, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  copy: { flex: 1, gap: Space.xs },
});
