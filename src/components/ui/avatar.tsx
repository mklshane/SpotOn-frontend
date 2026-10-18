import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { API_BASE_URL } from "@/config";
import { useTheme } from "@/hooks/use-theme";
import { getAccessToken } from "@/lib/auth-api";

import { ThemedText } from "../themed-text";

export type AvatarProps = {
  /** Local or remote image URI. Falls back to initials when omitted. */
  uri?: string | null;
  /** Full name used to derive fallback initials. */
  name?: string;
  size?: number;
  backgroundColor?: string;
  textColor?: string;
};

function getInitials(name?: string): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return "ME";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Circular profile photo, or a colored initials fallback when there's no photo yet. */
export function Avatar({ uri, name, size = 88, backgroundColor, textColor }: AvatarProps) {
  const theme = useTheme();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  const remotePrivate = uri?.startsWith("/me/avatar/") ?? false;
  const token = remotePrivate ? getAccessToken() : null;
  const sourceUri = remotePrivate ? `${API_BASE_URL}${uri}` : uri;
  const sourceKey = sourceUri ? `${sourceUri}:${token ?? ""}` : null;

  if (sourceUri && failedSource !== sourceKey && (!remotePrivate || token)) {
    return (
      <Image
        source={{ uri: sourceUri, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }}
        contentFit="cover"
        transition={150}
        onError={() => setFailedSource(sourceKey)}
        style={[dimensions, { backgroundColor: backgroundColor ?? theme.brandTint }]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        dimensions,
        { backgroundColor: backgroundColor ?? theme.brandTint },
      ]}
    >
      <ThemedText
        type="headline"
        style={{ color: textColor ?? theme.brand, fontSize: size * 0.30, lineHeight: size * 0.42, textAlign: "center", includeFontPadding: false }}
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
