import * as Linking from 'expo-linking';
import { StyleSheet, View } from 'react-native';

import { ClinicalImage } from '@/components/learn/ClinicalImage';
import { BodyGlyph } from '@/components/scan/body-glyph';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { IconCircle } from '@/components/ui/icon-circle';
import { Radius, Space } from '@/constants/theme';
import type { ArticleBlock } from '@/data/learn-content';
import { activeImageCredits, type ClinicalImageId } from '@/data/learn-images';
import { PENDING_SOURCES, SOURCES } from '@/data/learn-sources';
import { useTheme } from '@/hooks/use-theme';

/**
 * The one heading treatment every article block shares: a short brand accent
 * bar and a headline. Blocks differ in how their *content* is laid out, never
 * in how they announce themselves, which is what keeps the set coherent.
 */
export function BlockHeading({ title, intro }: { title?: string; intro?: string }) {
  const theme = useTheme();
  if (!title && !intro) return null;

  return (
    <View style={styles.headingWrap}>
      {title ? (
        <View style={styles.headingRow}>
          <View style={[styles.headingAccent, { backgroundColor: theme.brand }]} />
          <ThemedText type="headline" style={styles.headingText}>
            {title}
          </ThemedText>
        </View>
      ) : null}
      {intro ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {intro}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Plain headed prose. Consecutive prose blocks are grouped into one card. */
export function ProseGroup({ blocks }: { blocks: Extract<ArticleBlock, { kind: 'prose' }>[] }) {
  const theme = useTheme();

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      {blocks.map((block, index) => (
        <View key={index}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.hairline }]} /> : null}
          <View style={styles.section}>
            <BlockHeading title={block.heading} />
            <View style={styles.paragraphs}>
              {block.paragraphs.map((paragraph, i) => (
                <ThemedText key={i} type="body" themeColor="textSecondary">
                  {paragraph}
                </ThemedText>
              ))}
            </View>
          </View>
        </View>
      ))}
    </Card>
  );
}

/**
 * Side-by-side diagrams for signs you recognise by eye. Each row pairs a
 * lettered sign with a typical mole and a concerning one drawn the same way, so
 * the difference is the only thing that stands out.
 */
export function CompareBlock({ block }: { block: Extract<ArticleBlock, { kind: 'compare' }> }) {
  const theme = useTheme();

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      <View style={styles.section}>
        <BlockHeading title={block.heading} intro={block.intro} />
      </View>

      {block.items.map((item) => (
        <View key={item.sign}>
          <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
          <View style={styles.section}>
            <View style={styles.compareTitleRow}>
              <View style={[styles.letter, { backgroundColor: theme.brandTint }]}>
                <ThemedText type="headline" themeColor="brandPressed">
                  {item.letter}
                </ThemedText>
              </View>
              <ThemedText type="headline" style={styles.headingText}>
                {item.title}
              </ThemedText>
            </View>

            <View style={styles.compareRow}>
              <ClinicalImage
                id={item.photos.typical}
                caption={item.captions.typical}
                measurement={item.measurements?.typical}
              />
              <ClinicalImage
                id={item.photos.concern}
                caption={item.captions.concern}
                measurement={item.measurements?.concern}
                emphasis
              />
            </View>

            <ThemedText type="callout" themeColor="textSecondary">
              {item.detail}
            </ThemedText>

            {item.footnote ? (
              <ThemedText type="footnote" themeColor="muted">
                {item.footnote}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

/** An ordered walkthrough, connected down the gutter so the sequence is obvious. */
export function StepsBlock({ block }: { block: Extract<ArticleBlock, { kind: 'steps' }> }) {
  const theme = useTheme();

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      <View style={styles.section}>
        <BlockHeading title={block.heading} intro={block.intro} />

        <View>
          {block.steps.map((step, index) => (
            <View key={step.title} style={styles.stepRow}>
              <View style={styles.stepGutter}>
                <View style={[styles.stepNumber, { backgroundColor: theme.brand }]}>
                  <ThemedText type="caption" themeColor="onBrand" style={styles.stepNumberText}>
                    {index + 1}
                  </ThemedText>
                </View>
                {index < block.steps.length - 1 ? (
                  <View style={[styles.stepConnector, { backgroundColor: theme.hairline }]} />
                ) : null}
              </View>

              <View
                style={[styles.stepText, index < block.steps.length - 1 && styles.stepTextSpaced]}>
                <ThemedText type="headline">{step.title}</ThemedText>
                <ThemedText type="callout" themeColor="textSecondary">
                  {step.detail}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/**
 * Icon rows. `grouped` keeps parallel facts together in one divided card;
 * `tips` breaks advice into separate cards you can scan and act on one by one.
 */
export function ListBlock({ block }: { block: Extract<ArticleBlock, { kind: 'list' }> }) {
  const theme = useTheme();

  if (block.variant === 'tips') {
    return (
      <View style={styles.tips}>
        <BlockHeading title={block.heading} intro={block.intro} />
        {block.items.map((item) => (
          <Card key={item.title} padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
            <View style={styles.tipRow}>
              <View style={[styles.tipIcon, { backgroundColor: theme.brandTint }]}>
                <Icon name={item.icon} size={22} tintColor={theme.brand} />
              </View>
              <View style={styles.tipText}>
                <ThemedText type="headline">{item.title}</ThemedText>
                <ThemedText type="callout" themeColor="textSecondary">
                  {item.detail}
                </ThemedText>
              </View>
            </View>
          </Card>
        ))}
      </View>
    );
  }

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      <View style={styles.section}>
        <BlockHeading title={block.heading} intro={block.intro} />
      </View>

      {block.items.map((item) => (
        <View key={item.title}>
          <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
          <View style={styles.groupedRow}>
            <IconCircle icon={item.icon} variant="tint" size={40} />
            <View style={styles.groupedText}>
              <ThemedText type="headline">{item.title}</ThemedText>
              <ThemedText type="callout" themeColor="textSecondary">
                {item.detail}
              </ThemedText>
            </View>
          </View>
        </View>
      ))}
    </Card>
  );
}

/**
 * An annotated illustration: the same abstract lesion drawing used across the
 * app, blown up and paired with the features it is meant to teach. The traits
 * are captions for the artwork, not a second description of the article.
 */
export function VisualBlock({ block }: { block: Extract<ArticleBlock, { kind: 'visual' }> }) {
  const theme = useTheme();

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      <View style={styles.section}>
        <BlockHeading title={block.heading} intro={block.intro} />

        <ClinicalImage
          id={block.photo}
          caption="Possible appearance. Appearance alone cannot confirm a diagnosis."
        />

        <View style={styles.traits}>
          {block.traits.map((trait) => (
            <View key={trait.title} style={styles.traitRow}>
              <View style={[styles.traitDot, { backgroundColor: theme.brand }]} />
              <View style={styles.traitText}>
                <ThemedText type="subhead" style={styles.traitTitle}>
                  {trait.title}
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {trait.detail}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/**
 * Where a lesion tends to show up, drawn with the same body artwork the scan
 * flow uses for tracked spots. A list of place names would read as filler; the
 * silhouettes are what make the pattern land.
 */
export function BodyAreasBlock({ block }: { block: Extract<ArticleBlock, { kind: 'bodyAreas' }> }) {
  const theme = useTheme();

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      <View style={styles.section}>
        <BlockHeading title={block.heading} intro={block.intro} />

        <View style={styles.areas}>
          {block.areas.map((area) => (
            <View key={area.label} style={styles.area}>
              <View style={styles.areaArt}>
                <BodyGlyph region={area.region} size={40} />
              </View>
              <ThemedText type="caption" themeColor="textSecondary" style={styles.areaLabel}>
                {area.label}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/**
 * The one thing worth carrying away from the article. `caution` is reserved for
 * the few places where waiting genuinely costs something, so it keeps its force.
 */
export function NoticeBlock({ block }: { block: Extract<ArticleBlock, { kind: 'notice' }> }) {
  const theme = useTheme();
  const caution = block.tone === 'caution';
  const accent = caution ? theme.riskHigh : theme.brandPressed;

  return (
    <View style={[styles.notice, { backgroundColor: caution ? theme.riskHighBg : theme.brandTint }]}>
      <Icon name={caution ? 'exclamationmark.triangle.fill' : 'info.circle.fill'} size={18} tintColor={accent} />
      <View style={styles.noticeText}>
        {block.title ? (
          <ThemedText type="subhead" style={[styles.noticeTitle, { color: accent }]}>
            {block.title}
          </ThemedText>
        ) : null}
        <ThemedText type="footnote" themeColor="textSecondary">
          {block.text}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * The article's medical references. Anything the module could not verify is
 * listed here as an explicit gap rather than omitted, so a reader can see the
 * difference between a claim that is sourced and one that is not yet.
 */
export function SourcesBlock({ block }: { block: Extract<ArticleBlock, { kind: 'sources' }> }) {
  const theme = useTheme();
  const pending = block.pending ?? [];

  return (
    <View style={styles.sources}>
      <BlockHeading title="Sources" />

      {block.sources.map((id) => {
        const source = SOURCES[id];

        return (
          <PressableScale
            key={id}
            onPress={() => Linking.openURL(source.url)}
            accessibilityRole="link"
            accessibilityLabel={`${source.title}, ${source.org}. Opens in your browser.`}
            style={[styles.sourceRow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
            <View style={styles.sourceText}>
              <ThemedText type="caption" themeColor="muted">
                {source.org}
              </ThemedText>
              <ThemedText type="subhead" style={styles.sourceTitle}>
                {source.title}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.brandPressed }}>
                View source
              </ThemedText>
            </View>
            <Icon name="arrow.up.right" size={15} tintColor={theme.brandPressed} />
          </PressableScale>
        );
      })}

      {pending.map((id) => {
        const gap = PENDING_SOURCES[id];

        return (
          <View key={id} style={[styles.sourceRow, styles.sourcePending, { borderColor: theme.hairline }]}>
            <View style={styles.sourceText}>
              <ThemedText type="caption" themeColor="muted">
                {gap.org}
              </ThemedText>
              <ThemedText type="subhead" style={styles.sourceTitle}>
                Needs a verified source
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {gap.claim}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Credit for any real photograph on the page. Separate from Sources on purpose:
 * where a picture came from is a different question from where the medical
 * information came from. Renders nothing while every slot is still a diagram.
 */
export function ImageCreditsBlock({ imageIds }: { imageIds: readonly ClinicalImageId[] }) {
  const theme = useTheme();
  const credits = activeImageCredits(imageIds);
  if (credits.length === 0) return null;

  return (
    <View style={styles.credits}>
      <ThemedText type="caption" themeColor="muted" style={styles.creditsHeading}>
        IMAGE CREDITS
      </ThemedText>
      {credits.map((credit) => (
        <PressableScale
          key={credit.url}
          onPress={() => Linking.openURL(credit.url)}
          accessibilityRole="link"
          accessibilityLabel={`Image source ${credit.org}. Opens in your browser.`}
          style={styles.creditRow}>
          <ThemedText type="caption" themeColor="textSecondary">
            Image source: {credit.org} ({credit.licence})
          </ThemedText>
          <Icon name="arrow.up.right" size={11} tintColor={theme.brandPressed} />
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // No `overflow: 'hidden'` here on purpose. Nothing in these blocks reaches a
  // rounded corner (dividers are inset by Space.lg, artwork sits inside the
  // section padding), and clipping a card on Android can swallow its own
  // elevation shadow.
  card: { borderWidth: StyleSheet.hairlineWidth },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Space.lg },
  section: { padding: Space.lg, gap: Space.md },
  paragraphs: { gap: Space.sm },

  headingWrap: { gap: Space.xs },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  headingAccent: { width: 4, height: 20, borderRadius: 2 },
  headingText: { flex: 1 },

  compareTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  letter: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // alignItems flex-start so a one-line caption beside a two-line one does not
  // stretch its sibling's frame, which is what made the halves unequal.
  compareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },

  stepRow: { flexDirection: 'row', gap: Space.md },
  stepGutter: { width: 28, alignItems: 'center' },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { fontWeight: '700' },
  // Fills the gutter beneath a step's number down to the next one, so the
  // sequence reads as a single thread rather than three loose rows.
  stepConnector: { width: 2, flex: 1, marginVertical: Space.xs },
  stepText: { flex: 1, minWidth: 0, gap: 2 },
  stepTextSpaced: { paddingBottom: Space.lg },

  tips: { gap: Space.md },
  tipRow: { flexDirection: 'row', gap: Space.base, padding: Space.base, alignItems: 'flex-start' },
  tipIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: { flex: 1, minWidth: 0, gap: 2 },

  groupedRow: { flexDirection: 'row', gap: Space.base, padding: Space.lg, alignItems: 'flex-start' },
  groupedText: { flex: 1, minWidth: 0, gap: 2 },

  artStage: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.lg,
  },
  artMedallion: {
    width: 156,
    height: 156,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  traits: { gap: Space.md },
  traitRow: { flexDirection: 'row', gap: Space.md },
  // Nudged down so the dot sits on the first line of the label, not above it.
  traitDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  traitText: { flex: 1, minWidth: 0, gap: 2 },
  traitTitle: { fontWeight: '600' },

  areas: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  // Fixed width rather than flex, so a row of four on a 360px screen and a row
  // of five on a wider one both wrap cleanly instead of squeezing.
  area: { width: 72, gap: Space.sm },
  // Square, so BodyGlyph's own tinted tile reads as a deliberate thumbnail
  // rather than a stretched panel. BodyGlyph fills the box via flex: 1.
  areaArt: { height: 72 },
  areaLabel: { textAlign: 'center' },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    borderRadius: Radius.md,
    padding: Space.base,
  },
  noticeText: { flex: 1, minWidth: 0, gap: 2 },
  noticeTitle: { fontWeight: '700' },

  sources: { gap: Space.sm },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.base,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // An unverified entry is deliberately flat and unlinked, so it cannot be
  // mistaken for a citation at a glance.
  sourcePending: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  sourceText: { flex: 1, minWidth: 0, gap: 2 },
  sourceTitle: { fontWeight: '600' },

  credits: { gap: Space.xs, paddingHorizontal: Space.xs },
  creditsHeading: { fontWeight: '700', letterSpacing: 0.5 },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
