import { t } from '@/lib/i18n';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { uvLevel, type Conditions, type UvLevel } from '@/lib/weather';

export type ConditionsCardProps = {
  /** null renders the loading skeleton. */
  data: Conditions | null;
  placeName: string | null;
  usingDefault: boolean;
  /** Full card on Learn; a single slim row on Home. */
  variant?: 'full' | 'compact';
  /** Shows the "Use my location" link (full variant only). */
  onRequestLocation?: () => void;
  onPress: () => void;
};

// Mapped onto the triage risk palette so "high" reads the same everywhere in the app.
const LEVEL_COLOR = {
  low: ['riskLow', 'riskLowBg'],
  moderate: ['riskModerate', 'riskModerateBg'],
  high: ['riskHigh', 'riskHighBg'],
  veryHigh: ['riskCritical', 'riskCriticalBg'],
  extreme: ['riskCritical', 'riskCriticalBg'],
} as const satisfies Record<UvLevel, readonly [string, string]>;

function levelLabel(level: UvLevel): string {
  switch (level) {
    case 'low':
      return t('Low UV');
    case 'moderate':
      return t('Moderate UV');
    case 'high':
      return t('High UV');
    case 'veryHigh':
      return t('Very high UV');
    case 'extreme':
      return t('Extreme UV');
  }
}

function levelAdvice(level: UvLevel): string {
  switch (level) {
    case 'low':
      return t('Minimal protection needed.');
    case 'moderate':
      return t('Wear sunscreen and seek shade around midday.');
    case 'high':
      return t('Use SPF 30+, wear a hat, and stay in the shade from 10 AM to 4 PM.');
    case 'veryHigh':
    case 'extreme':
      return t('Avoid the midday sun. Cover up and reapply sunscreen.');
  }
}

/** Derived display values, shared by both variants. */
function describe(data: Conditions) {
  // After dark the current index is 0, so the day's peak is the useful number - when
  // the source knows it (the MET Norway fallback only forecasts forward).
  const showPeak = !data.isDay && data.uvMaxToday !== null;
  const shownUv = showPeak ? data.uvMaxToday! : data.uv;
  const level = uvLevel(shownUv);
  const uv = String(Math.round(shownUv));
  return {
    level,
    uv,
    temp: `${Math.round(data.tempC)}°C`,
    label: showPeak ? t("Today's peak UV") : levelLabel(level),
    advice: data.isDay
      ? levelAdvice(level)
      : showPeak
        ? t("The sun is down. Today's UV peaked at {{uv}}.", { uv })
        : t('The sun is down. No sun protection needed right now.'),
  };
}

/** The UV number on a soft disc tinted by its level - the card's focal point. */
function UvDial({ level, uv, size }: { level: UvLevel; uv: string; size: number }) {
  const theme = useTheme();
  const [color, tint] = LEVEL_COLOR[level];
  return (
    <View
      style={[
        styles.dial,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme[tint] },
      ]}>
      <ThemedText
        type={size >= 56 ? 'title2' : 'headline'}
        style={[styles.dialValue, { color: theme[color] }]}>
        {uv}
      </ThemedText>
      <ThemedText type="caption" style={[styles.dialUnit, { color: theme[color] }]}>
        {t('UV')}
      </ThemedText>
    </View>
  );
}

/**
 * Live temperature + UV. Only mounted while online; the parent hides it entirely
 * when there's no connection or no reading could be fetched.
 */
export function ConditionsCard({
  data,
  placeName,
  usingDefault,
  variant = 'full',
  onRequestLocation,
  onPress,
}: ConditionsCardProps) {
  const theme = useTheme();
  const compact = variant === 'compact';
  const place = usingDefault ? t('Metro Manila') : placeName ?? t('Your location');
  const eyebrow = `${t('Right now')} · ${place}`;
  const dialSize = compact ? 48 : 64;
  const cardStyle = [
    styles.card,
    compact ? styles.cardCompact : styles.cardFull,
    { backgroundColor: theme.surface, borderColor: theme.hairline },
    Elevation.sm,
  ];

  const eyebrowText = (
    <ThemedText type="caption" style={[styles.eyebrow, { color: theme.brandPressed }]} numberOfLines={1}>
      {eyebrow}
    </ThemedText>
  );

  if (!data) {
    const block = { backgroundColor: theme.elementBg };
    return (
      <View style={cardStyle} accessibilityLabel={t('Loading UV and temperature')}>
        <View style={styles.row}>
          <View style={[block, { width: dialSize, height: dialSize, borderRadius: dialSize / 2 }]} />
          <View style={styles.text}>
            {eyebrowText}
            <View style={[styles.skelLine, block, { width: '70%' }]} />
            {compact ? null : <View style={[styles.skelLine, block, { width: '45%' }]} />}
          </View>
        </View>
      </View>
    );
  }

  const d = describe(data);
  const a11y = `${eyebrow}. ${d.temp}. ${t('UV index')} ${d.uv}, ${d.label}. ${d.advice}`;

  if (compact) {
    return (
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={cardStyle}>
        <View style={styles.row}>
          <UvDial level={d.level} uv={d.uv} size={dialSize} />
          <View style={styles.text}>
            {eyebrowText}
            <ThemedText type="headline" numberOfLines={1}>
              {d.label}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {d.advice}
            </ThemedText>
          </View>
          <View style={styles.tempCompact}>
            <ThemedText type="headline">{d.temp}</ThemedText>
            <Icon name="chevron.right" size={14} tintColor={theme.muted} />
          </View>
        </View>
      </PressableScale>
    );
  }

  const peak =
    data.uvMaxToday === null ? null : t('Peak UV today: {{uv}}', { uv: String(Math.round(data.uvMaxToday)) });
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={cardStyle}>
      <View style={styles.row}>
        <UvDial level={d.level} uv={d.uv} size={dialSize} />
        <View style={styles.text}>
          {eyebrowText}
          <ThemedText type="title2" numberOfLines={1}>
            {d.label}
          </ThemedText>
          {data.isDay && peak ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {peak}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="title2" style={styles.tempFull}>
          {d.temp}
        </ThemedText>
      </View>

      <View style={[styles.advice, { backgroundColor: theme.elementBg }]}>
        <Icon name="sun.max.fill" size={16} tintColor={theme.brand} />
        <ThemedText type="footnote" style={styles.adviceText}>
          {d.advice}
        </ThemedText>
      </View>

      <View style={styles.footer}>
        {usingDefault && onRequestLocation ? (
          <Pressable onPress={onRequestLocation} hitSlop={Space.md} accessibilityRole="button" style={styles.locate}>
            <Icon name="mappin.circle.fill" size={16} tintColor={theme.brand} />
            <ThemedText type="footnote" themeColor="brand" style={styles.locateLabel}>
              {t('Use my location')}
            </ThemedText>
          </Pressable>
        ) : (
          <View />
        )}
        <ThemedText type="caption" themeColor="muted">
          {data.source === 'met-norway' ? t('Weather data by MET Norway') : t('Weather data by Open-Meteo')}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    // Same warm hairline as EducationCard so stacked cards read as one rhythm.
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardFull: { padding: Space.base, gap: Space.md },
  cardCompact: { paddingVertical: Space.md, paddingHorizontal: Space.base },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  // minWidth: 0 lets long place names / advice ellipsize on 360px devices.
  text: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  dial: { alignItems: 'center', justifyContent: 'center' },
  dialValue: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  dialUnit: { fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: -2 },
  tempCompact: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  tempFull: { fontVariant: ['tabular-nums'] },
  advice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    borderRadius: Radius.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
  },
  adviceText: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  locate: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  locateLabel: { fontWeight: '600' },
  skelLine: { height: 14, borderRadius: Radius.sm, marginTop: Space.xs },
});
