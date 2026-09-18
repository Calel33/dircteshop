# Build Ticket B6: Admin directory management + audit log + export

Slice owner: SPEC §10. Decisions from tickets 07, 08, 10. Blocked by: B3.

## End-to-end slice

1. `/admin` overview: Total Businesses, Pending Approval (clickable → queue), Verified Active, Submissions This Month.
2. `/admin/directory`: Grid (shared BusinessCard) + Table views on the same data; Map view = "coming soon" stub. Search by name/owner/location; filters category/status/verification. Actions: Approve, Request Changes, Reject, Suspend, Restore, Delete — each confirm modal + auditLogs row. **Hard delete only behind type-the-business-name**, deletes business + children. Bulk bar: approve only. isFeatured pinning.
3. Add Business: admin-created listing with owner email assignment (same flow as self-serve).
4. `/admin/owners`: read-only users table (name, businesses count, role).
5. `/admin/audit`: read-only, filterable audit log.
6. `/admin/categories`: Super Admin CRUD + ordering; delete blocked while businesses reference it.
7. CSV export (server action): businesses — name, category, status, owner, rating, dates.

## Done when (verification evidence)

- Lint + build clean.
- Every listed action writes its audit row; delete requires name-typing and removes children; category delete is blocked while referenced and works after reassignment; CSV downloads with correct columns; non-superAdmin users still 404 (B1 regression check).
