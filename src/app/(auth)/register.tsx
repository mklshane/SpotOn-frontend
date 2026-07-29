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
import { Checkbox } from '@/components/ui/checkbox';
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
import { getLocalPhoneError, sanitizeName } from '@/lib/form-validation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [mode, setMode] = useState<IdentifierMode>('phone');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    name?: string;
    identifier?: string;
    password?: string;
    consent?: string;
  }>({});

  function getIdentifierError(value = identifier, identifierMode = mode) {
    const id = value.trim();
    if (identifierMode === 'phone') return getLocalPhoneError(id);
    if (!id) return 'Email address is required.';
    return EMAIL_RE.test(id) ? undefined : 'Enter a valid email address.';
  }

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    setFormError(null);
    if (errors.identifier) {
      setErrors((current) => ({
        ...current,
        identifier: getIdentifierError(value),
      }));
    }
  }

  function toggleMode() {
    setMode((currentMode) => (currentMode === 'email' ? 'phone' : 'email'));
    setIdentifier('');
    setFormError(null);
    setErrors((e) => ({ ...e, identifier: undefined }));
  }

  function validate() {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Please enter your name.';
    next.identifier = getIdentifierError();
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    if (!consent) next.consent = 'Please agree to continue.';
    if (!next.identifier) delete next.identifier;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    const id = buildIdentifier(mode, identifier);
    const { error } = await signUp({
      password,
      full_name: name.trim(),
      consent,
      ...(mode === 'email' ? { email: id } : { phone: id }),
    });
    setSubmitting(false);
    if (error) {
      setFormError(error);
      return;
    }
    router.replace('/(auth)/complete-profile');
  }

  return (
    <Screen variant="gradient" gradient="dawnSoft">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Logo variant="wordmark" width={140} />
            <ThemedText type="title1" style={styles.title}>
              Create your account
            </ThemedText>
            <ThemedText type="body" themeColor="textSecondary">
              A few details and you’re ready to start screening.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Full name"
              placeholder="Juan dela Cruz"
              autoCapitalize="words"
              inputMode="text"
              textContentType="name"
              value={name}
              onChangeText={(value) => {
                setName(value);
                setFormError(null);
                if (errors.name && value.trim()) {
                  setErrors((current) => ({ ...current, name: undefined }));
                }
              }}
              transformInput={sanitizeName}
              error={errors.name}
            />

            <IdentifierField
              mode={mode}
              value={identifier}
              onChangeValue={handleIdentifierChange}
              onToggleMode={toggleMode}
              onBlur={() =>
                setErrors((current) => ({
                  ...current,
                  identifier: getIdentifierError(),
                }))
              }
              error={errors.identifier}
              containerStyle={styles.identifier}
            />

            <TextField
              label="Password"
              placeholder="At least 8 characters"
              secure
              autoCapitalize="none"
              textContentType="newPassword"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFormError(null);
                if (errors.password && value.length >= 8) {
                  setErrors((current) => ({ ...current, password: undefined }));
                }
              }}
              error={errors.password}
            />
          </View>

          <View style={styles.actions}>
            <View style={styles.consent}>
              <Checkbox
                checked={consent}
                onChange={(checked) => {
                  setConsent(checked);
                  if (checked) {
                    setErrors((current) => ({ ...current, consent: undefined }));
                  }
                }}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  I agree to SpotOn’s{' '}
                  <ThemedText type="footnote" themeColor="brand" style={styles.inlineLink}>
                    Privacy Policy
                  </ThemedText>{' '}
                  and to processing my health data for screening.
                </ThemedText>
              </Checkbox>
              {errors.consent ? (
                <ThemedText type="footnote" themeColor="riskCritical" style={styles.consentError}>
                  {errors.consent}
                </ThemedText>
              ) : null}
            </View>
            {formError ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.center}>
                {formError}
              </ThemedText>
            ) : null}
            <Button label="Create account" variant="brand" loading={submitting} onPress={handleSubmit} />
            <View style={styles.footnoteRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Already have an account?{' '}
              </ThemedText>
              <Link href="/(auth)/login" asChild>
                <Pressable hitSlop={8}>
                  <ThemedText type="footnote" themeColor="brand" style={styles.footnoteLink}>
                    Sign in
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
  consent: { gap: Space.xs, marginBottom: Space.xs },
  consentError: { marginLeft: Space.xl + Space.md },
  inlineLink: { fontWeight: '600' },
  center: { textAlign: 'center' },
  actions: { marginTop: 'auto', gap: Space.lg },
  footnoteRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footnoteLink: { fontWeight: '600' },
});
