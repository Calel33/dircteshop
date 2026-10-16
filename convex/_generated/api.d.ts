/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authz from "../authz.js";
import type * as businessTypes from "../businessTypes.js";
import type * as businesses_directoryQuery from "../businesses/directoryQuery.js";
import type * as businesses_helpers from "../businesses/helpers.js";
import type * as businesses_moderationPolicy from "../businesses/moderationPolicy.js";
import type * as businesses_moderationProjections from "../businesses/moderationProjections.js";
import type * as businesses_mutations from "../businesses/mutations.js";
import type * as businesses_ownerProjections from "../businesses/ownerProjections.js";
import type * as businesses_ownerSavePolicy from "../businesses/ownerSavePolicy.js";
import type * as businesses_publicHours from "../businesses/publicHours.js";
import type * as businesses_publicProjections from "../businesses/publicProjections.js";
import type * as businesses_queries from "../businesses/queries.js";
import type * as businesses_seed from "../businesses/seed.js";
import type * as businesses_seedFixtures from "../businesses/seedFixtures.js";
import type * as categories from "../categories.js";
import type * as http from "../http.js";
import type * as notificationHelpers from "../notificationHelpers.js";
import type * as notifications from "../notifications.js";
import type * as paymentAttemptTypes from "../paymentAttemptTypes.js";
import type * as paymentAttempts from "../paymentAttempts.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authz: typeof authz;
  businessTypes: typeof businessTypes;
  "businesses/directoryQuery": typeof businesses_directoryQuery;
  "businesses/helpers": typeof businesses_helpers;
  "businesses/moderationPolicy": typeof businesses_moderationPolicy;
  "businesses/moderationProjections": typeof businesses_moderationProjections;
  "businesses/mutations": typeof businesses_mutations;
  "businesses/ownerProjections": typeof businesses_ownerProjections;
  "businesses/ownerSavePolicy": typeof businesses_ownerSavePolicy;
  "businesses/publicHours": typeof businesses_publicHours;
  "businesses/publicProjections": typeof businesses_publicProjections;
  "businesses/queries": typeof businesses_queries;
  "businesses/seed": typeof businesses_seed;
  "businesses/seedFixtures": typeof businesses_seedFixtures;
  categories: typeof categories;
  http: typeof http;
  notificationHelpers: typeof notificationHelpers;
  notifications: typeof notifications;
  paymentAttemptTypes: typeof paymentAttemptTypes;
  paymentAttempts: typeof paymentAttempts;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
