import { t, localizedCopy, useLocale } from '@/lib/i18n';
import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import type { Sex, YesNoUnsure } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Accordion } from "@/components/ui/accordion";
import { AvatarPicker } from "@/components/ui/avatar-picker";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { TextField } from "@/components/ui/text-field";
import { Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { sanitizeName } from "@/lib/form-validation";
import { saveProfile } from "@/lib/profile";

const SEX_OPTIONS: { value: Sex; label: string }[] = localizedCopy([
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "intersex", label: "Intersex" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
]);

const SKIN_TYPE_OPTIONS: {
  value: string;
  label: string;
  description: string;
}[] = localizedCopy([
  { value: "1", label: "Type I", description: "Always burns, never tans" },
  {
    value: "2",
    label: "Type II",
    description: "Usually burns, tans minimally",
  },
  {
    value: "3",
    label: "Type III",
    description: "Sometimes burns, tans uniformly",
  },
  { value: "4", label: "Type IV", description: "Rarely burns, tans easily" },
  {
    value: "5",
    label: "Type V",
    description: "Very rarely burns, tans easily",
  },
  { value: "6", label: "Type VI", description: "Never burns" },
]);

// Optional risk factors (server 022). They tailor the result screen's "For you" notes and never
// change a result's urgency, so every one can be left blank.
const HISTORY_OPTIONS: { value: YesNoUnsure; label: string }[] = localizedCopy([
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
]);

const SUN_OPTIONS: { value: "yes" | "no"; label: string; description: string }[] = localizedCopy([
  { value: "yes", label: "Yes", description: "I work or spend long hours outdoors, or I sunburn easily" },
  { value: "no", label: "No", description: "Mostly indoors, and I rarely burn" },
]);

export default function EditProfileScreen() {
  useLocale();
  const theme = useTheme();
  const { user, setUser } = useAuth();

  const [fullName, setFullName] = useState(sanitizeName(user?.full_name ?? ""));
  const [dob, setDob] = useState<string | null>(user?.date_of_birth ?? null);
  const [sex, setSex] = useState<Sex | null>((user?.sex as Sex | null) ?? null);
  const phone = user?.phone ?? "";
  const [skinType, setSkinType] = useState<string | null>(
    user?.fitzpatrick_skin_type != null
      ? String(user.fitzpatrick_skin_type)
      : null,
  );
  const [personalHistory, setPersonalHistory] = useState<YesNoUnsure | null>(
    user?.personal_skin_cancer_history ?? null,
  );
  const [familyHistory, setFamilyHistory] = useState<YesNoUnsure | null>(
    user?.family_skin_cancer_history ?? null,
  );
  const [sunExposure, setSunExposure] = useState<"yes" | "no" | null>(
    user?.high_sun_exposure == null ? null : user.high_sun_exposure ? "yes" : "no",
  );
  const [avatarUri, setAvatarUri] = useState<string | null>(
    user?.avatar_url ?? null,
  );
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{
    fullName?: string;
    dob?: string;
    sex?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Errors are only recomputed on submit, so without this a corrected field keeps showing the
  // old message until the user presses Save again. Mirrors complete-profile.tsx.
  const clearError = (field: keyof typeof errors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  function validate() {
    const next: typeof errors = {};
    if (!fullName.trim()) next.fullName = "Please enter your name.";
    if (!dob) next.dob = "Enter a valid date of birth.";
    if (!sex) next.sex = "Please select one.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate() || !dob || !sex || !user) return;
    setSubmitting(true);
    try {
      const result = await saveProfile({
        fullName,
        dateOfBirth: dob,
        sex,
        fitzpatrickSkinType: skinType ? Number(skinType) : undefined,
        personalSkinCancerHistory: personalHistory ?? undefined,
        familySkinCancerHistory: familyHistory ?? undefined,
        highSunExposure: sunExposure == null ? undefined : sunExposure === "yes",
        avatarUri: avatarDirty ? avatarUri : undefined,
      }, user);
      setUser(result.user);
      if (result.status === 'rejected') {
        if (avatarDirty && result.user.avatar_url?.startsWith('file:')) {
          setAvatarUri(result.user.avatar_url);
          setAvatarDirty(false);
        }
        setFormError(result.error || t("Some changes couldn't be saved. Please try again."));
        return;
      }
      router.back();
    } catch (error) {
      console.warn('[profile] save failed before it could be queued:', error);
      setFormError(
        error instanceof Error ? error.message : t("Couldn't save your details. Check your connection and try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen variant="gradient" gradient="dawnSoft">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              hitSlop={12}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t("Back")}
            >
              <Icon name="chevron.left" tintColor={theme.brand} size={20} />
            </Pressable>
            <ThemedText type="title1">{t("Edit profile")}</ThemedText>
          </View>

          <AvatarPicker
            uri={avatarUri}
            name={fullName}
            onChange={(uri) => {
              setAvatarUri(uri);
              setAvatarDirty(true);
            }}
          />

          <View style={styles.form}>
            <TextField
              label={t("Full name")}
              placeholder={t("Your name")}
              inputMode="text"
              value={fullName}
              onChangeText={(value) => {
                setFullName(value);
                clearError('fullName');
              }}
              transformInput={sanitizeName}
              error={errors.fullName}
            />
            <DateField
              label={t("Date of birth")}
              value={dob}
              onChange={(value) => {
                setDob(value);
                clearError('dob');
              }}
              error={errors.dob}
            />
            <Accordion
              label={t("Sex")}
              placeholder={t("Select")}
              value={sex}
              options={SEX_OPTIONS}
              onChange={(value) => {
                setSex(value);
                clearError('sex');
              }}
              error={errors.sex}
            />
            <TextField
              label={t("Phone number")}
              placeholder={t("09xx xxx xxxx")}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              value={phone}
              editable={false}
              focusable={false}
              pointerEvents="none"
              accessibilityState={{ disabled: true }}
              style={{ color: theme.muted }}
            />
            <Accordion
              label={t("Skin type")}
              placeholder={t("Select")}
              value={skinType}
              options={SKIN_TYPE_OPTIONS}
              onChange={setSkinType}
            />
          </View>

          <View style={styles.form}>
            <View style={styles.groupHead}>
              <ThemedText type="headline">{t("Skin health background")}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {t("Optional. These help tailor the advice on your results. They never change how urgent a result is.")}
              </ThemedText>
            </View>
            <Accordion
              label={t("Have you had skin cancer before?")}
              placeholder={t("Select")}
              value={personalHistory}
              options={HISTORY_OPTIONS}
              onChange={setPersonalHistory}
            />
            <Accordion
              label={t("Has a parent, sibling, or child had skin cancer?")}
              placeholder={t("Select")}
              value={familyHistory}
              options={HISTORY_OPTIONS}
              onChange={setFamilyHistory}
            />
            <Accordion
              label={t("Do you get a lot of sun?")}
              placeholder={t("Select")}
              value={sunExposure}
              options={SUN_OPTIONS}
              onChange={setSunExposure}
            />
          </View>

          <View style={styles.actions}>
            {formError ? (
              <ThemedText
                type="footnote"
                themeColor="riskCritical"
                style={styles.center}
              >
                {formError}
              </ThemedText>
            ) : null}
            <Button
              label={t("Save changes")}
              variant="brand"
              loading={submitting}
              onPress={handleSubmit}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingTop: Space.lg,
    paddingBottom: Space.xl,
    gap: Space.xxl,
  },
  header: { flexDirection: "row", alignItems: "center", gap: Space.base },
  form: { gap: Space.xl },
  groupHead: { gap: Space.xs },
  actions: { marginTop: "auto", gap: Space.sm, paddingTop: Space.xl },
  center: { textAlign: "center" },
});
