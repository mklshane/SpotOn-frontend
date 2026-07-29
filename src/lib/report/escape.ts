const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value for HTML text or attribute context. Null/undefined collapse to ''.
 *
 * Every interpolation in report-html.ts goes through this. The only unescaped insertions
 * there are the static <style> block, a `data:` URI validated against a strict regex, and
 * rich-text runs whose segments are each escaped individually.
 */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Terse alias for use inside template literals. */
export const h = escapeHtml;
