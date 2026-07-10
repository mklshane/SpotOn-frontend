# Education Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder "Learn" tab with a real Education Hub — a topic list, sub-list
screens for topics with multiple articles, article detail screens, and a coming-soon placeholder
for the future Questionnaire — per `docs/superpowers/specs/2026-07-10-education-hub-design.md`.

**Architecture:** All content is static TypeScript data (`src/data/learn-content.ts`) — no
backend, no SQLite, no sync. A new `src/app/learn/` route group holds the sub-list/article/
questionnaire screens; the tab root (`src/app/(tabs)/learn.tsx`) is replaced with the real hub.
One new shared component, `TopicRow`, is reused by both the hub and the sub-list screen.

**Tech Stack:** Expo Router (existing), no new dependencies.

---

## Before you start

**No test runner in this project** — verification is `npx tsc --noEmit` and `npx expo lint`,
same convention as the Directory feature.

**One deliberate deviation from the design spec, decided during planning, not implementation:**
the spec's §2 "Coming soon" screen said it would "reuse `ScreenPlaceholder`... wrapped in the
same header pattern." `ScreenPlaceholder` renders its own full `<Screen>` internally, so wrapping
it in a separate header would mean nesting two `Screen`s and absolutely-positioning the header on
top with a hardcoded offset — fragile and against this codebase's "no arbitrary values" rule.
Task 6 below builds the coming-soon screen directly (manual header + centered icon/title/
subtitle/badge, the same visual content `ScreenPlaceholder` would have shown) instead. Same look,
cleaner structure.

---

## File structure

**New:**
- `src/data/learn-content.ts` — all topic/article content + `getTopic`/`getArticle` lookups
- `src/components/learn/TopicRow.tsx` — the icon+title+subtitle+chevron row, shared by hub + sub-list
- `src/app/learn/_layout.tsx`
- `src/app/learn/topic.tsx` — sub-list screen
- `src/app/learn/article.tsx` — article detail screen
- `src/app/learn/questionnaire.tsx` — coming-soon placeholder

**Modify:**
- `src/components/ui/icon.tsx` (3 new `VECTOR_MAP` entries)
- `src/app/(tabs)/learn.tsx` (replace placeholder with the real hub)
- `src/app/_layout.tsx` (register `learn` detail stack)

---

### Task 1: Icon additions + content data

**Files:**
- Modify: `src/components/ui/icon.tsx`
- Create: `src/data/learn-content.ts`

- [ ] **Step 1: Add 3 new `VECTOR_MAP` entries**

In `src/components/ui/icon.tsx`, insert into `VECTOR_MAP` (anywhere — e.g. after the `// directory` group):

```ts
  // learn
  'cross.case.fill': { set: 'ionicons', name: 'medkit' },
  'square.grid.2x2.fill': { set: 'ionicons', name: 'grid' },
  'sun.max.fill': { set: 'ionicons', name: 'sunny' },
```

- [ ] **Step 2: Write `src/data/learn-content.ts`**

```ts
import type { IconName } from '@/components/ui/icon';

export type ArticleSection = {
  heading?: string;
  paragraphs: string[];
};

export type Article = {
  id: string;
  title: string;
  icon: IconName;
  sections: ArticleSection[];
};

export type Topic =
  | { id: string; title: string; subtitle: string; icon: IconName; kind: 'article'; article: Article }
  | { id: string; title: string; subtitle: string; icon: IconName; kind: 'subtopics'; subtopics: Article[] }
  | { id: string; title: string; subtitle: string; icon: IconName; kind: 'comingSoon' };

export const LEARN_TOPICS: Topic[] = [
  {
    id: 'what-is-skin-cancer',
    title: 'What is Skin Cancer',
    subtitle: 'A quick introduction to what skin cancer is and why early detection matters.',
    icon: 'cross.case.fill',
    kind: 'article',
    article: {
      id: 'what-is-skin-cancer',
      title: 'What is Skin Cancer',
      icon: 'cross.case.fill',
      sections: [
        {
          paragraphs: [
            'Skin cancer happens when skin cells grow abnormally, usually because of damage from ultraviolet (UV) light — most often from the sun, but tanning beds too. It is the most common type of cancer worldwide, and also one of the most treatable when caught early.',
          ],
        },
        {
          heading: 'Why early detection matters',
          paragraphs: [
            'Most skin cancers develop slowly and visibly, on skin you can see and check yourself. Spotting a change early — before it grows or spreads — usually means simpler treatment and better outcomes.',
          ],
        },
        {
          heading: "SpotOn's role",
          paragraphs: [
            'SpotOn helps you track spots on your skin over time and get an early, informal read on whether a spot looks worth showing a doctor. It is a screening aid, not a diagnosis — always follow up with a dermatologist for anything that concerns you.',
          ],
        },
      ],
    },
  },
  {
    id: 'types-of-skin-cancer',
    title: 'Types of Skin Cancer',
    subtitle: 'The three most common types, and how they differ.',
    icon: 'square.grid.2x2.fill',
    kind: 'subtopics',
    subtopics: [
      {
        id: 'bcc',
        title: 'Basal Cell Carcinoma',
        icon: 'cross.case.fill',
        sections: [
          {
            heading: 'What it looks like',
            paragraphs: [
              'Often a pearly or waxy bump, or a flat, flesh-colored/brown scar-like lesion. It may bleed or scab and not fully heal.',
            ],
          },
          {
            heading: 'Risk level',
            paragraphs: [
              'The most common and least dangerous type — it grows slowly and rarely spreads beyond the skin, but can damage surrounding tissue if left untreated.',
            ],
          },
          {
            heading: 'Typical treatment',
            paragraphs: ['Usually removed with a minor outpatient procedure. Highly curable when caught early.'],
          },
        ],
      },
      {
        id: 'scc',
        title: 'Squamous Cell Carcinoma',
        icon: 'cross.case.fill',
        sections: [
          {
            heading: 'What it looks like',
            paragraphs: [
              'A firm, red bump, a scaly patch, or a sore that heals and reopens, often on sun-exposed skin like the face, ears, or hands.',
            ],
          },
          {
            heading: 'Risk level',
            paragraphs: [
              'More likely than BCC to grow deeper or spread if untreated, though still highly treatable when found early.',
            ],
          },
          {
            heading: 'Typical treatment',
            paragraphs: ['Usually surgical removal; larger or higher-risk cases may need additional treatment.'],
          },
        ],
      },
      {
        id: 'melanoma',
        title: 'Melanoma',
        icon: 'cross.case.fill',
        sections: [
          {
            heading: 'What it looks like',
            paragraphs: [
              'A new or changing mole — often asymmetric, with an irregular border, uneven color, and larger than a pencil eraser. See the ABCDE rule for the full checklist.',
            ],
          },
          {
            heading: 'Risk level',
            paragraphs: [
              'The least common but most serious type — it can spread to other parts of the body if not caught early, so prompt evaluation matters most here.',
            ],
          },
          {
            heading: 'Typical treatment',
            paragraphs: [
              'Surgical removal is standard; more advanced cases may need additional treatment from an oncology team.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'warning-signs',
    title: 'Warning Signs (ABCDE Rule)',
    subtitle: 'A simple checklist for spotting a mole that needs attention.',
    icon: 'exclamationmark.triangle.fill',
    kind: 'article',
    article: {
      id: 'warning-signs',
      title: 'Warning Signs (ABCDE Rule)',
      icon: 'exclamationmark.triangle.fill',
      sections: [
        { heading: 'Asymmetry', paragraphs: ['One half of the mole does not match the other half.'] },
        { heading: 'Border', paragraphs: ['Edges are irregular, ragged, or blurred, instead of smooth.'] },
        {
          heading: 'Color',
          paragraphs: ['Uneven color, or shades of brown, black, red, white, or blue within the same spot.'],
        },
        {
          heading: 'Diameter',
          paragraphs: ['Larger than about 6mm (roughly the size of a pencil eraser), though melanomas can be smaller.'],
        },
        {
          heading: 'Evolving',
          paragraphs: ['Any change in size, shape, color, or symptoms (itching, bleeding) over time.'],
        },
      ],
    },
  },
  {
    id: 'risk-factors',
    title: 'Risk Factors',
    subtitle: 'What raises your chances of developing skin cancer.',
    icon: 'figure.stand',
    kind: 'article',
    article: {
      id: 'risk-factors',
      title: 'Risk Factors',
      icon: 'figure.stand',
      sections: [
        {
          paragraphs: [
            'Anyone can develop skin cancer, but some factors make it more likely. Knowing yours can help you decide how often to self-check and when to see a dermatologist.',
          ],
        },
        {
          heading: 'Sun exposure',
          paragraphs: ['Frequent sunburns or long-term unprotected sun exposure, especially earlier in life.'],
        },
        {
          heading: 'Skin type',
          paragraphs: [
            'Fair skin, light hair, and eyes that burn easily are at higher risk, though anyone can develop skin cancer.',
          ],
        },
        {
          heading: 'Family history',
          paragraphs: ['A close relative with skin cancer, especially melanoma, raises your own risk.'],
        },
        {
          heading: 'Age and moles',
          paragraphs: ['Risk increases with age, and having many moles or atypical-looking moles is also a factor.'],
        },
      ],
    },
  },
  {
    id: 'prevention',
    title: 'Prevention & Sun Safety',
    subtitle: 'Everyday habits that lower your risk.',
    icon: 'sun.max.fill',
    kind: 'article',
    article: {
      id: 'prevention',
      title: 'Prevention & Sun Safety',
      icon: 'sun.max.fill',
      sections: [
        {
          heading: 'Sunscreen',
          paragraphs: ['Use broad-spectrum SPF 30+ daily, reapplied every two hours outdoors, even on cloudy days.'],
        },
        {
          heading: 'Protective clothing',
          paragraphs: ['Long sleeves, wide-brimmed hats, and sunglasses reduce direct UV exposure.'],
        },
        {
          heading: 'Timing',
          paragraphs: ['UV rays are strongest between 10am and 4pm — seek shade during peak hours when possible.'],
        },
        {
          heading: 'Regular self-checks',
          paragraphs: [
            'Check your skin monthly for new or changing spots, using the ABCDE rule as a guide, and use SpotOn to track anything you want to keep an eye on.',
          ],
        },
      ],
    },
  },
  {
    id: 'when-to-see-a-doctor',
    title: 'When to See a Doctor',
    subtitle: 'Signs that mean it is time for a professional opinion.',
    icon: 'stethoscope',
    kind: 'article',
    article: {
      id: 'when-to-see-a-doctor',
      title: 'When to See a Doctor',
      icon: 'stethoscope',
      sections: [
        {
          heading: 'Red-flag symptoms',
          paragraphs: [
            'See a dermatologist if a spot matches any of the ABCDE warning signs, changes noticeably, bleeds, itches persistently, or simply looks different from your other moles.',
          ],
        },
        {
          heading: 'What to expect at a visit',
          paragraphs: [
            'A dermatologist will visually examine the spot, possibly with a dermatoscope, and may recommend a biopsy if anything looks concerning. Most visits are quick and non-invasive.',
          ],
        },
        {
          heading: 'Finding a clinic',
          paragraphs: [
            'The Directory tab lists nearby dermatology clinics and doctors offering online booking, so you can find and reach a professional directly from SpotOn.',
          ],
        },
      ],
    },
  },
  {
    id: 'questionnaire',
    title: 'SpotOn Questionnaire',
    subtitle: 'A guided self-check to help assess your risk.',
    icon: 'doc.text.fill',
    kind: 'comingSoon',
  },
];

export function getTopic(id: string): Topic | undefined {
  return LEARN_TOPICS.find((t) => t.id === id);
}

export function getArticle(topicId: string, articleId?: string): Article | undefined {
  const topic = getTopic(topicId);
  if (!topic) return undefined;
  if (topic.kind === 'article') return topic.article;
  if (topic.kind === 'subtopics') return topic.subtopics.find((a) => a.id === articleId);
  return undefined;
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expected: no errors (this file has no consumers yet, so nothing else can break; it must be internally type-correct on its own).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/icon.tsx src/data/learn-content.ts
git commit -m "feat(learn): add education hub content data and icon mappings"
```

---

### Task 2: `TopicRow` component

**Files:**
- Create: `src/components/learn/TopicRow.tsx`

- [ ] **Step 1: Write `src/components/learn/TopicRow.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TopicRowProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
};

/** Icon + title + subtitle + chevron row, shared by the Learn hub and its sub-list screens. */
export function TopicRow({ icon, title, subtitle, onPress }: TopicRowProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card} elevation="sm">
        <View style={styles.row}>
          <IconCircle icon={icon} variant="tint" size={44} />
          <View style={styles.text}>
            <ThemedText type="headline">{title}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {subtitle}
            </ThemedText>
          </View>
          <Icon name="chevron.right" tintColor={theme.muted} size={18} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  text: { flex: 1, gap: 2 },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/learn/TopicRow.tsx
git commit -m "feat(learn): add TopicRow component"
```

---

### Task 3: Hub screen (replace the placeholder)

**Files:**
- Modify: `src/app/(tabs)/learn.tsx`

- [ ] **Step 1: Replace the file's entire content**

```tsx
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { TopicRow } from '@/components/learn/TopicRow';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { LEARN_TOPICS, type Topic } from '@/data/learn-content';

function onSelect(topic: Topic) {
  if (topic.kind === 'article') {
    router.push({ pathname: '/learn/article', params: { topicId: topic.id } });
  } else if (topic.kind === 'subtopics') {
    router.push({ pathname: '/learn/topic', params: { topicId: topic.id } });
  } else {
    router.push('/learn/questionnaire');
  }
}

export default function LearnScreen() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="largeTitle" style={styles.title}>
          Learn
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.subtitle}>
          Understand skin cancer signs, the ABCDEs, and when to see a doctor.
        </ThemedText>
        {LEARN_TOPICS.map((topic) => (
          <TopicRow
            key={topic.id}
            icon={topic.icon}
            title={topic.title}
            subtitle={topic.subtitle}
            onPress={() => onSelect(topic)}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Space.xl, paddingTop: Space.base, paddingBottom: Space.xxxl },
  title: { marginBottom: Space.xs },
  subtitle: { marginBottom: Space.xl },
});
```

Note: `router.push` here targets `/learn/article`, `/learn/topic`, `/learn/questionnaire` — none
of these routes exist until Tasks 4-6 land, so `npx tsc --noEmit` will show typed-route errors
after this task, same pattern as the Directory feature's mid-sequence route references. This is
expected and resolves once Task 6 finishes.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expected: errors about `/learn/article`, `/learn/topic`,
`/learn/questionnaire` not being valid routes yet (expected, see note above) — confirm there are
no OTHER errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/learn.tsx"
git commit -m "feat(learn): replace Learn tab placeholder with the topic hub"
```

---

### Task 4: Sub-list screen

**Files:**
- Create: `src/app/learn/topic.tsx`

- [ ] **Step 1: Write `src/app/learn/topic.tsx`**

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TopicRow } from '@/components/learn/TopicRow';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { getTopic } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

export default function LearnTopicScreen() {
  const theme = useTheme();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const topic = topicId ? getTopic(topicId) : undefined;

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          {topic?.title ?? 'Topic'}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {!topic || topic.kind !== 'subtopics' ? (
        <ListState kind="error" title="Topic not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {topic.subtopics.map((sub) => (
            <TopicRow
              key={sub.id}
              icon={sub.icon}
              title={sub.title}
              subtitle={sub.sections[0]?.paragraphs[0] ?? ''}
              onPress={() =>
                router.push({ pathname: '/learn/article', params: { topicId: topic.id, articleId: sub.id } })
              }
            />
          ))}
        </ScrollView>
      )}
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
  body: { paddingHorizontal: Space.xl, paddingTop: Space.base, paddingBottom: Space.xxxl },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expected: the `/learn/article` reference in this file will also show as
an unresolved typed route until Task 5 lands (same expected-transient pattern) — confirm no other
new errors beyond the ones already expected from Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/app/learn/topic.tsx
git commit -m "feat(learn): add sub-topic list screen"
```

---

### Task 5: Article detail screen

**Files:**
- Create: `src/app/learn/article.tsx`

- [ ] **Step 1: Write `src/app/learn/article.tsx`**

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { getArticle } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

export default function LearnArticleScreen() {
  const theme = useTheme();
  const { topicId, articleId } = useLocalSearchParams<{ topicId: string; articleId?: string }>();
  const article = topicId ? getArticle(topicId, articleId) : undefined;

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Article
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {!article ? (
        <ListState kind="error" title="Article not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <IconCircle icon={article.icon} variant="gradient" size={88} style={styles.hero} />
          <ThemedText type="title1" style={styles.title}>
            {article.title}
          </ThemedText>
          {article.sections.map((section, i) => (
            <View key={i} style={styles.section}>
              {section.heading ? (
                <ThemedText type="headline" style={styles.sectionHeading}>
                  {section.heading}
                </ThemedText>
              ) : null}
              {section.paragraphs.map((p, j) => (
                <ThemedText key={j} type="body" themeColor="textSecondary">
                  {p}
                </ThemedText>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
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
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, alignItems: 'center' },
  hero: { marginTop: Space.base, marginBottom: Space.base },
  title: { textAlign: 'center', marginBottom: Space.lg },
  section: { alignSelf: 'stretch', gap: Space.xs, marginBottom: Space.lg },
  sectionHeading: {},
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expected: only the `/learn/questionnaire` reference (Task 3) still
unresolved (Task 6 not done yet) — confirm no other new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/learn/article.tsx
git commit -m "feat(learn): add article detail screen"
```

---

### Task 6: Coming-soon screen + routing registration

**Files:**
- Create: `src/app/learn/questionnaire.tsx`
- Create: `src/app/learn/_layout.tsx`
- Modify: `src/app/_layout.tsx`

- [ ] **Step 1: Write `src/app/learn/questionnaire.tsx`**

```tsx
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function LearnQuestionnaireScreen() {
  const theme = useTheme();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Questionnaire
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.center}>
        <IconCircle icon="doc.text.fill" variant="tint" size={88} />
        <ThemedText type="title1" style={styles.title}>
          SpotOn Questionnaire
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.subtitle}>
          A guided self-check to help assess your risk.
        </ThemedText>
        <View style={[styles.badge, { backgroundColor: theme.brandTint }]}>
          <ThemedText type="caption" themeColor="brand" style={styles.badgeText}>
            COMING SOON
          </ThemedText>
        </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.base, paddingHorizontal: Space.xl },
  title: { marginTop: Space.sm, textAlign: 'center' },
  subtitle: { textAlign: 'center', maxWidth: 300 },
  badge: { marginTop: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.xs, borderRadius: Radius.pill },
  badgeText: { letterSpacing: 0.5, fontWeight: '600' },
});
```

- [ ] **Step 2: Write `src/app/learn/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';

export default function LearnDetailLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="topic" />
      <Stack.Screen name="article" />
      <Stack.Screen name="questionnaire" />
    </Stack>
  );
}
```

- [ ] **Step 3: Register the `learn` detail stack in the root layout**

In `src/app/_layout.tsx`, add `<Stack.Screen name="learn" />` after `<Stack.Screen name="directory" />`:

```tsx
                <Stack.Screen name="directory" />
                <Stack.Screen name="learn" />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected: **zero errors project-wide** (this is the last task; every
`/learn/...` route reference from Tasks 3-5 now resolves).
Run: `npx expo lint` — expected: clean on every file this feature touched (pre-existing,
unrelated repo lint debt in other files is not in scope).

- [ ] **Step 5: Commit**

```bash
git add src/app/learn/questionnaire.tsx src/app/learn/_layout.tsx src/app/_layout.tsx
git commit -m "feat(learn): add coming-soon screen and register the learn detail stack"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1:** `npx tsc --noEmit` — zero errors.
- [ ] **Step 2:** `npx expo lint` — clean on all `learn`-related files.
- [ ] **Step 3:** `npx expo export --platform ios` — bundles cleanly (JS-level proof every new
  route/import resolves).
- [ ] **Step 4 (manual, on a device/simulator/emulator):** Learn tab shows all 7 topics → tapping
  "Types of Skin Cancer" shows BCC/SCC/Melanoma → tapping one opens its article with hero icon,
  title, and sections → back button returns correctly at each level → tapping any other topic
  opens its article directly → tapping the Questionnaire row shows the coming-soon screen.
