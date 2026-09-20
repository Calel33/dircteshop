import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  addressValidator,
  hoursValidator,
  listingStatusValidator,
  photoValidator,
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
    // maintained by mutations as [name, keywords.join(' '), description].join(' ')
    searchText: v.string(),
    ownerId: v.id('users'),
    lastUpdatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    isFeatured: v.boolean(),
    moderationReason: v.optional(v.string()),
    moderatedAt: v.optional(v.number()),
    lastSavedAt: v.optional(v.number()),
  })
    .index('byStatus', ['status'])
    .index('byCategoryId', ['categoryId'])
    .index('byOwnerId', ['ownerId'])
    .searchIndex('searchText', {
      searchField: 'searchText',
      filterFields: ['status', 'categoryId'],
    }),

  menuGroups: defineTable({
    businessId: v.id('businesses'),
    name: v.string(),
    description: v.optional(v.string()),
    ordering: v.number(),
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

  orders: defineTable({
    businessId: v.id('businesses'),
    menuItemId: v.id('menuItems'),
    selections: v.array(
      v.object({
        optionName: v.string(),
        choiceName: v.string(),
      })
    ),
    customerName: v.string(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    status: v.union(
      v.literal('new'),
      v.literal('accepted'),
      v.literal('ready'),
      v.literal('completed')
    ),
    createdAt: v.number(),
  })
    .index('byBusinessId', ['businessId']),

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
  })
    .index('byBusinessId', ['businessId']),

  auditLogs: defineTable({
    actorUserId: v.id('users'),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    fromStatus: v.optional(listingStatusValidator),
    toStatus: v.optional(listingStatusValidator),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('byActorUserId', ['actorUserId'])
    .index('byTarget', ['targetType', 'targetId']),

  notifications: defineTable({
    userId: v.id('users'),
    type: v.string(),
    businessId: v.optional(v.id('businesses')),
    message: v.string(),
    reason: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('byUserId', ['userId']),
});
