/**
 * TFLite interpreter access.
 *
 * Native re-exports `react-native-fast-tflite` verbatim. The web build resolves `tflite.web.ts`,
 * which implements the same `loadTensorflowModel` contract over LiteRT.js.
 *
 * The shim sits at THIS level, rather than at lesion-model.ts / classifier-model.ts, so the
 * caching, warm-up, dev-mode download and layout introspection in those two modules stay
 * single-sourced and can't drift between platforms.
 */
export { loadTensorflowModel } from 'react-native-fast-tflite';
