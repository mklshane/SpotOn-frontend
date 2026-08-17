import { Icon } from '@/components/ui/icon';
import { useRef, useState } from 'react';
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
  /** Filters disallowed characters before forwarding the value to the form state. */
  transformInput?: (value: string) => string;
  containerStyle?: ViewStyle | ViewStyle[];
  /** Overrides the field's fill color. Defaults to `theme.elementBg`. */
  fieldBackgroundColor?: string;
  /** Pins the border to a fixed color regardless of focus/error state — for callers that need
   *  the field to carry its own status color (e.g. a tier-colored rename field). */
  fieldBorderColor?: string;
};

export function TextField({
  label,
  error,
  secure = false,
  transformInput,
  containerStyle,
  fieldBackgroundColor,
  fieldBorderColor,
  style,
  onFocus,
  onBlur,
  onChangeText,
  onKeyPress,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secure);

  const borderColor =
    fieldBorderColor ?? (error ? theme.riskCritical : focused ? theme.brand : theme.hairline);

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
          { backgroundColor: fieldBackgroundColor ?? theme.elementBg, borderColor, borderWidth: 1.5 },
        ]}>
        <TextInput
          ref={inputRef}
          placeholderTextColor={theme.muted}
          secureTextEntry={hidden}
          style={[styles.input, { color: theme.text }, style]}
          onChangeText={(value) => {
            const transformedValue = transformInput?.(value) ?? value;

            // Keep the native value in sync immediately. Waiting for the controlled
            // value render can briefly flash a rejected character on the screen.
            if (transformedValue !== value) {
              inputRef.current?.setNativeProps({ text: transformedValue });
            }
            onChangeText?.(transformedValue);
          }}
          onKeyPress={(event) => {
            const key = event.nativeEvent.key;
            if (transformInput && key.length === 1 && transformInput(key) !== key) {
              event.preventDefault();
            }
            onKeyPress?.(event);
          }}
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
            <Icon name={hidden ? 'eye' : 'eye.slash'} tintColor={theme.muted} size={18} />
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
