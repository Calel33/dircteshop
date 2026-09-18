# Research Asset: Convex domain model for LocalConnect (ticket 01)

Source: /research subagent, resolved at map charting. All template claims cite fetched file contents from https://github.com/Calel33/template-app (master).

## Template Findings

- `convex/schema.ts`: `users {name: v.string(), externalId: v.string()}` with `.index('byExternalId', ['externalId'])`; `paymentAttempts` with indexes `byPaymentId`, `byUserId`, `byPayerUserId`.
- `convex/users.ts`: `current` query, `upsertFromClerk` / `deleteFromClerk` internal mutations, `getCurrentUserOrThrow`, `getCurrentUser`. Identity: `ctx.auth.getUserIdentity()` → lookup `users` via `byExternalId` on `identity.subject`. User record created: `{name, externalId: data.id}` — **no role field**.
- `convex/paymentAttempts.ts` / `paymentAttemptTypes.ts`: `userId: v.optional(v.id('users'))` — the reference pattern ownerId follows (but required).
- `convex/http.ts`: POST `/clerk-users-webhook`, Svix signature validation, dispatches user.created/updated/deleted to internal mutations.
- `convex/auth.config.ts`: Clerk provider `{domain: process.env.NEXT_PUBLIC_CLERK_FRONTEND_API_URL, applicationID: 'convex'}`.
- `package.json`: `convex: "^1.31.2"`.

## Recommended v1 Schema (paste-ready)

```ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const listingStatus = v.union(
  v.literal('draft'),
  v.literal('pendingReview'),
  v.literal('approved'),
  v.literal('changesRequested'),
  v.literal('rejected'),
  v.literal('suspended')
);

const businessAddress = v.object({
  addressLine1: v.string(),
  addressLine2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  postalCode: v.optional(v.string()),
  country: v.string(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

const businessHours = v.object({
  monday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
  tuesday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
  wednesday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
  thursday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
  friday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
  saturday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
  sunday: v.optional(v.array(v.object({ opensAt: v.string(), closesAt: v.string() }))),
});

const verification = v.object({
  isVerified: v.boolean(),
  verifiedAt: v.optional(v.number()),
  verifiedBy: v.optional(v.id('users')),
});

const photo = v.object({
  storageId: v.id('_storage'),
  altText: v.optional(v.string()),
  ordering: v.number(),
});

export default defineSchema({
  users: defineTable({
    name: v.string(),
    externalId: v.string(),
  }).index('byExternalId', ['externalId']),

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
    address: businessAddress,
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    photos: v.array(photo),
    hours: businessHours,
    status: listingStatus,
    verification,
    rating: v.number(),
    ratingCount: v.number(),
    services: v.array(v.string()),
    credentials: v.array(v.string()),
    ownerId: v.id('users'),
    keywords: v.array(v.string()),
    searchText: v.string(),
    lastUpdatedAt: v.number(),
    submittedAt: v.optional(v.number()),
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
    customizationOptions: v.array(v.object({
      name: v.string(),
      required: v.boolean(),
      options: v.array(v.object({
        name: v.string(),
        priceAdjustment: v.optional(v.number()),
      })),
    })),
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
});
```

- `searchText` maintained by mutations as `[name, keywords.join(' '), description].join(' ')` — Convex search indexes allow exactly one searchField; filterFields give equality-filtered search (public search restricted to `status === 'approved'` + category).
- New listings init `rating: 0, ratingCount: 0`.

## State Machine

Statuses: `draft, pendingReview, approved, changesRequested, rejected, suspended`.

```ts
const allowedTransitions = {
  draft: ['pendingReview', 'rejected'],
  pendingReview: ['approved', 'changesRequested', 'rejected'],
  approved: ['pendingReview', 'suspended'],
  changesRequested: ['pendingReview', 'draft', 'rejected'],
  rejected: ['draft', 'pendingReview'],
  suspended: ['approved'],
} as const;
```

| From | To | Who | Guard notes |
|---|---|---|---|
| draft | pendingReview | Owner | ownerId match; validate submission fields; set submittedAt + lastUpdatedAt |
| pendingReview | approved | Super Admin | verification.isVerified=true, verifiedAt, verifiedBy |
| pendingReview | changesRequested | Super Admin | reason persisted (schema TBD in ticket 07) |
| pendingReview | rejected | Super Admin | rejection reason TBD |
| changesRequested | pendingReview | Owner | resubmit after revision |
| changesRequested | draft | Owner | optional explicit edit stage |
| approved | pendingReview | Owner | material change re-review (policy: tickets 06/07) |
| approved | suspended | Super Admin | verification cleared per policy |
| suspended | approved | Super Admin | restore |
| rejected | draft | Owner | reopen if policy permits |
| rejected | pendingReview | Super Admin | admin reopen path |

Enforcement: mutations accept an **action**, never a client-supplied status; load doc → resolve user → owner/superAdmin check → allow-list check → atomic patch (+ maintain searchText). Public queries return only `status === 'approved'`.

## Vertical Content Decision

**Separate tables over JSON blobs** (`menuGroups`/`menuItems`, `serviceOfferings`/`stylists`): business-scoped indexes, independent edit/reorder/availability, small targeted updates, typed validators; a polymorphic `content` field would lose validation + querying. Customization options stay nested per menu item (loaded with it).

## Unresolved (handed to later tickets)

- Super Admin role storage + claim format → ticket 02
- Rejection reasons / change-request messages / audit log schema → ticket 07
- Rating scale, review table (deferred v1), holiday hours, multi-location → fog
- Whether approved-listing edits re-trigger review; photo limits → tickets 06/07
