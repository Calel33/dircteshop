import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

// Order commitment protocol §6.2.4 / §6.2.6 (issue #76, T2): the bearer token
// and the human reference live in `orderAccess`, never on the `orders` row.
// These are plain helpers, not registered functions, so nothing here is
// client-callable — only internal functions may import them.
//
// Token: 32 bytes (256 bits) from `crypto.getRandomValues`, base64url without
// padding (43 chars). Convex mutations back `getRandomValues` with the
// per-execution seeded RNG, not the OS CSPRNG, and retries replay the same
// stream — which is exactly what keeps a retried batch idempotent. Never derive
// the token from an id, a timestamp, or contact data, and never log it.
//
// Reference: 6 chars from the §6.2.4 alphabet (no 0/O/1/I), unique per business.
// Convex has no unique indexes, so uniqueness is a transactional check against
// `byBusinessIdReference`; retry up to 5 times on collision, then use 7 chars.

const TOKEN_BYTES = 32;
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const REFERENCE_LENGTH = 6;
const REFERENCE_COLLISION_RETRIES = 5;
// Bounded so a pathological collision run fails loudly instead of looping. In
// practice one pass succeeds: the alphabet is 32 chars, so 6 chars ≈ 1.07e9
// candidates and 7 chars ≈ 3.4e10, checked inside the mutation transaction.
const MAX_INSERT_ATTEMPTS = 12;

/** 32 random bytes → unpadded base64url (43 chars, `A-Za-z0-9-_`). */
export function createAccessToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  // `btoa` exists in the default Convex runtime; `Buffer` does not.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomReference(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let reference = '';
  for (const byte of bytes) {
    // 256 is a multiple of the 32-char alphabet, so `%` is unbiased here.
    reference += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return reference;
}

/**
 * Mints a reference that is absent from `existing`. Six chars first; after
 * `REFERENCE_COLLISION_RETRIES` collisions, seven chars. Throws after a bounded
 * number of attempts rather than looping forever.
 */
export function createReference(existing: ReadonlySet<string>): string {
  for (let attempt = 0; attempt <= REFERENCE_COLLISION_RETRIES; attempt += 1) {
    const candidate = randomReference(REFERENCE_LENGTH);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  for (let attempt = 0; attempt <= REFERENCE_COLLISION_RETRIES; attempt += 1) {
    const candidate = randomReference(REFERENCE_LENGTH + 1);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not mint a unique order reference');
}

/**
 * Inserts one `orderAccess` row with a fresh token and a reference unique
 * within the business. The collision check and the insert share the caller's
 * transaction, which is the serialization point Convex provides in place of a
 * unique index. `tried` only avoids re-proposing a reference that already
 * clashed in this call; the database lookup is what enforces per-business
 * uniqueness.
 */
export async function insertOrderAccess(
  ctx: MutationCtx,
  args: { orderId: Id<'orders'>; businessId: Id<'businesses'> }
): Promise<{ accessToken: string; reference: string }> {
  const accessToken = createAccessToken();
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const reference = createReference(tried);
    tried.add(reference);

    const clash = await ctx.db
      .query('orderAccess')
      .withIndex('byBusinessIdReference', (q) =>
        q.eq('businessId', args.businessId).eq('reference', reference)
      )
      .first();
    if (clash === null) {
      await ctx.db.insert('orderAccess', {
        orderId: args.orderId,
        businessId: args.businessId,
        accessToken,
        reference,
        createdAt: Date.now(),
      });
      return { accessToken, reference };
    }
  }

  throw new Error('Could not allocate a unique order reference');
}

/** True when this order already has its access row. One index lookup, no pagination. */
export async function hasOrderAccess(
  ctx: QueryCtx | MutationCtx,
  orderId: Id<'orders'>
): Promise<boolean> {
  const access = await ctx.db
    .query('orderAccess')
    .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
    .first();
  return access !== null;
}
