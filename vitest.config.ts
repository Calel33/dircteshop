import { defineConfig } from 'vitest/config';

// B6b handler tests (issue #16 review follow-up, R2-M2): the Convex mock
// backend (`convex-test`) under the `edge-runtime` environment that matches the
// Convex function runtime. Test files live under `convex/` per the Convex
// testing guidance (convex/_generated/ai/guidelines.md). The plain `node
// --test` suite under `scripts/` is deliberately untouched: `include` here is
// scoped to `convex/**/*.test.ts` so the two runners never see each other's
// files.
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
  },
});
