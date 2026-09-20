/**
 * Vertical registry (SPEC §6).
 *
 * Compile-time-typed, developer-owned configuration: category slug -> the
 * profile modules and default actions that slug renders. This is a developer
 * artifact, NOT admin-editable data.
 *
 * Source of truth: `screens/SPEC.md` §6 "Public Profile Foundation" (§10 for the
 * seeded slug list) and `screens/wayfinder/tickets/10-non-exemplar-stubs.md`.
 */

/**
 * The eight seeded category slugs (SPEC §10). Declared locally so this registry
 * stays a pure module with no `convex/` import (no schema/codegen dependency).
 */
export type CategorySlug =
  | 'restaurants'
  | 'automotive'
  | 'healthcare'
  | 'legal-services'
  | 'beauty-wellness'
  | 'food-drink'
  | 'retail'
  | 'professional-services';

/**
 * Every module a profile can render: the foundation primitives that
 * `BusinessProfile` always draws, plus the vertical modules implemented by later
 * tickets (B8-B10). `VerticalConfig.modules` lists only the modules *beyond*
 * the foundation slots.
 */
export type ModuleId =
  // Foundation primitives (SPEC §6).
  | 'breadcrumb'
  | 'hero'
  | 'identityBar'
  | 'actionsBar'
  | 'infoCard'
  | 'hoursCard'
  | 'lastUpdatedFooter'
  // Vertical modules (SPEC §6 "modules beyond foundation").
  | 'menuTabs'
  | 'orderingPanel'
  | 'stylistsCard'
  | 'servicesPriceList'
  | 'bookingForm'
  | 'portfolio'
  | 'galleryEmphasis'
  | 'services'
  | 'credentials';

/** SPEC §6 actions union, reproduced verbatim. */
export type ProfileAction =
  | { kind: 'call' | 'directions' | 'website'; href: string }
  | { kind: 'book' | 'quote'; workflow: 'booking' | 'quoteRequest'; label?: string };

export type VerticalConfig = {
  modules: ModuleId[];
  defaultActions: ProfileAction[];
};

/**
 * Registry link actions are business-agnostic — there is no phone number,
 * address, or site at the slug level. `href` is therefore an empty placeholder
 * that the actions renderer resolves from the business document at render time
 * (phone -> `tel:`, address -> maps query, website -> URL).
 */
const PLACEHOLDER_HREF = '';

/** Generic profile used for slugs that have no explicit vertical config. */
const FALLBACK_VERTICAL: VerticalConfig = {
  modules: ['services'],
  defaultActions: [
    { kind: 'call', href: PLACEHOLDER_HREF },
    { kind: 'directions', href: PLACEHOLDER_HREF },
    { kind: 'website', href: PLACEHOLDER_HREF },
  ],
};

/**
 * SPEC §6 vertical config table, one entry per seeded slug.
 *
 * Hyphenated slugs use computed keys: the repo's `naming-convention` lint rule
 * only accepts camelCase/UPPER_CASE static property names.
 */
export const verticalConfigs: Record<CategorySlug, VerticalConfig> = {
  restaurants: {
    // TODO(#2): SPEC §6 also lists "Order Online (order workflow)". The §6
    // ProfileAction union has no order kind, so it lands with B8's order flow.
    modules: ['menuTabs', 'orderingPanel'],
    defaultActions: [
      { kind: 'call', href: PLACEHOLDER_HREF },
      { kind: 'directions', href: PLACEHOLDER_HREF },
      { kind: 'website', href: PLACEHOLDER_HREF },
    ],
  },
  automotive: {
    modules: ['services'],
    defaultActions: [
      { kind: 'call', href: PLACEHOLDER_HREF },
      { kind: 'quote', workflow: 'quoteRequest', label: 'Request Towing' },
      { kind: 'quote', workflow: 'quoteRequest' },
    ],
  },
  healthcare: {
    // TODO(#2): SPEC §6 also lists "Emergency Line (call)". The §6
    // ProfileAction union labels only workflow actions, so a second call action
    // would be indistinguishable from Call — it lands with B10's link labels.
    modules: ['services', 'credentials'],
    defaultActions: [
      { kind: 'book', workflow: 'booking' },
      { kind: 'call', href: PLACEHOLDER_HREF },
    ],
  },
  ['legal-services']: {
    modules: ['services', 'credentials'],
    defaultActions: [
      { kind: 'quote', workflow: 'quoteRequest', label: 'Schedule Consultation' },
      { kind: 'call', href: PLACEHOLDER_HREF },
      { kind: 'quote', workflow: 'quoteRequest', label: 'Send Message' },
    ],
  },
  ['beauty-wellness']: {
    modules: ['stylistsCard', 'servicesPriceList', 'bookingForm', 'portfolio'],
    defaultActions: [
      { kind: 'book', workflow: 'booking' },
      { kind: 'call', href: PLACEHOLDER_HREF },
    ],
  },
  ['food-drink']: {
    modules: ['galleryEmphasis', 'services'],
    defaultActions: [
      { kind: 'call', href: PLACEHOLDER_HREF },
      { kind: 'directions', href: PLACEHOLDER_HREF },
      { kind: 'website', href: PLACEHOLDER_HREF },
    ],
  },
  retail: {
    modules: ['services'],
    defaultActions: [
      { kind: 'call', href: PLACEHOLDER_HREF },
      { kind: 'directions', href: PLACEHOLDER_HREF },
      { kind: 'website', href: PLACEHOLDER_HREF },
    ],
  },
  ['professional-services']: {
    modules: ['services', 'credentials'],
    defaultActions: [
      { kind: 'quote', workflow: 'quoteRequest' },
      { kind: 'call', href: PLACEHOLDER_HREF },
    ],
  },
};

/**
 * Resolve a category slug to its vertical config. Unknown slugs (for example a
 * category created in the admin UI before its config ships) receive a safe
 * generic fallback instead of throwing.
 */
export function getVerticalConfig(slug: string): VerticalConfig {
  const config: VerticalConfig | undefined = verticalConfigs[slug as CategorySlug];
  return config ?? FALLBACK_VERTICAL;
}
