import { Icon, type IconName } from '@/components/ui/icon';
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
import { OnboardingHero } from '@/components/ui/onboarding-hero';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { markOnboardingSeen } from '@/lib/onboarding';

type Slide = {
  key: string;
  title: string;
  description: string;
  icon: IconName;
  // Drop a real illustration here later: require('@/assets/images/onboarding/welcome.png')
  image?: ImageSourcePropType;
};

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    title: 'Welcome to SpotOn',
    description:
      'Your pocket guide to checking skin changes early — calm, private, and made for the Philippines.',
    icon: 'sparkles',
    image: require('@/assets/images/onboarding/welcome.svg'),
  },
  {
    key: 'classify',
    title: 'Classify Skin Lesions',
    description:
      'Snap a photo and get an instant, on-device triage of how concerning a spot looks.',
    icon: 'camera.viewfinder',
    image: require('@/assets/images/onboarding/classify.svg'),
  },
  {
    key: 'dermatologists',
    title: 'Access Local Dermatologists',
    description: 'Find verified dermatology clinics and doctors near you, even offline.',
    icon: 'stethoscope',
    image: require('@/assets/images/onboarding/dermatologists.svg'),
  },
  {
    key: 'privacy',
    title: 'Your Data is Safe',
    description:
      'Your photos and results stay on your phone. Nothing is shared without your say-so.',
    icon: 'lock.shield.fill',
    image: require('@/assets/images/onboarding/privacy.svg'),
  },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finish = useCallback(async () => {
    await markOnboardingSeen().catch(() => {});
    router.replace('/(auth)/register');
  }, []);

  const handleNext = useCallback(() => {
    if (isLast) {
      finish();
    } else {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    }
  }, [index, isLast, finish]);

  const handleBack = useCallback(() => {
    if (index > 0) listRef.current?.scrollToIndex({ index: index - 1, animated: true });
  }, [index]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setIndex(first.index);
    },
  ).current;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => (
      <View style={[styles.page, { width }]}>
        <OnboardingHero image={item.image} icon={item.icon} />
        <View style={styles.copy}>
          <ThemedText type="largeTitle" style={styles.title}>
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
    <Screen variant="gradient" padded={false}>
      <View style={styles.header}>
        {index > 0 ? (
          <Pressable
            hitSlop={12}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.backRow}>
            <Icon name="chevron.left" tintColor={theme.muted} size={16} />
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable hitSlop={12} onPress={finish} accessibilityRole="button">
          <ThemedText type="subhead" themeColor="muted">
            Skip
          </ThemedText>
        </Pressable>
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
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />

      <View style={styles.footer}>
        <Dots count={SLIDES.length} activeIndex={index} />
        <Button
          label={isLast ? 'Get Started' : 'Continue'}
          variant="ink"
          onPress={handleNext}
          style={styles.cta}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 44,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    gap: Space.xxxl,
  },
  copy: { alignItems: 'center', gap: Space.md },
  title: { textAlign: 'center' },
  description: { textAlign: 'center', maxWidth: 320 },
  footer: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.base,
    gap: Space.xl,
    alignItems: 'center',
  },
  cta: { alignSelf: 'stretch',
    paddingVertical: Space.base,
  },
});
