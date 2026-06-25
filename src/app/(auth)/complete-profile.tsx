import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import type { Sex } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { saveProfile } from '@/lib/profile';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export default function CompleteProfileScreen() {
  const { user } = useAuth();
  // Already captured at sign-up if they registered by phone — don't ask again.
  const hasPhone = Boolean(user?.phone);
  const [dob, setDob] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ dob?: string; sex?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  function validate() {
    const next: typeof errors = {};
    if (!dob) next.dob = 'Enter a valid date of birth.';
    if (!sex) next.sex = 'Please select one.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate() || !dob || !sex) return;
    setSubmitting(true);
    try {
      await saveProfile({ dateOfBirth: dob, sex, phone: hasPhone ? undefined : phone });
      router.replace('/home');
    } catch {
      setFormError("Couldn't save your details. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title1">Tell us about you</ThemedText>
            <ThemedText type="body" themeColor="textSecondary">
              A few details to personalize your screening. This stays private to you.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <DateField label="Date of birth" onChange={setDob} error={errors.dob} />

            <Select
              label="Sex"
              placeholder="Select"
              value={sex}
              options={SEX_OPTIONS}
              onChange={setSex}
              error={errors.sex}
            />

            {hasPhone ? null : (
              <TextField
                label="Phone number (optional)"
                placeholder="09xx xxx xxxx"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                value={phone}
                onChangeText={setPhone}
              />
            )}
          </View>

          <View style={styles.actions}>
            {formError ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.center}>
                {formError}
              </ThemedText>
            ) : null}
            <Button label="Continue" variant="brand" loading={submitting} onPress={handleSubmit} />
            <Button
              label="Skip for now"
              variant="ghost"
              onPress={() => router.replace('/home')}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingTop: Space.xxl, paddingBottom: Space.xl, gap: Space.xxl },
  header: { gap: Space.md },
  form: { gap: Space.xl },
  actions: { marginTop: 'auto', gap: Space.sm },
  center: { textAlign: 'center' },
});
