import { isSafeExternalUrl } from '../../lib/utils.ts';

// Public directory card actions (SPEC §8): one shared `BusinessCard`, actions
// capped at two, and only ever working destinations — the public profile, a
// `tel:` link, or a scheme-guarded website. Booking/order/quote workflow
// actions stay deferred to their own tickets (B8-B10).
//
// Pure data + function (no React imports), pinned by
// `scripts/directory-card-actions.test.ts`. The `.ts` extension keeps the
// module importable under plain `node --test` (allowImportingTsExtensions).

export const DIRECTORY_CARD_ACTION_LIMIT = 2;

export type DirectoryCardAction = {
  kind: 'profile' | 'call' | 'website';
  href: string;
};

type ActionSource = {
  _id: string;
  phone?: string;
  website?: string;
};

/**
 * Resolves the card's working actions: the profile link always leads; the
 * second slot prefers `tel:` over a safe website. A blank/absent phone or an
 * unsafe website scheme (owner-supplied `javascript:`/`data:` values) simply
 * yields fewer actions rather than a broken link.
 */
export function resolveDirectoryCardActions(business: ActionSource): DirectoryCardAction[] {
  const actions: DirectoryCardAction[] = [
    { kind: 'profile', href: `/business/${business._id}` },
  ];

  const phone = business.phone?.trim();
  if (phone !== undefined && phone.length > 0) {
    actions.push({ kind: 'call', href: `tel:${phone}` });
  } else if (isSafeExternalUrl(business.website)) {
    actions.push({ kind: 'website', href: business.website });
  }

  return actions.slice(0, DIRECTORY_CARD_ACTION_LIMIT);
}
