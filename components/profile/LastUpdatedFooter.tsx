import { Clock } from 'lucide-react';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

export type LastUpdatedFooterProps = {
  lastUpdatedAt: number;
};

/** Owner-maintained freshness signal shown at the foot of the profile. */
export function LastUpdatedFooter({ lastUpdatedAt }: LastUpdatedFooterProps) {
  return (
    <footer className="text-muted-foreground flex items-center gap-2 text-xs">
      <Clock aria-hidden className="size-3.5" />
      <p>Last updated {DATE_FORMATTER.format(new Date(lastUpdatedAt))}</p>
    </footer>
  );
}
