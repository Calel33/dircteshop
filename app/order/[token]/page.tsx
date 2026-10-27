import { fetchQuery } from 'convex/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';

import { OrderReceipt } from '@/components/order/receipt';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { ORDER_ERROR_COPY } from '@/lib/order-errors';

/**
 * Durable order receipt (SPEC §2 `/order/[token]`, protocol §6.7).
 *
 * The token is the capability and the route is the only handle: the page is a
 * server fetch, so a refresh or a bookmark returns the identical receipt. The
 * response carries `Referrer-Policy: no-referrer` (next.config.ts) so the
 * token is never sent to a third party, and the page has no embeds.
 *
 * A wrong or garbage token renders the §6.5 `ORDER_NOT_FOUND` copy with a
 * directory CTA — never a stack trace, never a partial receipt.
 *
 * Docs: https://nextjs.org/docs/app/api-reference/file-conventions/page
 */

export const dynamic = 'force-dynamic';

/** Memoized per request so `generateMetadata` and the page share one fetch. */
const getReceipt = cache((token: string) =>
  fetchQuery(api.orders.getOrderByToken, { token }).catch(() => null)
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const receipt = await getReceipt(token);

  return {
    title: receipt === null ? 'Order not found' : `Order #${receipt.reference}`,
    // A receipt link is a capability; never let a crawler index or follow it.
    robots: { index: false, follow: false },
  };
}

function ReceiptNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-16 sm:px-6">
      <p className="text-micro text-card-muted font-mono tracking-label uppercase">Order receipt</p>
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that order.</h1>
      <p className="text-tiny text-card-muted">{ORDER_ERROR_COPY.ORDER_NOT_FOUND.copy}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/">Browse businesses</Link>
        </Button>
      </div>
    </main>
  );
}

export default async function OrderReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const receipt = await getReceipt(token);

  if (receipt === null) {
    return <ReceiptNotFound />;
  }

  return (
    <main>
      <OrderReceipt token={token} initial={receipt} />
    </main>
  );
}
