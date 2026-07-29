import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import type { Sex } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { saveProfile } from '@/lib/profile';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const SKIN_TYPE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: '1', label: 'Type I', description: 'Always burns, never tans' },
  { value: '2', label: 'Type II', description: 'Usually burns, tans minimally' },
  { value: '3', label: 'Type III', description: 'Sometimes burns, tans uniformly' },
  { value: '4', label: 'Type IV', description: 'Rarely burns, tans easily' },
  { value: '5', label: 'Type V', description: 'Very rarely burns, tans easily' },
  { value: '6', label: 'Type VI', description: 'Never burns' },
];

export default function EditProfileScreen() {
  const theme = useTheme();
  const { user, setUser } = useAuth();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [dob, setDob] = useState<string | null>(user?.date_of_birth ?? null);
  const [sex, setSex] = useState<Sex | null>((user?.sex as Sex | null) ?? null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [skinType, setSkinType] = useState<string | null>(
    user?.fitzpatrick_skin_type != null ? String(user.fitzpatrick_skin_type) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ dob?: string; sex?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  function validate() {
    const next: typeof errors = {};
    if (!dob) next.dob = 'Enter a valid date of birth.';
    if (!sex) next.sex = 'Please select one.';
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^(\+63|0)9\d{9}$/.test(trimmedPhone)) {
      next.phone = 'Enter a valid PH mobile number (e.g. 09xx xxx xxxx).';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate() || !dob || !sex) return;
    setSubmitting(true);
    try {
      const { user: saved, failedFields } = await saveProfile({
        fullName,
        dateOfBirth: dob,
        sex,
        phone,
        fitzpatrickSkinType: skinType ? Number(skinType) : undefined,
      });
      setUser(saved);
      if (failedFields.length > 0) {
        Alert.alert('Profile saved', 'Profile saved, but some fields could not be updated.');
      }
      router.back();
    } catch {
      setFormError("Couldn't save your details. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen variant="gradient" gradient="dawnSoft">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable
              hitSlop={12}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back">
              <Icon name="chevron.left" tintColor={theme.brand} size={20} />
            </Pressable>
            <ThemedText type="title1">Edit profile</ThemedText>
          </View>

          <View style={styles.form}>
            <TextField label="Full name" placeholder="Your name" value={fullName} onChangeText={setFullName} />
            <DateField label="Date of birth" value={dob} onChange={setDob} error={errors.dob} />
            <Accordion
              label="Sex"
              placeholder="Select"
              value={sex}
              options={SEX_OPTIONS}
              onChange={setSex}
              error={errors.sex}
            />
            <TextField
              label="Phone number"
              placeholder="09xx xxx xxxx"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
              error={errors.phone}
            />
            <Accordion
              label="Skin type"
              placeholder="Select"
              value={skinType}
              options={SKIN_TYPE_OPTIONS}
              onChange={setSkinType}
            />
          </View>

          <View style={styles.actions}>
            {formError ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.center}>
                {formError}
              </ThemedText>
            ) : null}
            <Button label="Save changes" variant="brand" loading={submitting} onPress={handleSubmit} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingTop: Space.lg, paddingBottom: Space.xl, gap: Space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  form: { gap: Space.xl },
  actions: { marginTop: 'auto', gap: Space.sm, paddingTop: Space.xl },
  center: { textAlign: 'center' },
});
