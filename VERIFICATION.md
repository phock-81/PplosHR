# Verification

- Production Vite build: passed.
- Backend syntax checks: passed.
- Original/optimized API and login response comparison using mocked Apps Script services: passed.
- Bulk-save grow, shrink and empty-data cases: passed.
- Grouped payroll deletion preserves other months and replaces the target month: passed.
- Profile update preserves IC and confirmation-date columns: passed.
- Staff-delete POST routing: passed.
- Combined startup opens the spreadsheet once: passed.
- Vue DOM smoke checks with mocked API: mount, admin login, navigation, staff modal and holiday creation passed without JavaScript errors.

The DOM checks use jsdom; they do not verify visual layout, real browser downloads, chart drawing, generated inline event handlers or real Google/Firebase behavior. Chromium could not be installed in this environment. Live integration, Excel/PDF output and mobile visual checks remain to be run after deployment using a test account. Earlier tests did not change live data. The unified-HR update below added master columns, employee IDs, role validation and empty registers to the live workbook.

Run backend checks with `npm run test:backend`.

UI update: DOM tests also pass for password visibility, staff query/status filtering, no-match feedback, generated links, mobile drawer focus/open/close and failed-load retry feedback. Browser visual QA remains unavailable.

Staff action fix: declared attachment state to prevent ReferenceError in ES modules. Built bundle checks run in strict mode and verify Add Staff opens an empty ADD form, and Update Profile opens an UPDATE form with the selected staff name and IC populated. API mocked; live writes not exercised.

## HR expansion validation

Production build passes. Backend domain tests cover session authentication, anonymous-read denial, redacted passwords, account-change permissions, ownership, two-stage claim/loan approval, claim policy caps and duplicate receipts, optimistic versions, reservation overlap/adjacency, self/manager/final appraisal stages, declaration and draft-letter privacy, immutable leave adjustments and sign-in balances, loan repayments/duplicate references/overpayment, idempotent record creation, training/task completion, appraisal cycle closure, logout and resigned-account denial. UI tests exercise HR entry, form submission, refreshed records and approval controls, plus the existing staff forms/navigation. API services and Sheets are mocked. Browser visual verification, real Apps Script writes, bank/statutory output validation and live load testing remain pending.

## Unified employee master and role update

Live workbook verified through Google Sheets cell metadata: Staff Y:AE headers, nine employee IDs, role dropdown and sixteen HR register headers; HR Setup Guide values and wrapping verified. Existing A:X values were preserved. No role was reassigned.

`node tests/roles.test.cjs` passes: HR cannot grant roles or modify HR/Admin accounts; HOD sees assigned team leave but not payroll; role changes affect active sessions; employee identity, username uniqueness, manager validation, version checks and last-Admin protection are enforced. HR workflows read organisation details from Staff; duplicate profiles are blocked. Employee account changes write audit entries without credentials.

Build and DOM tests pass with the unified main navigation and staff form. No live application deployment or real Apps Script end-to-end write test was performed. The workbook structure is live; new app behaviour requires deployment.

## Grouped navigation, leave UI and resource assignments

Automated checks cover all four roles, Overview landing, top-right name/role, profile/logout, hidden management menus, personal/team API scopes, live leave balance rendering, own-record history/search and failed-submission draft retention. Backend checks cover HR-only resource handover/return, employee projection in Staff AF, duplicate handover and booking conflicts, active/inactive claim types, personal leave isolation and current balance calculation. Original payroll/HR suites remain in the package.

Google Sheets metadata verified Staff AF header and note, HR_claimTypes header plus five initial types, HR_resourceAssignments headers, and the appended setup guide. Existing employee assignments/roles were not changed. Browser visual QA and real backend application writes remain deployment checks; UI tests use jsdom and mocked API responses.

Cleanup verification: build passes; role navigation tests assert all groups initially collapsed, no task links and no previous company branding in the rendered page. Backend tests reject retired lifecycle save/transition calls and omit lifecycle from bootstrap.


Grade update: `node tests/grades.test.cjs` covers derived grades, permissions, claim fallback/precedence and annual totals, unmatched-grade denial, resource quantity/value caps, and employee synchronization after title changes. Build and JSDOM checks are local; live Apps Script and Firebase deployment are still required.
