# Build Ticket B7: Photos / media via Convex file storage

Slice owner: SPEC §12. Decisions from map Notes. Blocked by: B3.

## End-to-end slice

1. Upload via Convex actions to `_storage` with size/type limits (record chosen limits here — SPEC §12 open detail).
2. Editor Photos & Media section: upload, reorder (ordering field), alt text, remove — per the businesses.photos contract.
3. Profile gallery/hero renders from photos with graceful empty state (placeholder when none).

## Done when (verification evidence)

- Lint + build clean.
- Upload → reorder → save draft → preview and live profile reflect the new order; oversized/wrong-type file rejected with a validation message; delete in editor removes from storage (or orphans documented — record which).
