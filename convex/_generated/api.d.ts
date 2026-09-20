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
import type * as businesses_helpers from "../businesses/helpers.js";
import type * as businesses_mutations from "../businesses/mutations.js";
import type * as businesses_queries from "../businesses/queries.js";
import type * as businesses_seed from "../businesses/seed.js";
import type * as categories from "../categories.js";
import type * as http from "../http.js";
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
  "businesses/helpers": typeof businesses_helpers;
  "businesses/mutations": typeof businesses_mutations;
  "businesses/queries": typeof businesses_queries;
  "businesses/seed": typeof businesses_seed;
  categories: typeof categories;
  http: typeof http;
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
