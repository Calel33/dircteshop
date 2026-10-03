/**
 * Convex document ids are Crockford base32 (lowercase alphabet
 * "0123456789abcdefghjkmnpqrstvwxyz", so no i/l/o/u) encoding an id-v6 payload
 * of 19–23 bytes — 31–37 characters. Real `businesses` ids fall at the short
 * end (31–32 characters).
 *
 * Sources:
 * - https://github.com/get-convex/convex-backend/blob/main/crates/value/src/base32.rs
 * - https://github.com/get-convex/convex-backend/blob/main/crates/value/src/id_v6.rs
 *
 * This is a structural check only: it cannot verify the embedded checksum, so a
 * 31–37 character string that skips this guard but is not a canonical id is
 * still rejected by `getMine`'s `v.id('businesses')` argument validation. The
 * editor's error boundary maps that failure to the same not-found state.
 */
const CONVEX_ID_PATTERN = /^[0-9abcdefghjkmnpqrstvwxyz]{31,37}$/;

/**
 * True when `value` has the shape of a Convex document id. Used to decide
 * whether a URL segment is safe to pass to a `v.id(...)` query argument.
 */
export function looksLikeConvexId(value: string): boolean {
  return CONVEX_ID_PATTERN.test(value);
}
