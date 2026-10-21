const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Corporate HR Correspondence Letterhead Generator ---');

// ============================================================================
// PART 1: Reference Number Generator & Template Content Logic
// ============================================================================
console.log('Testing Part 1: Reference number generation & template generators...');

// Dynamically import ESM service
async function testTemplates() {
  const servicePath = path.join(__dirname, '../src/services/letterTemplates.js');
  assert.ok(fs.existsSync(servicePath), 'src/services/letterTemplates.js must exist');

  const {
    generateReferenceNumber,
    generateIncrementLetter,
    generateConfirmationLetter,
    generateTransferLetter,
    generateMemoLetter,
    generateLetterBody,
    TEMPLATE_TYPES,
    METRIO_COMPANY_INFO
  } = await import('../src/services/letterTemplates.js');

  // Verify template types
  assert.deepEqual(TEMPLATE_TYPES, ['Increment', 'Confirmation', 'Transfer', 'Memo'], 'Must support standard template types');
  assert.ok(METRIO_COMPANY_INFO.name.includes('METRIO'), 'Company info must include METRIO');
  assert.ok(METRIO_COMPANY_INFO.address, 'Company info must have address');

  // 1. Reference number generation: HR/{TEMPLATE}/{YEAR}/{SEQ}
  const yr = 2026;
  const refInc = generateReferenceNumber('Increment', yr, 1);
  assert.match(refInc, /^HR\/INCREMENT\/2026\/001$/, `Increment ref format mismatch: ${refInc}`);

  const refConf = generateReferenceNumber('Confirmation', yr, 12);
  assert.match(refConf, /^HR\/CONFIRMATION\/2026\/012$/, `Confirmation ref format mismatch: ${refConf}`);

  const refTrf = generateReferenceNumber('Transfer', yr, '099');
  assert.match(refTrf, /^HR\/TRANSFER\/2026\/099$/, `Transfer ref format mismatch: ${refTrf}`);

  const refMemo = generateReferenceNumber('Memo', yr, 5);
  assert.match(refMemo, /^HR\/MEMO\/2026\/005$/, `Memo ref format mismatch: ${refMemo}`);

  // Object arg overload
  const refObj = generateReferenceNumber({ template: 'Increment', year: 2026, seq: 42 });
  assert.equal(refObj, 'HR/INCREMENT/2026/042');

  // 2. Increment Template Generator
  const incBody = generateIncrementLetter({
    employeeName: 'ALICE TAN',
    currentSalary: 4000,
    newSalary: 4600,
    incrementAmount: 600,
    percentage: 15.0,
    effectiveDate: '2026-07-01'
  });
  assert.ok(incBody.includes('ALICE TAN'), 'Increment letter must include employee name');
  assert.ok(incBody.includes('4,000.00'), 'Increment letter must include current salary');
  assert.ok(incBody.includes('4,600.00'), 'Increment letter must include new salary');
  assert.ok(incBody.includes('600.00'), 'Increment letter must include increment amount');
  assert.ok(incBody.includes('15'), 'Increment letter must include increment percentage');
  assert.ok(incBody.includes('2026-07-01'), 'Increment letter must include effective date');

  // 3. Confirmation Template Generator
  const confBody = generateConfirmationLetter({
    employeeName: 'BOB LEE',
    jobTitle: 'Senior Site Engineer',
    confirmationDate: '2026-05-01',
    salaryAdjustment: 'Adjusted to RM 5,200.00',
    newSalary: 5200
  });
  assert.ok(confBody.includes('BOB LEE'), 'Confirmation letter must include employee name');
  assert.ok(confBody.includes('Senior Site Engineer'), 'Confirmation letter must include job title');
  assert.ok(confBody.includes('2026-05-01'), 'Confirmation letter must include confirmation date');
  assert.ok(confBody.includes('5,200.00'), 'Confirmation letter must include salary adjustment');

  // 4. Transfer Template Generator
  const trfBody = generateTransferLetter({
    employeeName: 'ALICE TAN',
    fromDepartment: 'Software Engineering',
    fromRole: 'Frontend Developer',
    toDepartment: 'Product Operations',
    toRole: 'Technical Product Specialist',
    reportingManager: 'DIRECTOR KHOO',
    effectiveDate: '2026-08-01'
  });
  assert.ok(trfBody.includes('ALICE TAN'), 'Transfer letter must include employee name');
  assert.ok(trfBody.includes('Software Engineering'), 'Transfer letter must include previous dept');
  assert.ok(trfBody.includes('Product Operations'), 'Transfer letter must include new dept');
  assert.ok(trfBody.includes('Technical Product Specialist'), 'Transfer letter must include new role');
  assert.ok(trfBody.includes('DIRECTOR KHOO'), 'Transfer letter must include reporting manager');
  assert.ok(trfBody.includes('2026-08-01'), 'Transfer letter must include effective date');

  // 5. Memo Template Generator
  const memoBody = generateMemoLetter({
    employeeName: 'ALL STAFF',
    subject: 'UPDATED CODE OF CONDUCT',
    memoBody: 'Please review the attached updated employee handbook effective immediately.',
    signOff: 'Human Resources Department'
  });
  assert.ok(memoBody.includes('ALL STAFF'), 'Memo must include recipient');
  assert.ok(memoBody.includes('UPDATED CODE OF CONDUCT'), 'Memo must include subject');
  assert.ok(memoBody.includes('handbook effective immediately'), 'Memo must include body');
  assert.ok(memoBody.includes('Human Resources Department'), 'Memo must include sign-off');

  // 6. Generic router
  const routedInc = generateLetterBody('Increment', {
    employeeName: 'ALICE TAN',
    currentSalary: 4000,
    newSalary: 4500,
    effectiveDate: '2026-06-01'
  });
  assert.ok(routedInc.includes('ALICE TAN') && routedInc.includes('4,500.00'));
}

// ============================================================================
// PART 2: Backend Role Authorization & HR_letters Persistence
// ============================================================================
function testBackend() {
  console.log('Testing Part 2: Backend role authorization & HR_letters persistence...');

  const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
  const r = runtime(gasCode);

  function staff(name, role) {
    const a = Array(43).fill('');
    Object.assign(a, {
      0: name,
      1: 'Active',
      2: name.toLowerCase(),
      3: 'pass123',
      4: role,
      5: 3500,
      8: name + '-IC',
      24: 'EMP-' + name
    });
    return a;
  }

  r.set('Staff', [
    Array(43).fill('header'),
    staff('ADMIN', 'Admin'),
    staff('HR_USER', 'HR'),
    staff('MANAGER', 'HOD'),
    staff('ALICE', 'User'),
    staff('BOB', 'User')
  ]);
  r.set('Leave', [Array(15).fill('header')]);
  r.set('Holidays', [['Date', 'Name']]);
  r.set('Data', [Array(7).fill('header')]);
  r.set('Attendance', [Array(15).fill('header')]);
  r.set('LockedMonths', [['Month', 'Data JSON']]);
  r.set('Payroll', [Array(16).fill('header')]);

  const tokens = {};
  for (const name of ['ADMIN', 'HR_USER', 'MANAGER', 'ALICE', 'BOB']) {
    const x = r.request('login', { username: name.toLowerCase(), password: 'pass123' });
    assert.equal(x.status, 'success', `Login failed for ${name}`);
    tokens[name] = x.sessionToken;
  }

  const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);

  // 1. Role Authorization Checks: Staff (ALICE) and HOD (MANAGER) DENIED
  const staffCreate = req('ALICE', 'hrSave', {
    module: 'letters',
    record: {
      employee: 'ALICE',
      category: 'Memo',
      title: 'Self-issued memo',
      date: '2026-10-14',
      refNo: 'HR/MEMO/2026/001',
      notes: 'Unauthorized test memo',
      status: 'Issued'
    }
  });
  assert.equal(staffCreate.status, 'error', 'Staff user ALICE must be denied from creating corporate letters');
  assert.match(staffCreate.message, /HR administrators|authorized|permission/i);

  const hodCreate = req('MANAGER', 'hrSave', {
    module: 'letters',
    record: {
      employee: 'ALICE',
      category: 'Increment',
      title: 'HOD increment attempt',
      date: '2026-10-14',
      refNo: 'HR/INCREMENT/2026/002',
      notes: 'HOD trying to issue increment letter',
      status: 'Issued'
    }
  });
  assert.equal(hodCreate.status, 'error', 'HOD (MANAGER) must be denied from creating corporate letters');
  assert.match(hodCreate.message, /HR administrators|authorized|permission/i);

  // 2. HR_USER (HR role) is PERMITTED to create and save letters as Draft
  const hrDraft = req('HR_USER', 'hrSave', {
    module: 'letters',
    record: {
      employee: 'ALICE',
      category: 'Increment',
      title: 'Annual Salary Increment 2026',
      date: '2026-10-14',
      refNo: 'HR/INCREMENT/2026/001',
      notes: 'Proposed increment to RM 4,500 effective 1 Nov 2026.',
      status: 'Draft'
    }
  });
  assert.equal(hrDraft.status, 'success', `HR_USER should successfully save letter as Draft: ${hrDraft.message}`);
  assert.equal(hrDraft.data.status, 'Draft', 'Letter status must be Draft');
  assert.equal(hrDraft.data.refNo, 'HR/INCREMENT/2026/001', 'Reference number must be preserved in record');
  assert.equal(hrDraft.data.employee, 'ALICE');

  // Verify ALICE cannot see the Draft letter in her bootstrap
  const aliceBoot1 = req('ALICE', 'hrBootstrap');
  assert.equal(aliceBoot1.status, 'success');
  const aliceLetters1 = (aliceBoot1.data.records.letters || []);
  assert.equal(aliceLetters1.find(l => l.id === hrDraft.data.id), undefined, 'ALICE must NOT see Draft letters');

  // 3. ADMIN is PERMITTED to create and issue letters directly ('Issued')
  const adminIssued = req('ADMIN', 'hrSave', {
    module: 'letters',
    record: {
      employee: 'ALICE',
      category: 'Confirmation',
      title: 'Employment Confirmation Letter',
      date: '2026-10-14',
      refNo: 'HR/CONFIRMATION/2026/001',
      notes: 'Official confirmation letter as Senior Engineer.',
      status: 'Issued'
    }
  });
  assert.equal(adminIssued.status, 'success', `ADMIN should successfully save & issue letter: ${adminIssued.message}`);
  assert.equal(adminIssued.data.status, 'Issued', 'Letter status must be Issued');
  assert.equal(adminIssued.data.refNo, 'HR/CONFIRMATION/2026/001', 'Reference number must be preserved in record');

  // Verify ALICE CAN immediately see the Issued letter in her bootstrap
  const aliceBoot2 = req('ALICE', 'hrBootstrap');
  assert.equal(aliceBoot2.status, 'success');
  const aliceLetters2 = (aliceBoot2.data.records.letters || []);
  const issuedForAlice = aliceLetters2.find(l => l.id === adminIssued.data.id);
  assert.ok(issuedForAlice, 'ALICE must see Issued letters immediately');
  assert.equal(issuedForAlice.refNo, 'HR/CONFIRMATION/2026/001');
  assert.equal(issuedForAlice.status, 'Issued');

  // Verify Admin sees both Draft and Issued letters
  const adminBoot = req('ADMIN', 'hrBootstrap');
  assert.equal(adminBoot.status, 'success');
  const allLetters = adminBoot.data.records.letters || [];
  assert.ok(allLetters.some(l => l.id === hrDraft.data.id), 'Admin must see Draft letter');
  assert.ok(allLetters.some(l => l.id === adminIssued.data.id), 'Admin must see Issued letter');
}

// ============================================================================
// PART 3: Frontend Component, HrWorkspace & @media print CSS Verification
// ============================================================================
function testFrontend() {
  console.log('Testing Part 3: Frontend modal component, workspace integration & print CSS...');

  // 1. Modal Component existence & contents
  const modalPath = path.join(__dirname, '../src/components/LetterGeneratorModal.vue');
  assert.ok(fs.existsSync(modalPath), 'src/components/LetterGeneratorModal.vue must exist');
  const modalSrc = fs.readFileSync(modalPath, 'utf8');

  // Template types selection
  assert.ok(modalSrc.includes('Increment'), 'Modal must support Increment template');
  assert.ok(modalSrc.includes('Confirmation'), 'Modal must support Confirmation template');
  assert.ok(modalSrc.includes('Transfer'), 'Modal must support Transfer template');
  assert.ok(modalSrc.includes('Memo'), 'Modal must support Memo template');

  // Employee selection
  assert.ok(modalSrc.includes('employee') || modalSrc.includes('employees'), 'Modal must provide employee selector');

  // Reference number generator
  assert.ok(modalSrc.includes('refNo') || modalSrc.includes('referenceNumber') || modalSrc.includes('generateReferenceNumber'), 'Modal must feature reference number');

  // Template specific inputs
  assert.ok(modalSrc.includes('currentSalary') || modalSrc.includes('basic'), 'Modal must include salary inputs for Increment');
  assert.ok(modalSrc.includes('newSalary') || modalSrc.includes('revised'), 'Modal must include new salary input');
  assert.ok(modalSrc.includes('effectiveDate') || modalSrc.includes('confirmationDate'), 'Modal must include date input');
  assert.ok(modalSrc.includes('jobTitle') || modalSrc.includes('designation'), 'Modal must include job title input');

  // Corporate letterhead preview & container
  assert.ok(modalSrc.includes('letterhead-print'), 'Modal preview container must have .letterhead-print class');
  assert.ok(modalSrc.includes('METRIO') || modalSrc.includes('Metrio'), 'Letterhead preview must render Metrio Group corporate header');

  // Action buttons
  assert.ok(modalSrc.includes('window.print') || modalSrc.includes('printLetter') || modalSrc.includes('handlePrint'), 'Modal must include Print / Export PDF action');
  assert.ok(modalSrc.includes('Issued'), 'Modal must support Save & Issue Letter with status Issued');
  assert.ok(modalSrc.includes('Draft'), 'Modal must support Save as Draft with status Draft');

  // 2. Integration in HrWorkspace.vue
  const workspacePath = path.join(__dirname, '../src/components/HrWorkspace.vue');
  assert.ok(fs.existsSync(workspacePath), 'src/components/HrWorkspace.vue must exist');
  const wsSrc = fs.readFileSync(workspacePath, 'utf8');

  assert.ok(wsSrc.includes('LetterGeneratorModal'), 'HrWorkspace.vue must import LetterGeneratorModal');
  assert.ok(wsSrc.includes('<LetterGeneratorModal'), 'HrWorkspace.vue must mount LetterGeneratorModal component');
  assert.ok(
    wsSrc.includes('openLetterGenerator') || wsSrc.includes('showLetterModal'),
    'HrWorkspace.vue must provide trigger methods for LetterGeneratorModal'
  );
  assert.ok(
    wsSrc.includes('openLetterGeneratorBtn') || wsSrc.includes('Corporate Letter') || wsSrc.includes('Letterhead Generator'),
    'HrWorkspace.vue must provide trigger buttons in overview shortcuts and letters module'
  );

  // 3. Print CSS in src/styles/dashboard.css
  const cssPath = path.join(__dirname, '../src/styles/dashboard.css');
  assert.ok(fs.existsSync(cssPath), 'src/styles/dashboard.css must exist');
  const cssSrc = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssSrc.includes('@media print'), 'dashboard.css must contain @media print');
  assert.ok(cssSrc.includes('.letterhead-print'), 'dashboard.css must contain rules for .letterhead-print');
  assert.ok(
    cssSrc.includes('20mm') || cssSrc.includes('A4'),
    'dashboard.css @media print must specify A4 formatting and 20mm margin rules for letters'
  );
}

// Run test suite
(async () => {
  try {
    await testTemplates();
    testBackend();
    testFrontend();
    console.log('PASS: All Corporate HR Correspondence Letterhead Generator tests passed!');
  } catch (err) {
    console.error('FAIL:', err);
    process.exit(1);
  }
})();
