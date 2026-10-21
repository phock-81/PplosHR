const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing 360° Staff Profile Enquiry Dossier (Backend & Frontend) ---');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const r = runtime(gasCode);

function makeStaffRow(name, role, manager = '', options = {}) {
  const row = Array(43).fill('');
  Object.assign(row, {
    0: name,
    1: options.status || 'Active',
    2: name.toLowerCase(),
    3: 'pass123',
    4: role,
    5: options.basic || 4000,
    6: 19.23,
    7: 'Male',
    8: options.icNo || '900101-14-5555',
    9: '012-3456789',
    10: '123 Test Street, KL',
    11: '019-8765432',
    12: options.joinedDate || '2023-01-15',
    13: options.confirmDate || '2023-04-15',
    14: options.resignDate || '',
    15: 'Initial: 3500; Confirmed: 4000',
    21: 14, // AL
    22: 14, // MC
    24: 'EMP-' + name,
    25: options.companyId || 'CMP-1',
    26: options.departmentId || 'DEPT-ENG',
    27: manager,
    28: options.jobTitle || 'Software Engineer',
    29: 'Kuala Lumpur',
    30: 1, // version
    32: options.jobTitleId || 'jt-swe',
    33: options.gradeId || 'grade-m',
    34: `${name.toLowerCase()}@example.com`
  });
  return row;
}

r.set('Staff', [
  Array(43).fill('header'),
  makeStaffRow('ADMIN', 'Admin'),
  makeStaffRow('HR_USER', 'HR'),
  makeStaffRow('MANAGER', 'HOD'),
  makeStaffRow('ALICE', 'User', 'MANAGER', { icNo: '950202-10-1234', joinedDate: '2023-06-01' }),
  makeStaffRow('BOB', 'User', '', { icNo: '920303-08-4321', joinedDate: '2024-02-01' })
]);

// 1. Leave Sheet
r.set('Leave', [
  ['ID', 'Name', 'Type', 'Start', 'End', 'Days', 'Reason', 'Attachment', 'Status', 'Date', 'Decision', 'DecisionRemark', 'AnnualDays', 'UnpaidDays', 'NplTag'],
  ['LV-1', 'ALICE', 'AL', '2026-03-01', '2026-03-02', 2, 'Personal', '', 'Approved', '2026-02-20', 'Approved', '', 2, 0, ''],
  ['LV-2', 'ALICE', 'fractional_split', '2026-05-10', '2026-05-11', 2, 'Emergency', '', 'Approved', '2026-05-01', 'Approved', '', 1, 1, 'half_pay'],
  ['LV-3', 'BOB', 'AL', '2026-04-01', '2026-04-01', 1, 'Rest', '', 'Approved', '2026-03-25', 'Approved', '', 1, 0, '']
]);

// 2. HR_leaveOpeningBalances
r.set('HR_leaveOpeningBalances', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'op-alice-2026', 1, 'ALICE', 'Active',
    JSON.stringify({
      id: 'op-alice-2026', employee: 'ALICE', year: 2026, category: 'Annual',
      effectiveDate: '2026-01-01', days: 16.0, standardCarryForward: 12.0, standardExpiryDate: '2026-12-31',
      excessCarryForward: 2.0, excessExpiryDate: '2026-04-30', newEntitlement: 14.0
    }),
    '2026-01-01T00:00:00Z', 'ADMIN'
  ]
]);

// 3. Claims Sheet (HR_claims)
r.set('HR_claims', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'claim-1', 1, 'ALICE', 'Paid',
    JSON.stringify({
      id: 'claim-1', employee: 'ALICE', category: 'Medical', title: 'Clinic Medilife',
      receiptNo: 'RCP-101', date: '2026-02-15', amount: 150.00, status: 'Paid',
      paymentReference: 'BANK-TRF-001'
    }),
    '2026-02-16T00:00:00Z', 'ADMIN'
  ],
  [
    'claim-2', 1, 'ALICE', 'Approved',
    JSON.stringify({
      id: 'claim-2', employee: 'ALICE', category: 'Optical', title: 'Focus Point Glasses',
      receiptNo: 'RCP-202', date: '2026-04-10', amount: 200.00, status: 'Approved',
      paymentReference: ''
    }),
    '2026-04-11T00:00:00Z', 'ADMIN'
  ],
  [
    'claim-3', 1, 'BOB', 'Pending admin',
    JSON.stringify({
      id: 'claim-3', employee: 'BOB', category: 'Travel', title: 'Client meeting grab',
      receiptNo: 'RCP-303', date: '2026-03-01', amount: 45.00, status: 'Pending admin'
    }),
    '2026-03-02T00:00:00Z', 'BOB'
  ]
]);

// 4. Payroll Sheet
r.set('Payroll', [
  ['Month', 'Staff ID', 'Name', 'Basic', 'Worked Days', 'OT Pay', 'Gross Pay', 'EPF (Emp)', 'SOCSO (Emp)', 'EIS (Emp)', 'Total Emp Ded', 'EPF (Empr)', 'SOCSO (Empr)', 'EIS (Empr)', 'Total Empr Cont', 'Nett Pay', 'PCB', 'NPL Deduction', 'Claims', 'Zero-MC Award'],
  ['2026-01', 'EMP-ALICE', 'ALICE', '4000.00', '22', '0.00', '4000.00', '440.00', '19.75', '7.90', '467.65', '480.00', '69.15', '7.90', '557.05', '3532.35', '0.00', '0.00', '0.00', '0.00'],
  ['2026-02', 'EMP-ALICE', 'ALICE', '4000.00', '20', '0.00', '4000.00', '440.00', '19.75', '7.90', '467.65', '480.00', '69.15', '7.90', '3682.35', '0.00', '0.00', '150.00', '0.00'],
  ['2026-01', 'EMP-BOB', 'BOB', '3500.00', '22', '0.00', '3500.00', '385.00', '17.25', '6.90', '409.15', '420.00', '60.40', '6.90', '487.30', '3090.85', '0.00', '0.00', '0.00', '0.00']
]);

// 5. HR_resources and HR_resourceAssignments
r.set('HR_resources', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'res-laptop-01', 1, '', 'Available',
    JSON.stringify({
      id: 'res-laptop-01', code: 'LAP-001', title: 'Lenovo ThinkPad T14',
      category: 'Laptop', location: 'HQ Store', assetValue: 4500, availability: 'Assigned'
    }),
    '2025-01-01T00:00:00Z', 'ADMIN'
  ],
  [
    'res-card-01', 1, '', 'Available',
    JSON.stringify({
      id: 'res-card-01', code: 'ACC-012', title: 'Office Access Card',
      category: 'Equipment', location: 'Security', assetValue: 50, availability: 'Assigned'
    }),
    '2025-01-01T00:00:00Z', 'ADMIN'
  ]
]);

r.set('HR_resourceAssignments', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'asg-1', 1, 'ALICE', 'Assigned',
    JSON.stringify({
      id: 'asg-1', employee: 'ALICE', resourceId: 'res-laptop-01',
      date: '2023-06-02', condition: 'Brand New', notes: 'Developer machine with charger', status: 'Assigned'
    }),
    '2023-06-02T00:00:00Z', 'ADMIN'
  ],
  [
    'asg-2', 1, 'ALICE', 'Assigned',
    JSON.stringify({
      id: 'asg-2', employee: 'ALICE', resourceId: 'res-card-01',
      date: '2023-06-02', condition: 'Active', notes: 'Level 3 & 4 Access', status: 'Assigned'
    }),
    '2023-06-02T00:00:00Z', 'ADMIN'
  ]
]);

// 6. HR_letters
r.set('HR_letters', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'ltr-1', 1, 'ALICE', 'Issued',
    JSON.stringify({
      id: 'ltr-1', employee: 'ALICE', category: 'Confirmation',
      title: 'Employment Confirmation Letter', date: '2023-04-15',
      notes: 'Confirmation of employment as Software Engineer after 3-month probation.', status: 'Issued'
    }),
    '2023-04-15T00:00:00Z', 'ADMIN'
  ],
  [
    'ltr-2', 1, 'ALICE', 'Draft',
    JSON.stringify({
      id: 'ltr-2', employee: 'ALICE', category: 'Increment',
      title: 'Annual Salary Increment 2026', date: '2026-01-01',
      notes: 'Proposed increment to RM 4,500 pending board sign-off.', status: 'Draft'
    }),
    '2026-01-01T00:00:00Z', 'HR_USER'
  ],
  [
    'ltr-3', 1, 'BOB', 'Issued',
    JSON.stringify({
      id: 'ltr-3', employee: 'BOB', category: 'Offer',
      title: 'Offer of Employment', date: '2024-01-15',
      notes: 'Offer letter for Junior Engineer.', status: 'Issued'
    }),
    '2024-01-15T00:00:00Z', 'ADMIN'
  ]
]);

// Other required sheets
r.set('Holidays', [['Date', 'Name']]);
r.set('Data', [Array(7).fill('header')]);
r.set('Attendance', [Array(15).fill('header')]);
r.set('LockedMonths', [['Month', 'Data JSON']]);
r.set('HR_companies', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  ['CMP-1', 1, '', 'Active', JSON.stringify({ id: 'CMP-1', title: 'Metrio Corp Sdn Bhd', code: 'METRIO' }), '2025-01-01T00:00:00Z', 'ADMIN']
]);
r.set('HR_departments', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  ['DEPT-ENG', 1, '', 'Active', JSON.stringify({ id: 'DEPT-ENG', companyId: 'CMP-1', title: 'Engineering' }), '2025-01-01T00:00:00Z', 'ADMIN']
]);
r.set('HR_jobGrades', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  ['grade-m', 1, '', 'Active', JSON.stringify({ id: 'grade-m', code: 'M', title: 'Managerial / Senior' }), '2025-01-01T00:00:00Z', 'ADMIN']
]);

// Authenticate tokens
const tokens = {};
for (const name of ['ADMIN', 'HR_USER', 'MANAGER', 'ALICE', 'BOB']) {
  const loginRes = r.request('login', { username: name.toLowerCase(), password: 'pass123' });
  assert.equal(loginRes.status, 'success', `Login failed for ${name}`);
  tokens[name] = loginRes.sessionToken;
}

const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);

// ============================================================================
// PART 1: Backend getStaffDossier Action & Role Privacy Checks
// ============================================================================
console.log('Testing Part 1: Backend getStaffDossier permissions & privacy...');

// 1.1 Unauthenticated request is rejected
const unauthRes = r.request('getStaffDossier', { employee: 'ALICE' }, 'invalid-token');
assert.equal(unauthRes.status, 'error', 'Unauthenticated request must be rejected');

// 1.2 Admin can retrieve dossier for any employee (e.g. ALICE and BOB)
const adminAlice = req('ADMIN', 'getStaffDossier', { employee: 'ALICE' });
assert.equal(adminAlice.status, 'success', `Admin should fetch ALICE dossier: ${adminAlice.message}`);
assert.ok(adminAlice.data, 'Admin response must contain data payload');
assert.equal(adminAlice.data.profile.name, 'ALICE', 'Profile name must match requested employee');

const adminBob = req('ADMIN', 'getStaffDossier', { employee: 'BOB' });
assert.equal(adminBob.status, 'success', 'Admin should fetch BOB dossier');

// 1.3 HR user can retrieve dossier for any employee
const hrAlice = req('HR_USER', 'getStaffDossier', { employee: 'ALICE' });
assert.equal(hrAlice.status, 'success', `HR should fetch ALICE dossier: ${hrAlice.message}`);

// 1.4 HOD (MANAGER) can retrieve dossier for their direct subordinate (ALICE), but payroll is redacted
const managerAlice = req('MANAGER', 'getStaffDossier', { employee: 'ALICE' });
assert.equal(managerAlice.status, 'success', `MANAGER (HOD) must be allowed to fetch subordinate ALICE dossier: ${managerAlice.message}`);
assert.equal(managerAlice.data.profile.basic, 0, 'Subordinate basic salary must be redacted for HOD');
assert.equal(managerAlice.data.payroll.history.length, 0, 'Subordinate payroll records must be empty for HOD');

// 1.5 HOD (MANAGER) is denied for non-subordinate (BOB)
const managerBob = req('MANAGER', 'getStaffDossier', { employee: 'BOB' });
assert.equal(managerBob.status, 'error', 'MANAGER (HOD) must be denied for non-subordinate BOB');
assert.match(managerBob.message, /Unauthorized|Access denied|permission/i);

// 1.6 Staff/User (ALICE) can retrieve their own dossier
const aliceSelf = req('ALICE', 'getStaffDossier', { employee: 'ALICE' });
assert.equal(aliceSelf.status, 'success', `ALICE must be allowed to fetch her own dossier: ${aliceSelf.message}`);

// 1.7 Staff/User (ALICE) is denied for another employee (BOB)
const aliceBob = req('ALICE', 'getStaffDossier', { employee: 'BOB' });
assert.equal(aliceBob.status, 'error', 'ALICE must be denied from fetching BOB dossier');
assert.match(aliceBob.message, /Unauthorized|Access denied|permission/i);

// 1.8 Query by IC or employeeNo
const adminQueryByIc = req('ADMIN', 'getStaffDossier', { icNo: '950202-10-1234' });
assert.equal(adminQueryByIc.status, 'success', 'Should locate employee by IC number');
assert.equal(adminQueryByIc.data.profile.name, 'ALICE');

// 1.8b Keyword search (partial name, employee ID, job title)
const adminKeywordName = req('ADMIN', 'getStaffDossier', { employee: 'ALI' });
assert.equal(adminKeywordName.status, 'success', 'Should locate employee by partial name keyword ALI');
assert.equal(adminKeywordName.data.profile.name, 'ALICE');

const adminKeywordEmpNo = req('ADMIN', 'getStaffDossier', { employee: 'EMP-BOB' });
assert.equal(adminKeywordEmpNo.status, 'success', 'Should locate employee by employee ID keyword EMP-BOB');
assert.equal(adminKeywordEmpNo.data.profile.name, 'BOB');

// 1.9 Non-existent employee returns error
const notFound = req('ADMIN', 'getStaffDossier', { employee: 'UNKNOWN_PERSON' });
assert.equal(notFound.status, 'error', 'Non-existent employee should return error');

// ============================================================================
// PART 2: 360° Data Aggregation Verification
// ============================================================================
console.log('Testing Part 2: 360° Data Aggregation for ALICE...');

const d = adminAlice.data;

// Profile
assert.ok(d.profile, 'Dossier must aggregate profile');
assert.equal(d.profile.name, 'ALICE');
assert.equal(d.profile.role, 'User');
assert.equal(d.profile.icNo, '950202-10-1234');
assert.equal(d.profile.employeeNo, 'EMP-ALICE');
assert.equal(d.profile.jobTitle, 'Software Engineer');
assert.equal(d.profile.departmentId, 'DEPT-ENG');
assert.equal(d.profile.companyId, 'CMP-1');
assert.equal(d.profile.status, 'Active');
assert.equal(d.profile.joinedDate, '2023-06-01');
assert.equal(d.profile.confirmDate, '2023-04-15');
assert.equal(Number(d.profile.basic), 4000);

// Leaves: History, Fractional Split, Balances
assert.ok(d.leaves, 'Dossier must aggregate leaves');
const leaveList = Array.isArray(d.leaves) ? d.leaves : (d.leaves.history || d.leaves.applications || []);
assert.equal(leaveList.length, 2, 'ALICE must have 2 leave applications');
const splitLeave = leaveList.find(l => l.type === 'fractional_split' || l.annualDays === 1);
assert.ok(splitLeave, 'Fractional split leave must be included in history');
assert.equal(Number(splitLeave.annualDays), 1);
assert.equal(Number(splitLeave.unpaidDays), 1);

// Claims: Medical & Optical, status, paymentReference
assert.ok(d.claims, 'Dossier must aggregate claims');
const claimsList = Array.isArray(d.claims) ? d.claims : (d.claims.history || d.claims.records || []);
assert.equal(claimsList.length, 2, 'ALICE must have 2 claims');
const paidClaim = claimsList.find(c => c.status === 'Paid');
assert.ok(paidClaim, 'Paid claim must exist');
assert.equal(paidClaim.paymentReference, 'BANK-TRF-001', 'Payment reference must be aggregated');

// Payroll: Monthly history
assert.ok(d.payroll, 'Dossier must aggregate payroll history');
const payrollList = Array.isArray(d.payroll) ? d.payroll : (d.payroll.history || d.payroll.records || []);
assert.equal(payrollList.length, 2, 'ALICE must have 2 payroll month rows');
const janPay = payrollList.find(p => p.month === '2026-01');
assert.ok(janPay, 'January 2026 payslip must exist');
assert.equal(Number(janPay.gross), 4000);
assert.equal(Number(janPay.nettPay), 3532.35);

// Assets: Assigned equipment & laptop joined with HR_resources
assert.ok(d.assets, 'Dossier must aggregate company assets');
const assetList = Array.isArray(d.assets) ? d.assets : (d.assets.assignments || d.assets.records || []);
assert.equal(assetList.length, 2, 'ALICE must have 2 assigned resources');
const laptopAsset = assetList.find(a => (a.code === 'LAP-001' || a.title?.includes('ThinkPad') || a.resourceTitle?.includes('ThinkPad')));
assert.ok(laptopAsset, 'Assigned ThinkPad laptop must be aggregated with resource details');

// Letters: Official correspondence (Admin sees Draft and Issued; Staff only sees Issued)
assert.ok(d.letters, 'Dossier must aggregate official letters');
const adminLetters = Array.isArray(d.letters) ? d.letters : (d.letters.records || []);
assert.equal(adminLetters.length, 2, 'Admin must see both Draft and Issued letters for ALICE');

// Check that Staff only sees Issued letters
const aliceLetters = Array.isArray(aliceSelf.data.letters) ? aliceSelf.data.letters : (aliceSelf.data.letters.records || []);
assert.equal(aliceLetters.length, 1, 'ALICE (Staff) must only see Issued letters, not Drafts');
assert.equal(aliceLetters[0].status, 'Issued');

console.log('PASS: Part 1 & Part 2 Backend dossier verification passed.');

// ============================================================================
// PART 3: Frontend Component & Integration Verification
// ============================================================================
console.log('Testing Part 3: Frontend StaffDossierModal component & integrations...');

const modalFile = path.join(__dirname, '../src/components/StaffDossierModal.vue');
assert.ok(fs.existsSync(modalFile), 'src/components/StaffDossierModal.vue must exist');
const modalSrc = fs.readFileSync(modalFile, 'utf8');

// 5 Interactive Tabs
assert.ok(modalSrc.includes('Leave Balances') || modalSrc.includes('Leave History') || modalSrc.includes('tab === \'leaves\''), 'Modal must have Leave Balances & History tab');
assert.ok(modalSrc.includes('Claims') || modalSrc.includes('Flexi') || modalSrc.includes('tab === \'claims\''), 'Modal must have Claims & Flexi-Wellness tab');
assert.ok(modalSrc.includes('Payroll') || modalSrc.includes('tab === \'payroll\''), 'Modal must have Payroll History tab');
assert.ok(modalSrc.includes('Assets') || modalSrc.includes('Equipment') || modalSrc.includes('tab === \'assets\''), 'Modal must have Assigned Assets tab');
assert.ok(modalSrc.includes('Letters') || modalSrc.includes('tab === \'letters\''), 'Modal must have HR Letters tab');

// Header card
assert.ok(modalSrc.includes('tenure') || modalSrc.includes('Tenure'), 'Header card must show service tenure');
assert.ok(modalSrc.includes('joined') || modalSrc.includes('Joined'), 'Header card must show joined date');
assert.ok(modalSrc.includes('employee') || modalSrc.includes('Staff'), 'Header card must show employee information');

// Integration in PayrollDashboard.vue
const dashboardFile = path.join(__dirname, '../src/components/PayrollDashboard.vue');
assert.ok(fs.existsSync(dashboardFile), 'src/components/PayrollDashboard.vue must exist');
const dashboardSrc = fs.readFileSync(dashboardFile, 'utf8');

assert.ok(dashboardSrc.includes('StaffDossierModal'), 'PayrollDashboard.vue must import StaffDossierModal');
assert.ok(dashboardSrc.includes('<StaffDossierModal'), 'PayrollDashboard.vue must mount StaffDossierModal');
assert.ok(
  dashboardSrc.includes('openStaffDossier') || dashboardSrc.includes('showDossierModal') || dashboardSrc.includes('openDossierModal'),
  'PayrollDashboard.vue must provide trigger for Staff Dossier'
);

// Integration in HrWorkspace.vue
const workspaceFile = path.join(__dirname, '../src/components/HrWorkspace.vue');
assert.ok(fs.existsSync(workspaceFile), 'src/components/HrWorkspace.vue must exist');
const workspaceSrc = fs.readFileSync(workspaceFile, 'utf8');

assert.ok(workspaceSrc.includes('StaffDossierModal'), 'HrWorkspace.vue must import StaffDossierModal');
assert.ok(workspaceSrc.includes('<StaffDossierModal'), 'HrWorkspace.vue must mount StaffDossierModal');
assert.ok(
  workspaceSrc.includes('openStaffDossier') || workspaceSrc.includes('showDossierModal'),
  'HrWorkspace.vue must provide trigger for Staff Dossier'
);

// Keyword search and live typeahead suggestions
assert.ok(modalSrc.includes('matchingSuggestions'), 'StaffDossierModal must implement matchingSuggestions for keyword search');
assert.ok(modalSrc.includes('dossier-typeahead-menu') || modalSrc.includes('dossier-typeahead-item'), 'StaffDossierModal must render typeahead suggestions menu');
assert.ok(modalSrc.includes('clearSearch') || modalSrc.includes('bi-x-circle'), 'StaffDossierModal must have quick clear button for keyword search');

console.log('PASS: All 360° Staff Profile Enquiry Dossier tests passed!');
