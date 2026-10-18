import { AdminOverviewCards } from './admin-overview-cards';
import { AdminOverviewPanels } from './admin-overview-panels';

/**
 * `/admin` overview (issue #16, Task 1). The parent `app/admin/layout.tsx`
 * supplies the super-admin 404 gate; this route mounts the live count cards
 * and, below them, the Variant B audit/workload panels.
 * The page title is visually hidden because the prototype's command bar names
 * the active tab — the heading stays for assistive technology.
 */
export default function AdminPage() {
  return (
    <div className="grid gap-4 p-5">
      <h1 className="sr-only">Overview</h1>
      <AdminOverviewCards />
      <AdminOverviewPanels />
    </div>
  );
}
