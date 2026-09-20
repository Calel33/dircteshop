import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Guard for external URLs rendered into href attributes. Owner-supplied
 * `businesses.website` must never execute as `javascript:`/`data:` URIs on a
 * public page (stored XSS); anything that is not a real http(s) URL fails the
 * check. Returns the original string when safe, `undefined` otherwise, so a
 * URL that fails validation degrades visibly (plain text / disabled button)
 * rather than being relabeled or dropped silently.
 *
 * Docs: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
 * (see also OWASP "Unvalidated URLs and web redirects")
 */
export function isSafeExternalUrl(value: string | undefined | null): value is string {
  if (value === undefined || value === null || value.length === 0) {
    return false;
  }

  return /^https?:\/\//i.test(value);
}
