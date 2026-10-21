const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const r = runtime(fs.readFileSync('backend/GAS_payroll.js', 'utf8'));

// Helper to construct staff row
// Index 0: Name, 1: Status, 2: username, 3: password, 4: role, 5: basic, 24: employeeNo, 25: companyId, 26: departmentId, 27: manager, 34: email
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
    34: email || `${name.toLowerCase()}@metrio.com.my`
  });
  return row;
}

// Set up mock sheets
r.set('Staff', [
  Array(45).fill('header'),
  employee('ADMIN', 'Admin', '', 'DEPT-MGMT', 'admin@metrio.com.my'),
  employee('HR_USER', 'HR', '', 'DEPT-HR', 'hr@metrio.com.my'),
  employee('HOD_KENNY', 'HOD', '', 'DEPT-ENG', 'kenny@metrio.com.my'),
  employee('STAFF_ASMA', 'User', 'HOD_KENNY', 'DEPT-ENG', 'asma@metrio.com.my'),
  employee('STAFF_BOB', 'User', 'HOD_KENNY', 'DEPT-ENG', 'bob@metrio.com.my')
]);

r.set('Leave', [
  ['ID', 'Name', 'Type', 'Start', 'End', 'Days', 'Reason', 'Attachment', 'Status', 'Date', 'Decision', 'DecisionRemark', 'AnnualDays', 'UnpaidDays', 'NplTag']
]);

r.set('Payroll', [
  Array(20).fill('header'),
  ['2026-09', 'EMP-STAFF_ASMA', 'STAFF_ASMA', 3500]
]);

// Track sent emails in runtime mock
const sentEmails = [];
r.ctx.MailApp = {
  sendEmail(opts) {
    sentEmails.push(opts);
  }
};

// Login sessions
const tokens = {};
for (const name of ['ADMIN', 'HR_USER', 'HOD_KENNY', 'STAFF_ASMA', 'STAFF_BOB']) {
  const loginRes = r.request('login', { username: name.toLowerCase(), password: 'test-password' });
  assert.equal(loginRes.status, 'success', `Login failed for ${name}`);
  tokens[name] = loginRes.sessionToken;
}

const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);
const ok = (v) => {
  assert.equal(v.status, 'success', v.message || 'Expected success response');
  return v.data;
};

console.log('--- Testing Multi-Tier Notification & Application Routing (Staff -> HOD -> HR) ---');

// 1. Staff Submits Leave Application
console.log('Testing Part 1: Staff submits leave application...');
sentEmails.length = 0;
const submitRes = req('STAFF_ASMA', 'submitLeave', {
  staffName: 'STAFF_ASMA',
  leaveType: 'AL',
  startDate: '2026-10-20',
  endDate: '2026-10-21',
  totalDays: 2,
  reason: 'Family event'
});
assert.equal(submitRes.status, 'success');

// Verify leave row in sheet has status 'pending_hod'
const leaveRows = r.sheets.Leave.rows;
assert.equal(leaveRows.length, 2);
const submittedRow = leaveRows[1];
assert.equal(submittedRow[1], 'STAFF_ASMA');
assert.equal(submittedRow[8], 'pending_hod', 'Initial status must be pending_hod when staff has a manager');

// Verify notification email sent to HOD
assert.ok(sentEmails.length >= 1, 'Email notification must be triggered on leave submission');
const hodEmail = sentEmails.find(e => e.to.includes('kenny@metrio.com.my') || e.subject.includes('Awaiting HOD Endorsement'));
assert.ok(hodEmail, 'Email must be addressed to HOD (kenny@metrio.com.my)');
assert.match(hodEmail.subject, /Awaiting HOD Endorsement/i, 'Subject must state awaiting HOD endorsement');
assert.match(hodEmail.body, /STAFF_ASMA/, 'Body must contain applicant name');

console.log('PASS Part 1: Leave submission assigns pending_hod and emails HOD.');

// 2. HOD getActionCount and hrBootstrap visibility
console.log('Testing Part 2: HOD receives application in getActionCount and hrBootstrap...');
const hodActionRes = ok(req('HOD_KENNY', 'getActionCount', {}));
assert.equal(hodActionRes.pendingLeaves, 1, 'HOD must see 1 pending leave');
assert.ok(hodActionRes.recentPendingItems.some(i => i.employee === 'STAFF_ASMA'), 'recentPendingItems must list STAFF_ASMA');

// Verify HR or Admin action count at this stage
const hrActionResBefore = ok(req('HR_USER', 'getActionCount', {}));
assert.equal(hrActionResBefore.pendingLeaves, 0, 'HR should not have pending action while awaiting HOD endorsement');

// Verify HOD hrBootstrap contains pending leave in records.leave and teamLeave
const hodBootstrap = ok(req('HOD_KENNY', 'hrBootstrap', { scope: 'overview' }));
assert.ok(hodBootstrap.records.leave, 'records.leave must be populated');
assert.ok(hodBootstrap.records.leave.some(l => l.employee === 'STAFF_ASMA' && l.status === 'pending_hod'), 'HOD must see pending_hod in records.leave');
assert.ok(hodBootstrap.teamLeave.some(l => l.employee === 'STAFF_ASMA' && l.status === 'pending_hod'), 'HOD must see pending_hod in teamLeave');

console.log('PASS Part 2: HOD getActionCount and hrBootstrap accurately reflect pending application.');

// 3. HOD Endorses / Approves Application -> Auto-routes to HR
console.log('Testing Part 3: HOD approves application and system auto-notifies HR...');
sentEmails.length = 0;
const hodApproveRes = req('HOD_KENNY', 'updateLeaveStatus', {
  rowIndex: 2,
  newStatus: 'Approved',
  approver: 'HOD_KENNY',
  approverRemark: 'Recommended by HOD'
});
assert.equal(hodApproveRes.status, 'success');

// Verify sheet status transitioned to 'pending_admin'
const afterHodRow = r.sheets.Leave.rows[1];
assert.equal(afterHodRow[8], 'pending_admin', 'Status must transition from pending_hod to pending_admin upon HOD approval');

// Verify auto-routing email sent to HR
assert.ok(sentEmails.length >= 1, 'Email must be sent upon HOD endorsement');
const hrNoticeEmail = sentEmails.find(e => e.to.includes('hock@metrio.com.my') || e.subject.includes('Awaiting HR Final Approval'));
assert.ok(hrNoticeEmail, 'HR must receive notification email');
assert.match(hrNoticeEmail.subject, /Endorsed by HOD/i, 'Subject must state leave was endorsed by HOD');
assert.match(hrNoticeEmail.body, /Recommended by HOD/i, 'Body must contain HOD remark');

// Verify HOD count drops to 0 and HR count rises to 1
const hodCountAfter = ok(req('HOD_KENNY', 'getActionCount', {}));
assert.equal(hodCountAfter.pendingLeaves, 0, 'HOD pending count must return to 0');

const hrCountAfter = ok(req('HR_USER', 'getActionCount', {}));
assert.equal(hrCountAfter.pendingLeaves, 1, 'HR pending count must now be 1');

console.log('PASS Part 3: HOD approval transitions to pending_admin and auto-notifies HR.');

// 4. HR Final Approval -> Notifies Staff
console.log('Testing Part 4: HR gives final approval and system notifies staff...');
sentEmails.length = 0;
const hrApproveRes = req('HR_USER', 'updateLeaveStatus', {
  rowIndex: 2,
  newStatus: 'Approved',
  approver: 'HR_USER'
});
assert.equal(hrApproveRes.status, 'success');

// Verify sheet status transitioned to 'approved'
const finalRow = r.sheets.Leave.rows[1];
assert.equal(finalRow[8], 'approved', 'Status must be approved after HR action');

// Verify staff receives approval confirmation email
const staffEmail = sentEmails.find(e => e.to.includes('asma@metrio.com.my') || e.subject.includes('Leave Application Approved'));
assert.ok(staffEmail, 'Staff must receive approval confirmation email');
assert.match(staffEmail.subject, /Leave Application Approved/i);

const hrFinalCount = ok(req('HR_USER', 'getActionCount', {}));
assert.equal(hrFinalCount.pendingLeaves, 0, 'HR pending count must be 0 after approval');

console.log('PASS Part 4: HR approval finalizes leave and sends confirmation email to staff.');

// 5. Claims Workflow: Staff -> HOD -> HR
console.log('Testing Part 5: Multi-tier Claims workflow (Staff -> HOD -> HR)...');
sentEmails.length = 0;
const claimSaveRes = ok(req('STAFF_ASMA', 'hrSave', {
  module: 'claims',
  record: {
    employee: 'STAFF_ASMA',
    category: 'Medical',
    title: 'Clinic Consult',
    receiptNo: 'REC-00199',
    date: '2026-10-15',
    amount: 85,
    notes: 'Prescription fees'
  }
}));
assert.equal(claimSaveRes.status, 'Pending manager', 'Claim must initially be Pending manager');
assert.equal(claimSaveRes.manager, 'HOD_KENNY', 'Claim must record reporting manager');

// Verify HOD gets pending claim in getActionCount
const hodClaimCount = ok(req('HOD_KENNY', 'getActionCount', {}));
assert.equal(hodClaimCount.pendingClaims, 1, 'HOD must see 1 pending claim');

// HOD endorses claim
sentEmails.length = 0;
const hodClaimTransition = ok(req('HOD_KENNY', 'hrTransition', {
  module: 'claims',
  id: claimSaveRes.id,
  version: claimSaveRes.version,
  command: 'approve',
  comments: 'Approved medical receipt'
}));
assert.equal(hodClaimTransition.status, 'Pending admin', 'Claim must transition to Pending admin upon HOD endorsement');

// Verify notification sent to HR
const hrClaimEmail = sentEmails.find(e => e.to.includes('hock@metrio.com.my') || e.subject.includes('Claim Endorsed by HOD'));
assert.ok(hrClaimEmail, 'HR must receive notification that claim was endorsed by HOD');

// HR approves claim
const hrClaimTransition = ok(req('HR_USER', 'hrTransition', {
  module: 'claims',
  id: claimSaveRes.id,
  version: hodClaimTransition.version,
  command: 'approve'
}));
assert.equal(hrClaimTransition.status, 'Approved', 'Claim must transition to Approved upon HR approval');

console.log('PASS Part 5: Claims multi-tier approval workflow and HR notification verified.');

// 6. Frontend Component Verification
console.log('Testing Part 6: Frontend Mobile Inbox & Shell wiring verification...');
const inboxVue = fs.readFileSync('src/components/mobile/MobileInbox.vue', 'utf8');
const shellVue = fs.readFileSync('src/components/mobile/MobileAppShell.vue', 'utf8');

assert.match(inboxVue, /isLeaveAwaitingMyApproval/, 'MobileInbox must define isLeaveAwaitingMyApproval');
assert.match(inboxVue, /category:\s*['"]leave['"]/, 'MobileInbox must include leave approval items');
assert.match(inboxVue, /confirmApprove\(item\)/, 'MobileInbox must invoke confirmApprove');
assert.match(inboxVue, /promptReject\(item\)/, 'MobileInbox must invoke promptReject');

assert.match(shellVue, /checkPendingApprovalUpdates/, 'MobileAppShell must define checkPendingApprovalUpdates');
assert.match(shellVue, /handleInboxApprove/, 'MobileAppShell must define handleInboxApprove');
assert.match(shellVue, /handleInboxReject/, 'MobileAppShell must define handleInboxReject');
assert.match(shellVue, /@approve="handleInboxApprove"/, 'MobileAppShell must bind @approve');
assert.match(shellVue, /@reject="handleInboxReject"/, 'MobileAppShell must bind @reject');
assert.match(shellVue, /pollTimer\s*=\s*setInterval/, 'MobileAppShell must poll for background updates');
assert.match(shellVue, /visibilitychange/, 'MobileAppShell must listen to visibilitychange');

console.log('PASS Part 6: Frontend Mobile Inbox and App Shell contracts verified.');

console.log('\n===============================================================');
console.log('ALL NOTIFICATION & MULTI-TIER ROUTING TESTS PASSED PERFECTLY!');
console.log('===============================================================');
