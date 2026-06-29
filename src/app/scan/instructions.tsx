import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  type ImageSourcePropType,
  type ListRenderItemInfo,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Dots } from '@/components/ui/dots';
import { Icon } from '@/components/ui/icon';
import { OnboardingHero } from '@/components/ui/onboarding-hero';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Slide = {
  key: string;
  title: string;
  description: string;
  image: ImageSourcePropType;
};

const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

const SLIDES: Slide[] = [
  {
    key: 'locate',
    title: 'Locate your lesion',
    description: 'Rotate and zoom the 3D body model to mark the area where the spot is.',
    image: require('@/assets/images/instructions/locate.svg'),
  },
  {
    key: 'photo',
    title: 'Take a clear, detailed photo',
    description: 'Keep within about 10 cm, use bright light, and keep other objects out of the frame.',
    image: require('@/assets/images/instructions/photo.svg'),
  },
  {
    key: 'assess',
    title: 'Get a quick assessment',
    description: 'In seconds, SpotOn gives an on-device triage of how concerning the spot looks.',
    image: require('@/assets/images/instructions/assess.svg'),
  },
  {
    key: 'schedule',
    title: 'Plan your self-checks',
    description: 'Check monthly and use SpotOn to track any changes over time.',
    image: require('@/assets/images/instructions/schedule.svg'),
  },
];

export default function InstructionsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const handleNext = useCallback(() => {
    if (isLast) router.back();
    else listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  }, [index, isLast]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setIndex(first.index);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => (
      <View style={[styles.page, { width }]}>
        <OnboardingHero image={item.image} icon="camera.viewfinder" size={260} />
        <View style={styles.copy}>
          <ThemedText type="title1" themeColor="brand" style={styles.title}>
            {item.title}
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.description}>
            {item.description}
          </ThemedText>
        </View>
      </View>
    ),
    [width],
  );

  return (
    <Screen variant="gradient" gradient="dawnSoft" padded={false}>
      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close instructions">
          <Icon name="xmark" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Instructions
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />

      <View style={styles.footer}>
        <Dots count={SLIDES.length} activeIndex={index} />
        <Button label={isLast ? 'Got it' : 'Next'} variant="brand" onPress={handleNext} style={styles.cta} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xl, gap: Space.xxxl },
  copy: { alignItems: 'center', gap: Space.md },
  title: { textAlign: 'center' },
  description: { textAlign: 'center', maxWidth: 320 },
  footer: { paddingHorizontal: Space.xl, paddingBottom: Space.base, gap: Space.xl, alignItems: 'center' },
  cta: { alignSelf: 'stretch', paddingVertical: Space.base },
});
