import { t } from '@/lib/i18n';
import { useCallback, useState } from 'react';

import { ActionSheet } from '@/components/ui/action-sheet';
import { callNumber, splitPhones, type PhoneOption } from '@/lib/links';

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
