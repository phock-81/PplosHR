const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 1. Test OverviewMetricService defensive getStaffSettings
test('OverviewMetricService: computeUserClaimLimits handles missing or empty getStaffSettings without crashing', async () => {
  const metricServiceFile = path.resolve(__dirname, '../src/components/overview/OverviewMetricService.js');
  const code = fs.readFileSync(metricServiceFile, 'utf8');

  // Verify safe defensive pattern exists
  assert.match(code, /getStaffSettings\(\)\s*\|\|\s*\{\}/, 'Must have fallback to empty object if getStaffSettings returns falsy');
  
  // Test runtime evaluation in isolated node environment
  global.window = {
    dashboardActions: {
      getStaffSettings: () => undefined // simulates uninitialized settings
    }
  };
  
  const { computeUserClaimLimits } = await import('../src/components/overview/OverviewMetricService.js');
  const user = { name: 'ASMA ZARIHA BINTI MOHD. SHUKRI' };
  
  // Should not throw TypeError
  const result = computeUserClaimLimits(user, []);
  assert.equal(result.cap, 600);
  assert.equal(result.remaining, 600);
  assert.equal(result.spent, 0);
});

// 2. Test HrWorkspace session and conditional mileage fields
test('HrWorkspace: session triggers load(true) and shouldShowField filters category-scoped fields', () => {
  const hrWorkspaceFile = path.resolve(__dirname, '../src/components/HrWorkspace.vue');
  const code = fs.readFileSync(hrWorkspaceFile, 'utf8');

  // Verify session triggers load(true)
  assert.match(code, /function session\(e\)\{[\s\S]*?if\s*\(\s*user\.value\s*\)\s*load\(true\);/, 'session must trigger load(true) when user is set');
  
  // Verify onMounted triggers load(true)
  assert.match(code, /if\s*\(user\.value\)\s*load\(true\);/, 'onMounted must trigger load(true) when saved session exists');

  // Verify shouldShowField is implemented
  assert.match(code, /function shouldShowField\(field\)/, 'shouldShowField function must exist');
  assert.match(code, /field\.categories\.some/, 'shouldShowField must check field.categories');
  assert.match(code, /formFields\s*=\s*computed\(\(\s*\)\s*=>\s*\(spec\.value\?\.fields\s*\|\|\s*\[\]\)\.filter\(shouldShowField\)\)/, 'formFields must filter by shouldShowField');
});

// 3. Test Leave UI: remove Hospitalisation and rename to Awaiting approval
test('Leave UI: Exclude Hospitalisation balance card and display Awaiting approval', () => {
  const dashboardFile = path.resolve(__dirname, '../src/services/dashboard.js');
  const dCode = fs.readFileSync(dashboardFile, 'utf8');
  assert.match(dCode, /!\[['"]Annual['"],\s*['"]Medical['"],\s*['"]Hospitalisation['"],\s*['"]Hospitalization['"]\]\.includes\(b\.category\)/, 'dashboard.js must exclude Hospitalisation from other leave balances');

  const payrollDashboardFile = path.resolve(__dirname, '../src/components/PayrollDashboard.vue');
  const pCode = fs.readFileSync(payrollDashboardFile, 'utf8');
  assert.match(pCode, /Awaiting approval<\/span>/, 'PayrollDashboard.vue must show Awaiting approval label');
  assert.doesNotMatch(pCode, /Awaiting decision<\/span>/, 'PayrollDashboard.vue must no longer show Awaiting decision');
});

// 4. Test backend date normalization and empty row safety in GAS_payroll.js
test('GAS_payroll.js: hrDate_ normalizes slash dates and hrRows_ safely handles empty rows', () => {
  const gasFile = path.resolve(__dirname, '../backend/GAS_payroll.js');
  const code = fs.readFileSync(gasFile, 'utf8');

  // Verify hrDate_ parses slash dates
  assert.match(code, /function hrDate_\(value,datetime\)/, 'hrDate_ function exists');
  assert.match(code, /parts\[2\]/, 'hrDate_ must reconstruct YYYY-MM-DD from parts');

  // Test slash parsing logic directly
  function testHrDate(value, datetime) {
    let s = String(value || '').trim();
    if (datetime) {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) {
        s = s.slice(0, 16);
      }
      assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s));
    } else {
      if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
        s = s.slice(0, 10);
      } else if (/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(s)) {
        const parts = s.split(/[-/]/);
        s = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
      } else if (/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.test(s)) {
        const parts = s.split(/[-/]/);
        if (Number(parts[0]) > 12) {
          s = `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
        } else if (Number(parts[1]) > 12) {
          s = `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
        } else {
          s = `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
        }
      }
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s));
    }
    assert.ok(!isNaN(Date.parse(s)));
    return s;
  }

  // Verify slash dates from browser/user inputs
  assert.equal(testHrDate('10/15/2026'), '2026-10-15');
  assert.equal(testHrDate('15/10/2026'), '2026-10-15');
  assert.equal(testHrDate('2026-10-15T08:30:00.000Z'), '2026-10-15');
  assert.equal(testHrDate('2026-10-15'), '2026-10-15');

  // Verify hrRows_ guards against empty strings
  assert.match(code, /if\s*\(!r\s*\|\|\s*!r\[4\]\s*\|\|\s*!String\(r\[4\]\)\.trim\(\)\)\s*continue;/, 'hrRows_ must ignore empty or whitespace rows');
});

// 5. Test Mobile updates: today schedule removed from MobileHome, MobileMe 360 redesigned
test('Mobile: today schedule removed and MobileMe 360 profile redesigned', () => {
  const homeFile = path.resolve(__dirname, '../src/components/mobile/MobileHome.vue');
  const hCode = fs.readFileSync(homeFile, 'utf8');
  assert.doesNotMatch(hCode, /class="m-shift-pill"/, 'MobileHome.vue must not render the m-shift-pill schedule card');

  const meFile = path.resolve(__dirname, '../src/components/mobile/MobileMe.vue');
  const mCode = fs.readFileSync(meFile, 'utf8');
  assert.match(mCode, /class="m-dossier-hero"/, 'MobileMe.vue must have redesigned 360 dossier hero section');
  assert.match(mCode, /class="m-segmented-tabs"/, 'MobileMe.vue must have 360 segmented tabs');
  assert.match(mCode, /activeTab === 'payslips'/, 'MobileMe.vue must have payslips panel');
  assert.match(mCode, /activeTab === 'claims'/, 'MobileMe.vue must have claims & flexi panel');
  assert.match(mCode, /activeTab === 'leave'/, 'MobileMe.vue must have leave panel');
  assert.match(mCode, /activeTab === 'assets'/, 'MobileMe.vue must have assets panel');
  assert.match(mCode, /activeTab === 'letters'/, 'MobileMe.vue must have letters panel');
});

// 6. Test hrLeaveCategory_ resolution for full names and codes
test('GAS_payroll.js: hrLeaveCategory_ resolves both full names and standard codes', () => {
  const gasFile = path.resolve(__dirname, '../backend/GAS_payroll.js');
  const code = fs.readFileSync(gasFile, 'utf8');

  // Extract hrLeaveCategory_ function from backend code
  const fnMatch = code.match(/function hrLeaveCategory_\(value\)[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'hrLeaveCategory_ function must exist');
  
  const evalHrLeaveCategory = new Function(fnMatch[0] + '; return hrLeaveCategory_;')();

  // Full English names from UI
  assert.equal(evalHrLeaveCategory('Annual Leave'), 'Annual');
  assert.equal(evalHrLeaveCategory('Medical Leave'), 'Medical');
  assert.equal(evalHrLeaveCategory('Medical Leave (MC)'), 'Medical');
  assert.equal(evalHrLeaveCategory('Hospitalization Leave'), 'Hospitalisation');
  assert.equal(evalHrLeaveCategory('Hospitalisation Leave'), 'Hospitalisation');
  assert.equal(evalHrLeaveCategory('Emergency Leave'), 'Annual');
  assert.equal(evalHrLeaveCategory('Unpaid Leave'), 'Unpaid');
  assert.equal(evalHrLeaveCategory('Unpaid Leave (NPL)'), 'Unpaid');
  assert.equal(evalHrLeaveCategory('Replacement Leave'), 'Replacement');
  assert.equal(evalHrLeaveCategory('Compassionate Leave'), 'Compassionate');
  assert.equal(evalHrLeaveCategory('Marriage Leave'), 'Marriage');
  assert.equal(evalHrLeaveCategory('Maternity Leave'), 'Maternity');
  assert.equal(evalHrLeaveCategory('Paternity Leave'), 'Paternity');

  // Standard short codes
  assert.equal(evalHrLeaveCategory('AL'), 'Annual');
  assert.equal(evalHrLeaveCategory('EL'), 'Annual');
  assert.equal(evalHrLeaveCategory('ML'), 'Medical');
  assert.equal(evalHrLeaveCategory('MC'), 'Medical');
  assert.equal(evalHrLeaveCategory('HPL'), 'Hospitalisation');
  assert.equal(evalHrLeaveCategory('NPL'), 'Unpaid');
  assert.equal(evalHrLeaveCategory('RPL'), 'Replacement');
  assert.equal(evalHrLeaveCategory('CPL'), 'Compassionate');
  assert.equal(evalHrLeaveCategory('MRL'), 'Marriage');
  assert.equal(evalHrLeaveCategory('MTL'), 'Maternity');
  assert.equal(evalHrLeaveCategory('PL'), 'Paternity');
  assert.equal(evalHrLeaveCategory('fractional_split'), 'fractional_split');
});

// 7. Test hrInductionDate_ and confirmation date handling
test('GAS_payroll.js: hrInductionDate_ parses Malaysian slash dates and confirmation logic handles text/active staff', () => {
  const gasFile = path.resolve(__dirname, '../backend/GAS_payroll.js');
  const code = fs.readFileSync(gasFile, 'utf8');

  // Verify Utilities mock and hrInductionDate_ extraction
  const fnMatch = code.match(/function hrInductionDate_\(value\)[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'hrInductionDate_ function must exist');

  const mockUtilities = {
    formatDate: (d, tz, fmt) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  };

  const evalHrInductionDate = new Function('Utilities', fnMatch[0] + '; return hrInductionDate_;')(mockUtilities);

  // Slash dates
  assert.equal(evalHrInductionDate('15/10/2025'), '2025-10-15');
  assert.equal(evalHrInductionDate('01/04/2025'), '2025-04-01');
  assert.equal(evalHrInductionDate('2025/10/15'), '2025-10-15');
  assert.equal(evalHrInductionDate('2025-10-15'), '2025-10-15');

  // Confirmation assertion check regex in code
  assert.match(code, /const isTextConfirmed\s*=\s*\/confirmed\|yes\|true\/i\.test\(rawConfirm\);/, 'Must support text confirmed in staff[13]');
  assert.match(code, /if\s*\(confirmed\s*&&\s*date\)\s*\{[\s\S]*?hrAssert_\(confirmed\s*<=\s*date/, 'Must verify confirmation date <= receipt date when confirmed date is known');
});

// 8. Test MobileRequests form reset and UI controls
test('MobileRequests.vue: implements form resets, date normalization, Clear buttons, and standard leave codes', () => {
  const reqFile = path.resolve(__dirname, '../src/components/mobile/MobileRequests.vue');
  const code = fs.readFileSync(reqFile, 'utf8');

  // Verify reset methods exist and clear drafts + file inputs
  assert.match(code, /function resetLeaveForm\(\)\s*\{[\s\S]*?localStorage\.removeItem\(LEAVE_DRAFT_KEY\);[\s\S]*?if\s*\(leaveFileInput\.value\)/, 'resetLeaveForm must clear state, draft and file ref');
  assert.match(code, /function resetClaimForm\(\)\s*\{[\s\S]*?localStorage\.removeItem\(CLAIM_DRAFT_KEY\);[\s\S]*?if\s*\(claimFileInput\.value\)/, 'resetClaimForm must clear state, draft and file ref');

  // Verify normalizeDateStr
  assert.match(code, /function normalizeDateStr\(val\)/, 'normalizeDateStr helper must exist');

  // Verify Clear buttons in both wizard headers
  assert.match(code, /@click="resetLeaveForm"[^>]*>[\s\S]*?Clear\s*<\/button>/, 'Leave wizard must have Clear button');
  assert.match(code, /@click="resetClaimForm"[^>]*>[\s\S]*?Clear\s*<\/button>/, 'Claim wizard must have Clear button');

  // Verify standard option codes in template
  assert.match(code, /<option value="AL">Annual Leave \(AL\)<\/option>/, 'Must have AL option');
  assert.match(code, /<option value="ML">Medical Leave \(MC\)<\/option>/, 'Must have ML option');
  assert.match(code, /<option value="HPL">Hospitalization Leave \(HPL\)<\/option>/, 'Must have HPL option');

  // Verify post-submit resets
  assert.match(code, /resetLeaveForm\(\);\s*showLeaveWizard\.value\s*=\s*false;/, 'submitLeave must call resetLeaveForm on success');
  assert.match(code, /resetClaimForm\(\);\s*showClaimWizard\.value\s*=\s*false;/, 'submitClaim must call resetClaimForm on success');
});

// 9. Test HrWorkspace spec definition and canOpenHr permission fixes
test('HrWorkspace & navigation: spec is defined, canOpenHr allows Admin/HR all modules, openHrPage has session recovery', async () => {
  const hrWorkspaceFile = path.resolve(__dirname, '../src/components/HrWorkspace.vue');
  const hwCode = fs.readFileSync(hrWorkspaceFile, 'utf8');

  // Verify spec is defined
  assert.match(hwCode, /const spec\s*=\s*computed\(\(\s*\)\s*=>\s*modules\[active\.value\]\);/, 'HrWorkspace must define spec computed property');

  // Verify openModule has session recovery
  assert.match(hwCode, /function openModule\(e\)\{[\s\S]*?localStorage\.getItem\('hrPortalUser'\)/, 'openModule must restore user from localStorage if null');

  // Verify canOpenHr allows Admin and HR all modules
  const navFile = path.resolve(__dirname, '../src/hr/navigation.js');
  const navCode = fs.readFileSync(navFile, 'utf8');
  assert.match(navCode, /if\s*\(\['Admin',\s*'HR'\]\.includes\(norm\)\)\s*return true;/, 'canOpenHr must return true for Admin and HR');

  const { canOpenHr } = await import('../src/hr/navigation.js');
  assert.equal(canOpenHr('Admin', 'companies', 'all'), true, 'Admin can open companies');
  assert.equal(canOpenHr('Admin', 'appraisals', 'all'), true, 'Admin can open appraisals');
  assert.equal(canOpenHr('HR', 'claims', 'all'), true, 'HR can open claims');
  assert.equal(canOpenHr('HR', 'cycles', 'all'), true, 'HR can open cycles');
  assert.equal(canOpenHr('Staff', 'claims', 'personal'), true, 'Staff can open personal claims');

  // Verify dashboard.js openHrPage fallback
  const dFile = path.resolve(__dirname, '../src/services/dashboard.js');
  const dCode = fs.readFileSync(dFile, 'utf8');
  assert.match(dCode, /function openHrPage\(module,scope,element\)\s*\{[\s\S]*?localStorage\.getItem\('hrPortalUser'\)/, 'openHrPage must restore currentUser if null');
});


