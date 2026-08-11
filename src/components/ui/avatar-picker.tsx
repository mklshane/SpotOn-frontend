import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { ActionSheet } from "./action-sheet";
import { Avatar } from "./avatar";
import { Icon } from "./icon";

export type AvatarPickerProps = {
  uri?: string | null;
  /** Full name used for the initials fallback and accessibility label. */
  name?: string;
  size?: number;
  onChange: (uri: string | null) => void;
};

async function pickFromCamera(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      "Camera access needed",
      "Enable camera access in Settings to take a photo.",
    );
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

async function pickFromLibrary(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      "Photo access needed",
      "Enable photo library access in Settings to choose a photo.",
    );
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

/**
 * Tappable avatar that opens an action sheet to take a new photo, pick one
 * from the library, or remove the existing photo. Purely local state in/out
 * via `uri`/`onChange` — persisting the chosen photo (upload, save to the
 * user's profile, etc.) is left to the caller.
 */
export function AvatarPicker({
  uri,
  name,
  size = 96,
  onChange,
}: AvatarPickerProps) {
  const theme = useTheme();
  const [sheetVisible, setSheetVisible] = useState(false);

  const options = [
    {
      key: "camera",
      label: "Take Photo",
      onPress: async () => {
        const picked = await pickFromCamera();
        if (picked) onChange(picked);
      },
    },
    {
      key: "library",
      label: "Choose from Library",
      onPress: async () => {
        const picked = await pickFromLibrary();
        if (picked) onChange(picked);
      },
    },
    ...(uri
      ? [
          {
            key: "remove",
            label: "Remove Photo",
            destructive: true,
            onPress: () => onChange(null),
          },
        ]
      : []),
  ];

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setSheetVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={uri ? "Change profile photo" : "Add profile photo"}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <Avatar uri={uri} name={name} size={size} />
        <View
          style={[
            styles.badge,
            { backgroundColor: theme.brand, borderColor: theme.background },
          ]}
        >
          <Icon name="camera.fill" tintColor={theme.onBrand} size={14} />
        </View>
      </Pressable>

      <ActionSheet
        visible={sheetVisible}
        title="Profile photo"
        onClose={() => setSheetVisible(false)}
        options={options}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  pressable: { position: "relative" },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.85 },
});
