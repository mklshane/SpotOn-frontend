import { StyleSheet, View } from "react-native";

import { Space } from "@/constants/theme";

import { ThemedText } from "../themed-text";
import { DocumentHeader } from "./document-header";
import { Screen } from "./screen";

export type StubScreenProps = {
  title: string;
  body?: string;
};

export function StubScreen({
  title,
  body = "This document is coming soon.",
}: StubScreenProps) {
  return (
    <Screen padded={false}>
      <DocumentHeader title={title} />

      <View style={styles.content}>
        <ThemedText type="body" themeColor="textSecondary">
          {body}
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.xl, paddingTop: Space.lg },
});
