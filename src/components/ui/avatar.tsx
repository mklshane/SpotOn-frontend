import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { ThemedText } from "../themed-text";

export type AvatarProps = {
  /** Local or remote image URI. Falls back to initials when omitted. */
  uri?: string | null;
  /** Full name used to derive fallback initials. */
  name?: string;
  size?: number;
};

function getInitials(name?: string): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Circular profile photo, or a colored initials fallback when there's no photo yet. */
export function Avatar({ uri, name, size = 88 }: AvatarProps) {
  const theme = useTheme();
  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        contentFit="cover"
        transition={150}
        style={[dimensions, { backgroundColor: theme.brandTint }]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        dimensions,
        { backgroundColor: theme.brandTint },
      ]}
    >
      <ThemedText
        type="title2"
        themeColor="brand"
        style={{ fontSize: size * 0.36 }}
      >
        {getInitials(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
});
