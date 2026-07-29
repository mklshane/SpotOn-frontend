const PH_LOCAL_MOBILE_RE = /^9\d{9}$/;
const PH_TRUNK_MOBILE_RE = /^09\d{9}$/;
const PH_COUNTRY_MOBILE_RE = /^639\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keep letters and common name separators while rejecting digits, emoji, and symbols. */
export function sanitizeName(value: string): string {
  return value.replace(/[^\p{L}\p{M}\s.'’,\-]/gu, '');
}

export function getFullNameError(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Full name is required.';

  const letterCount = name.match(/\p{L}/gu)?.length ?? 0;
  if (letterCount < 2) return 'Enter your full name.';
  return undefined;
}

export function getEmailError(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Email address is required.';
  return EMAIL_RE.test(email) ? undefined : 'Enter a valid email address.';
}

export function getLoginPasswordError(value: string): string | undefined {
  return value ? undefined : 'Password is required.';
}

export function getRegistrationPasswordError(value: string): string | undefined {
  if (!value) return 'Password is required.';
  return value.length >= 8 ? undefined : 'Use at least 8 characters.';
}

/**
 * Sanitize the local part used beside the fixed +63 prefix.
 * Also handles pasted 09... and +63... numbers.
 */
export function sanitizeLocalPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const localDigits = digits.startsWith('63')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;

  // Philippine mobile numbers always start with 9 after the +63 prefix.
  if (localDigits && !localDigits.startsWith('9')) return '';
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

export function getLocalPhoneError(value: string): string | undefined {
  const phone = sanitizeLocalPhone(value);

  if (!phone) return 'Phone number is required.';
  if (phone.length < 10) return 'Enter all 10 digits after +63.';
  if (!PH_LOCAL_MOBILE_RE.test(phone)) return 'Enter a valid PH mobile number.';
  return undefined;
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
