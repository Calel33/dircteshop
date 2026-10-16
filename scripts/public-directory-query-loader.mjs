/**
 * ESM loader `scripts/public-directory-query.test.ts` registers with
 * `module.register()` before importing `convex/businesses/queries.ts`:
 *
 * - `resolve` retries relative specifiers that carry no extension as `.ts`,
 *   then `.js` (Node cannot resolve `convex/`'s extensionless imports; the
 *   Convex bundler does).
 * - `load` substitutes `convex/users.ts` — it imports type names in value
 *   position (`QueryCtx`, `UserJSON`, `Validator`) that type stripping cannot
 *   elide — with a stub whose only export is `getCurrentUser`. Neither
 *   `listDirectory` nor `countDirectory` calls into it.
 *
 * The hooks are asynchronous because `module.register()` (Node >= 20.6) runs
 * them on a separate loader thread; the synchronous `module.registerHooks()`
 * that this replaces is Node >= 22.15, above the declared `node >= 22.6`
 * engine floor (package.json).
 * Docs: https://nodejs.org/docs/latest-v22.x/api/module.html#moduleregisterspecifier-parenturl-options
 */

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[cm]?[jt]s$/.test(specifier)
  ) {
    for (const extension of ['.ts', '.js']) {
      try {
        return await nextResolve(specifier + extension, context);
      } catch {
        // Try the next extension.
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('/convex/users.ts')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export async function getCurrentUser() { return null; }\n',
    };
  }
  return nextLoad(url, context);
}
