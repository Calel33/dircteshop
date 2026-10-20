import type { Doc } from '../_generated/dataModel';

// B4 (issue #4) development seed fixtures, extracted into a pure module so the
// fixture contract (`scripts/business-seed.test.ts`) is testable under plain
// `node --test` — `seed.ts` itself imports the Convex runtime and cannot be
// loaded by Node ESM (extensionless generated imports). This module has no
// runtime imports at all: data and types only.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * One menu item inside a restaurant seed fixture. `ordering` is omitted on
 * purpose: the seed stores the item's array index, so fixture order is stored
 * order. Optional fields reuse the `menuItems` document contract, so a fixture
 * can only express what `menus.createItem` / `menus.updateItem` accept.
 */
export type SeedMenuItemFixture = {
  name: string;
  description?: string;
  price?: number;
  isAvailable: boolean;
  nutrition?: Doc<'menuItems'>['nutrition'];
  customizationOptions: Doc<'menuItems'>['customizationOptions'];
};

/** One menu tab; group order and item order come from their array positions. */
export type SeedMenuGroupFixture = {
  name: string;
  description?: string;
  items: SeedMenuItemFixture[];
};

/**
 * B8 (issue #8) dev seed menu for the restaurant tracer: the public `menuTabs`
 * module and the `orderingPanel` customizer render exactly these rows.
 */
export type SeedMenuFixture = {
  groups: SeedMenuGroupFixture[];
};

/**
 * One development fixture. Relative offsets (converted to absolute timestamps
 * at seed time) are declared per fixture so repeated seed runs are stable and
 * feed ordering is deterministic:
 * - Trending This Week orders featured listings by `lastUpdatedAt` desc.
 * - New to LocalConnect orders approved listings by `submittedAt` desc.
 * - Recently Verified orders verified listings by `verification.verifiedAt` desc.
 *
 * Coverage the B4 acceptance needs: >= 3 approved across categories,
 * nonapproved rows, featured/verified variants, both sides of the Highly Rated
 * boundary (`rating >= 4.5 && ratingCount > 0`), keyword search terms, distinct
 * IANA timezones, and hours edge cases (overnight, multi-period, closed day).
 */
export type SeedFixture = {
  name: string;
  categorySlug: string;
  status: 'approved' | 'draft';
  description: string;
  address: Doc<'businesses'>['address'];
  phone?: string;
  email?: string;
  website?: string;
  services: string[];
  credentials: string[];
  keywords: string[];
  rating: number;
  ratingCount: number;
  isFeatured: boolean;
  timezone: string;
  hours: Doc<'businesses'>['hours'];
  /**
   * Restaurant menus only (B8). Seeded idempotently by `seed.ts` on every run,
   * including when the business already exists.
   */
  menu?: SeedMenuFixture;
  /** Approved fixtures only; feeds "New to LocalConnect". Distinct per fixture. */
  submittedAtAgoMs?: number;
  /** Feeds "Trending This Week" (with `isFeatured`). Distinct among featured. */
  lastUpdatedAtAgoMs: number;
  /** Present when verified; feeds "Recently Verified". Distinct per verified fixture. */
  verifiedAgoMs?: number;
};

export const SEED_FIXTURES: readonly SeedFixture[] = [
  {
    name: 'Sunrise Bakery & Café',
    categorySlug: 'food-drink',
    status: 'approved',
    description:
      'Neighbourhood bakery and café serving hand-rolled pastries, sourdough bread and single-origin coffee.',
    address: {
      addressLine1: '18 Maple Street',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
    },
    phone: '+1 555 0134',
    website: 'https://sunrisebakery.example.com',
    services: ['Fresh bread', 'Pastries', 'Coffee', 'Cakes', 'Breakfast'],
    credentials: ['Certified Organic', 'Local Favourite 2025'],
    keywords: ['bakery', 'cafe', 'coffee', 'pastries', 'bread', 'breakfast'],
    rating: 4.6,
    ratingCount: 128,
    isFeatured: false,
    timezone: 'America/Chicago',
    hours: {
      monday: [{ opensAt: '07:00', closesAt: '17:00' }],
      tuesday: [{ opensAt: '07:00', closesAt: '17:00' }],
      wednesday: [{ opensAt: '07:00', closesAt: '17:00' }],
      thursday: [{ opensAt: '07:00', closesAt: '17:00' }],
      friday: [{ opensAt: '07:00', closesAt: '18:00' }],
      saturday: [{ opensAt: '08:00', closesAt: '16:00' }],
      sunday: [{ opensAt: '08:00', closesAt: '14:00' }],
    },
    submittedAtAgoMs: 7 * DAY_MS,
    lastUpdatedAtAgoMs: 3 * DAY_MS,
    verifiedAgoMs: 5 * DAY_MS,
  },
  {
    name: 'Lakeside Auto Repair',
    categorySlug: 'automotive',
    status: 'approved',
    description:
      'Independent auto shop for oil changes, brakes, tires and engine diagnostics, serving Springfield drivers since 1998.',
    address: {
      addressLine1: '402 Lakeside Avenue',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62703',
      country: 'US',
    },
    phone: '+1 555 0142',
    website: 'https://lakesideauto.example.com',
    services: ['Oil changes', 'Brake repair', 'Tire service', 'Engine diagnostics'],
    credentials: ['ASE Certified'],
    keywords: ['auto repair', 'mechanic', 'oil change', 'brakes', 'tires'],
    rating: 4.7,
    ratingCount: 64,
    isFeatured: true,
    timezone: 'America/New_York',
    hours: {
      monday: [{ opensAt: '08:00', closesAt: '17:30' }],
      tuesday: [{ opensAt: '08:00', closesAt: '17:30' }],
      wednesday: [{ opensAt: '08:00', closesAt: '17:30' }],
      thursday: [{ opensAt: '08:00', closesAt: '17:30' }],
      friday: [{ opensAt: '08:00', closesAt: '17:30' }],
      saturday: [{ opensAt: '09:00', closesAt: '13:00' }],
    },
    submittedAtAgoMs: 3 * DAY_MS,
    lastUpdatedAtAgoMs: 1 * HOUR_MS,
    verifiedAgoMs: 1 * DAY_MS,
  },
  {
    name: 'Serenity Day Spa',
    categorySlug: 'beauty-wellness',
    status: 'approved',
    description:
      'Boutique day spa offering massage, facials and late-evening wellness sessions by appointment.',
    address: {
      addressLine1: '77 Sunset Boulevard',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62711',
      country: 'US',
    },
    phone: '+1 555 0177',
    services: ['Massage', 'Facials', 'Body treatments', 'Evening sessions'],
    credentials: ['Licensed Estheticians'],
    keywords: ['spa', 'massage', 'facial', 'wellness', 'relaxation'],
    rating: 4.9,
    ratingCount: 41,
    isFeatured: false,
    timezone: 'America/Los_Angeles',
    // Friday carries a late session that wraps past midnight (22:00-01:00) and
    // a regular daytime period, so the fixture covers multi-period + overnight.
    hours: {
      tuesday: [{ opensAt: '10:00', closesAt: '19:00' }],
      wednesday: [{ opensAt: '10:00', closesAt: '19:00' }],
      thursday: [{ opensAt: '10:00', closesAt: '19:00' }],
      friday: [
        { opensAt: '10:00', closesAt: '19:00' },
        { opensAt: '21:00', closesAt: '01:00' },
      ],
      saturday: [{ opensAt: '10:00', closesAt: '19:00' }],
    },
    submittedAtAgoMs: 2 * HOUR_MS,
    lastUpdatedAtAgoMs: 5 * HOUR_MS,
    verifiedAgoMs: 2 * HOUR_MS,
  },
  {
    name: 'Summit Legal Group',
    categorySlug: 'legal-services',
    status: 'approved',
    description:
      'Small practice for estate planning, family law and small-business consultation. Rated exactly at the Highly Rated boundary (4.5, one reviewer) and not yet verified.',
    address: {
      addressLine1: '9 Capitol Square, Suite 210',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    },
    phone: '+1 555 0121',
    website: 'https://summitlegal.example.com',
    services: ['Estate planning', 'Family law', 'Business consultation'],
    credentials: ['Illinois Bar'],
    keywords: ['lawyer', 'attorney', 'legal', 'consultation', 'estate planning'],
    rating: 4.5,
    ratingCount: 8,
    isFeatured: true,
    timezone: 'America/New_York',
    hours: {
      monday: [{ opensAt: '09:00', closesAt: '17:00' }],
      tuesday: [{ opensAt: '09:00', closesAt: '17:00' }],
      wednesday: [{ opensAt: '09:00', closesAt: '17:00' }],
      thursday: [{ opensAt: '09:00', closesAt: '17:00' }],
      friday: [{ opensAt: '09:00', closesAt: '17:00' }],
    },
    submittedAtAgoMs: 4 * DAY_MS,
    lastUpdatedAtAgoMs: 2 * DAY_MS,
  },
  {
    name: 'Midtown Family Dental',
    categorySlug: 'healthcare',
    status: 'approved',
    description:
      'Family dental practice for cleanings, checkups and preventive care, with early morning appointments.',
    address: {
      addressLine1: '241 Midtown Plaza',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
    },
    phone: '+1 555 0186',
    services: ['Cleanings', 'Checkups', 'Preventive care'],
    credentials: ['DDS'],
    keywords: ['dentist', 'dental', 'teeth cleaning', 'family dentist'],
    rating: 4.2,
    ratingCount: 215,
    isFeatured: false,
    timezone: 'America/Chicago',
    hours: {
      monday: [{ opensAt: '08:00', closesAt: '16:00' }],
      tuesday: [{ opensAt: '08:00', closesAt: '16:00' }],
      wednesday: [{ opensAt: '08:00', closesAt: '16:00' }],
      thursday: [{ opensAt: '08:00', closesAt: '16:00' }],
      friday: [{ opensAt: '08:00', closesAt: '12:00' }],
    },
    submittedAtAgoMs: 10 * DAY_MS,
    lastUpdatedAtAgoMs: 6 * DAY_MS,
  },
  {
    name: 'Harborview Bistro',
    categorySlug: 'restaurants',
    status: 'approved',
    description:
      'Waterfront bistro serving seasonal seafood and small plates for dinner, with a curated wine list. Newly listed with no ratings yet.',
    address: {
      addressLine1: '3 Harbor Walk',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62702',
      country: 'US',
    },
    phone: '+1 555 0155',
    website: 'https://harborviewbistro.example.com',
    services: ['Dinner service', 'Seafood', 'Wine list'],
    credentials: [],
    keywords: ['bistro', 'seafood', 'dinner', 'wine', 'waterfront'],
    rating: 5,
    ratingCount: 0,
    isFeatured: false,
    timezone: 'America/Chicago',
    hours: {
      wednesday: [{ opensAt: '17:00', closesAt: '23:00' }],
      thursday: [{ opensAt: '17:00', closesAt: '23:00' }],
      friday: [{ opensAt: '17:00', closesAt: '23:00' }],
      saturday: [{ opensAt: '17:00', closesAt: '23:00' }],
      sunday: [{ opensAt: '17:00', closesAt: '22:00' }],
    },
    // B8 (issue #8) restaurant tracer (prototype Variant A). Only this fixture
    // declares a menu: the "Build Your Bowl" builder proves the required
    // single-select groups + optional multi-select veggies flow, "Mains" proves
    // direct "Order $x" items (one unavailable, one with nutrition), and
    // "Drinks & Sides" fills the remaining tab. `seed.ts` writes these rows
    // idempotently; this is dev seed data, not a production content path.
    menu: {
      groups: [
        {
          name: 'Build Your Bowl',
          description: 'Pick a base, a protein, a sauce and as many veggies as you like.',
          items: [
            {
              name: 'Build Your Bowl',
              description: 'Steamed base, your choice of protein, house sauce and fresh veggies.',
              price: 14.5,
              isAvailable: true,
              customizationOptions: [
                {
                  name: 'Base',
                  required: true,
                  options: [
                    { name: 'Jasmine Rice' },
                    { name: 'Brown Rice' },
                    { name: 'Mixed Greens' },
                    { name: 'Rice Noodles', priceAdjustment: 1.5 },
                  ],
                },
                {
                  name: 'Protein',
                  required: true,
                  options: [
                    { name: 'Grilled Chicken', priceAdjustment: 4 },
                    { name: 'Seared Salmon', priceAdjustment: 6 },
                    { name: 'Crispy Tofu', priceAdjustment: 3 },
                    { name: 'Slow-Braised Beef', priceAdjustment: 7 },
                  ],
                },
                {
                  name: 'Sauce',
                  required: true,
                  options: [
                    { name: 'Miso Ginger' },
                    { name: 'Spicy Sesame', priceAdjustment: 0.5 },
                    { name: 'Herb Tahini', priceAdjustment: 0.5 },
                    { name: 'Citrus Ponzu' },
                  ],
                },
                {
                  name: 'Veggies',
                  required: false,
                  options: [
                    { name: 'Pickled Cucumber' },
                    { name: 'Charred Broccoli', priceAdjustment: 0.75 },
                    { name: 'Shaved Carrot' },
                    { name: 'Edamame', priceAdjustment: 0.75 },
                    { name: 'Roasted Peppers', priceAdjustment: 0.75 },
                  ],
                },
              ],
            },
          ],
        },
        {
          name: 'Mains',
          description: 'Chef-composed plates from the harbor kitchen.',
          items: [
            {
              name: 'Seared Salmon Plate',
              description: 'Farro, charred greens and lemon butter.',
              price: 24,
              isAvailable: true,
              nutrition: {
                calories: 620,
                proteinGrams: 41,
                carbohydrateGrams: 38,
                fatGrams: 30,
              },
              customizationOptions: [],
            },
            {
              name: 'Braised Short Rib',
              description: 'Creamy polenta, roasted carrots and red wine jus.',
              price: 28,
              isAvailable: true,
              customizationOptions: [],
            },
            {
              // Temporarily sold out: exercises the card's availability state.
              name: 'Harvest Grain Bowl',
              description: 'Seasonal squash, kale, farro and toasted seeds.',
              price: 18,
              isAvailable: false,
              customizationOptions: [],
            },
          ],
        },
        {
          name: 'Drinks & Sides',
          description: 'House drinks and plates to share.',
          items: [
            {
              name: 'Sparkling Yuzu Lemonade',
              description: 'House-pressed lemon, yuzu and soda.',
              price: 5.5,
              isAvailable: true,
              customizationOptions: [],
            },
            {
              name: 'House Cold Brew',
              description: 'Slow-steeped single-origin coffee, served over ice.',
              price: 4,
              isAvailable: true,
              customizationOptions: [],
            },
            {
              name: 'Sourdough & Cultured Butter',
              description: 'Warm house sourdough with whipped butter.',
              price: 6,
              isAvailable: true,
              customizationOptions: [],
            },
          ],
        },
      ],
    },
    submittedAtAgoMs: 12 * DAY_MS,
    lastUpdatedAtAgoMs: 8 * DAY_MS,
  },
  {
    name: 'Main Street Outfitters',
    categorySlug: 'retail',
    status: 'draft',
    description: 'Independent outdoor and everyday clothing shop for the Springfield community.',
    address: {
      addressLine1: '52 Main Street',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    },
    phone: '+1 555 0199',
    services: ['Outdoor clothing', 'Footwear', 'Accessories'],
    credentials: [],
    keywords: ['outfitters', 'clothing', 'outdoor', 'gear', 'retail'],
    rating: 0,
    ratingCount: 0,
    isFeatured: false,
    timezone: 'America/Chicago',
    hours: {},
    lastUpdatedAtAgoMs: 4 * HOUR_MS,
  },
];
