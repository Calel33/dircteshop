export default function FlaggedPage() {
  return (
    <div className="grid gap-4 p-5">
      <h1 className="sr-only">Flagged content</h1>
      <div className="bg-card border-border rounded-shell shadow-sm border p-4">
        <h2 className="mb-1 text-base font-semibold">Flagged content</h2>
        <p className="text-card-muted text-tiny">
          Version 1 does not currently have a flagged content source.
        </p>
      </div>
    </div>
  );
}
