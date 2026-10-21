# Performance review

## Implemented

| Area | Original | Updated |
|---|---|---|
| Dashboard startup | Five GET executions and one POST execution | One `getBootstrap` GET with the same six response sections; legacy fallback |
| Spreadsheet access | Repeated `openById`, including redundant POST opening | One request-local spreadsheet handle |
| Read size | Entire used sheet width | Schema column count and populated rows |
| Bulk save | Clear all existing rows, then write all rows | Overwrite once; clear leftover rows/columns only |
| Month payroll replacement | One deletion per matching row | One deletion per consecutive matching group, bottom-up |
| Profile fields | Multiple cell writes, including incorrect column indices | Contact/address/emergency in one J–L write; history in P |
| Leave status | Two or three separate writes | One I–L write preserving application timestamp and previous withdrawal remark |
| Destructive writes | No coordinated lock | Script lock with five-second busy response, released after flush |
| Initial frontend download | Excel and PDF libraries in entry bundle | Dynamic imports on first use |

`deleteSingleStaff` now has a POST route; the function existed but was unreachable.

## Evidence and limits

Local tests compare original and optimized read/login responses, grow/shrink/empty saves, and payroll replacement outcomes. A bootstrap test confirms one spreadsheet opening. A fixture with four target payroll rows in two groups needs two deletion calls rather than four.

These are operation-count improvements, not measured Google-hosted latency. No live deployment, spreadsheet mutation, Drive upload or email was performed. Apps Script cold starts, payload transfer, Drive uploads and synchronous email delivery remain sources of delay. The bootstrap response still contains full history; it does not reduce total data volume or guarantee a transactional snapshot across reads.

Request-local reuse deliberately avoids shared caching of credentials or staff/payroll data, stale cache invalidation problems and cache-size limits. The short lock prevents overlapping destructive saves through this script's HTTP routes. It does not make Google Sheets transactional, coordinate manual sheet edits, or protect direct editor calls that bypass `doPost`. Leave submission/status retain their existing concurrency behavior.

## Existing security issue found during review

The supplied `getStaff` API returns passwords, and the server trusts caller-provided role/name values without verifying a session for data access or writes. Firebase Hosting does not correct this. The performance update preserves API compatibility and does not implement an authentication redesign. Before public production use, introduce server-verified sessions and action permissions, stop returning stored passwords, and use a secure credential storage/authentication system.

## Deployment and checking

1. Keep the original script as a backup outside the live Apps Script project. Replace the live code with `backend/GAS_payroll.js`; do not load both versions in the same project.
2. Update the existing Apps Script web-app deployment to a new version, retaining its URL and current access settings.
3. Verify `?action=getBootstrap` returns `status: success` and six sections. Use a test account to check login, dashboard, staff editing, holidays, leave and payroll locking.
4. Deploy the rebuilt Vue frontend to Firebase Hosting.
5. Compare browser Network request duration for startup and Apps Script execution duration on the same data before/after, including repeated warm loads. No percentage speedup is claimed without those measurements.
6. Check Apps Script execution logs for Drive/email failures and busy responses. Manual spreadsheet edits need no cache invalidation.

References: https://developers.google.com/apps-script/guides/support/best-practices and https://developers.google.com/apps-script/reference/lock/lock

---

## Current code audit — 17 October 2026

Scope: overall source review focused on UI response time and bugs. The earlier sections above are historical; their implementation and security statements do not supersede this audit. The attached handoff was reference evidence, not deployment authorization. No application source was changed or deployed. Independent backend and mobile reviewers inspected the actual code; the coordinator cross-checked the findings. This is a prioritized audit, not certification of every workflow.

### Verification performed

- `npm run test:all`: PASS (configured chain). This does not include every test script in package.json.
- `npm run build -- --outDir tmp/review-build`: PASS, 10.37 seconds on this machine. Main JS 2,363.82 kB / gzip 697.06 kB; CSS 400.35 kB / gzip 63.14 kB. Build warns that ReportCenter's static Excel import prevents lazy loading.
- `node tests/dashboard-performance.test.cjs`: FAIL. Harness lacks localStorage; its response mocks also use json() while production now reads ok/text(). This is a stale test harness, not proof that request deduplication itself fails.
- `node tests/performance-backend.test.cjs`: FAIL at `getLeaveData must reduce reads`. Investigate the assertion and current read behavior before claiming this optimization remains verified.
- Independent reviewers executed actual backend functions in local Node VM/in-memory sheet harnesses with synthetic data: unrestricted attendance response, lost claim reimbursement, mobile booking rejection and mobile withdrawal rejection reproduced.
- No live authenticated browser walkthrough, Apps Script timing measurement, load test, statutory certification, spreadsheet writes, email, or deployment. No Git repository was detected in this folder. No percentage speed improvement is claimed.
- Logs: `tmp/review-test-all.log`, `tmp/review-build.log`. Build output is isolated in `tmp/review-build`.

### Priority findings and acceptance checks

1. **P1 — Attendance approval endpoint exposes confidential staff fields.** `backend/GAS_payroll.js:4724` returns raw getStaff data for includeData. The permission list at 3161 omits this read, and response sanitization at 3212–3214 does not cover its nested staff result. An ordinary authenticated User received another synthetic employee's password, salary and bank details in the independent reproduction. Restrict the endpoint by role and team; whitelist response fields and never serialize passwords. Acceptance: User is denied; HOD receives only authorized attendance/team fields; every role receives zero password fields, including composite responses.

2. **P1 — Embedded attendance bypasses API scope and replaces valid empty/error results.** `src/services/dashboard.js:3` statically imports `src/data/importedAttendance.js`, which contains 862 attendance records for four named employees (456,398 source bytes). These records are reachable in the browser bundle before authentication. At 2432–2433 the same records replace missing or successfully empty server attendance. Remove personnel fixtures from the production module graph; use synthetic development-only fixtures and distinct empty/error states. Acceptance: production assets contain no embedded personnel records; empty server data stays empty and failed loads show retry feedback. Whether this exact build is currently deployed was not checked.

3. **P1 — Claims can be marked Paid without reimbursement in payroll.** `backend/GAS_payroll.js:132–145` marks approved claims Paid, but 298 writes caller-supplied payroll rows without reconciling the claim map. The normal UI supplies those rows (`src/services/dashboard.js:2932–2946`); reimbursement at 2868 comes from staff/settings fields the staff API does not populate. Independent synthetic reproduction: approved RM100 claim became Paid while reimbursement stayed RM0 and net pay stayed RM1,000. Reconcile payroll on the server and commit payment/lock state only after a recoverable successful payroll operation. Acceptance: reimbursement and net pay match approved claims, retries do not duplicate them, and failures do not strand claims as Paid.

4. **P1 — Company-specific approval can replace other companies' payroll.** The lock key includes company (`backend/GAS_payroll.js:84`), but payroll replacement deletes by month alone (303–306). Frontend generation loops all staff (`src/services/dashboard.js:2779`); server fallback and claim selection are also not company-scoped. Static trace, not a reproduced company scenario. Carry stable company identity through selection, calculation, persisted rows and replacement. Acceptance: approving company A leaves company B's payroll, claims and lock state unchanged.

5. **P2 — Mobile leave withdrawal always sends an invalid request.** `src/components/mobile/MobileRequests.vue:123–127` omits rowIndex and requests Withdrawn directly. Backend 3172–3188 requires a valid row and, for an ordinary employee, Withdrawal Requested. Reproduced Invalid leave row; adding rowIndex alone still fails permission validation. Use rowIndex plus stable requestId/expectedStatus and the correct workflow status, or resolve the stable ID on the server. Acceptance: employee request succeeds and awaits approval; moved/changed requests are rejected safely.

6. **P2 — Mobile resource bookings always fail date validation.** `src/components/mobile/MobileRequests.vue:271–274` sends identical date-only start/end values. Backend bookings require datetime values and end after start. Actual synthetic request returned Invalid date. Add start/end time controls and use the shared booking contract. Acceptance: valid timed booking succeeds, overlapping bookings and end-before-start are rejected, retry remains idempotent.

7. **P2 — Mobile refresh leaves payslips and dossier stale.** `MobileMe.vue:100–106` loads only on mount/name change while MobileAppShell uses KeepAlive (446). Shell refresh emits an event with no listener and ends its spinner after 900 ms regardless of completion (117–121). Cache expiry alone does not trigger another load. Wire refresh to await all visible data loaders, bypass/invalidate relevant cache entries, and expose errors. Acceptance: newly published payslip appears after refresh without reload/sign-out; spinner and timestamp reflect actual success. Also remove the unused leave fetch or fix selection at MobileRequests.vue:326: empty arrays are truthy and can mask fetchedLeaves.

### Response-time improvements, in recommended order

1. **Reduce startup JavaScript.** `ReportCenter.vue:3` statically imports xlsx-js-style through eagerly loaded HrWorkspace. Import it inside export, and lazy-load reports, charts, document modals and other infrequent modules. Remove embedded attendance data. Vue's official performance guidance supports code splitting and list virtualization: https://vuejs.org/guide/best-practices/performance . Acceptance: build no longer reports mixed static/dynamic Excel loading; network trace shows export dependencies are absent before export. Record bundle sizes before/after.

2. **Use one coordinated bootstrap and load only the active workflow.** PayrollDashboard.vue:90 starts mobile bootstrap on every session, including desktop; HrWorkspace.vue:248 also bootstraps; dashboard.js:2455 makes another scope-all HR request after attendance loading just for company/department/job masters. Exact in-flight deduplication cannot merge different scopes or later requests. Backend hrBootstrap iterates module sheets (GAS_payroll.js:2688). Create one session-aware data owner, reuse scoped reference data, fetch attendance by period and HR records by module, and defer heavy inactive pages. Preserve permission boundaries and write invalidation. Acceptance: network trace has no redundant same-resource fetches, old-session results cannot update UI, and first useful content does not wait for inactive modules.

3. **Index attendance and limit DOM work.** dashboard.js:3314–3320 scans all attendance once per employee and 3360 scans leave once per employee-day. It also renders summary, attendance, staff and holidays after bootstrap regardless of active screen (2497–2505). Build employee/month/date and leave indexes once, render only the active view, and paginate or virtualize large staff lists. Remove the hidden ActionCenter/OrgChart/ResourceCalendar mounts at HrWorkspace.vue:540–544. Acceptance: identical totals and filters, bounded rendered rows, and measured interaction time under representative 100/500-staff fixtures.

4. **Bound waits and reduce server lock contention.** dashboard.js:2272 has no request timeout/cancellation; startup falls back to six calls for any bootstrap failure (5415–5426), including ordinary outages. Only use legacy fallback for explicit unsupported-endpoint responses; add bounded reads, clear retry/error UI and stale-response guards. Never blindly retry a write whose outcome is unknown. Backend holds a script-wide mutation lock (1173) while some flows perform Drive work and synchronous emails. Move slow external work outside the critical section with durable/idempotent state, and batch spreadsheet operations where safe. Google's guidance: https://developers.google.com/apps-script/guides/support/best-practices . Acceptance: delayed/failed requests recover visibly, duplicate writes are prevented, and simultaneous punch/save fixtures do not unnecessarily block on email/file work.

### Suggested delivery order

First close the access leak and remove production fixtures; then fix and independently verify payroll claims/company isolation and mobile actions. Next implement bundle/bootstrap/rendering improvements in small stages with before/after measurements. Finally repair excluded performance/UI tests and add the actual failing user workflows to the release gate. Retain existing logic tests, but supplement source-pattern assertions with real request-contract and browser tests.

Suggested measurement baseline: cold/warm login to usable overview, attendance month/filter response, staff-search response, save-to-confirmation, request count/bytes, and browser long tasks; compare medians and slow-tail timings using the same role, fixture size, device and network. These are proposed checks, not achieved timings. No production changes are authorized by this review alone.

## Implementation follow-up — 17 October 2026

Status: priority fixes implemented and locally verified; no deployment or live data mutation. This section supersedes the open status of items explicitly marked fixed below. Historical source line numbers in the audit refer to the pre-change version.

### Completed

- Attendance approval endpoint now rejects ordinary User access, restricts HOD data to their permitted team, and returns whitelisted staff/approval fields without credentials or payroll/bank fields.
- Production attendance fixture imports, fallback records, and hardcoded employee/biometric identity maps removed. Full attendance history is excluded from persistent clock caching, including restoration of older cache entries. Mobile attendance now consumes authorized personal history from mobileClockConfig, with saved Attendance corrections taking precedence over raw Data by date. Month browsing remains local; full-history response bounding remains a scaling follow-up. Corrections override raw biometric rows; confirmed mobile punches still participate in the existing earliest-IN/latest-OUT merge, and corrected rows retain the existing Biometric label. Successful empty results stay empty; failed loads show retry state rather than substituting historical records. Logout and role/token changes clear sensitive state, visible records and open modals.
- Payroll reconciles claim reimbursement on the server; company identity is persisted as payroll column 21 and used for scoped replacement. Other companies' rows, claims, leave markers and locks remain unchanged. Overlapping ALL/company finalized scopes require explicit unlock.
- PayrollOperations provides a durable recovery journal. Interrupted commits resume the same operation, and claims are paid only for included payroll employees. Payroll/dossier readers share the commit lock and do not expose pending payroll. Completed payload snapshots are removed after durable completion; compact completion markers remain. Cleanup failure is retryable without repeating payment.
- Mobile withdrawal follows the authenticated Withdrawal Requested contract. Booking uses explicit start/end datetime controls. Claim retries retain a stable request identity. Refresh awaits bootstrap and the active screen, invalidates session cache, and reports errors. Payslips/dossier reload on activation. Address lookup no longer delays a valid GPS punch.
- Excel loads only when exporting. Report/analytics/modal/mobile chunks are deferred; hidden legacy overview component trees no longer mount. Lazy dossier/year-end modals initialize on their first open.
- Desktop startup does not run the mobile bootstrap; mobile startup avoids the legacy desktop history load. Desktop master data and attendance load concurrently and share the overview request. Old-session and superseded refresh responses cannot overwrite newer results.
- HR lists render 50 records per page; CSV retains the complete filtered list. Search excludes embedded attachment data. Attendance/month/identity and leave lookups use indexes while preserving canonical matching and row order. Inactive legacy views are not rendered during initialization.
- Read requests have a 30-second deadline. Bootstrap fallback is limited to explicit unsupported-action replies; manager-scope failures cannot downgrade to broader reads.
- Fixed request-local cache invalidation after bootstrap resource seeding, which previously could return an empty resource catalogue on the first load.

### Verification and measured results

- Expanded `npm run test:all`: PASS, including new `test:review` gate. The gate includes payroll-security-recovery, performance-backend, dashboard-performance, dashboard-safety-performance, bootstrap-session, mobile-review-regressions and compiled-Vue UI integration tests.
- `test:ui` now points to the compiled-Vue integration check. The older standalone DOM suites remain historical/optional and were not all migrated or rerun; a passing configured gate is not a claim about every file under tests.
- After the final cache-only adjustment, `npm run test:review` and mobile GPS tests were rerun: PASS, including cache save/restore privacy checks.
- `npm run build`: PASS, 10.17 seconds; regenerated normal `dist` output. Main JS 876.29 kB / gzip 270.99 kB, compared with 2,363.82 / gzip 697.06 kB before this work. Compressed entry JS is about 61% smaller. CSS entry 363.08 kB / gzip 56.63 kB. Excel is a separate on-demand chunk. The mobile chunk is 148.14 kB / gzip 41.50 kB after removing its remaining fixture import. Chunk-size warnings remain for entry/Excel/PDF; no browser latency percentage is claimed.
- All 14 production JavaScript assets were scanned against the historical attendance fixture identities and fixture import name: none found.
- Compiled Vue/JSDOM checks: login and setup, one shared desktop overview bootstrap, 120-record pagination/search, all 120 filtered records in CSV, attachment-data exclusion from search, lazy dossier first-open request, and logout while initialization is delayed: PASS with no Vue runtime errors. These are DOM integration checks, not visual browser/device tests.
- New backend synthetic checks: User denial, HOD team isolation, no password leakage; supplied/generated payroll reimbursement and company isolation; safe retries and unlock/relock; four injected failure stages; overlap locks; payroll/dossier read locking; alias resolution; twelve approvals retaining twelve compact markers; deferred cleanup recovery: PASS.
- New mobile synthetic checks: withdrawal payload, booking validation/local time, claim retry identity, refresh completion/failure and cache race: PASS. Own attendance history, exact employee/biometric identity isolation, conflicting-ID rejection, saved correction precedence, and empty/config attendance UI behavior: PASS.
- Attendance index fixture: 6,004 potential row checks reduced to 3 canonical candidate checks with identical result identity/order. This is computational evidence, not wall-clock latency.
- Repaired existing performance harnesses: missing localStorage/Response mocks, missing spreadsheet read counters and nondeterministic seed timestamps. Existing cache parity now verifies getLeaveData 43→3, leaveOverview 17→4, hrBootstrap 62→13 reads against an uncached variant. These counts validate request-local caching; they are not all newly introduced optimizations.
- Independent source review of backend recovery/privacy/compaction and frontend startup/session/pagination found issues that were corrected before the final passing gate. Builder checks were supplemented by separate reviewer contexts.
- Evidence: `tmp/audit-final-tests.log`, `tmp/audit-cache-final-tests.log`, `tmp/audit-final-build.log`, `tmp/audit-production-dependencies.json`; focused tests are retained under tests. Local backups exist under `tmp/audit-fix-baseline` and the builders' temporary directories.

### Operational limits and remaining work

1. Live four-role browser/device workflows and Apps Script timing remain unverified. Deploy frontend and backend together to a backed-up staging environment before production; this work did not deploy either.
2. An interrupted payroll operation intentionally blocks conflicting writes and unpublished payroll reads until HR retries the same month/company. The new PayrollOperations sheet is created on first use. The existing single-cell lock-rate schema is guarded below 45,000 characters: unusually large snapshots fail safely before financial changes and need a future schema extension.
3. Broader server-side module/period pagination, removing setup writes from bootstrap entirely, and moving email/Drive work outside mutation locks remain scaling follow-ups. This patch reduces redundant loads/rendering without redesigning every API or introducing background delivery infrastructure.
4. Production dependency audit reports three existing PDF-chain advisories: dompurify (moderate), html2pdf.js (high), jspdf (critical). npm proposes html2pdf.js 0.14.0 as a breaking upgrade from 0.10.1. That migration and PDF-output compatibility testing were not included in this patch. Do not treat the dependency audit as clean.
5. Local tooling: installing dependencies on the Google Drive filesystem produced zero-byte files and rejected the esbuild executable. JS dependencies were repaired from a clean install of the exact lockfile in a local temporary folder; final tests/build used its matching native binary through ESBUILD_BINARY_PATH. The source/lockfile contain no machine-specific binary path. For repeatable local execution, use a local-disk dependency checkout or supply ESBUILD_BINARY_PATH to a matching locally installed binary. This is an environment limitation, not an application build error.

Next action: perform staging deployment and real-role workflow/latency validation when authorized, then address the PDF dependency upgrade and larger backend scaling work separately.

## Staging release preparation — 17 October 2026

User authorized proceeding with staging and identified https://peopleoshr--beta-qlz5ndcb.web.app/ as the target. Firebase CLI 15.33.0 confirms project/site peopleoshr; the workspace .firebaserc default workpluse is stale and is not used for this release. An explicit site configuration and snapshot are prepared under tmp/staging-release-20261017.

Existing beta release: projects/peopleoshr/sites/peopleoshr/channels/beta/releases/1792153483773000; version f97956fe5d3e6c78. Existing live release: projects/peopleoshr/sites/peopleoshr/channels/live/releases/1792020016042000; version 2796877493b44e1c. Saved channel metadata: tmp/staging-release-20261017/channels-before.json. No Hosting deployment or backend update was performed.

The beta asset uses the same Apps Script exec URL as local .env. User supplied editor project 1jBAusqxwNr-woP3MMvyJRzUh0UF_k0TUxndA_zydgCXFMWEVpqP8vfTI. clasp clone returned "The caller does not have permission" under phock81@gmail.com. Browser session was not signed into Apps Script. Two other accessible HR projects were backed up for identification only; neither deployment matched the configured API. They were not modified.

The requested backend cannot yet be backed up, inspected or updated. Staging-workbook isolation is unconfirmed. Resume after an authorized account can access the supplied script and the target workbook is confirmed. Then back up that actual script, verify deployment linkage and data targets, deploy tested backend, build against the verified endpoint, and publish only the peopleoshr beta channel. Perform four-role checks before considering production. The prepared frontend currently retains the existing endpoint and is held pending this verification.

The documented backend/GAS_payroll.txt was stale; it has been synchronized byte-for-byte with tested backend/GAS_payroll.js. Its previous content is backed up in tmp/staging-release-20261017/GAS_payroll-before-sync.txt. No source logic changed during this preparation. Tests/build from the implementation gate remain applicable; live-role validation remains pending.

## Shared backend and beta release — 17 October 2026 (final state)

This entry supersedes the access-blocked staging status above. Access was restored for phock81@gmail.com. The supplied Apps Script project was verified to serve both beta and production, with the same Attendance_LIVE workbook. After this was explained, the user explicitly chose "Update the shared production backend".

Release evidence:
- Remote HEAD and deployed version 45 were byte-identical to the pre-fix baseline. Release comparison confirmed only the reviewed fixes (259 additions, 55 removals); no remote changes were discarded. This final scope comparison was by the backend builder, not a fresh independent implementation review.
- Backend source SHA-256: 938783F70A61C2DFF2359B1534B7D1068181CE488FA846546247C68CB8D99BEA. Cloning immutable deployed version 46 verified this exact hash. Existing manifest and scopes were preserved.
- Initial CLI deployment of version 46 returned Google HTTP 403 to the public API. Backend version 45 and the prior beta release were requested as rollback; access still failed. The user then reported redeploying version 46 from their account. The API recovered to HTTP 200 with expected JSON. The cause is consistent with deployment-account authorization, but was not conclusively diagnosed.
- Remote editor source was restored during rollback, then realigned with tested version 46 after the owner's successful redeployment. No further API deployment was performed by the agent after owner recovery.
- Final shared API deployment remains AKfycbxeK-BZX9932K8b_TWeagZcHvp56tLV-u_qjW-fAfyG410ywuF0RT1mWmMpGl5ZdhLl, version 46. Both beta and production consume it.
- Final beta: https://peopleoshr--beta-qlz5ndcb.web.app/ ; Firebase Hosting version 222bdd2b369ed20d. Remote entry /assets/index-8fA9ghgU.js matches validated dist. Previous beta version f97956fe5d3e6c78 is retained for rollback.
- Production Hosting version 2796877493b44e1c is unchanged. This does not mean production behavior is unchanged: production now uses backend version 46.

Verification: critical payroll/privacy regressions rerun and passed before release; all 14 asset privacy scans passed; prepared frontend hashes matched validated dist. After owner redeployment, anonymous GET returns expected sign-in JSON; getAttendanceApproval, getPayroll, and mobileClockConfig reject unauthenticated requests with no data. Existing DEMO HR browser session loaded the overview and HR training empty-state list; search entry/clear worked. No payroll approval, claim, leave, or other business mutation was submitted during live verification. Existing bootstrap may perform its normal setup writes.

Four-role acceptance remains incomplete: User/HOD/Admin sign-ins were requested from the user; real-device and representative latency measurements remain pending. HR checks are a limited read-only smoke test. Existing manifest has no MailApp send-mail scope, so notification authorization remains an existing unverified limitation, unchanged by this release.

Evidence lives in tmp/staging-release-20261017: deployed-v45-backup, deployed-v46-verified, deployments-final.json, channels-final.json, firebase-deploy-final.json, api-smoke.log and predeploy-payroll-tests.log. The release was recovered after a temporary API access failure; do not describe the rollout as uninterrupted. Rollback requiring owner authorization should be performed by the original deploying account.

## Live HOD checks — 17 October 2026 (follow-up in progress)

The user supplied a signed-in HOD browser session. Read-only checks confirmed HOD role display; only My Workspace and My Team navigation; 10 supervised staff consistent between overview and directory; directory search returns zero matches for unmatched input; attendance recommendation view loads; leave approvals show zero pending requests; Claim Reviews loads one assigned pending-manager claim. No recommendations, approvals, rejections, payroll actions or other business mutations were submitted. Navigation visibility is not proof of complete API authorization.

A remaining privacy defect was identified: getAttendanceApproval returned saved attendance.manualOTPay to HOD, and buildTable could display it in OT Pay/Total Pay despite salary fields and locked rates being excluded. Current inspected October rows displayed zero; actual nonzero monetary disclosure was established from source, not observed in that session. Backend response filtering and HOD financial-column hiding are being implemented with regression tests. This finding prevents full HOD acceptance until corrected and redeployed. Entire-team/month attendance rendering remains a performance follow-up; no browser latency benchmark is claimed.

## Live User checks — 17 October 2026 (follow-up in progress)

User supplied a signed-in ordinary User session after HOD sign-out. Navigation shows only My Workspace; team/HR/admin groups are absent. Own payslip history loads and September detail identifies the signed-in employee. My Claims shows the own pending-manager claim with Details/Cancel and no HOD Recommend/Reject actions. My Leave loads authoritative AL10 and ML20 for this employee. No request/financial mutations were submitted.

Found two overview defects: KPI shows unknown while lower card fabricates14 through a fallback, and My Attendance points to the role-blocked management dashboard so does nothing. Fixes in progress: authoritative leaveOverview summary, and a separate read-only own-attendance dialog rather than granting management-dashboard access. A distinct leave row with raw status pending_hod is displayed while pending count remains0; no approval-status migration is authorized/performed by these UI checks.

HOD monetary fix: full test:all and production build pass, asset privacy scan passes; independent review passes. Backend immutable version47 was created without switching the active deployment; owner asked to deploy47 to avoid repeating previous deployment-account access outage. Local source hash F5BD6C7B812BA41813F58FFA741D34BF01EAB219D25E8BE91E43918499074AA6. Tests/build logs: tmp/staging-release-20261017/hod-fix-tests.log and hod-fix-build.log. Updated frontend not yet published at this entry.

## Role follow-up release — 17 October 2026

Owner confirmed deployment of backend47; CLI listing shows47 and API returns expected JSON. Backend47 removes monetary attendance fields for HOD while retaining HR/Admin values. Frontend15b0730967eda7bc published to beta; production Hosting remains2796877493b44e1c. Published entry index-DNkKnIUB.js matches tested build.

Full expanded test:all PASS and build PASS9.23s;17 JavaScript assets passed fixture privacy scan. Main JS879.94kB/gzip272.24kB. New executable gates cover personal attendance, authoritative leave, desktop leave stages. Independent review caught and corrected explicit-null entitlement and Malaysia joined-date edge cases. Existing route test was updated to require authorized personal dialog rather than the old blocked dashboard route; session harness now verifies personal dialog closes on logout.

Live User recheck: overview annual balance10 agrees with lower balance/entitlement10 and My Leave; My Attendance opens own mobile history in October and biometric history in September; close works; My Leave count1 and label Awaiting HOD approval for the previously raw pending_hod row. Payslip list/detail and own claim list had passed earlier. No business mutations submitted.

One residual overview pending-summary defect discovered: computeUserPendingRequests omits leave records completely, and subtitle omits loan/booking counts already included in total. Minimal correction in progress using already authorized records.leave with own identity/stage checks, no new requests or record edits. User asked to return to HOD for live privacy/queue recheck; Admin remains pending.

## Final HOD/User follow-up state — 17 October 2026

HOD live recheck after backend47/frontend correction: attendance OT Pay and Total Pay columns absent; hours and HOD Recommend remain; no HR final-approval/autolock button. HOD Leave Management now shows1 pending approval and the intended pending_hod request. No approval/rejection was clicked. HOD overview unified inbox still counts its supported claim/resource items and does not surface this leave item; Leave Management is the verified complete leave queue (follow-up for overview coverage).

Final small User overview pending-summary patch counts own authorized records.leave pending stages and includes all nonzero request types in subtitle. test:review PASS after this final helper change, build PASS9.70s,17 assets pass privacy scan. Main JS880.32kB/gzip272.39kB. Beta Hosting version3254ed90f08616f3 serves index-BuC4fIuc.js. Backend remains47. Final User pending-summary helper is regression-tested but not separately live rechecked after this last small deployment; personal attendance/leave/payslip/claim flows were live checked on immediately prior beta version with identical flow implementation.

Admin check remains pending: user reported sign-in but the inspected account displayed demo hr / HR, so it was not counted as Admin acceptance. User asked to select Admin/Superadmin; no account roles were edited. Other residuals: actual device/latency benchmarking, full-history attendance response/table scaling, existing mobile joined-date slicing edge, existing own-HR/Admin withdrawal UI/backend policy mismatch, and previously documented PDF dependency advisories.

## Role verification handover — 17 October 2026

User clarified that HR is the highest role they want considered in this review ("HR consider as superadmin"). No account or authorization policy was changed. Current source still distinguishes HR from Admin, so Admin-only privileges were not claimed as tested.

Final live HR read-only check: attendance monetary columns remain visible and HR final-approval/autolock controls are available; payroll Summary Dashboard renders. No final approval/autolock/report export or business mutation was executed. User, HOD and HR smoke coverage is complete for the documented screens; full end-to-end write workflows and Admin-specific actions remain outside this acceptance evidence.

Final beta3254ed90f08616f3 / index-BuC4fIuc.js; shared backend47. Production Hosting remains previous version2796877493b44e1c. UI corrections are beta-only until separately promoted; shared backend privacy changes affect both frontends. Full test:all passed before final overview-count-only tweak, and full test:review plus focused overview regressions passed afterward. Final build9.70s and17-asset privacy scan passed. Current report preserves known gaps rather than claiming bug-free completion.
