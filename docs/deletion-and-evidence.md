# Deletion, full profile controls and automatic evidence

Administrators can remove individual users, rounds, charges, payments and expenses, or remove up to 500 records shown in the current filtered screen in one transaction. A reason and a confirmation are required in the application. Deleted records appear in Trash and can be restored; no provider account, transaction reference or Drive file is permanently erased.

Removing a user blocks access on every API request, hides that user's current outstanding charges and excludes the user from new rounds. Historical approved payments remain in the ledger. Removing a round or charge hides its outstanding balance and blocks new payments while retaining its historical receipts. Removing a payment excludes it from approved income and recomputes its charge balance. Removing an expense excludes it from expense totals. Restoring an approved payment cannot exceed the charge amount; restoring an open payment cannot create a second open payment on the same charge. Administrators cannot delete their own account.

Profile controls include name, student ID, year, role, active status, phone, contact email, administrative notes, password reset and LINE unlinking. Students can edit their own name, year, phone and contact email. Contact email is not the synthetic login email. Administrative notes stay private to administrators. IDs used internally, transaction references and original financial history are retained.

Payment evidence appears automatically in payment tables and review dialogs. Expense evidence appears automatically in administrator expense tables and edit dialogs. Private files remain in Google Drive and are fetched through the authenticated download endpoint. Requests use authorization headers, never session tokens in image URLs. Images enter the viewport automatically, at most three loads run at once, and temporary image URLs are revoked when the view or account changes.

`npm test` verifies management, API authorization, deletion UI and private image loading. `tests/deletion.sql` verifies the financial and access controls against Postgres and rolls back all test changes.

SlipOK troubleshooting remains paused; this update changes record management and evidence display only.
