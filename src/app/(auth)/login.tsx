import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import {
  buildIdentifier,
  IdentifierField,
  type IdentifierMode,
} from '@/components/ui/identifier-field';
import { Logo } from '@/components/ui/logo';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { routeAfterAuth } from '@/lib/profile';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<IdentifierMode>('phone');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});

  function toggleMode() {
    setMode((m) => (m === 'email' ? 'phone' : 'email'));
    setIdentifier('');
    setErrors((e) => ({ ...e, identifier: undefined }));
  }

  function validate() {
    const next: typeof errors = {};
    const id = identifier.trim();
    if (mode === 'email') {
      if (!EMAIL_RE.test(id)) next.identifier = 'Enter a valid email address.';
    } else if (id.replace(/\D/g, '').length < 10) {
      next.identifier = 'Enter a valid phone number.';
    }
    if (!password) next.password = 'Please enter your password.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    const { error } = await signIn(buildIdentifier(mode, identifier), password);
    if (error) {
      setSubmitting(false);
      setFormError(error);
      return;
    }
    const next = await routeAfterAuth();
    setSubmitting(false);
    router.replace(next);
  }

  return (
    <Screen variant="gradient" gradient="dawnSoft">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Logo variant="wordmark" width={140} />
            <ThemedText type="title1" style={styles.title}>
              Welcome back
            </ThemedText>
            <ThemedText type="body" themeColor="textSecondary">
              Sign in to pick up where you left off.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <IdentifierField
              mode={mode}
              value={identifier}
              onChangeValue={setIdentifier}
              onToggleMode={toggleMode}
              error={errors.identifier}
              containerStyle={styles.identifier}
            />
            <TextField
              label="Password"
              placeholder="Your password"
              secure
              autoCapitalize="none"
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              error={errors.password}
            />
          </View>

          <View style={styles.actions}>
            {formError ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.center}>
                {formError}
              </ThemedText>
            ) : null}
            <Button
              label="Sign in"
              variant="brand"
              loading={submitting}
              onPress={handleSubmit}
            />
            <View style={styles.footnoteRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                New here?{' '}
              </ThemedText>
              <Link href="/(auth)/register" asChild>
                <Pressable hitSlop={8}>
                  <ThemedText type="footnote" themeColor="brand" style={styles.footnoteLink}>
                    Create an account
                  </ThemedText>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingTop: Space.xxl, paddingBottom: Space.xl, gap: Space.xxxl },
  header: { gap: Space.md },
  title: { marginTop: Space.sm },
  form: { gap: Space.lg },
  identifier: { marginBottom: -Space.md },
  actions: { marginTop: 'auto', gap: Space.lg },
  center: { textAlign: 'center' },
  footnoteRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footnoteLink: { fontWeight: '600' },
});
