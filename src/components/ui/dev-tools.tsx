import { Icon } from '@/components/ui/icon';
import { Asset } from 'expo-asset';
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resetOnboarding } from '@/lib/onboarding';
import { useScanHistory } from '@/lib/scan-history';
import { useScreeningSession } from '@/lib/screening-session';
import { MAJOR_QUESTIONS, MINOR_QUESTIONS, computeTriage } from '@/lib/triage/tps-core';
import type { Answer, LesionClass, QuestionId, SymptomAnswers } from '@/lib/triage/types';

import { ThemedText } from '../themed-text';

type Jump = { label: string; href: Href };

const JUMPS: Jump[] = [
  { label: 'Splash', href: '/' },
  { label: 'Onboarding', href: '/(onboarding)' },
  { label: 'Register', href: '/(auth)/register' },
  { label: 'Login', href: '/(auth)/login' },
  { label: 'Profile', href: '/(auth)/complete-profile' },
  { label: 'App (Tabs)', href: '/home' },
  { label: 'Scan flow', href: '/scan/body' },
];

// A real lesion photo (from SpotOn-synthetic/dataset_real/MEL) bundled to seed a dev screening,
// so the questionnaire jump can run the real classifier end-to-end (jumping straight to the
// questionnaire otherwise skips capture/quality, where startClassification() normally fires —
// analysis then has nothing to join on). Classifies cleanly as MEL, unlike a random web image.
const TEST_PHOTO = require('../../../assets/dev/test-lesion.jpg');

// Mock screenings so every result variant is reachable without running the model.
const MOCKS: { label: string; topClass: LesionClass; conf: number; answer: Answer; floor?: boolean }[] = [
  { label: 'Result: Low', topClass: 'BENIGN', conf: 0.92, answer: 'no' },
  { label: 'Result: Moderate', topClass: 'BCC', conf: 0.75, answer: 'no' },
  { label: 'Result: High', topClass: 'MEL', conf: 0.91, answer: 'no' },
  { label: 'Result: Critical', topClass: 'MEL', conf: 0.97, answer: 'yes' },
  { label: 'Result: Safety floor', topClass: 'OTHER', conf: 0.32, answer: 'unsure', floor: true },
];

function mockAnswers(a: Answer): SymptomAnswers {
  return Object.fromEntries(
    [...MAJOR_QUESTIONS, ...MINOR_QUESTIONS].map((q) => [q, a]),
  ) as Record<QuestionId, Answer>;
}

/** __DEV__-only floating panel to jump between flow screens and reset flags. */
export function DevTools() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { addEntry } = useScanHistory();
  const { setImageUri, setSource, startClassification } = useScreeningSession();

  // Seed a real photo + kick off classification (as a gallery upload), then jump into the
  // questionnaire — so the dev shortcut reaches a genuine result instead of the "classification
  // never started" error. Resolve the bundled asset to a local file:// URI (what the real flow
  // feeds the classifier), rather than the Metro http URL.
  async function startTestQuestionnaire() {
    setOpen(false);
    const asset = await Asset.fromModule(TEST_PHOTO).downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    setSource('gallery');
    setImageUri(uri);
    startClassification(uri);
    router.replace('/scan/questionnaire');
  }

  async function openMockResult(mock: (typeof MOCKS)[number]) {
    const answers = mockAnswers(mock.answer);
    const rest = (1 - mock.conf) / 4;
    const probs = Object.fromEntries(
      (['MEL', 'SCC', 'BCC', 'OTHER', 'BENIGN'] as LesionClass[]).map((c) => [
        c,
        c === mock.topClass ? mock.conf : rest,
      ]),
    ) as Record<LesionClass, number>;
    const entry = await addEntry({
      mark: { point: [0.2, 0.72, 0.34], region: 'Chest', view: 'front' },
      imageUri: '',
      source: 'camera',
      questionnaire: { answers, completedAt: new Date().toISOString() },
      classification: {
        probs,
        topClass: mock.topClass,
        topConfidence: mock.conf,
        attempt: mock.floor ? 2 : 1,
        modelVersion: 'dev-mock',
        inputSize: 260,
        normalization: 'zeroOne',
        inferenceMs: 0,
      },
      triage: computeTriage(mock.topClass, mock.conf, answers, { applyFloor: mock.floor }),
    });
    router.replace({ pathname: '/scan/result', params: { id: entry.id } });
  }

  if (!__DEV__) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { bottom: insets.bottom + 80, right: Space.base }]}>
      {open ? (
        <View style={[styles.panel, { backgroundColor: theme.surface }, Elevation.md]}>
          <ThemedText type="caption" themeColor="muted" style={styles.heading}>
            DEV — JUMP TO
          </ThemedText>
          {JUMPS.map((j) => (
            <Pressable
              key={j.label}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => {
                router.replace(j.href);
                setOpen(false);
              }}>
              <ThemedText type="subhead">{j.label}</ThemedText>
            </Pressable>
          ))}
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={() => startTestQuestionnaire().catch((e) => console.warn('[dev] seed failed', e))}>
            <ThemedText type="subhead" themeColor="brand">
              Questionnaire (+ photo)
            </ThemedText>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
          {MOCKS.map((m) => (
            <Pressable
              key={m.label}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => {
                openMockResult(m).catch((e) => console.warn('[dev] mock failed', e));
                setOpen(false);
              }}>
              <ThemedText type="subhead">{m.label}</ThemedText>
            </Pressable>
          ))}
          <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={async () => {
              await resetOnboarding().catch(() => {});
              router.replace('/');
              setOpen(false);
            }}>
            <ThemedText type="subhead" themeColor="brand">
              Reset onboarding flag
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.fab, { backgroundColor: theme.text }, Elevation.md]}
        accessibilityLabel="Developer tools">
        <Icon name={open ? 'xmark' : 'hammer.fill'} tintColor={theme.background} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', alignItems: 'flex-end', gap: Space.sm },
  fab: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderRadius: Radius.lg,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.xs,
    minWidth: 180,
  },
  heading: { paddingHorizontal: Space.md, paddingVertical: Space.xs, letterSpacing: 0.5 },
  row: { paddingHorizontal: Space.md, paddingVertical: Space.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Space.xs },
});
