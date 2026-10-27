import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  addressValidator,
  amenitiesValidator,
  hoursValidator,
  listingStatusValidator,
  photoValidator,
  tagsValidator,
  verificationValidator,
} from './businessTypes';
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

  categories: defineTable({
    name: v.string(),
    slug: v.string(),
    icon: v.optional(v.string()),
    ordering: v.number(),
    parentCategoryId: v.optional(v.id('categories')),
  })
    .index('bySlug', ['slug'])
    .index('byParentCategoryId', ['parentCategoryId'])
    .index('byOrdering', ['ordering']),

  businesses: defineTable({
    name: v.string(),
    categoryId: v.id('categories'),
    description: v.string(),
    address: addressValidator,
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    // IANA timezone name, e.g. "America/New_York". bookings.startAt is
    // stored in UTC and rendered in the business's local time.
    timezone: v.string(),
    photos: v.array(photoValidator),
    hours: hoursValidator,
    status: listingStatusValidator,
    verification: verificationValidator,
    rating: v.number(),
    ratingCount: v.number(),
    services: v.array(v.string()),
    credentials: v.array(v.string()),
    keywords: v.array(v.string()),
    // free-form editor values (B3a); optional so pre-existing rows remain valid
    tags: tagsValidator,
    amenities: amenitiesValidator,
    // maintained by mutations as [name, keywords.join(' '), description].join(' ')
    searchText: v.string(),
    ownerId: v.id('users'),
    lastUpdatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    isFeatured: v.boolean(),
    moderationReason: v.optional(v.string()),
    moderatedAt: v.optional(v.number()),
    lastSavedAt: v.optional(v.number()),
    // Order commitment protocol (issue #76, §6.2.2), additive and optional:
    // absent `acceptingOrders` / `orderProtocol` means accepting / 'legacy'.
    acceptingOrders: v.optional(v.boolean()),
    acceptingOrdersUntil: v.optional(v.number()),
    acceptingOrdersNote: v.optional(v.string()),
    orderProtocol: v.optional(v.union(v.literal('legacy'), v.literal('basket'))),
  })
    .index('byStatus', ['status'])
    .index('byStatusSubmittedAt', ['status', 'submittedAt'])
    // Category-filtered queue reads (B3c): step status -> categoryId -> submittedAt
    // in index order so a category page bounds its submittedAt range without
    // scanning unrelated categories. Retains `byStatusSubmittedAt` for the
    // all-category path. Docs: https://docs.convex.dev/database/reading-data/indexes
    .index('byStatusCategorySubmittedAt', ['status', 'categoryId', 'submittedAt'])
    // B6b (issue #16, Task 1): the /admin overview's "submissions this month"
    // count ranges on submittedAt alone, and `byStatusSubmittedAt` requires a
    // status equality first, so it cannot bound the month across statuses.
    // Rows without submittedAt are indexed with undefined and fall below the
    // range's gte month-start bound.
    .index('bySubmittedAt', ['submittedAt'])
    // Landing feed ordering (B4, SPEC §8): approved featured listings by last
    // update, and approved verified listings by verification time. Dot paths
    // index nested fields (https://docs.convex.dev/database/reading-data/indexes).
    .index('byStatusFeaturedUpdatedAt', ['status', 'isFeatured', 'lastUpdatedAt'])
    .index('byStatusVerifiedVerifiedAt', [
      'status',
      'verification.isVerified',
      'verification.verifiedAt',
    ])
    .index('byCategoryId', ['categoryId'])
    .index('byOwnerId', ['ownerId'])
    .searchIndex('searchText', {
      searchField: 'searchText',
      filterFields: ['status', 'categoryId'],
    }),

  // B7 (issue #7) upload ownership. A storage id may only be attached to the
  // listing it was uploaded for, and delete-on-remove may only touch ids this
  // listing owns. Rows are written by the authenticated upload HTTP action;
  // pre-registry photos are registered by the one-time backfill.
  storageUploads: defineTable({
    storageId: v.id('_storage'),
    ownerId: v.id('users'),
    businessId: v.id('businesses'),
    createdAt: v.number(),
  }).index('byStorageId', ['storageId']),

  menuGroups: defineTable({
    businessId: v.id('businesses'),
    name: v.string(),
    description: v.optional(v.string()),
    ordering: v.number(),
    // §6.2.2 additive pause switch; absent means available.
    isAvailable: v.optional(v.boolean()),
  })
    .index('byBusinessId', ['businessId'])
    .index('byBusinessIdOrdering', ['businessId', 'ordering']),

  menuItems: defineTable({
    businessId: v.id('businesses'),
    groupId: v.id('menuGroups'),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    imageStorageId: v.optional(v.id('_storage')),
    customizationOptions: v.array(
      v.object({
        name: v.string(),
        required: v.boolean(),
        options: v.array(
          v.object({
            name: v.string(),
            priceAdjustment: v.optional(v.number()),
          })
        ),
      })
    ),
    ordering: v.number(),
    isAvailable: v.boolean(),
    // v1 nutrition display contract. Neither SPEC nor
    // `wayfinder/research/convex-domain-model.md` pins a shape, so this minimal
    // display-only object is the agreed v1 contract. It is additive: absent means
    // the owner has not published nutrition values.
    nutrition: v.optional(
      v.object({
        calories: v.optional(v.number()),
        proteinGrams: v.optional(v.number()),
        carbohydrateGrams: v.optional(v.number()),
        fatGrams: v.optional(v.number()),
      })
    ),
  })
    .index('byBusinessId', ['businessId'])
    .index('byGroupId', ['groupId'])
    .index('byBusinessIdOrdering', ['businessId', 'ordering']),

  serviceOfferings: defineTable({
    businessId: v.id('businesses'),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    ordering: v.number(),
    isAvailable: v.boolean(),
  })
    .index('byBusinessId', ['businessId'])
    .index('byBusinessIdOrdering', ['businessId', 'ordering']),

  stylists: defineTable({
    businessId: v.id('businesses'),
    name: v.string(),
    bio: v.optional(v.string()),
    photoStorageId: v.optional(v.id('_storage')),
    serviceOfferingIds: v.array(v.id('serviceOfferings')),
    ordering: v.number(),
    isActive: v.boolean(),
  })
    .index('byBusinessId', ['businessId'])
    .index('byBusinessIdOrdering', ['businessId', 'ordering']),

  // Order commitment protocol (issue #76, §6.2.2). Additive expand: every new
  // field is optional so existing rows stay valid and `submitOrder` keeps
  // writing the legacy pair until `placeOrder` ships.
  orders: defineTable({
    businessId: v.id('businesses'),

    // Committed line snapshots. Absent on legacy rows until the backfill runs.
    items: v.optional(
      v.array(
        v.object({
          menuItemId: v.id('menuItems'),
          name: v.string(),
          unitPrice: v.optional(v.number()), // integer cents; absent = unpriced
          quantity: v.number(), // 1..20
          selections: v.array(
            v.object({
              optionName: v.string(),
              choiceName: v.string(),
              priceAdjustment: v.optional(v.number()), // integer cents
            })
          ),
          lineTotal: v.optional(v.number()),
        })
      )
    ),
    subtotal: v.optional(v.number()), // absent if any line is unpriced
    pricingSource: v.optional(v.union(v.literal('snapshot'), v.literal('legacyUnknown'))),

    customerName: v.string(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    note: v.optional(v.string()),

    status: v.union(
      v.literal('new'),
      v.literal('accepted'),
      v.literal('ready'),
      v.literal('completed'),
      v.literal('declined'),
      v.literal('cancelled'),
      v.literal('expired'),
      v.literal('no_show')
    ),
    statusReason: v.optional(v.string()),
    statusUpdatedAt: v.optional(v.number()), // fall back to createdAt on legacy rows
    expiresAt: v.optional(v.number()), // display only; the sweep reads orderExpiry
    customerUserId: v.optional(v.id('users')),

    createdAt: v.number(),

    // Legacy single-item fields kept during expand; `submitOrder` still writes them.
    menuItemId: v.optional(v.id('menuItems')),
    selections: v.optional(
      v.array(
        v.object({
          optionName: v.string(),
          choiceName: v.string(),
        })
      )
    ),
  })
    .index('byBusinessId', ['businessId'])
    // §6.2.2 board filters. T2 never queries this index, so it ships plain
    // (synchronous deploy) rather than `staged`; the `orders` table is small
    // enough that the backfill does not need the two-deploy path.
    .index('byBusinessIdStatus', ['businessId', 'status']),

  // A bearer capability and a human reference, separate from the order so a
  // broad owner query or export cannot accidentally expose the token.
  orderAccess: defineTable({
    orderId: v.id('orders'),
    businessId: v.id('businesses'),
    accessToken: v.string(), // 32 random bytes, base64url; 256 bits
    reference: v.string(), // 6 chars, unique per business; not a capability
    createdAt: v.number(),
  })
    .index('byAccessToken', ['accessToken'])
    .index('byOrderId', ['orderId'])
    .index('byBusinessIdReference', ['businessId', 'reference']),

  // Idempotency is scoped to a business; keys are not global.
  orderIdempotency: defineTable({
    businessId: v.id('businesses'),
    key: v.string(), // client UUID, 16..64 chars
    argsHash: v.string(), // SHA-256 hex of canonical args
    orderId: v.id('orders'),
    createdAt: v.number(),
  })
    .index('byBusinessIdKey', ['businessId', 'key'])
    .index('byCreatedAt', ['createdAt']),

  // A required-field expiry schedule. Legacy rows are never inserted here, so an
  // optional `orders.expiresAt` cannot pull them into the sweep.
  orderExpiry: defineTable({
    orderId: v.id('orders'),
    businessId: v.id('businesses'),
    expiresAt: v.number(),
  })
    .index('byExpiresAt', ['expiresAt'])
    .index('byOrderId', ['orderId']),

  // Append-only audit of order transitions.
  orderEvents: defineTable({
    orderId: v.id('orders'),
    businessId: v.id('businesses'),
    actorType: v.union(v.literal('customer'), v.literal('owner'), v.literal('system')),
    actorUserId: v.optional(v.id('users')),
    action: v.union(
      v.literal('submitted'),
      v.literal('accepted'),
      v.literal('declined'),
      v.literal('cancelled'),
      v.literal('ready'),
      v.literal('completed'),
      v.literal('expired'),
      v.literal('no_show')
    ),
    fromStatus: v.optional(v.string()),
    toStatus: v.string(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  }).index('byOrderIdCreatedAt', ['orderId', 'createdAt']),

  // Fixed-window counters. Contact keys are hashes; business keys are ids.
  orderThrottle: defineTable({
    key: v.string(), // "contact:<businessId>:<sha256>:10m" | "contact:<businessId>:<sha256>:24h" | "business:<id>:10m"
    windowStart: v.number(),
    count: v.number(),
  }).index('byKey', ['key']),

  // Owner-managed block list. The contact is hashed at rest.
  orderBlocks: defineTable({
    businessId: v.id('businesses'),
    contactHash: v.string(), // SHA-256 of normalized phone/email
    reason: v.optional(v.string()),
    createdByUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('byBusinessIdContactHash', ['businessId', 'contactHash'])
    // The owner block-list page reads the newest rows for one business; the
    // compound hash index above cannot order by recency.
    .index('byBusinessIdCreatedAt', ['businessId', 'createdAt']),

  bookings: defineTable({
    businessId: v.id('businesses'),
    serviceOfferingId: v.id('serviceOfferings'),
    stylistId: v.optional(v.id('stylists')),
    customerName: v.string(),
    customerPhone: v.string(),
    customerEmail: v.string(),
    // stored in UTC; rendered in the business's local time
    startAt: v.number(),
    cancelToken: v.string(),
    status: v.union(
      v.literal('requested'),
      v.literal('confirmed'),
      v.literal('declined'),
      v.literal('cancelled')
    ),
  })
    .index('byBusinessId', ['businessId'])
    .index('byCancelToken', ['cancelToken']),

  quoteRequests: defineTable({
    businessId: v.id('businesses'),
    customerName: v.string(),
    customerContact: v.string(),
    message: v.string(),
    sourceLabel: v.optional(v.string()),
    status: v.union(v.literal('new'), v.literal('responded'), v.literal('closed')),
    createdAt: v.number(),
  }).index('byBusinessId', ['businessId']),

  auditLogs: defineTable({
    actorUserId: v.id('users'),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    // Immutable name snapshot written by every business audit path (B6a hard
    // delete REQUIRES it); the delete cascade also backfills legacy rows
    // before the target disappears, and the audit query falls back to the live
    // business name only when no snapshot exists (issue #15 §B4/§B5).
    targetName: v.optional(v.string()),
    fromStatus: v.optional(listingStatusValidator),
    toStatus: v.optional(listingStatusValidator),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('byActorUserId', ['actorUserId'])
    .index('byTarget', ['targetType', 'targetId'])
    // B6a (issue #15, Task 2): newest-first audit reads page this index.
    .index('byCreatedAt', ['createdAt']),

  notifications: defineTable({
    userId: v.id('users'),
    type: v.string(),
    businessId: v.optional(v.id('businesses')),
    message: v.string(),
    reason: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('byUserId', ['userId'])
    // B5 (issue #5): newest-first user lists and unread-only reads. The read
    // path steps userId -> createdAt desc for pagination and userId ->
    // readAt === undefined for the badge/batch reads (undefined matches rows
    // without the field; https://docs.convex.dev/database/types#working-with-undefined).
    .index('byUserIdAndCreatedAt', ['userId', 'createdAt'])
    .index('byUserIdAndReadAt', ['userId', 'readAt'])
    // B6a (issue #15, Task 5): bounds the hard-delete cascade's notification
    // lookup by business instead of scanning the whole table.
    .index('byBusinessId', ['businessId']),
});
