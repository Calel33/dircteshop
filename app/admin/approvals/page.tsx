import { ApprovalsRoute } from './approvals-route';

/**
 * Server entry for `/admin/approvals` (issue #13 / B3b todo #4). The parent
 * `app/admin/layout.tsx` supplies the super-admin 404 gate; this route only
 * mounts the client queue shell.
 */
export default function AdminApprovalsPage() {
  return <ApprovalsRoute />;
}
