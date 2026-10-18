import { AnalyticsSummary } from './analytics-summary';

/**
 * `/admin/analytics` v1 stub (issue #16, Task 3). The parent
 * `app/admin/layout.tsx` supplies the super-admin 404 gate; this route mounts
 * the SPEC §13 counts panel — real order, booking, and quote-request counts
 * read from the existing tables, with Views left TBD because v1 has no view
 * tracking.
 */
export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <h1 className="font-display mb-4 text-2xl font-bold">Analytics</h1>
      <AnalyticsSummary />
    </div>
  );
}
