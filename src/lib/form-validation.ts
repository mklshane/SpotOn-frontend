const PH_LOCAL_MOBILE_RE = /^9\d{9}$/;
const PH_TRUNK_MOBILE_RE = /^09\d{9}$/;
const PH_COUNTRY_MOBILE_RE = /^639\d{9}$/;

/** Remove digits from a person's name while preserving letters, punctuation, and spacing. */
export function sanitizeName(value: string): string {
  return value.replace(/\d/g, '');
}

/**
 * Sanitize the local part used beside the fixed +63 prefix.
 * Also handles pasted 09... and +63... numbers.
 */
export function sanitizeLocalPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const localDigits = PH_COUNTRY_MOBILE_RE.test(digits)
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;

  return localDigits.slice(0, 10);
}

/** Keep profile phone input numeric, with an optional leading + for E.164 values. */
export function sanitizePhone(value: string): string {
  const trimmed = value.trimStart();
  const digits = trimmed.replace(/\D/g, '');
  const maxLength = digits.startsWith('63') ? 12 : digits.startsWith('0') ? 11 : 10;
  const sanitizedDigits = digits.slice(0, maxLength);

  return trimmed.startsWith('+') ? `+${sanitizedDigits}` : sanitizedDigits;
}

export function isValidLocalPhone(value: string): boolean {
  return PH_LOCAL_MOBILE_RE.test(sanitizeLocalPhone(value));
}

/**
 * Return a valid Philippine mobile number in E.164 format, or null when invalid.
 * Accepted inputs: 9171234567, 09171234567, and +639171234567.
 */
export function normalizePhilippinePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');

  if (PH_LOCAL_MOBILE_RE.test(digits)) return `+63${digits}`;
  if (PH_TRUNK_MOBILE_RE.test(digits)) return `+63${digits.slice(1)}`;
  if (PH_COUNTRY_MOBILE_RE.test(digits)) return `+${digits}`;
  return null;
}
