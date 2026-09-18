import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { paymentAttemptSchemaValidator } from './paymentAttemptTypes';

export default defineSchema({
  users: defineTable({
    name: v.string(),
    // this the Clerk ID, stored in the subject JWT field
    externalId: v.string(),
    // stamped ONLY by upsertFromClerk from SUPER_ADMIN_CLERK_IDS; never client-writable
    role: v.union(v.literal('user'), v.literal('superAdmin')),
  }).index('byExternalId', ['externalId']),

  paymentAttempts: defineTable(paymentAttemptSchemaValidator)
    .index('byPaymentId', ['payment_id'])
    .index('byUserId', ['userId'])
    .index('byPayerUserId', ['payer.user_id']),
});
