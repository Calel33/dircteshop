import { v } from 'convex/values';

// Reusable validators for the LocalConnect / LocalHub business domain.
// Shared by convex/schema.ts and the business functions so the listing shape
// is defined once. Mirrors the paymentAttemptTypes.ts validator-module pattern.

// Listing lifecycle statuses (SPEC §5). Mutations never accept this directly —
// they accept an action and resolve the target status server-side.
export const listingStatusValidator = v.union(
  v.literal('draft'),
  v.literal('pendingReview'),
  v.literal('approved'),
  v.literal('changesRequested'),
  v.literal('rejected'),
  v.literal('suspended')
);

// A single opening period within a day, e.g. { opensAt: '09:00', closesAt: '17:00' }.
export const openingPeriodValidator = v.object({
  opensAt: v.string(),
  closesAt: v.string(),
});

// Per-day opening periods; a day is optional and absent when closed.
export const hoursValidator = v.object({
  monday: v.optional(v.array(openingPeriodValidator)),
  tuesday: v.optional(v.array(openingPeriodValidator)),
  wednesday: v.optional(v.array(openingPeriodValidator)),
  thursday: v.optional(v.array(openingPeriodValidator)),
  friday: v.optional(v.array(openingPeriodValidator)),
  saturday: v.optional(v.array(openingPeriodValidator)),
  sunday: v.optional(v.array(openingPeriodValidator)),
});

export const addressValidator = v.object({
  addressLine1: v.string(),
  addressLine2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  postalCode: v.optional(v.string()),
  country: v.string(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

// Admin moderation state. verifiedBy is stamped by the approving Super Admin.
export const verificationValidator = v.object({
  isVerified: v.boolean(),
  verifiedAt: v.optional(v.number()),
  verifiedBy: v.optional(v.id('users')),
});

// Stored photos reference Convex file storage (B7 owns uploads).
export const photoValidator = v.object({
  storageId: v.id('_storage'),
  altText: v.optional(v.string()),
  ordering: v.number(),
});
