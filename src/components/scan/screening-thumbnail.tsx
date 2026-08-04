import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ImageStyle, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

/**
 * A screening photo that degrades visibly when the file isn't there.
 *
 * A photo can go missing independently of the row pointing at it: a copy that failed at capture
 * time (persistImage falls back to the original cache URI, which the OS may evict), a database
 * restored without its images, or a path that stopped resolving — the container-UUID bug that
 * data/image-paths.ts now prevents. A bare <Image> renders those as a silent blank rectangle that
 * reads as a layout bug rather than missing data, and gives no signal that anything is wrong.
 *
 * Both failure shapes land on the same placeholder: no URI at all, and a URI whose load fails.
 */
export function ScreeningThumbnail({
  uri,
  style,
  iconSize = 20,
}: {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  iconSize?: number;
}) {
  const theme = useTheme();
  // The failure is keyed to the URI that produced it rather than held as a bare boolean: list rows
  // are recycled onto new records, and a flag would let one missing photo poison every row that
  // later reused the same component instance. Deriving it during render also keeps the React
  // Compiler happy — resetting via an effect is a cascading render.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = !!uri && failedUri === uri;

  if (!uri || failed) {
    return (
      <View
        style={[
          styles.placeholder,
          { backgroundColor: theme.elementBg },
          style as StyleProp<ViewStyle>,
        ]}>
        <Icon name="photo.on.rectangle" tintColor={theme.muted} size={iconSize} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      transition={180}
      onError={() => setFailedUri(uri)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
