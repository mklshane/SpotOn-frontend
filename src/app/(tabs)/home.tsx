import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useScanHistory } from '@/lib/scan-history';
import { TIER_CONTENT } from '@/lib/triage/recommendations';
import type { ScreeningRecord, TriageTier } from '@/lib/triage/types';

/** "Good morning" / "Good afternoon" / "Good evening" based on the device clock. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function formatActivityDate(value?: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });
}

function formatScreeningDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTierColors(theme: ReturnType<typeof useTheme>, tier: TriageTier) {
  switch (tier) {
    case 'low':
      return { foreground: theme.riskLow, background: theme.riskLowBg };
    case 'moderate':
      return { foreground: theme.riskModerate, background: theme.riskModerateBg };
    case 'high':
      return { foreground: theme.riskHigh, background: theme.riskHighBg };
    case 'critical':
      return { foreground: theme.riskCritical, background: theme.riskCriticalBg };
  }
}

function RecentScreeningCard({ item }: { item: ScreeningRecord }) {
  const theme = useTheme();
  const tierColors = getTierColors(theme, item.triage.tier);
  const location = item.mark?.region ?? 'Unmarked location';

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/scan/result',
          params: { id: item.id },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`${location}, ${TIER_CONTENT[item.triage.tier].name}, ${formatScreeningDate(
        item.createdAt
      )}`}
      style={({ pressed }) => [
        styles.screeningCard,
        {
          backgroundColor: theme.surface,
          borderColor: theme.hairline,
        },
        pressed && styles.pressed,
      ]}>
      <Image
        source={{ uri: item.imageUri }}
        contentFit="cover"
        transition={180}
        style={styles.thumbnail}
      />

      <View style={styles.screeningInfo}>
        <ThemedText type="headline" numberOfLines={1}>
          {location}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {formatScreeningDate(item.createdAt)}
        </ThemedText>
      </View>

      <View style={styles.screeningEnd}>
        <View style={[styles.tierBadge, { backgroundColor: tierColors.background }]}>
          <ThemedText type="caption" style={{ color: tierColors.foreground }}>
            {TIER_CONTENT[item.triage.tier].name}
          </ThemedText>
        </View>
        <Icon name="chevron.right" tintColor={theme.muted} size={16} />
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { entries, loading } = useScanHistory();
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || 'there';
  const recent = entries.slice(0, 2);
  const lastScreening = entries[0];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <View
            style={[styles.headerGlow, { backgroundColor: theme.brandTint }]}
            pointerEvents="none"
          />
          <ThemedText type="largeTitle">
            {getGreeting()}, {firstName}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {TODAY_LABEL}
          </ThemedText>
        </View>

        <Pressable
          onPress={() => router.push('/scan/body')}
          accessibilityRole="button"
          accessibilityLabel="Start a new screening"
          style={({ pressed }) => [styles.heroCard, pressed && styles.pressed]}>
          <Image
            source={require('@/assets/images/home-screening-hero.png')}
            contentFit="cover"
            transition={180}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[
              'rgba(242,106,46,0.98)',
              'rgba(255,138,76,0.91)',
              'rgba(255,138,76,0.22)',
              'rgba(255,138,76,0.02)',
            ]}
            locations={[0, 0.45, 0.73, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.heroContent}>
            <View style={styles.heroIcon}>
              <Icon name="camera.viewfinder" tintColor={theme.onBrand} size={24} />
            </View>
            <ThemedText type="title2" themeColor="onBrand">
              New screening
            </ThemedText>
            <ThemedText type="footnote" themeColor="onBrand" style={styles.heroSubtitle}>
              Take a clear photo for private, on-device triage.
            </ThemedText>
            <View style={[styles.heroButton, { backgroundColor: theme.surface }]}>
              <ThemedText type="subhead" themeColor="brand">
                Start screening
              </ThemedText>
              <Icon name="chevron.right" tintColor={theme.brand} size={15} />
            </View>
          </View>
        </Pressable>

        <View style={styles.sectionHead}>
          <ThemedText type="title2">Your activity</ThemedText>
        </View>

        <View
          style={[
            styles.activityCard,
            {
              backgroundColor: theme.surface,
              borderColor: theme.brandTint,
            },
          ]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,233,218,0.6)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[styles.activityOrb, { backgroundColor: theme.brandTint }]}
            pointerEvents="none"
          />

          <View style={styles.activityColumn}>
            <View style={[styles.activityIcon, { backgroundColor: theme.brandTint }]}>
              <Icon name="clock.arrow.circlepath" tintColor={theme.brand} size={23} />
            </View>
            <View style={styles.activityText}>
              <ThemedText
                type="caption"
                themeColor="brand"
                numberOfLines={2}
                style={styles.activityLabel}>
                {'TOTAL\nSCREENINGS'}
              </ThemedText>
              <ThemedText type="title2" style={styles.activityValue}>
                {loading ? '—' : entries.length}
              </ThemedText>
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                numberOfLines={2}
                style={styles.activityCaption}>
                Completed screenings
              </ThemedText>
            </View>
          </View>

          <View style={[styles.activityDivider, { backgroundColor: theme.hairline }]} />

          <View style={styles.activityColumn}>
            <View style={[styles.activityIcon, { backgroundColor: theme.brandTint }]}>
              <Icon name="calendar" tintColor={theme.brand} size={23} />
            </View>
            <View style={styles.activityText}>
              <ThemedText
                type="caption"
                themeColor="brand"
                numberOfLines={2}
                style={styles.activityLabel}>
                {'LAST\nSCREENING'}
              </ThemedText>
              <ThemedText
                type="title2"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                style={styles.activityValue}>
                {loading ? '—' : formatActivityDate(lastScreening?.createdAt)}
              </ThemedText>
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                numberOfLines={2}
                style={styles.activityCaption}>
                {lastScreening ? 'Most recent activity' : 'No screenings yet'}
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.sectionHead}>
          <ThemedText type="title2">Recent screenings</ThemedText>
          {entries.length > recent.length ? (
            <Pressable
              hitSlop={8}
              onPress={() => router.push('/scan/all')}
              accessibilityRole="button"
              accessibilityLabel="See all screenings"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="subhead" themeColor="brand">
                See all
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {recent.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: theme.surface,
                borderColor: theme.hairline,
              },
            ]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.brandTint }]}>
              <Icon name="camera.viewfinder" tintColor={theme.brand} size={22} />
            </View>
            <View style={styles.emptyText}>
              <ThemedText type="headline">
                {loading ? 'Loading screenings…' : 'No screenings yet'}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {loading
                  ? 'Your activity will appear in a moment.'
                  : 'Your completed screenings will appear here.'}
              </ThemedText>
            </View>
          </View>
        ) : (
          <View style={styles.list}>
            {recent.map((item) => (
              <RecentScreeningCard key={item.id} item={item} />
            ))}
          </View>
        )}

        <View style={[styles.privacyBanner, { backgroundColor: theme.brandTint }]}>
          <View style={[styles.privacyIcon, { backgroundColor: theme.surface }]}>
            <Icon name="lock.shield.fill" tintColor={theme.brand} size={22} />
          </View>
          <View style={styles.privacyText}>
            <ThemedText type="headline">Private by design</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              Analysis runs on your device. Core screening works offline.
            </ThemedText>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.giant,
  },
  header: {
    paddingTop: Space.xxl,
    gap: 2,
  },
  headerGlow: {
    position: 'absolute',
    top: -36,
    left: -44,
    width: 170,
    height: 170,
    borderRadius: 85,
    opacity: 0.6,
  },
  heroCard: {
    height: 230,
    marginTop: Space.xl,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    justifyContent: 'center',
    ...Elevation.lg,
  },
  heroContent: {
    width: '61%',
    paddingLeft: Space.xl,
    gap: Space.sm,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: Space.xs,
  },
  heroSubtitle: {
    opacity: 0.94,
  },
  heroButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginTop: Space.sm,
    paddingVertical: 10,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  sectionHead: {
    marginTop: Space.xxl,
    marginBottom: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityCard: {
    minHeight: 118,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Space.base,
    paddingHorizontal: Space.sm,
    overflow: 'hidden',
    ...Elevation.sm,
  },
  activityOrb: {
    position: 'absolute',
    right: -32,
    top: 8,
    width: 84,
    height: 84,
    borderRadius: 42,
    opacity: 0.55,
  },
  activityColumn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -4 }],
  },
  activityText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  activityLabel: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.35,
  },
  activityValue: {
    fontSize: 24,
    lineHeight: 28,
    marginTop: Space.sm,
  },
  activityCaption: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  activityDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: Space.sm,
  },
  screeningCard: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.sm,
    paddingRight: Space.md,
    ...Elevation.sm,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
    backgroundColor: '#F3E9E1',
  },
  screeningInfo: {
    flex: 1,
    gap: 2,
  },
  screeningEnd: {
    alignItems: 'flex-end',
    gap: Space.sm,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.base,
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    flex: 1,
    gap: 2,
  },
  list: {
    gap: Space.md,
  },
  privacyBanner: {
    marginTop: Space.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    borderRadius: Radius.lg,
    padding: Space.base,
  },
  privacyIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.84,
  },
});
