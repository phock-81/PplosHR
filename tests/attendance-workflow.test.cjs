const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Attendance Multi-Tier Approval Workflow & Clean UI ---');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const r = runtime(gasCode);

function callAction(action, payload = {}, actor = null) {
  r.ctx.SpreadsheetApp.flush();
  return JSON.parse(r.ctx.routePost_({
    postData: {
      contents: JSON.stringify({ action, payload, actor })
    }
  }).getContent());
}

function staff(name, role, manager = '', basic = 4000, joinedDate = '2023-01-01', alEntitlement = 14, companyId = 'CMP1') {
  const row = Array(43).fill('');
  Object.assign(row, {
    0: name,
    1: 'Active',
    2: name.toLowerCase(),
    3: 'pass123',
    4: role,
    5: basic,
    12: joinedDate,
    13: joinedDate,
    21: alEntitlement,
    24: 'EMP-' + name,
    25: companyId,
    27: manager,
    30: 1
  });
  return row;
}

// 1. Setup Staff Sheet
r.set('Staff', [
  Array(43).fill('header'),
  staff('ADMIN', 'Admin', '', 8000),
  staff('HR_OFFICER', 'HR', '', 5000),
  staff('HOD_KENNY', 'HOD', '', 6000),
  staff('STAFF_DANNY', 'User', 'HOD_KENNY', 3500),
  staff('STAFF_LILY', 'User', 'HOD_KENNY', 3200)
]);

r.set('Holidays', [['Date', 'Name']]);
r.set('Data', [Array(7).fill('header')]);
r.set('Attendance', [Array(15).fill('header')]);
r.set('LockedMonths', [['Month', 'Data JSON']]);
r.set('Payroll', [Array(20).fill('header')]);

// Setup Leave Sheet with:
// 1. One pending_hod for Danny (HOD Kenny should see in action count)
// 2. One pending_admin for Lily (HR/Admin should see in action count)
r.set('Leave', [
  Array(15).fill('header'),
  [
    'LV-1', 'STAFF_DANNY', 'AL', '2026-05-10', '2026-05-11',
    2, 'Vacation', '', 'pending_hod', '2026-05-01', '', '', 2, 0, ''
  ],
  [
    'LV-2', 'STAFF_LILY', 'NPL', '2026-05-15', '2026-05-15',
    1, 'Emergency', '', 'pending_admin', '2026-05-01', '', '', 0, 1, ''
  ]
]);

// Setup Claims Sheet with:
// 1. One Pending manager claim for Danny (manager HOD_KENNY)
// 2. One Pending admin claim for Lily
// 3. One Approved claim <= 20th for Danny (ready to be paid in 2026-05 lock)
r.set('HR_claims', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'CLM-1', 1, 'STAFF_DANNY', 'Pending manager',
    JSON.stringify({
      id: 'CLM-1', employee: 'STAFF_DANNY', manager: 'HOD_KENNY', category: 'Medical',
      amount: 80, date: '2026-05-05', status: 'Pending manager'
    }),
    '2026-05-05T00:00:00Z', 'STAFF_DANNY'
  ],
  [
    'CLM-2', 1, 'STAFF_LILY', 'Pending admin',
    JSON.stringify({
      id: 'CLM-2', employee: 'STAFF_LILY', manager: 'HOD_KENNY', category: 'Dental',
      amount: 150, date: '2026-05-08', status: 'Pending admin'
    }),
    '2026-05-08T00:00:00Z', 'STAFF_LILY'
  ],
  [
    'CLM-3', 1, 'STAFF_DANNY', 'Approved',
    JSON.stringify({
      id: 'CLM-3', employee: 'STAFF_DANNY', manager: 'HOD_KENNY', category: 'Mileage',
      amount: 120, date: '2026-05-12', status: 'Approved'
    }),
    '2026-05-12T00:00:00Z', 'ADMIN'
  ]
]);

r.set('HR_audit', [['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By']]);
r.set('HR_bookings', [['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By']]);
r.set('HR_loans', [['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By']]);
r.set('HR_profiles', [['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By']]);

console.log('Testing Part 1: getActionCount for different roles...');

// 1. Admin / HR action count
const adminCountRes = callAction('getActionCount', {}, { name: 'ADMIN', role: 'Admin' });
assert.equal(adminCountRes.status, 'success');
assert.equal(adminCountRes.data.pendingLeaves, 1, 'Admin should have 1 pending leave (pending_admin)');
assert.equal(adminCountRes.data.pendingClaims, 1, 'Admin should have 1 pending claim (Pending admin)');
assert.equal(adminCountRes.data.total, 2, 'Admin should have 2 total pending actions before attendance');

// 2. HOD Kenny action count
const hodCountRes = callAction('getActionCount', {}, { name: 'HOD_KENNY', role: 'HOD' });
assert.equal(hodCountRes.status, 'success');
assert.equal(hodCountRes.data.pendingLeaves, 1, 'HOD Kenny should have 1 pending leave (pending_hod for subordinate Danny)');
assert.equal(hodCountRes.data.pendingClaims, 1, 'HOD Kenny should have 1 pending claim (Pending manager for Danny)');
assert.equal(hodCountRes.data.total, 2, 'HOD Kenny should have 2 total pending actions');

console.log('PASS Part 1: Action count metrics verified for Admin and HOD.');

console.log('Testing Part 2: Attendance Multi-Tier Approval Flow (HOD -> HR -> Autolock)...');

// Stage 0: Initial getAttendanceApproval should be Draft
const initAtt = callAction('getAttendanceApproval', { month: '2026-05' }, { name: 'ADMIN', role: 'Admin' });
assert.equal(initAtt.status, 'success');
assert.equal(initAtt.data.approvalStatus, 'Draft');

// Stage 1: Regular staff attempts HOD recommendation (should be rejected)
const unauthorizedHOD = callAction('approveAttendanceHOD', { month: '2026-05' }, { name: 'STAFF_DANNY', role: 'User' });
assert.equal(unauthorizedHOD.status, 'error', 'Non-manager must be denied from approving HOD attendance');

// Stage 1: HOD Kenny recommends attendance for 2026-05
const hodRecommend = callAction('approveAttendanceHOD', {
  month: '2026-05',
  comments: 'All site punch logs verified and OT confirmed.'
}, { name: 'HOD_KENNY', role: 'HOD' });
assert.equal(hodRecommend.status, 'success');
assert.equal(hodRecommend.data.approvalStatus, 'Pending HR');
assert.equal(hodRecommend.data.hodApprover, 'HOD_KENNY');

// Now Admin action count should have pendingAttendance = 1
const adminCountAfterHOD = callAction('getActionCount', {}, { name: 'ADMIN', role: 'Admin' });
assert.equal(adminCountAfterHOD.data.pendingAttendance, 1, 'Admin should now see 1 pending attendance approval');
assert.equal(adminCountAfterHOD.data.total, 3, 'Admin total pending actions should now be 3');

// Stage 2: HOD attempts final HR approval (should be rejected)
const unauthorizedHR = callAction('approveAttendanceHR', { month: '2026-05' }, { name: 'HOD_KENNY', role: 'HOD' });
assert.equal(unauthorizedHR.status, 'error', 'Non-HR must be denied from final attendance approval and autolock');

// Stage 2: HR approves and autolocks attendance for 2026-05
const hrApproval = callAction('approveAttendanceHR', {
  month: '2026-05',
  data: {
    rates: {
      'STAFF_DANNY': { basic: 3500, restDays: [0] },
      'STAFF_LILY': { basic: 3200, restDays: [0] }
    }
  }
}, { name: 'HR_OFFICER', role: 'HR' });
assert.equal(hrApproval.status, 'success');

// Verify that month is now locked in LockedMonths
const lockedAtt = callAction('getAttendanceApproval', { month: '2026-05' }, { name: 'HR_OFFICER', role: 'HR' });
assert.equal(lockedAtt.status, 'success');
assert.equal(lockedAtt.data.approvalStatus, 'Locked');
assert.equal(lockedAtt.data.hrApprover, 'HR_OFFICER');

// Verify that approved claim CLM-3 was automatically marked as Paid with reference 'PAYROLL-2026-05'
const claimsRows = r.sheets.HR_claims.rows;
const clm3Row = claimsRows.find(row => row[0] === 'CLM-3');
assert.ok(clm3Row, 'CLM-3 must exist in claims sheet');
const clm3Json = typeof clm3Row[4] === 'string' ? JSON.parse(clm3Row[4]) : clm3Row[4];
assert.equal(clm3Json.status, 'Paid', 'Approved claim <= 20th must be transitioned to Paid');
assert.equal(clm3Json.paymentReference, 'PAYROLL-2026-05');

// Verify that Payroll sheet now has autolocked records
const payrollRows = r.sheets.Payroll.rows;
assert.ok(payrollRows.length > 1, 'Payroll records must be generated');
const dannyPayroll = payrollRows.find(row => row[2] === 'STAFF_DANNY');
assert.ok(dannyPayroll, 'Danny payroll row must be generated');
assert.equal(dannyPayroll[0], '2026-05');

// After lock, Admin pendingAttendance should be back to 0
const adminCountAfterLock = callAction('getActionCount', {}, { name: 'ADMIN', role: 'Admin' });
assert.equal(adminCountAfterLock.data.pendingAttendance, 0, 'Admin pending attendance should be 0 after lock');

console.log('PASS Part 2: Attendance Multi-Tier Approval Flow & Autolock verified.');

console.log('Testing Part 3: Rejection Flow (Return to Draft)...');

// Seed a month 2026-06 as Pending HR
callAction('approveAttendanceHOD', { month: '2026-06' }, { name: 'HOD_KENNY', role: 'HOD' });

// Reject month 2026-06
const rejectRes = callAction('rejectAttendanceApproval', {
  month: '2026-06',
  reason: 'Missing overtime punch on 14th June.'
}, { name: 'HR_OFFICER', role: 'HR' });
assert.equal(rejectRes.status, 'success');
assert.equal(rejectRes.data.approvalStatus, 'Rejected');
assert.equal(rejectRes.data.rejectionReason, 'Missing overtime punch on 14th June.');

console.log('PASS Part 3: Rejection Flow verified.');

console.log('Testing Part 4: Frontend UI Cleanliness & Badge Verification...');

const vuePath = path.join(__dirname, '..', 'src', 'components', 'PayrollDashboard.vue');
const vueCode = fs.readFileSync(vuePath, 'utf8');

// Ensure Upload Data button is completely removed
assert.doesNotMatch(vueCode, /<i class="bi bi-cloud-upload-fill me-2"><\/i>\s*Upload Data/, 'Upload Data button must be removed from header');

// Ensure refreshSystemBtn is hidden from visible UI
assert.match(vueCode, /id="refreshSystemBtn"[^>]*style="display:\s*none;"/, 'refreshSystemBtn must be hidden from user view');

// Ensure AccountMenu has notification badge
const accountMenuPath = path.join(__dirname, '..', 'src', 'components', 'AccountMenu.vue');
const accountMenuCode = fs.readFileSync(accountMenuPath, 'utf8');
assert.match(accountMenuCode, /id="accountActionBadge"/, 'AccountMenu must have #accountActionBadge notification badge');
assert.match(accountMenuCode, /hr-action-count/, 'AccountMenu must listen to hr-action-count event');

// Ensure dashboard.js strictly sources allStaffNames from staffSettings
const dashPath = path.join(__dirname, '..', 'src', 'services', 'dashboard.js');
const dashCode = fs.readFileSync(dashPath, 'utf8');
assert.match(dashCode, /const allStaffNames = Object\.keys\(staffSettings\);/, 'allStaffNames in renderStaffMgmt must strictly source from staffSettings');
assert.match(dashCode, /recommendAttendanceHOD/, 'recommendAttendanceHOD must be defined in dashboard.js');
assert.match(dashCode, /approveAttendanceHR/, 'approveAttendanceHR must be defined in dashboard.js');
assert.match(dashCode, /rejectAttendanceApproval/, 'rejectAttendanceApproval must be defined in dashboard.js');
assert.match(dashCode, /fetchActionCount/, 'fetchActionCount must be defined in dashboard.js');

console.log('PASS Part 4: Frontend UI cleanliness & notification badge verified.');

console.log('Testing Part 5: Attendance Upload Feature & Universal HR Review Verification...');

// 1. Verify Attendance Upload button in PayrollDashboard.vue
assert.match(vueCode, /id="attendanceFileUpload"/, 'PayrollDashboard must have #attendanceFileUpload in controlPanel');
assert.match(vueCode, /Upload Staff Attendance/, 'PayrollDashboard must have "Upload Staff Attendance" button');
assert.match(vueCode, /accept="\.csv,\s*\.xlsx,\s*\.xls"/, 'attendanceFileUpload must accept .csv, .xlsx, .xls files');

// 2. Verify HrWorkspace.vue has biometric upload trigger
const hrWorkspacePath = path.join(__dirname, '..', 'src', 'components', 'HrWorkspace.vue');
const hrWorkspaceCode = fs.readFileSync(hrWorkspacePath, 'utf8');
assert.match(hrWorkspaceCode, /id="hrAttendanceFileUpload"/, 'HrWorkspace must have #hrAttendanceFileUpload input');
assert.match(hrWorkspaceCode, /Upload Biometric Attendance/, 'HrWorkspace must have "Upload Biometric Attendance" button');

// 3. Verify dashboard.js file event listeners
assert.match(dashCode, /#attendanceFileUpload/, 'dashboard.js must attach event listener to #attendanceFileUpload');

// 4. Verify no premature dropping of staff without punch logs in renderDashboard
const renderDashboardCode = dashCode.substring(dashCode.indexOf('function renderDashboard('), dashCode.indexOf('function buildTable('));
assert.doesNotMatch(renderDashboardCode, /if\s*\(staffDataMap\.size\s*===\s*0\)\s*return;/, 'renderDashboard must NOT drop staff who have zero punches, ensuring all staff schedules render for HR review');

// 5. Verify direct HR approval button in Draft stage
assert.match(dashCode, /btnApproveAttendanceHRDirect/, 'dashboard.js must provide #btnApproveAttendanceHRDirect so HR can review and directly approve attendance in Draft stage');

console.log('PASS Part 5: Attendance upload feature & universal HR review verified.');

console.log('Testing Part 6: HOD Attendance Approvals Access & Top Action Buttons...');

// 1. Ensure #dashboard container is accessible to HOD and not restricted by admin-only-element
assert.doesNotMatch(vueCode, /<div\s+id="dashboard"[^>]*class="[^"]*admin-only-element[^"]*"/, 'Attendance #dashboard container must not have admin-only-element so HOD and Supervisor can review attendance');

// 2. Ensure top action buttons exist in attendanceApprovalBanner
assert.match(dashCode, /id="btnRecommendAttendanceHODTop"/, 'dashboard.js must render #btnRecommendAttendanceHODTop in the top approval banner for immediate HOD submission');
assert.match(dashCode, /id="btnApproveAttendanceHRTop"/, 'dashboard.js must render #btnApproveAttendanceHRTop in the top approval banner for HR');

// 3. Ensure month fallback logic exists in action handlers
assert.match(dashCode, /m\s*=\s*m\s*\|\|\s*\$\('#monthSelect'\)\.val\(\)/, 'Action handlers must fallback to #monthSelect.val() if month param is omitted');

console.log('PASS Part 6: HOD attendance approvals access & top action buttons verified.');

console.log('\nALL ATTENDANCE WORKFLOW & NOTIFICATION TESTS PASSED SUCCESSFULLY!\n');

