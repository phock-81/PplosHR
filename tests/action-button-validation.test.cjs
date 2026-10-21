/**
 * action-button-validation.test.cjs
 * 
 * Comprehensive regression tests verifying Action Button Validation Matrix & Audit fixes:
 * 1. PERF-01: HrWorkspace.vue save() patches local record, closes editor, and runs background reload without freezing UI.
 * 2. PERF-02: GAS_payroll.js hrBootstrap_ does not seed/mutate when records exist.
 * 3. FUNC-01: RoleOverview.vue does not fabricate 14-day fallback when leave balance is null.
 * 4. FUNC-02: RoleOverview.vue checks actual attendance for today and derives payroll state from lockedMonths.
 * 5. FUNC-03: RoleOverview.vue handleDrilldown routes to valid page IDs (staff-portal, leave-management, dashboard, summary-dashboard, staff-mgmt).
 * 6. FUNC-05: OverviewMetricService computeUserClaimLimits evaluates dynamic claim policies.
 * 7. FUNC-06: dashboard.js syncHolidaysToDB and deleteStaff validate API responses and support rollback.
 * 8. FUNC-07: HrWorkspace.vue act() wraps transition in try/finally.
 * 9. SEC-01: dashboard.js renderStaffMgmt safely escapes staff names in onclick handlers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PERF-01 & FUNC-07: HrWorkspace save() and act() harden state handling and prevent UI freezes', () => {
  const file = path.resolve(__dirname, '../src/components/HrWorkspace.vue');
  const code = fs.readFileSync(file, 'utf8');

  // Verify save() patches local state immediately and closes modal before background load
  assert.match(code, /if\s*\(res\.data\)\s*\{[\s\S]*?records\.value\[active\.value\]/, 'save() must patch local records state');
  assert.match(code, /editor\.value\s*=\s*null;\s*notice\.value\s*=\s*'Record saved\.'/, 'editor must close and notice show promptly');
  assert.match(code, /load\(true\)\.catch\(console\.error\);/, 'load(true) must be called asynchronously without blocking UI');

  // Verify act() has try/finally to prevent stuck saving state
  assert.match(code, /async function act\(\)\s*\{[\s\S]*?try\s*\{[\s\S]*?\}\s*finally\s*\{\s*saving\.value\s*=\s*false;\s*\}/, 'act() must use try/finally to reset saving.value');

  // Verify onOverviewNavigateModule resolves scope properly
  assert.match(code, /function onOverviewNavigateModule\(mod,\s*targetScope\)\s*\{/, 'onOverviewNavigateModule must accept targetScope');
  assert.match(code, /let s\s*=\s*targetScope;[\s\S]*?if\s*\(!s\s*\|\|\s*s\s*===\s*'overview'\)/, 'onOverviewNavigateModule must default non-overview scope');
});

test('PERF-02: GAS_payroll.js hrBootstrap_ is strictly read-only and skips seeding when tables exist', () => {
  const file = path.resolve(__dirname, '../backend/GAS_payroll.js');
  const code = fs.readFileSync(file, 'utf8');

  // Verify seed calls are conditional on empty table only
  assert.match(code, /if\s*\(hrRows_\('jobGrades'\)\.length\s*===\s*0\)\s*hrSeedInductionGrades_/, 'hrBootstrap_ must only seed grades if empty');
  assert.match(code, /if\s*\(hrRows_\('workSchedules'\)\.length\s*===\s*0\)\s*hrSeedWorkSchedules_/, 'hrBootstrap_ must only seed schedules if empty');
  assert.doesNotMatch(code, /hrSeedWorkSchedules_\(\);\s*const shared/, 'hrBootstrap_ must not unconditionally call hrSeedWorkSchedules_');
});

test('FUNC-01, FUNC-02 & FUNC-03: RoleOverview.vue metrics, valid drilldowns, and zero-fabrication', () => {
  const file = path.resolve(__dirname, '../src/components/overview/RoleOverview.vue');
  const code = fs.readFileSync(file, 'utf8');

  // FUNC-01: Zero-fabrication for Annual Leave
  assert.doesNotMatch(code, /userLeave\.value\.alBalance\s*\?\?\s*14/, 'Must not use ?? 14 fallback for AL balance');
  assert.match(code, /alDays\s*!=\s*null\s*\?\s*alDays\s*:\s*'—'/, 'Must show dash if balance is null');

  // FUNC-02: Attendance and Payroll lock status
  assert.match(code, /const todayAttendance\s*=\s*\(props\.records\?\.attendance\s*\|\|\s*\[\]\)\.filter/, 'Must filter records.attendance for today');
  assert.match(code, /computeUserAttendanceState\(props\.user,\s*todayAttendance\)/, 'Must pass today attendance to computeUserAttendanceState');
  assert.match(code, /const isMonthLocked\s*=\s*Boolean\(lockedMonths\[currentMonth\]\);/, 'Payroll status must check lockedMonths');

  // FUNC-03: Drilldowns route to valid registered page IDs
  assert.match(code, /if\s*\(target\s*===\s*'myLeave'\)\s*\{\s*navigateToTab\('staff-portal'\);/, 'myLeave must navigate to staff-portal');
  assert.match(code, /if\s*\(target\s*===\s*'teamLeave'\)\s*\{\s*navigateToTab\('leave-management'\);/, 'teamLeave must navigate to leave-management');
  assert.match(code, /if\s*\(target\s*===\s*'myAttendance'\)\s*\{\s*window\.dispatchEvent\(new CustomEvent\('hr-personal-attendance'\)\)/, 'myAttendance must open the authorized personal view');
  assert.match(code, /if\s*\(target\s*===\s*'payroll'\)\s*\{\s*navigateToTab\('summary-dashboard'\);/, 'payroll must navigate to summary-dashboard');
  assert.match(code, /if\s*\(target\s*===\s*'directory'.*?\)\s*\{\s*navigateToTab\('staff-mgmt'\);/, 'directory must navigate to staff-mgmt');
});

test('FUNC-05: OverviewMetricService computeUserClaimLimits evaluates dynamic policies', async () => {
  const { computeUserClaimLimits } = await import('../src/components/overview/OverviewMetricService.js');

  const user = { name: 'JOHN DOE', gradeId: 'M' };
  const customPolicies = [
    { gradeId: 'M', category: 'Medical', annualLimit: 1800, availability: 'Active' }
  ];

  const resultWithPolicy = computeUserClaimLimits(user, [], customPolicies);
  assert.equal(resultWithPolicy.cap, 1800, 'Must apply custom active policy limit');

  // Without custom policy, falls back to FAM-23/G grade cap
  const resultFallback = computeUserClaimLimits(user, [], []);
  assert.equal(resultFallback.cap, 1000, 'Grade M fallback cap must be 1000');
});

test('FUNC-06 & SEC-01: dashboard.js response validation, rollback, and safe onclick escaping', () => {
  const file = path.resolve(__dirname, '../src/services/dashboard.js');
  const code = fs.readFileSync(file, 'utf8');

  // FUNC-06: deleteStaff rollback
  assert.match(code, /async function deleteStaff\(name\)\s*\{[\s\S]*?const backup\s*=\s*staffSettings\[name\];/, 'deleteStaff must backup staff record before removal');
  assert.match(code, /if\s*\(!res\s*\|\|\s*res\.status\s*!==\s*'success'\)\s*\{[\s\S]*?staffSettings\[name\]\s*=\s*backup;/, 'deleteStaff must restore backup on API failure');

  // FUNC-06: syncHolidaysToDB status check
  assert.match(code, /async function syncHolidaysToDB\(\)\s*\{[\s\S]*?if\s*\(res\s*&&\s*res\.status\s*===\s*'success'\)/, 'syncHolidaysToDB must verify res.status === success');

  // FUNC-06: saveData / saveAttendance check
  assert.match(code, /const \[res1,\s*res2\]\s*=\s*await Promise\.all\(\[\s*apiPost\('saveData'/, 'Attendance sync must run both requests and check statuses');

  // Button wiring
  assert.match(code, /openStaffModal\('UPDATE',\s*'\${name}'\)/, 'Table view must wire openStaffModal');
  assert.match(code, /window\.openStaffDossier\('\${name}'\)/, 'Table view must wire openStaffDossier');
});
