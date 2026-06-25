import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

export type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  /** Renders a password field with a show/hide toggle. */
  secure?: boolean;
  containerStyle?: ViewStyle | ViewStyle[];
};

export function TextField({
  label,
  error,
  secure = false,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secure);

  const borderColor = error ? theme.riskCritical : focused ? theme.brand : 'transparent';

  return (
    <View style={containerStyle}>
      {label ? (
        <ThemedText type="subhead" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <View
        style={[
          styles.field,
          { backgroundColor: theme.elementBg, borderColor, borderWidth: 1.5 },
        ]}>
        <TextInput
          placeholderTextColor={theme.muted}
          secureTextEntry={hidden}
          style={[styles.input, { color: theme.text }, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {secure ? (
          <Pressable
            hitSlop={10}
            onPress={() => setHidden((h) => !h)}
            style={styles.toggle}
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <SymbolView name={hidden ? 'eye' : 'eye.slash'} tintColor={theme.muted} size={18} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
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
  input: { flex: 1, ...Type.body, paddingVertical: 0 },
  toggle: { paddingLeft: Space.sm },
  error: { marginTop: Space.xs },
});
