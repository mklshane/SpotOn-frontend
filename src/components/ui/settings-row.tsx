import * as Linking from "expo-linking";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import { ThemedText } from "../themed-text";
import { Icon, type IconName } from "./icon";
import { IconCircle } from "./icon-circle";
import { Switch } from "./switch";

export type SettingsRowProps = {
  icon: IconName;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  /**
   * `'chevron'` (default) shows a nav arrow. `'switch'` renders a `Switch` wired
   * to `switchValue`/`onSwitchChange` and the row's own `onPress` is ignored (no
   * nested-touchable conflict). Any other `ReactNode` (including `null` for a
   * plain informational row) is rendered as-is — an interactive `ReactNode`
   * accessory is the caller's responsibility to keep out of the row's own
   * touch target.
   */
  accessory?: "chevron" | "switch" | ReactNode;
  switchValue?: boolean;
  onSwitchChange?: (next: boolean) => void;
  /** Renders the label and icon tint in the critical/danger color (e.g. "Delete account"). */
  destructive?: boolean;
};

export function SettingsRow({
  icon,
  label,
  sublabel,
  onPress,
  accessory = "chevron",
  switchValue = false,
  onSwitchChange,
  destructive = false,
}: SettingsRowProps) {
  const theme = useTheme();

  let accessoryNode: ReactNode;
  if (accessory === "chevron") {
    accessoryNode = (
      <Icon name="chevron.right" tintColor={theme.muted} size={18} />
    );
  } else if (accessory === "switch") {
    accessoryNode = (
      <Switch value={switchValue} onChange={(next) => onSwitchChange?.(next)} />
    );
  } else {
    accessoryNode = accessory;
  }

  const isInteractive = accessory !== "switch" && Boolean(onPress);

  return (
    <Pressable
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      accessibilityRole={isInteractive ? "button" : undefined}
      style={({ pressed }) => [
        styles.row,
        pressed && isInteractive && styles.pressed,
      ]}
    >
      <IconCircle
        icon={icon}
        variant="tint"
        size={44}
        iconColor={destructive ? theme.riskCritical : undefined}
        tintBg={destructive ? theme.riskCriticalBg : undefined}
      />
      <View style={styles.text}>
        <ThemedText
          type="headline"
          themeColor={destructive ? "riskCritical" : "text"}
        >
          {label}
        </ThemedText>
        {sublabel ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {sublabel}
          </ThemedText>
        ) : null}
      </View>
      {accessoryNode}
    </Pressable>
  );
}

export type ContactLinkProps = {
  /** The address to open in the device's mail client, e.g. "help.spoton@gmail.com". */
  email: string;
  /** Optional display text. Defaults to the email address itself. */
  label?: string;
  /** Optional subject line pre-filled in the composed email. */
  subject?: string;
};

/**
 * A small inline, tappable email link — brand-colored, underlined, with a
 * leading mail icon. Meant to sit inside body copy (e.g. a "Contact us"
 * paragraph) rather than in a settings list, unlike `SettingsRow`.
 */
export function ContactLink({ email, label, subject }: ContactLinkProps) {
  const theme = useTheme();
  const href = subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${email}`;

  return (
    <Pressable
      onPress={() => Linking.openURL(href)}
      accessibilityRole="link"
      accessibilityLabel={`Email ${email}`}
      hitSlop={6}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Icon name="envelope.fill" tintColor={theme.brand} size={14} />
      <ThemedText type="subhead" themeColor="brand" style={styles.linkText}>
        {label ?? email}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.base,
    paddingVertical: Space.md,
  },
  text: { flex: 1, gap: 2 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: Space.xs,
  },
  linkText: {
    textDecorationLine: "underline",
  },
  pressed: { opacity: 0.7 },
});
