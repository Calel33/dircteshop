import { AdminOverviewCards } from './admin-overview-cards';

/**
 * `/admin` overview (issue #16, Task 1). The parent `app/admin/layout.tsx`
 * supplies the super-admin 404 gate; this route mounts the live count cards.
 */
export default function AdminPage() {
  return (
    <div className="p-6">
      <h1 className="font-display mb-4 text-2xl font-bold">Overview</h1>
      <AdminOverviewCards />
    </div>
  );
}
