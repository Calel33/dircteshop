#!/usr/bin/env node
/**
 * Seeds the DEV Convex deployment with the SPEC §10 categories and the two
 * reference businesses (one approved food-drink, one draft retail).
 *
 * Usage: pnpm seed   (or: node scripts/seed.ts)
 *
 * Dependency order is explicit: categories first, then businesses (the
 * businesses reference `categoryId`). Every function invoked here is an
 * `internalMutation`, so nothing is exposed to clients. The run is idempotent —
 * re-running returns the same ids and writes nothing.
 *
 * Convex sends function logs to stderr and the return value to stdout
 * (CHANGELOG 1.27.2), so stderr is inherited and stdout is parsed. The CLI's
 * default target is the dev deployment; `--prod` is deliberately never passed.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

type SeedResult = {
  ownerId: string;
  adminId: string;
  approvedBusinessId: string;
  draftBusinessId: string;
};

/**
 * Narrows an unknown Convex return value to `SeedResult`. Mirrors the
 * `Array.isArray` guard on the categories result — a shape change should fail
 * loudly here rather than print `undefined` ids.
 */
function isSeedResult(value: unknown): value is SeedResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.ownerId === 'string' &&
    typeof candidate.adminId === 'string' &&
    typeof candidate.approvedBusinessId === 'string' &&
    typeof candidate.draftBusinessId === 'string'
  );
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const convexCli = path.join(repoRoot, 'node_modules', 'convex', 'bin', 'main.js');

/** Runs one internal Convex function on the dev deployment and returns its value. */
function runConvexFunction(functionName: string): unknown {
  const stdout = execFileSync(process.execPath, [convexCli, 'run', functionName], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const trimmed = stdout.trim();
  return trimmed.length > 0 ? JSON.parse(trimmed) : null;
}

const categories = runConvexFunction('categories:seedCategories');
const seed = runConvexFunction('businesses/seed:seedBusinesses');

if (!Array.isArray(categories)) {
  throw new Error('categories:seedCategories did not return the seeded categories');
}

if (!isSeedResult(seed)) {
  throw new Error('businesses/seed:seedBusinesses did not return the seeded ids');
}

console.log(`Seeded ${categories.length} categories.`);
console.log(`Seed owner id:                ${seed.ownerId}`);
console.log(`Seed admin id:                ${seed.adminId}`);
console.log(`Approved food-drink business: ${seed.approvedBusinessId}`);
console.log(`Draft retail business:        ${seed.draftBusinessId}`);
