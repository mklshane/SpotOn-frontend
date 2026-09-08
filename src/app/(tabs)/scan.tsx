import { t, useLocale } from '@/lib/i18n';
import { ScreenPlaceholder } from '@/components/ui/screen-placeholder';

export default function ScanScreen() {
  useLocale();
  return (
    <ScreenPlaceholder
      icon="camera.fill"
      title={t("Scan a lesion")}
      subtitle={t("Point your camera at a spot for an instant, on-device triage.")}
    />
  );
}
