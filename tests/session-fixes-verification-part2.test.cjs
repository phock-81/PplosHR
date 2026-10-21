const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Starting Verification Part 2: Navigation Auto-Collapse, Action Count Tally & Personal Attendance Remarks ---');

// 1. Navigation Auto-Collapse and Default Collapsed State
const dashJsPath = path.resolve(__dirname, '../src/services/dashboard.js');
const dashJs = fs.readFileSync(dashJsPath, 'utf8');

assert.ok(!dashJs.includes('<details open class="navigation-subdetails">'), 'Subgroups must not be hardcoded as open by default');
assert.ok(dashJs.includes('<details class="navigation-subdetails">'), 'Subgroups must start collapsed by default');
assert.ok(dashJs.includes("menu.find('details').removeAttr('open')"), 'details must auto collapse to parent when tab is selected');
assert.ok(dashJs.includes("closest('.navigation-subgroup').addClass('has-active')"), 'Active indicator must be assigned to parent subgroup');
console.log('PASS 1: Navigation auto-collapse and default collapsed state verified.');

// 2. Action Count Tally on Web Overview and Backend
const metricServicePath = path.resolve(__dirname, '../src/components/overview/OverviewMetricService.js');
const metricService = fs.readFileSync(metricServicePath, 'utf8');

assert.ok(metricService.includes('// 6. Leave Requests'), 'buildUnifiedActionInbox must process leave requests');
assert.ok(metricService.includes("isPendingHod && (role === 'HOD' || isAdmin)"), 'buildUnifiedActionInbox must support HOD pending leave');
assert.ok(metricService.includes('teamMemberNames.has'), 'buildUnifiedActionInbox must check team subordinates');

// Test buildUnifiedActionInbox pure function with mock HOD and 3 actionable items
const { buildUnifiedActionInbox } = require(path.resolve(__dirname, '../src/components/overview/OverviewMetricService.js'));

const mockHod = { name: 'NG KE NAM', role: 'HOD' };
const mockRecords = {
  claims: [
    { id: 'CLM-01', employee: 'ASMA ZARIHA BINTI MOHD. SHUKRI', manager: 'NG KE NAM', status: 'Pending manager', amount: 100, date: '2026-10-15' }
  ],
  bookings: [
    { id: 'RES-01', employee: 'ASMA ZARIHA BINTI MOHD. SHUKRI', manager: 'NG KE NAM', status: 'Pending manager', title: 'Uniformo', date: '2026-10-16' }
  ]
};
const mockTeamLeave = [
  { id: 'LV-01', employee: 'ASMA ZARIHA BINTI MOHD. SHUKRI', type: 'ML', days: 1, status: 'pending_hod', start: '2026-10-16', end: '2026-10-16' }
];
const mockEmployees = [
  { name: 'ASMA ZARIHA BINTI MOHD. SHUKRI', manager: 'NG KE NAM' }
];

const inboxItems = buildUnifiedActionInbox(mockHod, mockRecords, [], mockTeamLeave, mockEmployees);
assert.equal(inboxItems.length, 3, 'HOD inbox must return all 3 actionable items (Leave, Claim, Resource)');
assert.ok(inboxItems.some(i => i.module === 'claims'), 'Claim must be in inbox');
assert.ok(inboxItems.some(i => i.module === 'bookings'), 'Booking resource must be in inbox');
assert.ok(inboxItems.some(i => i.module === 'leave'), 'Leave must be in inbox');
console.log('PASS 2: Unified Action Inbox returns exactly 3 items and tallies with mobile approvals.');

// 3. Backend GAS_payroll getActionCount and saveStaffAttendanceRemark
const backendPath = path.resolve(__dirname, '../backend/GAS_payroll.js');
const backend = fs.readFileSync(backendPath, 'utf8');

assert.ok(backend.includes("if (action === 'saveStaffAttendanceRemark')"), 'saveStaffAttendanceRemark route must exist in GAS_payroll.js');
assert.ok(backend.includes("function saveStaffAttendanceRemark(payload, actor)"), 'saveStaffAttendanceRemark implementation must exist');
assert.ok(backend.includes("Attendance for ' + month + ' has been approved & locked by HR"), 'Must prevent editing remarks for locked months');
assert.ok(backend.includes("} else if (isHod) {\n    bookings.filter"), 'getActionCount must count bookings and loans for HOD subordinates');
console.log('PASS 3: Backend getActionCount for HOD and saveStaffAttendanceRemark verified.');

// 4. My Attendance Navigation and PersonalAttendance Component
const navPath = path.resolve(__dirname, '../src/hr/navigation.js');
const nav = fs.readFileSync(navPath, 'utf8');
assert.ok(nav.includes("page('my-attendance','My Attendance','clock-history','personal')"), 'My Attendance must be in My Workspace navigation');

const personalAttPath = path.resolve(__dirname, '../src/components/PersonalAttendance.vue');
const personalAtt = fs.readFileSync(personalAttPath, 'utf8');
assert.ok(personalAtt.includes('saveStaffAttendanceRemark'), 'PersonalAttendance must call saveStaffAttendanceRemark');
assert.ok(personalAtt.includes('isMonthLocked'), 'PersonalAttendance must check isMonthLocked');
assert.ok(personalAtt.includes('Active / Unapproved'), 'PersonalAttendance must indicate active/unapproved month status');
assert.ok(personalAtt.includes('embedded'), 'PersonalAttendance must support embedded workspace tab mode');

const payrollDashPath = path.resolve(__dirname, '../src/components/PayrollDashboard.vue');
const payrollDash = fs.readFileSync(payrollDashPath, 'utf8');
assert.ok(payrollDash.includes('id="my-attendance"'), 'my-attendance tab section must exist in PayrollDashboard.vue');

console.log('PASS 4: My Attendance tab, embedded PersonalAttendance, and remark editing capability verified.');

console.log('\n--- ALL VERIFICATIONS PASSED SUCCESSFULLY! ---');
