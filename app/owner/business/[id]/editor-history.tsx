'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { formatTimestamp } from './editor-datetime';
import type { HistoryEntry } from './editor-status';

/**
 * Change History for the owner editor (issue #12 / B3a, simplified): a
 * saved/status trail derived from document timestamps only — no field-level
 * diffs. Entries are rendered newest first.
 */
export function EditorHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">Change History</CardTitle>
        <CardDescription>Saved and status trail — no field-level diffs.</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">No history yet.</p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {entries.map((entry) => (
              <li
                key={`${entry.label}-${entry.at}`}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span className="text-sm">{entry.label}</span>
                <time
                  dateTime={new Date(entry.at).toISOString()}
                  className="text-muted-foreground font-label text-xs"
                >
                  {formatTimestamp(entry.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
