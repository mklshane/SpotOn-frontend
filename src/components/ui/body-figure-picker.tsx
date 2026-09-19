import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  defaultVariantForSex,
  useBodyVariant,
  writeBodyVariantOverride,
  type BodyVariant,
} from '@/lib/body-variant';
import { t, useLocale } from '@/lib/i18n';
import { ThemedText } from '../themed-text';
import { Button } from './button';
import { Icon } from './icon';
import { SettingsRow } from './settings-row';

/** `null` is "match my profile" - no override stored. */
type Choice = BodyVariant | null;

const figureLabel = (v: BodyVariant) => (v === 'female' ? t('Female figure') : t('Male figure'));

/**
 * Settings row + sheet for the body figure used by the 3D body map. Same shape as LanguagePicker.
 * The profile's sex picks the default (see defaultVariantForSex); this is the override for anyone
 * the default does not suit, and "Match my profile" clears it.
 */
export function BodyFigurePicker() {
  useLocale();
  const theme = useTheme();
  const { user } = useAuth();
  const { variant, override } = useBodyVariant();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const profileDefault = defaultVariantForSex(user?.sex);
  const options: { value: Choice; label: string; hint?: string }[] = [
    { value: null, label: t('Match my profile'), hint: figureLabel(profileDefault) },
    { value: 'male', label: t('Male figure') },
    { value: 'female', label: t('Female figure') },
  ];

  async function choose(next: Choice) {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await writeBodyVariantOverride(next);
      setVisible(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return <>
    <SettingsRow icon="figure.stand" label={t('Body figure')} sublabel={figureLabel(variant)} onPress={() => setVisible(true)} />
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!saving) setVisible(false); }}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <ThemedText type="title2">{t('Body figure')}</ThemedText>
          <ThemedText type="body">{t('The body shown when you mark where a spot is.')}</ThemedText>
          {options.map(({ value, label, hint }) => {
            const checked = override === value;
            return <Pressable key={value ?? 'profile'} accessibilityRole="radio" accessibilityState={{ checked, disabled: saving }} aria-checked={checked} disabled={saving} onPress={() => void choose(value)} style={[styles.option, { backgroundColor: checked ? theme.brandTint : theme.elementBg }]}>
              <View style={styles.copy}>
                <ThemedText type="headline">{label}</ThemedText>
                {hint && <ThemedText type="footnote" themeColor="textSecondary">{hint}</ThemedText>}
              </View>
              {checked && <Icon name="checkmark" size={20} tintColor={theme.brand} />}
            </Pressable>;
          })}
          {error && <ThemedText accessibilityRole="alert" type="footnote" themeColor="riskCritical">{t('Could not save the body figure. Please try again.')}</ThemedText>}
          <Button label={t('Cancel')} variant="ghost" disabled={saving} loading={saving} onPress={() => setVisible(false)} />
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(33,26,21,0.35)', justifyContent: 'center', padding: Space.xl },
  sheet: { width: '100%', maxWidth: 430, alignSelf: 'center', borderRadius: Radius.xl, padding: Space.xl, gap: Space.base },
  option: { minHeight: 58, borderRadius: Radius.md, padding: Space.base, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  copy: { flex: 1, gap: Space.xs },
});
