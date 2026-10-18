'use server';

import { auth } from '@clerk/nextjs/server';
import { fetchMutation, fetchQuery } from 'convex/nextjs';
import { ConvexError } from 'convex/values';

import {
  buildBusinessExportCsv,
  buildBusinessExportFileName,
  collectExportPages,
} from '@/convex/adminExportPolicy';
import { api } from '@/convex/_generated/api';

// B6b audited business CSV export (issue #16, Task 6) — the first Server
// Action in this repo. It is an untrusted POST endpoint (Next.js docs: "Treat
// every action as an untrusted entry point"), so it re-derives the Clerk Convex
// token server-side, and every Convex call it makes is guarded by
// `requireSuperAdmin` — no business row can leave without that guard. It pages
// the guarded query (each page ≤ EXPORT_PAGE_SIZE; the server enforces the
// cap), assembles the CSV in memory, and records EXACTLY ONE completion audit
// event ONLY after the full export succeeded. A failure at any step writes
// nothing.
//
// Delivery note (Next.js 16): a Server Action cannot set `Content-Disposition`,
// so the action returns the serializable `{ csv, fileName }` and the client
// builds a Blob download. The 1 MB `serverActions.bodySizeLimit` is a REQUEST
// cap and does not apply to this response; the real ceilings are Convex's
// per-function return (16 MiB) and scan (~32,000 documents) limits, plus
// browser memory.
//
// Docs: node_modules/next/dist/docs/01-app/02-guides/server-actions.md ·
// node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md ·
// https://docs.convex.dev/client/nextjs/app-router/server-rendering

/** Normalises a thrown export error into a user-facing message. */
function exportErrorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string') {
    return error.data;
  }
  return error instanceof Error && error.message
    ? error.message
    : 'The export failed. Try again.';
}

export async function exportBusinessesCsv() {
  const { getToken } = await auth();
  const token = (await getToken({ template: 'convex' })) ?? undefined;
  if (token === undefined) {
    return {
      ok: false as const,
      error: 'A Super Admin session is required to export businesses.',
    };
  }

  try {
    // Pages are separate queries: NOT a snapshot. Rows can shift between page
    // reads (documented v1 limitation, issue #16 risk table). `collectExportPages`
    // retries a SplitRequired page at the same cursor with a smaller page size.
    const rows = await collectExportPages(({ numItems, cursor }) =>
      fetchQuery(
        api.adminExports.listBusinessesPage,
        { paginationOpts: { numItems, cursor } },
        { token }
      )
    );

    const csv = buildBusinessExportCsv(rows);

    // The ONE completion event, written only after the full CSV exists. If
    // this write fails the action fails too: an export that cannot be audited
    // is not delivered, and a failed export never writes an event.
    await fetchMutation(api.adminExports.recordBusinessesCsvExport, {}, { token });

    return {
      ok: true as const,
      csv,
      fileName: buildBusinessExportFileName(Date.now()),
      rowCount: rows.length,
    };
  } catch (error) {
    return { ok: false as const, error: exportErrorMessage(error) };
  }
}
