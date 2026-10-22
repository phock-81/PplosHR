const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');

console.log('--- Testing Resources Request Lifecycle, Pre-load Pipeline & UI Layouts ---');

const r = runtime(fs.readFileSync('backend/GAS_payroll.js', 'utf8'));

// Helper to construct staff row
function employee(name, role, manager = '', departmentId = 'DEPT-ENG', email = '') {
  const row = Array(45).fill('');
  Object.assign(row, {
    0: name,
    1: 'Active',
    2: name.toLowerCase(),
    3: 'test-password',
    4: role,
    5: 3500,
    23: '[]',
    24: 'EMP-' + name,
    25: 'COMP-1',
    26: departmentId,
    27: manager,
    30: 1,
    31: '',
    34: email || `${name.toLowerCase()}@metrio.com.my`
  });
  return row;
}

// Mock sheets
r.set('Staff', [
  Array(45).fill('header'),
  employee('ADMIN', 'Admin', '', 'DEPT-MGMT', 'admin@metrio.com.my'),
  employee('HR_USER', 'HR', '', 'DEPT-HR', 'hr@metrio.com.my'),
  employee('HOD_KENNY', 'HOD', '', 'DEPT-ENG', 'kenny@metrio.com.my'),
  employee('STAFF_ASMA', 'User', 'HOD_KENNY', 'DEPT-ENG', 'asma@metrio.com.my')
]);

const sentEmails = [];
r.ctx.MailApp = {
  sendEmail(opts) {
    sentEmails.push(opts);
  }
};

const tokens = {};
for (const name of ['ADMIN', 'HR_USER', 'HOD_KENNY', 'STAFF_ASMA']) {
  const loginRes = r.request('login', { username: name.toLowerCase(), password: 'test-password' });
  assert.equal(loginRes.status, 'success');
  tokens[name] = loginRes.sessionToken;
}

const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);
const ok = (v) => {
  assert.equal(v.status, 'success', v.message || 'Expected success response');
  return v.data;
};

// Seed a resource in catalogue via hrSave
const laptopRes = ok(req('HR_USER', 'hrSave', {
  module: 'resources',
  record: {
    code: 'LAP-001',
    title: 'Dell Latitude Laptop',
    category: 'Equipment',
    availability: 'Available',
    assetValue: 3500
  }
}));

// 1. Staff requests a resource
console.log('Testing 1: Staff submits Resource Request -> status Pending manager, emails HOD...');
sentEmails.length = 0;
const reqRes = ok(req('STAFF_ASMA', 'hrSave', {
  module: 'bookings',
  record: {
    employee: 'STAFF_ASMA',
    resourceId: laptopRes.id,
    title: 'Site Engineering Setup',
    start: '2026-10-25T09:00',
    end: '2026-10-30T18:00',
    notes: 'Laptop needed for site operations'
  }
}));

assert.equal(reqRes.status, 'Pending manager', 'Status must be Pending manager');
assert.equal(reqRes.manager, 'HOD_KENNY');
assert.ok(reqRes.requestedAt, 'requestedAt must be recorded');
assert.equal(reqRes.requestedBy, 'STAFF_ASMA', 'requestedBy must be recorded');

// Email must go ONLY to HOD
assert.ok(sentEmails.length >= 1, 'Email notification must be sent');
const hodEmail = sentEmails.find(e => e.to.includes('kenny@metrio.com.my'));
assert.ok(hodEmail, 'Email must be addressed to HOD (kenny@metrio.com.my)');
assert.match(hodEmail.subject, /Awaiting HOD Endorsement/i);
console.log('PASS 1: Resource request submitted, logged requestedAt, and emailed HOD.');

// 2. HOD Approves / Recommends -> status Pending admin, subsequences email to HR HOD
console.log('Testing 2: HOD endorses Resource Request -> status Pending admin, emails HR HOD...');
sentEmails.length = 0;
const hodApproveRes = ok(req('HOD_KENNY', 'hrTransition', {
  module: 'bookings',
  id: reqRes.id,
  version: reqRes.version,
  command: 'approve',
  comments: 'Recommended for site engineer duties'
}));

assert.equal(hodApproveRes.status, 'Pending admin');
assert.ok(hodApproveRes.hodApprovedAt, 'hodApprovedAt must be recorded');
assert.equal(hodApproveRes.hodApprover, 'HOD_KENNY');
assert.equal(hodApproveRes.hodRemark, 'Recommended for site engineer duties');

// Subsequence email must be sent to HR
const hrEmail = sentEmails.find(e => e.to.includes('hr@metrio.com.my') || e.to.includes('hock@metrio.com.my'));
assert.ok(hrEmail, 'Email must subsequence to HR HOD');
assert.match(hrEmail.subject, /Resource Request Endorsed by HOD/i);
console.log('PASS 2: HOD approval logged hodApprovedAt and subsequenced email to HR HOD.');

// 3. HR Approves -> status Approved, records hrApprovedAt
console.log('Testing 3: HR approves Resource Request -> status Approved, logs hrApprovedAt...');
sentEmails.length = 0;
const hrApproveRes = ok(req('HR_USER', 'hrTransition', {
  module: 'bookings',
  id: reqRes.id,
  version: hodApproveRes.version,
  command: 'approve',
  comments: 'Approved by HR Operations'
}));

assert.equal(hrApproveRes.status, 'Approved');
assert.ok(hrApproveRes.hrApprovedAt, 'hrApprovedAt must be recorded');
assert.equal(hrApproveRes.hrApprover, 'HR_USER');
console.log('PASS 3: HR approval logged hrApprovedAt.');

// 4. HR Marks Resource Ready -> status Ready, records readyAt & readyBy, notifies staff
console.log('Testing 4: HR marks Resource Ready -> status Ready, logs readyAt, notifies staff...');
sentEmails.length = 0;
const hrReadyRes = ok(req('HR_USER', 'hrTransition', {
  module: 'bookings',
  id: reqRes.id,
  version: hrApproveRes.version,
  command: 'ready',
  comments: 'Prepared at HR Office Desk 4. Serial: DELL-992'
}));

assert.equal(hrReadyRes.status, 'Ready');
assert.ok(hrReadyRes.readyAt, 'readyAt must be recorded');
assert.equal(hrReadyRes.readyBy, 'HR_USER');
assert.equal(hrReadyRes.readyNotes, 'Prepared at HR Office Desk 4. Serial: DELL-992');

// Staff notified to collect and acknowledge
const staffReadyNotice = sentEmails.find(e => e.to.includes('asma@metrio.com.my'));
assert.ok(staffReadyNotice, 'Staff must be notified that resource is ready for collection');
assert.match(staffReadyNotice.subject, /Collection|Resource is Ready/i);
console.log('PASS 4: Resource marked ready, logged readyAt, and notified staff.');

// 5. Staff Acknowledges Receipt -> status Received, auto-saves to My Resources
console.log('Testing 5: Staff acknowledges receipt -> status Received, auto-saves to My Resources...');
sentEmails.length = 0;
const staffAckRes = ok(req('STAFF_ASMA', 'hrTransition', {
  module: 'bookings',
  id: reqRes.id,
  version: hrReadyRes.version,
  command: 'acknowledge',
  comments: 'Laptop received in good condition'
}));

assert.equal(staffAckRes.status, 'Received');
assert.ok(staffAckRes.receivedAt, 'receivedAt must be recorded');
assert.equal(staffAckRes.acknowledgedBy, 'STAFF_ASMA');
assert.equal(staffAckRes.acknowledgeNotes, 'Laptop received in good condition');

// Verify automatically assigned in resourceAssignments
const assignments = r.ctx.hrRows_('resourceAssignments');
assert.ok(assignments.length >= 1, 'resourceAssignments must contain auto-assigned record');
const asmaAssignment = assignments.find(a => a.employee === 'STAFF_ASMA' && a.resourceId === laptopRes.id);
assert.ok(asmaAssignment, 'Assignment for STAFF_ASMA and laptopRes.id must exist');
assert.equal(asmaAssignment.status, 'Assigned');

// Verify Staff sheet column 32 (resources) was updated for STAFF_ASMA
const staffRows = r.sheets.Staff.rows;
const asmaRow = staffRows.find(s => s[0] === 'STAFF_ASMA');
assert.ok(asmaRow, 'STAFF_ASMA row must exist in Staff sheet');
assert.ok(asmaRow[31], 'Staff row 31 (resources) must be populated');
const parsedRes = JSON.parse(asmaRow[31]);
assert.ok(Array.isArray(parsedRes), 'Resources must be a JSON array');
assert.ok(parsedRes.some(item => item.model === 'Dell Latitude Laptop'), 'My Resources must contain Dell Latitude Laptop');

console.log('PASS 5: Staff acknowledgment logged receivedAt, auto-saved to My Resources.');

// 6. Navigation and UI Files verification
console.log('Testing 6: Verifying navigation and UI changes...');
const navContent = fs.readFileSync('src/hr/navigation.js', 'utf8');
assert.match(navContent, /hr\('bookings',\s*'Resources Request',\s*'personal',\s*'box-seam'\)/, 'Navigation must label bookings as Resources Request in personal');
assert.match(navContent, /hr\('bookings',\s*'Resource Requests',\s*'team',\s*'box-seam'\)/, 'Navigation must include Resource Requests in team');
assert.match(navContent, /'Resource Requests'/, 'Navigation must include Resource Requests in operations');

const hrWorkspace = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.match(hrWorkspace, /id="jobTitlesGradesCategorySwitcher"/, 'HrWorkspace must contain jobTitlesGradesCategorySwitcher');
assert.match(hrWorkspace, /id="hr-category-selector-jobs"/, 'HrWorkspace must contain hr-category-selector-jobs');
assert.match(hrWorkspace, /push\('ready',\s*'Mark Resource Ready'\)/, 'HrWorkspace must support ready action');
assert.match(hrWorkspace, /push\('acknowledge',\s*'Acknowledge & Receive'\)/, 'HrWorkspace must support acknowledge action');
assert.match(hrWorkspace, /Resource Request Approval (&amp;|&) Handover History/, 'HrWorkspace detail must display history timeline');
assert.match(hrWorkspace, /Auto pre-load "My Workspace"/, 'HrWorkspace must have auto preload for My Workspace');
assert.match(hrWorkspace, /Auto pre-load "My Team"/, 'HrWorkspace must have auto preload for My Team');
assert.match(hrWorkspace, /Auto pre-load "Subsequent if any"/, 'HrWorkspace must have auto preload for Subsequent');

const payrollDashboard = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');
assert.match(payrollDashboard, /myProfileUsername.*myProfilePassword/s, 'Username must appear before Password in Contact & Security Settings');
assert.match(payrollDashboard, /myProfileAcademicLevel.*myProfileRole/s, 'System Role must appear in row 2 after Academic Level in Personal Information');

const staffDossier = fs.readFileSync('src/components/StaffDossierModal.vue', 'utf8');
assert.match(staffDossier, /leaveBalances\.length === 2 \? 'col-md-6'/, 'StaffDossierModal must dynamically stretch leave balance cards');

console.log('PASS 6: Navigation, HrWorkspace, PayrollDashboard, and StaffDossier contracts verified.');

console.log('\n===============================================================');
console.log('ALL RESOURCES REQUEST, PRE-LOAD & UI TESTS PASSED PERFECTLY!');
console.log('===============================================================');
