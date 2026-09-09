import { t, useLocale } from '@/lib/i18n';
/**
 * Web capture — still photo instead of the live frame-processor viewfinder.
 *
 * The native screen (capture.tsx) runs the YOLO detector on every camera frame through
 * VisionCamera frame processors and react-native-worklets-core, neither of which exists on web.
 * Rather than reimplement live tracking on a rAF loop, the web replica captures a still and lets
 * the *existing* still pipeline do the work: classify.ts runs the detector on the captured image
 * via lesion-detector.ts, and falls back to full-frame + DoG zoom refinement when no box is found.
 *
 * That is not a special web-only path — it is exactly what a native capture does when the live
 * detector doesn't fire (about 9.5% of stills with y11n_v1). So the triage answer a web tester
 * gets is produced by the same code as on the phone. What they don't exercise is the framing
 * coach, so framing-UX feedback from web does not transfer to the native capture experience.
 *
 * Hand-off matches capture.tsx exactly: push /scan/crop with a renderable `uri`, and
 * `detected: '0'` because there is no live box to forward.
 */
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { GradientBackground } from '@/components/ui/gradient-background';
import { Icon } from '@/components/ui/icon';
import { Colors, Space } from '@/constants/theme';
import * as FileSystem from '@/lib/fs';
import { MAX_IMAGES_PER_SCREENING } from '@/lib/classifier/model-config';
import { prewarmLesionModel } from '@/lib/lesion-model';
import { useScreeningSession } from '@/lib/screening-session';

/** Same cap capture.tsx applies when baking in EXIF orientation. */
const PHOTO_LONG_EDGE = 2048;
/** JPEG quality, matching the native manipulateAsync compress value. */
const JPEG_QUALITY = 0.92;
/** Digital zoom ceiling. Past ~4x a phone sensor is only magnifying noise. */
const MAX_ZOOM = 4;

/**
 * How long to wait for getUserMedia before giving up.
 *
 * A *denied* prompt rejects immediately, but a *dismissed* one (Esc, ignored, tab blurred
 * before answering) leaves the promise pending forever — which stranded the screen on
 * "Starting camera…" with a permanently disabled shutter and no way back.
 */
const CAMERA_START_TIMEOUT_MS = 10_000;
/** Longest we'll wait for the first real frame after play() before calling the camera dead. */
const FIRST_FRAME_TIMEOUT_MS = 4_000;
const TIMED_OUT = '__spoton_camera_timeout__';

/**
 * Resolve once the video reports real dimensions. play() can reject under an autoplay policy —
 * we swallow that — leaving a 0x0 element; going 'live' on one arms a shutter that shoot()
 * silently drops, so the preview has to prove itself first.
 */
function waitForFirstFrame(video: HTMLVideoElement): Promise<boolean> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onMeta);
      resolve(ok);
    };
    const onMeta = () => done(video.videoWidth > 0 && video.videoHeight > 0);
    const timer = setTimeout(() => done(false), FIRST_FRAME_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', onMeta);
  });
}

type Status = 'starting' | 'live' | 'denied' | 'unavailable' | 'timeout';

export default function CaptureWebScreen() {
  useLocale();
  const insets = useSafeAreaInsets();
  const session = useScreeningSession();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Derived lazily rather than set in the mount effect: a browser with no getUserMedia is
  // already 'unavailable' on first render, which keeps start() free of any synchronous setState
  // (react-hooks/immutability rejects one called directly from an effect).
  const [status, setStatus] = useState<Status>(() =>
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
      ? 'starting'
      : 'unavailable',
  );
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(true);
  /**
   * Digital zoom, 1–4x. Applied by cropping the source rect at capture time, so the model sees
   * the zoomed frame rather than just the user seeing a bigger preview — a lesion framed at 3x
   * really does arrive larger in the pixels the classifier reads.
   *
   * Deliberately NOT the MediaStreamTrack `zoom` constraint: WebKit does not expose it, and every
   * iOS browser is WebKit, so a constraint-only implementation would do nothing on the iPhones
   * most testers use. Where the constraint IS available (Android Chrome) we drive it too, below,
   * to get real optical zoom on top.
   */
  const [zoom, setZoom] = useState(1);
  /** Torch is genuinely impossible on iOS (no WebKit API); the control hides rather than lies. */
  const [caps, setCaps] = useState<{ torch: boolean; zoom: { min: number; max: number } | null }>({
    torch: false,
    zoom: null,
  });
  const [torchOn, setTorchOn] = useState(false);

  // Same trick as the native body screen: get the detector loading before the user needs it.
  useEffect(() => {
    prewarmLesionModel();
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Open the camera whenever `attempt` changes (mount, and each retry).
   *
   * Inlined rather than called out to a helper so every setState lands in a promise
   * continuation: React's lint rules reject a synchronous setState reached directly from an
   * effect body, and rightly — the state here is only ever known after getUserMedia resolves.
   */
  useEffect(() => {
    if (status === 'unavailable' && attempt === 0) return; // no camera API at all
    let cancelled = false;
    let gaveUp = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        // `environment` asks for the rear camera on phones and is simply ignored on desktops.
        const request = navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        // If the prompt is answered after we've stopped waiting, the stream still lands here.
        // Stop it, or the browser keeps the camera indicator lit on a screen that moved on.
        request
          .then((late) => {
            if (gaveUp || cancelled) late.getTracks().forEach((t) => t.stop());
          })
          .catch(() => {});

        const stream = await Promise.race([
          request,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              gaveUp = true;
              reject(new Error(TIMED_OUT));
            }, CAMERA_START_TIMEOUT_MS);
          }),
        ]);
        clearTimeout(timer);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          const running = await waitForFirstFrame(videoRef.current);
          if (cancelled) return;
          if (!running) {
            console.warn('[capture.web] preview never produced a frame');
            setStatus('unavailable');
            return;
          }
        }
        // What this particular camera can actually do. iOS reports neither.
        const track = stream.getVideoTracks()[0];
        const c = (track?.getCapabilities?.() ?? {}) as {
          torch?: boolean;
          zoom?: { min: number; max: number };
        };
        if (!cancelled) {
          setCaps({
            torch: c.torch === true,
            zoom: c.zoom && c.zoom.max > c.zoom.min ? { min: c.zoom.min, max: c.zoom.max } : null,
          });
          setStatus('live');
        }
      } catch (e) {
        clearTimeout(timer);
        if (cancelled) return;
        if ((e as Error)?.message === TIMED_OUT) {
          console.warn('[capture.web] camera did not start within %dms', CAMERA_START_TIMEOUT_MS);
          setStatus('timeout');
          return;
        }
        // NotAllowedError is a refusal; everything else (no device, in use) is unavailability.
        console.warn('[capture.web] camera unavailable', e);
        setStatus((e as Error)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
    };
    // `status` is deliberately not a dependency: it is written by this effect, and re-running on
    // its own writes would loop. `attempt` is the retry signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, stop]);

  /**
   * Drive the hardware where it exists. Digital zoom always applies at capture; this maps the
   * same slider onto real optical zoom when the track supports it, so Android gets both.
   */
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !caps.zoom) return;
    const { min, max } = caps.zoom;
    // Map 1..MAX_ZOOM onto the device's own range.
    const target = min + ((Math.min(zoom, MAX_ZOOM) - 1) / (MAX_ZOOM - 1)) * (max - min);
    track
      // `zoom` is a non-standard constraint (absent from lib.dom), hence the cast.
      .applyConstraints({ advanced: [{ zoom: target }] } as unknown as MediaTrackConstraints)
      .catch(() => { /* the track can refuse mid-stream; digital zoom still applies */ });
  }, [zoom, caps.zoom]);

  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !caps.torch) return;
    track
      // `torch` is likewise non-standard — Chromium-only in practice.
      .applyConstraints({ advanced: [{ torch: torchOn }] } as unknown as MediaTrackConstraints)
      .catch(() => { /* torch can fail while the camera is warming up */ });
  }, [torchOn, caps.torch]);

  /** Draw the current frame, downscaled to the same long-edge cap the native path uses. */
  async function shoot() {
    const video = videoRef.current;
    if (!video || busy || status !== 'live') return;
    setBusy(true);
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      // Digital zoom = take a centred sub-rect of the frame. The output stays the same size, so
      // the lesion occupies more pixels — which is the whole point, since the classifier crops
      // from this image. `native` already applied optical zoom on top where it was supported.
      const z = Math.max(1, Math.min(zoom, MAX_ZOOM));
      const sw = vw / z;
      const sh = vh / z;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
      );
      if (!blob) throw new Error('canvas produced no image');

      // Land it in the virtual cache dir rather than keeping a bare object URL, so the file
      // behaves like a native capture: renderable downstream, and swept by discardScratch.
      const objectUrl = URL.createObjectURL(blob);
      const dest = `${FileSystem.cacheDirectory}capture-${Date.now()}.jpg`;
      try {
        await FileSystem.copyAsync({ from: objectUrl, to: dest });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      session.setSource('camera');
      router.push({ pathname: '/scan/crop', params: { uri: dest, detected: '0' } });
    } catch (e) {
      console.warn('[capture.web] capture failed', e);
    } finally {
      setBusy(false);
    }
  }

  /** Desktop testers, and anyone whose browser won't hand over a camera. */
  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    session.setSource('gallery');
    router.push({ pathname: '/scan/crop', params: { uri: result.assets[0].uri, source: 'gallery' } });
  }

  if (status === 'denied' || status === 'unavailable' || status === 'timeout') {
    // 'unavailable' is the only one retrying can't help with — there is no camera to reach.
    const canRetry = status !== 'unavailable';
    const title =
      status === 'denied'
        ? t("Camera access needed")
        : status === 'timeout'
          ? t("Camera didn't start")
          : t("No camera available");
    const body =
      status === 'denied'
        ? t("SpotOn uses your camera to capture the skin spot for triage. Allow camera access in your browser, then try again.")
        : status === 'timeout'
          ? t("Your browser never answered the camera permission prompt. Look for a blocked-camera icon in the address bar, then try again — or upload a photo instead.")
          : t("This device or browser has no camera SpotOn can use. You can still upload a photo instead.");
    return (
      <View style={[styles.black, styles.permission, { paddingTop: insets.top + Space.huge }]}>
        <ThemedText type="title2" style={styles.permTitle}>
          {title}
        </ThemedText>
        <ThemedText type="body" style={styles.permBody}>
          {body}
        </ThemedText>
        {canRetry ? (
          <Button
            label={t("Try again")}
            variant="brand"
            onPress={() => {
              setStatus('starting');
              setAttempt((n) => n + 1);
            }}
            style={styles.permBtn}
          />
        ) : null}
        <Button label={t("Upload a photo")} variant="outline" onPress={pickFromGallery} style={styles.permBtn} />
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <ThemedText type="headline" style={styles.permCancel}>
            {t("Not now")}</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.black}>
      {/* RNW renders View as a div, so a raw <video> composes normally inside it. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          // Preview mirror of the capture-time crop, so what you frame is what you get.
          transform: `scale(${zoom})`,
          transformOrigin: 'center',
        }}
      />

      {guide ? <View pointerEvents="none" style={styles.guideRing} /> : null}

      <View style={[styles.banner, { top: insets.top + Space.xxl }]} pointerEvents="none">
        <ThemedText type="subhead" style={styles.bannerText}>
          {status === 'live' ? t("Fill the circle with the spot") : t("Starting camera…")}
        </ThemedText>
      </View>

      <Pressable
        hitSlop={12}
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + Space.sm }]}
        accessibilityRole="button"
        accessibilityLabel={t("Close camera")}>
        <Icon name="xmark" tintColor="#FFFFFF" size={22} />
      </Pressable>

      <Pressable
        onPress={() => router.push('/scan/instructions')}
        style={styles.instructions}
        accessibilityRole="button">
        <ThemedText type="subhead" style={styles.instructionsLabel}>
          {t("Instructions")}</ThemedText>
      </Pressable>

      {/* Zoom — always available: it is a canvas crop, so it works even on iOS where the
          MediaStreamTrack zoom constraint does not exist. */}
      {status === 'live' ? (
        <View style={[styles.zoomBar, { bottom: insets.bottom + 132 }]}>
          <ThemedText type="caption" style={styles.zoomLabel}>
            {zoom.toFixed(1)}×
          </ThemedText>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number((e.target as HTMLInputElement).value))}
            aria-label={t('Zoom')}
            style={{ flex: 1, accentColor: '#FF8A4C' }}
          />
          {/* Torch only exists on Chromium/Android; on iPhone the button is absent, not dead. */}
          {caps.torch ? (
            <Pressable
              hitSlop={12}
              onPress={() => setTorchOn((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ selected: torchOn }}
              accessibilityLabel={t('Toggle flash')}>
              <Icon name={torchOn ? 'bolt.fill' : 'bolt.slash.fill'} tintColor="#FFFFFF" size={24} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + Space.lg }]}>
        <Pressable
          hitSlop={12}
          onPress={pickFromGallery}
          style={styles.sideBtn}
          accessibilityRole="button"
          accessibilityLabel={t("Upload a photo")}>
          <Icon name="photo.on.rectangle" tintColor="#FFFFFF" size={26} />
        </Pressable>

        {session.images.length > 0 ? (
          <View style={styles.shotCount} pointerEvents="none">
            <ThemedText type="caption" style={styles.shotCountText}>
              {session.images.length} {t("of")} {MAX_IMAGES_PER_SCREENING}
            </ThemedText>
          </View>
        ) : null}

        <Pressable
          onPress={shoot}
          disabled={busy || status !== 'live'}
          style={styles.shutter}
          accessibilityRole="button"
          accessibilityLabel={t("Capture")}>
          <GradientBackground
            variant="sunsetVivid"
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.shutterFill}
          />
          <Icon name="camera.fill" tintColor="#FFFFFF" size={28} />
        </Pressable>

        <Pressable
          hitSlop={12}
          onPress={() => setGuide((v) => !v)}
          style={styles.sideBtn}
          accessibilityRole="button"
          accessibilityLabel={t("Toggle guide")}>
          <View style={[styles.toggle, guide && styles.toggleOn]}>
            <View style={[styles.knob, guide && styles.knobOn]} />
          </View>
          <ThemedText type="caption" style={styles.guideLabel}>
            {t("Guide")}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000000' },
  permission: { alignItems: 'center', paddingHorizontal: Space.xl, gap: Space.md },
  permTitle: { color: '#FFFFFF', textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  permBtn: { alignSelf: 'stretch', marginTop: Space.sm },
  permCancel: { color: 'rgba(255,255,255,0.75)', marginTop: Space.lg },
  guideRing: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    width: '70%',
    aspectRatio: 1,
    transform: [{ translateY: '-50%' }],
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  banner: { position: 'absolute', alignSelf: 'center', paddingHorizontal: Space.md, paddingVertical: Space.xs, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' },
  bannerText: { color: '#FFFFFF' },
  close: { position: 'absolute', left: Space.lg, padding: Space.xs },
  instructions: { position: 'absolute', right: Space.lg, top: Space.xxl, padding: Space.xs },
  instructionsLabel: { color: '#FFFFFF', textDecorationLine: 'underline' },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: Space.lg,
  },
  sideBtn: { alignItems: 'center', gap: Space.xs, width: 64 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  shutterFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  zoomBar: {
    position: 'absolute',
    left: Space.xl,
    right: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  zoomLabel: { color: '#FFFFFF', minWidth: 38 },
  shotCount: { position: 'absolute', top: -Space.xs, alignSelf: 'center' },
  shotCountText: { color: '#FFFFFF' },
  toggle: { width: 34, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.3)', padding: 2 },
  toggleOn: { backgroundColor: Colors.light.brand },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 14 }] },
  guideLabel: { color: '#FFFFFF' },
});
