# Education Hub — Design

## Goal

Turn the current "Learn" tab placeholder into a real Education Hub: a list of dermatology
topics, some of which expand into a sub-list, all leading to article screens with static,
bundled content. Inspired by a generic course-app layout (topic list → detail screen), reskinned
entirely in SpotOn's sunset design system — no purple gradients, ratings, or "by author" course
metadata from the inspiration image carry over.

## Scope

- Replace `src/app/(tabs)/learn.tsx` (currently a `ScreenPlaceholder`) with the real hub screen.
- Add a new `src/app/learn/` stack route group: `_layout.tsx`, `topic.tsx` (sub-list),
  `article.tsx` (detail), `questionnaire.tsx` (coming-soon placeholder).
- Add one static content file, `src/data/learn-content.ts`, holding all topic/article text.
- Reuse existing primitives (`Card`, `ThemedText`, `Icon`, `IconCircle`, `ScreenPlaceholder`,
  `Screen`) — no new UI primitives needed; the row shape matches Directory's
  `ClinicCard`/`DoctorCard` list-row pattern closely enough to write directly rather than extract
  a new shared component (see "Row component" below for the one exception).

**Out of scope (explicitly deferred):**
- The actual SpotOn Questionnaire flow (question bank, scoring, results) — its own future
  brainstorm/spec. This pass only adds a row that navigates to a "coming soon" screen.
- Real photography/illustration assets — hero images are placeholder gradient icon circles
  (`IconCircle variant="gradient"`), swappable for real images later without touching screen code.
- A CMS, admin UI, or backend endpoint for content — content is static TypeScript, edited
  directly in the repo.
- Search, filtering, or a "recently viewed" section on the hub.

---

## 1. Content data model (`src/data/learn-content.ts`)

```ts
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

export const LEARN_TOPICS: Topic[] = [ /* the 7 topics below */ ];

export function getTopic(id: string): Topic | undefined;
export function getArticle(topicId: string, articleId?: string): Article | undefined;
```

`getArticle` handles both cases: for an `article`-kind topic, `articleId` is omitted and it
returns `topic.article` directly; for a `subtopics`-kind topic, `articleId` selects the specific
sub-article. This keeps `article.tsx` (the detail screen) working from a single lookup function
regardless of which kind of topic it was reached from.

### Placeholder topic list

1. **What is Skin Cancer** (`article`) — one article: a short explainer (2-3 sections:
   definition, why early detection matters, SpotOn's role).
2. **Types of Skin Cancer** (`subtopics`) — three sub-articles: **Basal Cell Carcinoma**,
   **Squamous Cell Carcinoma**, **Melanoma**, each with "What it looks like" / "Risk level" /
   "Typical treatment" sections.
3. **Warning Signs (ABCDE Rule)** (`article`) — one section per letter (Asymmetry, Border,
   Color, Diameter, Evolving).
4. **Risk Factors** (`article`) — sun exposure, skin type, family history, age.
5. **Prevention & Sun Safety** (`article`) — sunscreen, protective clothing, avoiding peak sun
   hours, regular self-checks.
6. **When to See a Doctor** (`article`) — red-flag symptoms, what to expect at a dermatologist
   visit, links conceptually to the Directory tab (a "Find a clinic" note, not a live link in
   this pass).
7. **SpotOn Questionnaire** (`comingSoon`) — placeholder only.

All text is genuinely placeholder — short, factually-reasonable-but-not-medically-reviewed
paragraphs (2-4 sentences each), clearly editable in one file. Not a substitute for reviewed
medical copy before shipping to real users; that's a content task, not an engineering one.

---

## 2. Screens

### Hub (`src/app/(tabs)/learn.tsx`)

`Screen` with a title header ("Learn"), then a vertical list of topic rows built from
`LEARN_TOPICS`. Each row: `IconCircle` (tint variant) + title + subtitle + chevron, in a `Card`,
matching `SettingsRow`'s visual weight but as a single-purpose local component (see below) since
`SettingsRow` is tailored to Settings-specific accessories (switch, destructive tone) this screen
doesn't need.

Tapping a row navigates based on `kind`:
- `article` → `/learn/article?topicId=<id>`
- `subtopics` → `/learn/topic?topicId=<id>`
- `comingSoon` → `/learn/questionnaire`

### Sub-list (`src/app/learn/topic.tsx`)

Manual back header (matches Directory's detail-screen header pattern exactly: back chevron +
title + spacer). Body: the same row list style as the hub, populated from the topic's
`subtopics` array. Tapping a sub-article row navigates to
`/learn/article?topicId=<id>&articleId=<subId>`.

### Article (`src/app/learn/article.tsx`)

Manual back header. Body: `IconCircle variant="gradient"` (large, centered) + title
(`Type.title1`), then each `ArticleSection` renders an optional `Type.headline` heading followed
by its paragraphs (`Type.body`, `textSecondary` for a calm reading color). Looked up via
`getArticle(topicId, articleId?)` from the route params; if not found (shouldn't happen with
static data, but params are technically arbitrary strings), falls back to the existing
`ListState kind="error"` pattern from Directory rather than crashing.

### Coming soon (`src/app/learn/questionnaire.tsx`)

Just `ScreenPlaceholder` (already exists, already used for this exact purpose on other
not-yet-built screens) with Questionnaire-specific icon/title/subtitle, plus the manual back
header (the existing `ScreenPlaceholder` doesn't include a header/back button — this route wraps
it in the same header pattern as the other two new screens; the tab-level placeholder usage
elsewhere doesn't need one since it's a tab root, not a pushed screen).

### Row component

One new small local component, `src/components/learn/TopicRow.tsx` — the icon+title+subtitle+
chevron row, used identically by both the hub and the sub-list screen (avoids duplicating the
same JSX/styles in two files for what's visually one row shape reused twice).

---

## 3. Navigation wiring

- Register `<Stack.Screen name="learn" />` in the root `src/app/_layout.tsx` (same pattern as
  `directory`/`profile`).
- `src/app/learn/_layout.tsx` registers `topic`, `article`, `questionnaire` as sibling screens.

---

## 4. Error handling

Static data means "not found" is only reachable via a malformed/stale route param, not a real
runtime failure mode (no network, no DB). `article.tsx` and `topic.tsx` each do a simple
`if (!topic) return <ListState kind="error" .../>` guard rather than assuming the lookup always
succeeds — cheap insurance, not over-engineering, since route params are technically always
`string | string[] | undefined` regardless of what the data model guarantees.

## 5. Testing

No test runner in this project (consistent with the Directory feature) — verification is
`npx tsc --noEmit` and `npx expo lint`, same as before.
