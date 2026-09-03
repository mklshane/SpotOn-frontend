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
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  getEmailError,
  getFullNameError,
  getLocalPhoneError,
  getRegistrationPasswordError,
  sanitizeName,
} from '@/lib/form-validation';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const theme = useTheme();
  const [mode, setMode] = useState<IdentifierMode>('phone');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isAdult, setIsAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    name?: string;
    identifier?: string;
    password?: string;
    isAdult?: string;
    acceptedTerms?: string;
  }>({});

  function getIdentifierError(value = identifier, identifierMode = mode) {
    const id = value.trim();
    if (identifierMode === 'phone') return getLocalPhoneError(id);
    return getEmailError(id);
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
    next.name = getFullNameError(name);
    next.identifier = getIdentifierError();
    next.password = getRegistrationPasswordError(password);
    if (!isAdult) next.isAdult = 'Please confirm you are 18 or older.';
    if (!acceptedTerms)
      next.acceptedTerms = 'Please accept the Terms and Privacy Policy to continue.';
    if (!next.name) delete next.name;
    if (!next.identifier) delete next.identifier;
    if (!next.password) delete next.password;
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
      consent: isAdult && acceptedTerms,
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
              autoComplete="name"
              inputMode="text"
              textContentType="name"
              maxLength={100}
              value={name}
              onChangeText={(value) => {
                setName(value);
                setFormError(null);
                if (errors.name) {
                  setErrors((current) => ({
                    ...current,
                    name: getFullNameError(value),
                  }));
                }
              }}
              onBlur={() =>
                setErrors((current) => ({
                  ...current,
                  name: getFullNameError(name),
                }))
              }
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
              autoComplete="new-password"
              textContentType="newPassword"
              maxLength={128}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFormError(null);
                if (errors.password) {
                  setErrors((current) => ({
                    ...current,
                    password: getRegistrationPasswordError(value),
                  }));
                }
              }}
              onBlur={() =>
                setErrors((current) => ({
                  ...current,
                  password: getRegistrationPasswordError(password),
                }))
              }
              error={errors.password}
            />
          </View>

          <View style={styles.actions}>
            <View style={styles.consent}>
              <View
                style={[
                  styles.notice,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.hairline },
                ]}>
                <ThemedText type="footnote" style={styles.noticeTitle}>
                  Before you continue
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.noticeBody}>
                  SpotOn is an academic research prototype and is not a medical device or
                  diagnostic tool. Its results may be inaccurate and should not replace
                  consultation with a healthcare professional.
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.noticeBody}>
                  By creating an account, you acknowledge the{' '}
                  <ThemedText
                    type="footnote"
                    themeColor="brand"
                    style={styles.inlineLink}
                    onPress={() => router.push('/profile/terms')}>
                    Terms and Conditions
                  </ThemedText>{' '}
                  and{' '}
                  <ThemedText
                    type="footnote"
                    themeColor="brand"
                    style={styles.inlineLink}
                    onPress={() => router.push('/profile/privacy')}>
                    Privacy Policy
                  </ThemedText>{' '}
                  and consent to the collection and processing of your information as described
                  in the Privacy Policy.
                </ThemedText>
              </View>

              <Checkbox
                checked={isAdult}
                onChange={(checked) => {
                  setIsAdult(checked);
                  if (checked) {
                    setErrors((current) => ({ ...current, isAdult: undefined }));
                  }
                }}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  I confirm that I am 18 years old or older.
                </ThemedText>
              </Checkbox>
              {errors.isAdult ? (
                <ThemedText type="footnote" themeColor="riskCritical" style={styles.consentError}>
                  {errors.isAdult}
                </ThemedText>
              ) : null}

              <Checkbox
                checked={acceptedTerms}
                onChange={(checked) => {
                  setAcceptedTerms(checked);
                  if (checked) {
                    setErrors((current) => ({ ...current, acceptedTerms: undefined }));
                  }
                }}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  I have read and agree to the{' '}
                  <ThemedText
                    type="footnote"
                    themeColor="brand"
                    style={styles.inlineLink}
                    onPress={() => router.push('/profile/terms')}>
                    Terms and Conditions
                  </ThemedText>{' '}
                  and{' '}
                  <ThemedText
                    type="footnote"
                    themeColor="brand"
                    style={styles.inlineLink}
                    onPress={() => router.push('/profile/privacy')}>
                    Privacy Policy
                  </ThemedText>
                  , and consent to the processing of my health data for screening.
                </ThemedText>
              </Checkbox>
              {errors.acceptedTerms ? (
                <ThemedText type="footnote" themeColor="riskCritical" style={styles.consentError}>
                  {errors.acceptedTerms}
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
  consent: { gap: Space.md, marginBottom: Space.xs },
  notice: { borderWidth: 1, borderRadius: Radius.md, padding: Space.base, gap: Space.xs },
  noticeTitle: { fontWeight: '700' },
  noticeBody: { lineHeight: 18 },
  consentError: { marginLeft: Space.xl + Space.md },
  inlineLink: { fontWeight: '600' },
  center: { textAlign: 'center' },
  actions: { marginTop: 'auto', gap: Space.lg },
  footnoteRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footnoteLink: { fontWeight: '600' },
});
