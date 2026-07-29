import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { sanitizeLocalPhone } from '@/lib/form-validation';

import { ThemedText } from '../themed-text';

export type IdentifierMode = 'email' | 'phone';

/** Build the value to send to the API. Phone → E.164 (+63…). */
export function buildIdentifier(mode: IdentifierMode, value: string): string {
  if (mode === 'email') return value.trim();
  return `+63${sanitizeLocalPhone(value)}`;
}

export type IdentifierFieldProps = {
  mode: IdentifierMode;
  value: string;
  onChangeValue: (v: string) => void;
  onToggleMode: () => void;
  onBlur?: () => void;
  error?: string;
  containerStyle?: ViewStyle | ViewStyle[];
};

export function IdentifierField({
  mode,
  value,
  onChangeValue,
  onToggleMode,
  onBlur,
  error,
  containerStyle,
}: IdentifierFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const isPhone = mode === 'phone';
  const borderColor = error ? theme.riskCritical : focused ? theme.brand : theme.hairline;

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
          ref={inputRef}
          style={[styles.input, { color: theme.text }]}
          placeholder={isPhone ? '912 345 6789' : 'you@email.com'}
          placeholderTextColor={theme.muted}
          keyboardType={isPhone ? 'number-pad' : 'email-address'}
          inputMode={isPhone ? 'numeric' : 'email'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isPhone ? 'tel' : 'email'}
          textContentType={isPhone ? 'telephoneNumber' : 'emailAddress'}
          value={value}
          maxLength={isPhone ? 10 : undefined}
          onChangeText={(nextValue) => {
            const sanitizedValue = isPhone ? sanitizeLocalPhone(nextValue) : nextValue;

            // Correct the native value immediately so a rejected key never
            // flashes before the controlled value render catches up.
            if (sanitizedValue !== nextValue) {
              inputRef.current?.setNativeProps({ text: sanitizedValue });
            }
            onChangeValue(sanitizedValue);
          }}
          onKeyPress={(event) => {
            if (!isPhone) return;

            const key = event.nativeEvent.key;
            const isDigit = /^\d$/.test(key);
            const isAllowedFirstDigit = value.length > 0 || key === '9';
            if (key.length === 1 && (!isDigit || !isAllowedFirstDigit)) {
              event.preventDefault();
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
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
