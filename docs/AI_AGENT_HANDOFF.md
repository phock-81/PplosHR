# PplosHR — AI Agent handoff for Stages 1, 2 and 3

**Prepared:** 14 October 2026  
**Deployment target:** Firebase Hosting preview channel `beta`, project/site `peopleoshr`  
**Expected beta URL:** https://peopleoshr--beta-qlz5ndcb.web.app/  
**Production URL:** https://peopleoshr.web.app/ — DO NOT deploy to production.  
**Status:** Frontend-only Stage 2/3 patch prepared; NOT deployed and NOT end-to-end tested. Stage 1 patch previously prepared separately.

## Mission

Integrate and validate the new read-only Management Insights workspace against the **latest** PplosHR application source, preserve all working payroll/leave/claim/role flows, combine with Stage 1 analytics as needed, and deploy ONLY to the `beta` Firebase Hosting preview channel after successful testing. Do not claim an operational beta deployment until the hosting CLI confirms the release URL and the page is verified.

## Authoritative sources / project location

- Main Google Drive folder: https://drive.google.com/drive/folders/18REEFyT86A_LQR7n6-onnDRbDVS2iQ0x
- Source Vue component: `src/components/HrWorkspace.vue`
- Existing analytics component from Stage 1: `src/components/HrAnalytics.vue`
- Existing routes/roles: `src/hr/navigation.js` and `src/hr/schema.js`
- Existing backend: `backend/GAS_payroll.js` (Google Apps Script; no patch to this file supplied here)
- Existing hosting target configuration: `firebase.json` with `hosting.site` = `peopleoshr`
- Source reference docs: `HR_REVIEW.md`, `VERIFICATION.md`, `DEPLOY_HR.md`
- Reference manual: attached *Byte HRPlus User Manual* (89 pages), used as functional comparison, not as program source.

**Critical:** The project Drive content can change after patch extraction. Compare current files with package versions before applying. Do not overwrite more recent fixes. The patch carries a full `HrWorkspace.vue` from the earlier Phase 1 patch for integration convenience, but safest integration is to add only the `HrInsights` import and Overview component mount into the newest live source.

## Patch contents

1. `src/components/HrInsights.vue` — new Stage 2/3 insights module.
2. `src/components/HrWorkspace.vue` — full previously patched component plus two lines to import/mount `HrInsights`.
3. `src/components/HrAnalytics.vue` — unchanged Stage 1 overview/report charts for combined integration.
4. `docs/AI_AGENT_HANDOFF.md` — this handoff.

## Stage 2 — implemented in this patch

- Department-grouped employee structure with recorded managers and explicit unassigned-staff grouping. This is an organization grouping, not a fully linked hierarchical graph.
- Approved team leave monthly heatmap, with overlapping days highlighted by employee; no staffing-minimum policy or conflict blocking.
- Claims by type: counts and sum of requested amounts (NOT paid actual payroll expenses). Existing authorized `hrBootstrap` claims feed only.
- Company/department filters and per-view CSV exports with CSV formula-injection escaping.
- Browser print / Save as PDF (NOT server-generated signed/archived PDF).

## Stage 3 — implemented in this patch

- Recruitment candidate-stage counts; not historic conversion or time-to-hire.
- Training certificate expiry list (future expiry dates with the earliest 12 displayed); no automated notices.
- Appraisal final rating view and mean of present positive ratings; no missing scores inferred.

## Security and scope

- Management Insights renders only for `HR` and `Admin` within this component; all input records are supplied from existing authorized frontend bootstrap data.
- HOD/User must NOT receive hidden HR data via frontend calls. Backend role protection must remain enforced; frontend conditional display is not a security boundary.
- Project is Apps Script + Google Sheets backend with Firebase Hosting for frontend. Do not send secrets into Vite `VITE_` variables or frontend source.
- Do not alter employee/grade/claim policies, statutory computations, payroll runs, leave opening balance ledgers or approval statuses as part of this task.

## Integration steps for agent

1. Obtain *current* source from the Drive folder or a verified Git working tree and back it up; do not use an older `dist` artifact as source.
2. Inspect the current `HrWorkspace.vue` for newer code and existing analytics. Add import `import HrInsights from './HrInsights.vue';` if absent.
3. Add `<HrInsights :employees="employees" :records="records" :team-leave="teamLeave" :role="user?.role || 'User'" />` beneath existing `<HrAnalytics ... mode="overview" />` in the Overview template; ensure just one instance.
4. Copy `HrInsights.vue` into `src/components/`. Preserve existing styles/theming.
5. Verify `hrBootstrap` returns employee, company, department, approved team leave, claims, recruitment, training and appraisals in the desired scope. If missing, **do not expand backend access casually**; design and test role-safe projections first.
6. Verify chart source records map to current backend fields (especially status/manager/companyId/departmentId/finalRating/expiry). Correct mismatches in a targeted patch, documenting every change.
7. Consider deriving leave day boundaries in Malaysia-local date (instead of relying on UTC month defaults) if native calendar date behavior differs in live browser.
8. Run automated tests, production build, and real-browser four-role smoke checks.

## Must-run checks / acceptance gate

- `npm ci`
- `npm run build`
- `npm run test:all` (if configured in latest project), and the other currently supported UI smoke/navigation tests; record any skipped suites.
- Admin/HR: Overview shows insights and changing company/department filters changes visible records only.
- HOD/User: management-only panels, payroll financials and HR-only records are not visible or accessible.
- Staff with no company/department remains listed as unassigned; missing data shows sensible empty states and no NaN.
- Team leave months with 28/29/30/31 days work; leave spanning month boundaries paints appropriate days; no false approval or automatic restriction.
- CSV opens in Excel correctly; special strings beginning `=,+,-,@` cannot become formulas; exported rows match currently authorized filters.
- PDF print layout tested in Chromium browser for a management page and no browser errors.
- Login/logout/account-switch isolation, browser reload, data refresh, and stale-session responses.
- Existing staff updates, leave balances, claims approval, payslip PDF, payroll calculations, resource assignments, HR letters and navigation still work.

## Beta deployment (PowerShell only after verified tests)

```powershell
cd "<verified-current-pploshr-source-folder>"
npm ci
npm run build
# Run applicable tests from package.json, for example:
npm run test:all
# Beta preview ONLY. Do not substitute `firebase deploy --only hosting`.
firebase login
firebase hosting:channel:deploy beta --project peopleoshr --only peopleoshr
```

Firebase CLI flag support may vary by version; if `--only peopleoshr` is unsupported, use `firebase hosting:channel:deploy beta --project peopleoshr` with the *verified* `firebase.json` pointing to `peopleoshr`. To prevent inadvertent production deployment, **never** run `firebase deploy --only hosting --project peopleoshr` for this handoff. Use a beta channel deployment and verify the URL emitted by Firebase; the preview URL may change.

### Deployment evidence to collect

- CLI version, Firebase project/site/channel, release ID, UTC deployment time, emitted preview URL.
- `npm run build` result and test command summaries.
- Screenshot of beta Overview as HR and as User; screenshot of export/print preview.
- Confirmation production channel untouched.
- Any errors/limitations with remediation steps.

## Deferred / not implemented in this patch

True interactive reporting-line tree, role-specific HOD management insights, organization vacancies, department staffing threshold alerts, chart-to-record details, proper PDF template library and archival, scheduled report emails, real-time payroll finance chart, skills radar matrix, recruitment conversion history, automatic training reminders, official statutory reports, policy-aware workload forecasts. These require new backend contracts, business rules and stronger tests; do not mark them complete.

## Rollback

Keep a copy of the current source and the previous beta Hosting release ID. If beta fails after deployment, restore the previous beta channel release through Firebase Hosting's supported rollback/clone procedure after verifying the source project and channel. Do not roll back production or edit Apps Script unless a backend change was explicitly included and validated.

## Completion report format

Provide: files actually changed; completed UI features; unit/integration and browser test results; known defects and unresolved items; beta preview URL from CLI; production-not-changed confirmation. Distinguish verified facts from assumptions.
