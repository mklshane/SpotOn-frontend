import { t } from '@/lib/i18n';
import { useCallback, useState } from 'react';

import { ActionSheet } from '@/components/ui/action-sheet';
import { callNumber, formatPhone, splitPhones, type PhoneOption } from '@/lib/links';

/**
 * Call a listing's free-text phone field. One number dials straight away; several (about 2% of
 * listings: "0917-547-7622, 7982572, …") open a picker instead of dialling them fused together.
 * Render `sheet` once anywhere in the screen.
 */
export function usePhoneCall() {
  const [choices, setChoices] = useState<PhoneOption[] | null>(null);

  const call = useCallback((raw: string | null | undefined) => {
    const phones = splitPhones(raw);
    if (phones.length === 1) callNumber(phones[0].dial);
    else if (phones.length > 1) setChoices(phones);
  }, []);

  const sheet = (
    <ActionSheet
      visible={choices != null}
      title={t('Choose a number to call')}
      onClose={() => setChoices(null)}
      options={(choices ?? []).map((p) => ({
        key: p.dial,
        label: p.display,
        icon: 'phone.fill' as const,
        onPress: () => callNumber(p.dial),
      }))}
    />
  );

  return { call, sheet };
}

/** True when the field holds at least one dialable number - hide Call otherwise. */
export function hasPhone(raw: string | null | undefined): boolean {
  return splitPhones(raw).length > 0;
}

/**
 * "Call (043) 773 6800" - a Call button names the number it dials, so two buttons on one
 * screen (hospital trunk line vs the doctor's own line) can't be confused. A field holding
 * several numbers shows the first and how many more the picker will offer.
 */
export function callLabel(raw: string | null | undefined): string {
  const phones = splitPhones(raw);
  if (!phones.length) return t('Call');
  const number = formatPhone(phones[0].dial);
  return phones.length > 1
    ? t('Call {{number}} +{{count}}', { number, count: phones.length - 1 })
    : t('Call {{number}}', { number });
}

/** Every dialable number in a phone field, normalised - for spotting the same line twice. */
export function phoneDials(raw: string | null | undefined): string[] {
  return splitPhones(raw).map((p) => p.dial);
}
