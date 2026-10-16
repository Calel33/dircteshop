import { MapPin, Search } from 'lucide-react';
import Form from 'next/form';
import Link from 'next/link';

// Persistent public header (SPEC §8): search-first, on the `design.md` surface
// role. `next/form` with a string action gives GET semantics — the form data
// is encoded into `/search?q=...`, submitted with client-side navigation and
// prefetched automatically. The route-group layout cannot read `searchParams`
// (layouts are not re-rendered per navigation), so the input is intentionally
// uncontrolled; the results page owns the authoritative `q`.
// Docs: https://nextjs.org/docs/app/api-reference/components/form

export function SiteHeader() {
  return (
    <header className="bg-surface text-surface-foreground">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          data-testid="site-brand"
          className="rounded-control focus-visible:ring-ring/50 flex items-center gap-2 font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="bg-primary text-primary-foreground rounded-control flex size-7 items-center justify-center"
          >
            <MapPin className="size-4" />
          </span>
          LocalConnect
        </Link>

        <Form
          action="/search"
          role="search"
          aria-label="Site search"
          className="rounded-control bg-surface-foreground/10 order-last flex min-w-0 basis-full items-center gap-2 px-3 sm:order-none sm:max-w-md sm:flex-1 sm:basis-auto"
        >
          <Search aria-hidden className="text-surface-foreground/70 size-4 shrink-0" />
          <input
            type="search"
            name="q"
            placeholder="Search businesses, services, keywords"
            aria-label="Search businesses"
            data-testid="header-search-input"
            className="text-surface-foreground placeholder:text-surface-foreground/70 min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
          />
        </Form>

        <nav aria-label="Primary" className="ml-auto flex items-center text-sm">
          <Link
            href="/categories"
            className="rounded-control hover:bg-surface-foreground/10 focus-visible:ring-ring/50 px-3 py-2 font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Categories
          </Link>
        </nav>
      </div>
    </header>
  );
}
