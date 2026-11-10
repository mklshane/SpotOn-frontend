import { t, useLocale } from "@/lib/i18n";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import Animated, { FadeIn } from "react-native-reanimated";

import { Elevation, Radius, Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { MIN_BACKUP_PASSWORD } from "@/lib/backup/core";

import { ThemedText } from "./themed-text";
import { Button } from "./ui/button";
import { IconCircle } from "./ui/icon-circle";
import { TextField } from "./ui/text-field";

export type BackupPasswordDialogProps = {
  visible: boolean;
  /** `create` asks twice (making a backup); `enter` asks once (restoring one). */
  mode: "create" | "enter";
  /** Keeps the dialog up with a spinner while the file is encrypted or decrypted. */
  loading?: boolean;
  /** Shown under the fields while loading, e.g. "Unlocking… 40%". */
  status?: string | null;
  /** An error from the caller, e.g. a wrong password. */
  error?: string | null;
  /** The user is typing again - the caller should clear `error`. */
  onEdit?: () => void;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

/**
 * Password prompt for backup files. Same card and backdrop as ConfirmDialog.
 *
 * There is no way to recover a forgotten backup password - the key never leaves the file's owner -
 * so `create` mode says so plainly and makes the user type the password twice.
 */
export function BackupPasswordDialog(props: BackupPasswordDialogProps) {
  const dismiss = props.loading ? () => {} : props.onCancel;
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      {/* Mounted only while open, so a typed password never outlives the dialog. */}
      {props.visible ? <DialogBody {...props} dismiss={dismiss} /> : null}
    </Modal>
  );
}

function DialogBody({
  mode,
  loading = false,
  status,
  error,
  onEdit,
  onSubmit,
  onCancel,
  dismiss,
}: BackupPasswordDialogProps & { dismiss: () => void }) {
  useLocale();
  const theme = useTheme();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    if (loading) return;
    if (mode === "create") {
      if (password.length < MIN_BACKUP_PASSWORD) {
        setLocalError(t("Use at least 8 characters."));
        return;
      }
      if (password !== confirm) {
        setLocalError(t("The passwords don't match."));
        return;
      }
    } else if (!password) {
      setLocalError(t("Enter the backup password."));
      return;
    }
    setLocalError(null);
    onSubmit(password);
  }

  const shownError = localError ?? error;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Pressable
        style={styles.backdrop}
        onPress={dismiss}
        accessibilityLabel={t("Dismiss")}
      >
        <Animated.View entering={FadeIn.duration(160)} style={styles.cardWrap}>
          <Pressable
            style={[
              styles.card,
              { backgroundColor: theme.surface },
              Elevation.lg,
            ]}
          >
            <IconCircle
              icon={mode === "create" ? "lock.fill" : "arrow.down.doc.fill"}
              size={64}
            />

            <View style={styles.copy}>
              <ThemedText type="title2" style={styles.center}>
                {mode === "create"
                  ? t("Protect your backup")
                  : t("Unlock your backup")}
              </ThemedText>
              <ThemedText
                type="callout"
                themeColor="textSecondary"
                style={styles.center}
              >
                {mode === "create"
                  ? t(
                      "Your backup has your photos and answers, so it's locked with a password. If you forget this password, the backup can't be opened - not even by us.",
                    )
                  : t("Enter the password you set when you made this backup.")}
              </ThemedText>
            </View>

            <View style={styles.fields}>
              <TextField
                label={mode === "create" ? t("Backup password") : t("Password")}
                secure
                textContentType={mode === "create" ? "newPassword" : "password"}
                autoFocus
                editable={!loading}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setLocalError(null);
                  onEdit?.();
                }}
                onSubmitEditing={mode === "enter" ? submit : undefined}
              />
              {mode === "create" ? (
                <TextField
                  label={t("Confirm password")}
                  secure
                  textContentType="newPassword"
                  editable={!loading}
                  value={confirm}
                  onChangeText={(v) => {
                    setConfirm(v);
                    setLocalError(null);
                  }}
                  onSubmitEditing={submit}
                />
              ) : null}
              {shownError ? (
                <ThemedText type="footnote" themeColor="riskCritical">
                  {shownError}
                </ThemedText>
              ) : loading && status ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {status}
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button
                label={mode === "create" ? t("Create backup") : t("Unlock")}
                variant="brand"
                loading={loading}
                onPress={submit}
                style={styles.action}
              />
              <Button
                label={t("Cancel")}
                variant="ghost"
                disabled={loading}
                onPress={onCancel}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(33,26,21,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: Space.xl,
  },
  cardWrap: { width: "100%", maxWidth: 400 },
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Space.xl,
    paddingTop: Space.xl,
    paddingBottom: Space.base,
    alignItems: "center",
    gap: Space.lg,
  },
  copy: { gap: Space.sm },
  center: { textAlign: "center" },
  fields: { alignSelf: "stretch", gap: Space.base },
  actions: { alignSelf: "stretch", gap: Space.xs },
  action: { alignSelf: "stretch" },
});
