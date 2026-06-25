import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

export type IdentifierMode = 'email' | 'phone';

/** Build the value to send to the API. Phone → E.164 (+63…). */
export function buildIdentifier(mode: IdentifierMode, value: string): string {
  if (mode === 'email') return value.trim();
  const digits = value.replace(/\D/g, '').replace(/^0/, '');
  return '+63' + digits;
}

export type IdentifierFieldProps = {
  mode: IdentifierMode;
  value: string;
  onChangeValue: (v: string) => void;
  onToggleMode: () => void;
  error?: string;
  containerStyle?: ViewStyle | ViewStyle[];
};

export function IdentifierField({
  mode,
  value,
  onChangeValue,
  onToggleMode,
  error,
  containerStyle,
}: IdentifierFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const isPhone = mode === 'phone';
  const borderColor = error ? theme.riskCritical : focused ? theme.brand : 'transparent';

  return (
    <View style={containerStyle}>
      <ThemedText type="subhead" themeColor="textSecondary" style={styles.label}>
        {isPhone ? 'Phone number' : 'Email'}
      </ThemedText>

      <View style={[styles.field, { backgroundColor: theme.elementBg, borderColor, borderWidth: 1.5 }]}>
        {isPhone ? (
          <>
            <ThemedText type="body">+63</ThemedText>
            <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
          </>
        ) : null}
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder={isPhone ? '912 345 6789' : 'you@email.com'}
          placeholderTextColor={theme.muted}
          keyboardType={isPhone ? 'phone-pad' : 'email-address'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isPhone ? 'tel' : 'email'}
          textContentType={isPhone ? 'telephoneNumber' : 'emailAddress'}
          value={value}
          onChangeText={onChangeValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>

      <View style={styles.footerRow}>
        {error ? (
          <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
            {error}
          </ThemedText>
        ) : (
          <View />
        )}
        <Pressable hitSlop={8} onPress={onToggleMode} accessibilityRole="button">
          <ThemedText type="footnote" themeColor="brand" style={styles.toggle}>
            {isPhone ? 'Use email instead' : 'Use phone instead'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: Space.sm },
  field: {
    height: 54,
    borderRadius: Radius.md,
    paddingHorizontal: Space.base,
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: Space.md,
    marginHorizontal: Space.md,
  },
  input: { flex: 1, ...Type.body, paddingVertical: 0 },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Space.xs,
  },
  error: { flex: 1 },
  toggle: { fontWeight: '600' },
});
