import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import { ThemedText } from "../themed-text";
import { Icon } from "./icon";

export type DocumentHeaderProps = {
  title: string;
};

/**
 * The compact back-button + centered-title header shared by simple document
 * screens (stubs, Terms of Service, Privacy Policy, etc). Pulled out of
 * `StubScreen` so every screen in this family renders the identical header
 * instead of hand-copying it.
 */
export function DocumentHeader({ title }: DocumentHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.header}>
      <Pressable
        hitSlop={12}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Icon name="chevron.left" tintColor={theme.brand} size={20} />
      </Pressable>
      <ThemedText type="headline" themeColor="textSecondary">
        {title}
      </ThemedText>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSpacer: { width: 20 },
});
