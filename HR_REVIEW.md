# HR system review and expansion

Reviewed on 13 October 2026. The Vue/Firebase application now integrates HR modules directly into the main navigation alongside attendance, payroll, leave and holidays; Employee Management combines staff and organisation details. It remains a Vue frontend with an Apps Script/Google Sheets backend.

## Evidence reviewed

- [Drive reference folder](https://drive.google.com/drive/folders/1BBXRrLS2uANRs_2lxXycls8LpDNlsRay).
- [HR data model](https://drive.google.com/file/d/1a6E2dLQ5FG-A90ZYBZfysaA5RrR3bIUU/view): companies, departments, employee reporting lines, claims, resources/bookings, appraisal cycles, tax relief, correspondence, payroll records and audit logs.
- [Claims routes](https://drive.google.com/file/d/1UeiWuJxGU-us_dIqOrqvre8X4q24br09/view): receipt details and ownership, HOD recommendation followed by administrator approval.
- [Resources routes](https://drive.google.com/file/d/1A442H9ZEZz2X9f9JvAfZgtTjGKyJIcoO/view): resource availability, pending and approved reservation conflicts, cancellation and approval.
- [Appraisal routes](https://drive.google.com/file/d/1fHAHQ3UY-3CzbW2aU3NTDkIpd1YCGGqc/view): cycle assignment, employee self rating, reviewer rating and a final score.
- The embedded screenshots in [UBSHR Step by Step guide](https://docs.google.com/spreadsheets/d/18e5vL_ijouLMVEY7wHPaPFRKXo3VXpMT/edit) show company selection, application/approval menus, receipt and annual claim limits, HOD recommendation, annual/medical leave summaries and adjustments, and a loan module entry. Their historical entitlement/amount examples were not adopted as current company policy.
- The attached UBS menu screenshot confirms Leave, Claim, Resource, Performance Appraisal and Employee Tax Relief.

The other installation, bank and year-end files in the folder were inventoried, but their contents were not fully reviewed. No data from reference applications was imported and no Drive files were modified.

## Coverage

| Area | Implemented behaviour | Integration boundary |
|---|---|---|
| Staff, attendance, payroll, leave and holidays | Existing screens retained; Add Staff/Update Profile attachment-state bug fixed | Existing statutory calculations retained, not re-certified |
| Companies and departments | Company registers, employer reference fields, departments and heads | Organisation records, not tenant-isolated databases |
| Employee Management | Account, role, payroll, company, department, job title, employee ID, location and reporting manager | One Staff master row; organisation is derived from it |
| Claims and policies | Medical/travel/mileage/accommodation/other claims, receipt links, duplicate checking, per-receipt/annual caps, manager recommendation, HR approval/rejection and external payment reference | Paid claims remain separate from payslips; no automatic reimbursement transfer |
| Resources | Catalogue, availability, booking requests, cancellation and approval, overlap prevention including pending requests | Start/end inputs use the shared local schedule convention; UI labels specify Malaysia time |
| Appraisals | Cycles, goals, self and reviewer rating, HR finalisation, closure after all reviews complete | Mean of self and reviewer rating; when no reviewer rating exists HR supplies the second rating |
| Tax relief | Employee declarations, evidence links and HR review | Not official TP1/PCB/EA generation, eligibility validation or a tax calculation |
| Correspondence | Draft, issue, employee viewing, print | No email sent and no salary change applied automatically |
| Recruitment | Candidate, vacancy/position, interview date, CV link, notes and editable pipeline stage | Hired candidate does not automatically create a Staff account |
| Onboarding/offboarding/probation | Individual tasks, assignee, due date, overdue count and completion | Tasks do not automatically disable credentials or retrieve assets |
| Training | Employee course, provider, date, expiry, cost, evidence and completion | Certificate register, not a learning delivery platform |
| Leave adjustments | Annual/medical ledger postings, including negative reversals | Applied to sign-in balances for the selected year; no automated year-end batch or fractional-leave redesign |
| Employee loans | Request, recommendation, approval, external disbursement reference, repayment history and outstanding balance | No interest calculation, bank transfer or automatic payroll deduction |
| HR reports and audit | Counts by module, action queue, CSV export and latest 500 HR change events | Audit covers the new HR modules; not all legacy payroll changes |

## Access and persistence

All frontend data access now uses authenticated POST requests. Login issues an opaque, random session token stored in browser sessionStorage. The Apps Script cache stores the session for up to six hours and may evict it earlier. Logout revokes that session. Every request rechecks the employee status and role in Staff. Public GET reads and identity-only password resets are disabled.

Staff responses no longer contain passwords. Blank passwords on existing staff updates preserve the stored value. Role changes require Admin. HR can maintain User/HOD employees and create User accounts. HOD (including legacy Supervisor) can act on assigned team approvals but cannot read other payroll records. Users see their own personal records, issued letters and shared resource/cycle/company/department metadata. HR administrators see all companies and employees. An approver cannot approve their own claim or loan request.

New records are stored in separate HR_* tabs in the existing spreadsheet, provisioned in the live workbook (and created safely by setupHrBackend when missing). Existing sheets are not cleared during setup. Version checks prevent stale updates. A script lock serialises mutations, including booking conflict checks and approval transitions. New-record request references make retries idempotent. Repayment references cannot be duplicated. Rejected/cancelled requests do not consume claim caps. Active pending/approved/paid claims consume the configured annual cap. Without a matching company/year/type claim policy, no cap is enforced; configure policies before inviting employees.

Receipt, CV and certificate support currently uses HTTPS document links. Set access in the document's own sharing settings. The app does not grant access to those files. Existing legacy staff/leave attachment uploads are retained.

## Remaining work for a production HR suite

1. Deploy and test with real Admin, HR, HOD and User accounts and a backed-up test spreadsheet. Browser visual verification, live latency and real writes have not been exercised here.
2. Replace legacy spreadsheet plaintext passwords with a managed authentication provider and secure recovery/MFA. The new session/authorisation layer removes anonymous data access but does not migrate those stored credentials.
3. Verify current Malaysian statutory rules and bank specifications before implementing PCB/EA/TP1/statutory files, bank salary files, automated reimbursements or loan payroll deductions. No bank file or statutory submission is generated by the new modules.
4. Build automated year-end leave carry-forward, fractional leave schemes, roster-to-attendance integration, benefit enrolment and company-specific access boundaries when their exact policies are supplied. The existing leave approval workflow was preserved; two-stage approval was added for new claims/loans/appraisals.
5. Add paginated queries/exports and a database migration for large record volumes. HR startup reads module sheets in one request when the HR workspace opens, which is suitable for modest team datasets, not an unbounded enterprise archive.
6. Expand immutable audit coverage to all legacy payroll and account changes, add backup/retention controls and protected receipt uploads.

The package is an expanded operational HR core, not a certified statutory or banking replacement for UBS.
