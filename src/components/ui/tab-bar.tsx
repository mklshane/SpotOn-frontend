import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from '@/components/ui/icon';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Gradients, Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

type SF = IconName;
type TabConfig = { label: string; icon: SF; iconActive?: SF; center?: boolean };

const TABS: Record<string, TabConfig> = {
  home: { label: 'Home', icon: 'house', iconActive: 'house.fill' },
  directory: { label: 'Directory', icon: 'building.2', iconActive: 'building.2.fill' },
  scan: { label: 'Scan', icon: 'camera.fill', center: true },
  learn: { label: 'Learn', icon: 'book', iconActive: 'book.fill' },
  profile: { label: 'Profile', icon: 'person', iconActive: 'person.fill' },
};

type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
  };
};

export function CustomTabBar({ state, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        styles.shadow,
        {
          backgroundColor: theme.surface,
          paddingBottom: insets.bottom,
          height: 66 + insets.bottom,
        },
      ]}>
      {state.routes.map((route, index) => {
        const cfg = TABS[route.name];
        if (!cfg) return null;
        const focused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        if (cfg.center) {
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              accessibilityRole="button">
              <View style={[styles.centerRing, { backgroundColor: theme.surface }, styles.centerShadow]}>
                <View style={styles.centerCircle}>
                  <LinearGradient
                    colors={Gradients.sunsetVivid.colors as unknown as [string, string, ...string[]]}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Icon name={cfg.icon} tintColor={theme.onBrand} size={26} />
                </View>
              </View>
              <ThemedText
                type="caption"
                themeColor={focused ? 'brand' : 'muted'}
                style={[styles.label, focused && styles.labelActive]}>
                {cfg.label}
              </ThemedText>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            accessibilityRole="button">
            <Icon
              name={focused ? cfg.iconActive ?? cfg.icon : cfg.icon}
              tintColor={focused ? theme.brand : theme.muted}
              size={25}
            />
            <ThemedText
              type="caption"
              themeColor={focused ? 'brand' : 'muted'}
              style={[styles.label, focused && styles.labelActive]}>
              {cfg.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const CIRCLE = 54;
const RING = CIRCLE + 8;

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: Space.md,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  // soft warm shadow rising upward off the bar
  shadow: {
    shadowColor: '#7A4A2B',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
  item: { flex: 1, alignItems: 'center', gap: 5 },
  pressed: { opacity: 0.6 },
  label: { ...Type.caption },
  labelActive: { fontWeight: '600' },
  centerRing: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    marginTop: -30,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerShadow: {
    shadowColor: '#E5571B',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  centerCircle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
