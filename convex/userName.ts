// Display-name derivation for the Clerk -> `users` sync.
//
// Defect (B6b `/admin/owners`): the sync built the name with a template
// literal, so a Clerk user without a first/last name stored the literal
// "null null" and the owners table rendered it verbatim. This module derives
// the stored name from real identity signals, and gives already-stored bad
// values a readable label at the projection boundary.
//
// Runtime-import-free so `node --test` can value-import it
// (`scripts/user-name.test.ts`).

/** Shown when neither a name nor any identity signal is available. */
export const UNKNOWN_USER_NAME = 'Unknown user';

/** The display-name inputs, mapped from Clerk's `UserJSON` wire fields. */
export type ClerkUserNameSource = {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  emails?: ReadonlyArray<string | null | undefined>;
};

/** True for a part that must never become a display token. */
function isMissingNamePart(part: string): boolean {
  return part === '' || part.toLowerCase() === 'null' || part.toLowerCase() === 'undefined';
}

/** Trims a part and maps absent/legacy placeholder strings to `''`. */
function cleanNamePart(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  return isMissingNamePart(trimmed) ? '' : trimmed;
}

/**
 * The stored display name for a Clerk user: `firstName` + `lastName` when
 * present, else `username`, else the first non-blank email address, else
 * `UNKNOWN_USER_NAME`. Never returns an empty string or a `"null"` token.
 */
export function clerkDisplayName(data: ClerkUserNameSource): string {
  const fullName = [cleanNamePart(data.firstName), cleanNamePart(data.lastName)]
    .filter((part) => part !== '')
    .join(' ');
  if (fullName !== '') {
    return fullName;
  }

  const username = cleanNamePart(data.username);
  if (username !== '') {
    return username;
  }

  for (const email of data.emails ?? []) {
    const address = cleanNamePart(email);
    if (address !== '') {
      return address;
    }
  }

  return UNKNOWN_USER_NAME;
}

/**
 * The label for an already-stored `users.name`. Rows written by the old sync
 * may hold `"null null"` (or a partial like `"Maya null"`); those placeholder
 * tokens are dropped and an empty result falls back to `UNKNOWN_USER_NAME`.
 */
export function storedDisplayName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => cleanNamePart(part))
    .filter((part) => part !== '');
  return parts.length === 0 ? UNKNOWN_USER_NAME : parts.join(' ');
}
