import { t, useLocale } from '@/lib/i18n';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Space } from '@/constants/theme';
import { useSurfaceWidth } from '@/hooks/use-surface-width';
import { releaseBlobUri } from '@/lib/blob-uri';
import { MAX_IMAGES_PER_SCREENING } from '@/lib/classifier/model-config';
import { useScreeningSession } from '@/lib/screening-session';
import { discardScratch } from '@/lib/scratch-files';

/**
 * Confirm the photo before it is checked (2026-10-07).
 *
 * ONE PHOTO IS THE NORMAL CASE. The screen is the photo and a Proceed button; extra angles are an
 * optional, quiet link, and the thumbnail strip only exists once there is more than one photo. Every
 * capture used to land on the quality screen, so a multi-photo screening sat through the image
 * checks once per photo. They now run ONCE, over the whole set, when the user taps Proceed.
 *
 * NO ENTRANCE ANIMATION, AND NO EMPTY FIRST FRAME. The photo is drawn straight from the route param,
 * in the same square crop.tsx framed it in, and the route has no transition (_layout.tsx) - so
 * "Use photo" reads as the crop screen swapping its buttons, not as a new screen fading in. The
 * first version added the photo in an effect and faded it in, which flashed an empty screen on
 * every capture.
 *
 * Stack: crop REPLACES into this screen, and "Add another" on the camera path is a plain back to the
 * capture screen still mounted below, so extra photos never pile up camera screens.
 */
export default function ReviewScreen() {
  useLocale();
  const insets = useSafeAreaInsets();
  const width = useSurfaceWidth();
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const session = useScreeningSession();
  const { images } = session;
  const [selectedUri, setSelectedUri] = useState<string | null>(uri ?? null);
  const leaving = useRef(false);

  // Accept the photo crop.tsx just produced. addImage dedupes by uri, so a re-render never adds it
  // twice. The UI does not wait on this: it draws `uri` directly until the session catches up.
  useEffect(() => {
    if (!uri) return;
    const index = session.addImage({ uri, source: session.source, qualityPassed: false });
    if (index === 0) session.setImageUri(uri);
    // Classification starts now on iOS and web, exactly when the quality screen used to start it.
    // Android waits for the image checks to settle (quality.tsx): the classifier, skin gate and IQA
    // share one JS thread there, and the camera's detector may be live again behind us.
    if (Platform.OS !== 'android') session.enqueueImage(uri, index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Nothing to review (every photo removed, or a stale route): back to taking one.
  useEffect(() => {
    if (images.length > 0 || uri || leaving.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/scan/capture');
  }, [images.length, uri]);

  // Until addImage lands, the set is "the photo we were handed".
  const set = images.length > 0 || !uri ? images.map((p) => p.uri) : [uri];
  const count = set.length;
  const multi = count > 1;
  const atCap = count >= MAX_IMAGES_PER_SCREENING;
  const shown = (selectedUri && set.includes(selectedUri) ? selectedUri : set[count - 1]) ?? null;
  const fromGallery = session.source === 'gallery';
  // Same square crop.tsx draws, so the photo does not move when this screen replaces it.
  const frame = width - Space.xl * 2;

  function remove(target: string) {
    session.removeImage(target);
    void discardScratch(target);
    releaseBlobUri(target);
    if (selectedUri === target) setSelectedUri(null);
  }

  /** Single photo: retake it. Back to the camera, or to the screen that offered the picker. */
  function retake() {
    if (leaving.current || !shown) return;
    leaving.current = true;
    remove(shown);
    if (router.canGoBack()) router.back();
    else router.replace('/scan/capture');
  }

  async function addAnother() {
    if (leaving.current || atCap) return;
    if (fromGallery) {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
      if (result.canceled || !result.assets[0]) return;
      leaving.current = true;
      router.replace({ pathname: '/scan/crop', params: { uri: result.assets[0].uri, source: 'gallery' } });
      return;
    }
    leaving.current = true;
    // The capture screen is still mounted below this one (crop replaced itself with us).
    if (router.canGoBack()) router.back();
    else router.replace('/scan/capture');
  }

  function proceed() {
    if (leaving.current || count === 0) return;
    leaving.current = true;
    router.replace('/scan/quality');
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Same near-black darkroom as capture and crop - dark glyphs would vanish on it. */}
      <StatusBar style="light" />
      <View style={styles.header}>
        {multi ? (
          <View style={styles.headerSide} />
        ) : (
          <Pressable
            hitSlop={12}
            onPress={retake}
            style={styles.headerSide}
            accessibilityRole="button"
            accessibilityLabel={fromGallery ? t('Choose another photo') : t('Retake')}>
            <Icon name={fromGallery ? 'photo.on.rectangle' : 'arrow.counterclockwise'} tintColor="#FFFFFF" size={22} />
          </Pressable>
        )}
        <ThemedText type="headline" style={styles.title}>
          {multi ? t('Your photos') : t('Your photo')}
        </ThemedText>
        <View style={styles.headerSide} />
      </View>

      <View style={styles.body}>
        <View style={[styles.preview, { width: frame, height: frame }]}>
          {shown ? <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} /> : null}
          {multi && shown ? (
            <Pressable
              hitSlop={10}
              onPress={() => remove(shown)}
              style={styles.removeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('Remove this photo')}>
              <Icon name="trash.fill" tintColor="#FFFFFF" size={16} />
            </Pressable>
          ) : null}
        </View>

        {multi ? (
          <View style={styles.strip}>
            {set.map((p, i) => {
              const isSel = p === shown;
              return (
                <Pressable
                  key={p}
                  onPress={() => setSelectedUri(p)}
                  style={[styles.thumb, isSel && styles.thumbSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                  accessibilityLabel={t('Photo {{n}} of {{total}}', { n: i + 1, total: count })}>
                  <Image source={{ uri: p }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <ThemedText type="footnote" style={styles.hint}>
            {t('Make sure the spot is sharp and well lit.')}
          </ThemedText>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Space.lg }]}>
        <Button label={t('Proceed')} variant="brand" onPress={proceed} style={styles.cta} />
        {/* Optional and quiet on purpose: one photo is the standard screening. Kept in the layout at
            the cap (just hidden) so the Proceed button never jumps. */}
        <Pressable
          hitSlop={10}
          onPress={addAnother}
          disabled={atCap}
          style={[styles.secondary, atCap && styles.hidden]}
          accessibilityRole="button"
          accessibilityElementsHidden={atCap}>
          <ThemedText type="subhead" style={styles.secondaryText}>
            {t('Add another angle (optional)')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A1411' },
  // Mirrors crop.tsx's header so the swap between the two screens is seamless.
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSide: { width: 22 },
  title: { color: '#FFFFFF' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.lg },
  preview: {
    borderRadius: Space.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  removeBtn: {
    position: 'absolute',
    top: Space.md,
    right: Space.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,16,13,0.6)',
  },
  strip: { flexDirection: 'row', gap: Space.sm },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#000',
  },
  thumbSelected: { borderColor: Colors.light.brand },
  hint: { color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  footer: { paddingHorizontal: Space.xl, gap: Space.xs, alignItems: 'center' },
  cta: { alignSelf: 'stretch', paddingVertical: Space.base },
  secondary: { paddingVertical: Space.md },
  secondaryText: { color: 'rgba(255,255,255,0.7)' },
  hidden: { opacity: 0 },
});
