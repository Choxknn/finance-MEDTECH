# 2026-09-30 — Admin management and red theme

- Red responsive design, including navigation, login, dashboard and forms.
- Edit member name, year, role and active status; change student ID while retaining financial history and LINE association.
- Admin member password reset; existing self-service password change remains available.
- Preview and import up to 25 members per CSV batch. Existing accounts are skipped; each row reports success/failure. Passwords are never stored in audit logs.
- Edit rounds; close and reopen payment collection. Adjust round-wide or individual amounts only before an approved or open payment exists.
- Add existing members to existing open rounds.
- Edit expense details, replace evidence, cancel and restore expenses with a mandatory reason. Original evidence remains retained in audit history.
- Edit payment notes while retaining original approved amounts, references and decisions.
- Edit site name, recipient details, QR image (up to 1 MB) and LINE OA URL in the admin settings screen.
- Monthly income/expense reports use approval time in Asia/Bangkok. Outstanding reports always show current balances. Export both as spreadsheet-safe CSV.
- Before/after audit details for management edits. Every request verifies the active profile and admin role on the server.

## Verification

`npm ci && npm test` runs DOM/CSV and API authorization/validation tests.
`tests/management.sql` verifies transactional financial protections and evidence history, then rolls back all inserted records.

## Operational notes

Recipient details and the displayed QR must agree with the receiver configured in SlipOK. Changing the displayed settings does not change the provider's receiver account.
Automatic SlipOK verification troubleshooting is still paused. Existing pending transactions still require manual administrator review when the provider fails.
Synthetic student login emails are not delivery addresses; forgotten passwords are reset by an administrator after verifying the student.
Backend credentials stay in Supabase secrets. Authenticated members cannot query the private tables directly; all data access goes through the Edge Function.
