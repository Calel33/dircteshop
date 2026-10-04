import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Minimal textarea primitive (issue #13 / B3b todo #5) used by the required
 * reason modal. Mirrors the repo's `input.tsx` shadcn/v4 conventions and the
 * `@radix-ui`-era styling (no new dependency): semantic tokens only, focus ring
 * and `aria-invalid` states, disabled styling.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 flex field-sizing-content min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
