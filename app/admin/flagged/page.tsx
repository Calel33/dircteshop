'use client';

export default function FlaggedPage() {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-border p-6 bg-card text-card-foreground shadow-sm">
        <h2 className="text-xl font-semibold">Flagged Content</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Version 1 does not currently have a flagged content source.
        </p>
      </div>
    </div>
  );
}
