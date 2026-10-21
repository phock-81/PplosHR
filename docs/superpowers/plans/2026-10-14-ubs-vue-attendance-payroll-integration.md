# UBS System & Induction Policy into Attendance Payroll Vue Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Sage UBS HR & Payroll calculation engine, latest Malaysian statutory compliance (2024–2026 mandates), Metrio Group Induction Policy (FAM-23/G Jul 2025), 360° staff dossier, fractional leave, year-end rollover, and corporate letterhead generator into the Attendance Payroll Vue application.

**Architecture:** Extend the existing Vue 3 Single-Page Application (Vite, Bootstrap 5.3) and its Google Apps Script backend (`backend/GAS_payroll.js`). Statutory schedules, pro-rating formulas, and induction benefit limits are implemented in clean, testable JavaScript modules (`src/services/statutory.js`, `src/services/inductionPolicy.js`) mirrored in the Apps Script persistence layer, with dynamic HR configuration editable via the UI and stored in Google Sheets (`HR_statutorySettings`).

**Tech Stack:** JavaScript (ES6+), Node.js (v20+ / v22+), Vue 3, Google Apps Script V8 runtime, Google Sheets API, Vite, Bootstrap 5.3.

## Global Constraints

- Platform: Windows / Node.js with Vite and Google Apps Script V8 runtime.
- Deployment target: Firebase Hosting (for frontend `dist`) and Google Apps Script Web App (for backend API).
- No unverified external dependencies: Pure native JavaScript / standard Node.js test runners matching existing `tests/*.test.cjs`.
- Statutory Regulations: Amended Malaysian regulations (SOCSO Act 4 ceiling RM 6,000; EIS Act 800 ceiling RM 6,000 and age $\ge 60$ exemption; EPF Act 452 11%/13%/12% and age $\ge 60$ 0%/4%; LHDN Form TP1 12/14 categories and computerized progressive PCB).
- Company Induction Policy: Metrio Group Induction Manual (FAM-23/G, 7th Edition: JUL 2025).
- Statutory citations and regulatory references must be visibly displayed on all relevant UI screens.
- All statutory rates, ceilings, relief caps, and policy limits must be dynamically editable by HR without code changes.

---

### Task 1: Malaysian Statutory Deduction Engine (`src/services/statutory.js` & `tests/statutory.test.cjs`)

**Files:**
- Create: `attendance-payroll-vue/src/services/statutory.js`
- Create: `attendance-payroll-vue/tests/statutory.test.cjs`

**Interfaces:**
- Produces:
  - `calculateEpf(wages, age, isForeigner)`: returns `{ employee: number, employer: number }`
  - `calculateSocso(wages, age, ceiling)`: returns `{ employee: number, employer: number }`
  - `calculateEis(wages, age, ceiling)`: returns `{ employee: number, employer: number }`
  - `calculatePcb(grossPay, epfEmployee, tp1MonthlyRelief, age, settings)`: returns `number`
  - `SOCSO_SCHEDULE`: Array of wage band tiers up to RM 6,000
  - `TP1_RELIEF_CAPS`: Object of statutory Form TP1 caps

- [ ] **Step 1: Write the failing unit test for Malaysian statutory calculations**

Create `attendance-payroll-vue/tests/statutory.test.cjs`:
```javascript
const assert = require('node:assert/strict');
const statutory = require('../src/services/statutory.cjs');

// Test 1: EPF Calculation
// Below 60, wage <= 5000: 11% EE, 13% ER
const epf1 = statutory.calculateEpf(4000, 30);
assert.equal(epf1.employee, 440);
assert.equal(epf1.employer, 520);

// Below 60, wage > 5000: 11% EE, 12% ER
const epf2 = statutory.calculateEpf(6000, 30);
assert.equal(epf2.employee, 660);
assert.equal(epf2.employer, 720);

// Age 60 and above: 0% EE, 4% ER
const epfSenior = statutory.calculateEpf(5000, 62);
assert.equal(epfSenior.employee, 0);
assert.equal(epfSenior.employer, 200);

// Test 2: SOCSO Calculation (Act 4 amended RM 6,000 ceiling)
// Cat 1 (Age < 60) for wage RM 3,500
const socso1 = statutory.calculateSocso(3550, 35);
assert.equal(socso1.employee, 17.75);
assert.equal(socso1.employer, 62.15);

// Cat 1 for wage RM 6,500 (capped at RM 6,000 ceiling: EE 29.75, ER 104.15)
const socsoMax = statutory.calculateSocso(6500, 35);
assert.equal(socsoMax.employee, 29.75);
assert.equal(socsoMax.employer, 104.15);

// Cat 2 (Age >= 60) for wage RM 6,500 (EE 0, ER capped at 74.40)
const socsoSenior = statutory.calculateSocso(6500, 62);
assert.equal(socsoSenior.employee, 0);
assert.equal(socsoSenior.employer, 74.40);

// Test 3: EIS Calculation (Act 800 amended RM 6,000 ceiling)
const eis1 = statutory.calculateEis(4000, 30);
assert.equal(eis1.employee, 8.00);
assert.equal(eis1.employer, 8.00);

// Capped at RM 6,000: EE 11.90, ER 11.90
const eisMax = statutory.calculateEis(7000, 30);
assert.equal(eisMax.employee, 11.90);
assert.equal(eisMax.employer, 11.90);

// Age >= 60 is exempt
const eisSenior = statutory.calculateEis(5000, 62);
assert.equal(eisSenior.employee, 0);
assert.equal(eisSenior.employer, 0);

// Test 4: PCB Calculation
// Income <= RM 3,000 monthly: PCB is 0
const pcbLow = statutory.calculatePcb(3000, 330, 0, 30);
assert.equal(pcbLow, 0);

// Income RM 10,000 monthly: PCB computed with progressive brackets
const pcbHigh = statutory.calculatePcb(10000, 333.33, 0, 30);
assert.ok(pcbHigh > 800 && pcbHigh < 1100, `PCB should be in expected tax range, got ${pcbHigh}`);

console.log('PASS: statutory.test.cjs - EPF, SOCSO, EIS, and PCB computations verified.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/statutory.test.cjs`  
Expected: FAIL with `Cannot find module '../src/services/statutory.cjs'`

- [ ] **Step 3: Implement `src/services/statutory.js` (and CommonJS wrapper `src/services/statutory.cjs` for tests)**

Create `attendance-payroll-vue/src/services/statutory.js`:
```javascript
// Malaysian Statutory Calculation Engine (EPF, SOCSO, EIS, PCB)
// Reflects latest 2024-2026 mandates:
// - SOCSO Act 4: RM 6,000 ceiling (Oct 2024)
// - EIS Act 800: RM 6,000 ceiling (Oct 2024)
// - EPF Act 452: Senior age >= 60 tier
// - LHDN PCB: Progressive brackets and Section 6A rebate

export const DEFAULT_STATUTORY_CONFIG = {
  socsoCeiling: 6000.0,
  eisCeiling: 6000.0,
  epfEmployeeStandardRate: 0.11,
  epfEmployerLowWageRate: 0.13,
  epfEmployerHighWageRate: 0.12,
  epfEmployerSeniorRate: 0.04,
  pcbIndividualReliefMonthly: 750.0, // RM 9,000 / 12
  pcbEpfMaxMonthlyDeduction: 333.33,  // RM 4,000 / 12
  pcbRebateMaxAnnualIncome: 35000.0,
  pcbRebateAmount: 400.0
};

export const TP1_RELIEF_CAPS = {
  parent_medical: 8000.0,
  serious_diseases_medical: 10000.0,
  lifestyle_general: 2500.0,
  lifestyle_sports: 1000.0,
  childcare_fees: 3000.0,
  sspn_savings: 8000.0,
  life_insurance: 3000.0,
  epf_voluntary: 4000.0,
  prs_annuity: 3000.0,
  education_medical_insurance: 3000.0,
  ev_charging: 2500.0,
  socso_relief: 350.0
};

// Act 4 Third Schedule Table
export const SOCSO_SCHEDULE = [
  { low: 0, high: 30, ee: 0.10, er1: 0.40, er2: 0.30 },
  { low: 30, high: 50, ee: 0.20, er1: 0.70, er2: 0.50 },
  { low: 50, high: 70, ee: 0.30, er1: 1.10, er2: 0.80 },
  { low: 70, high: 100, ee: 0.40, er1: 1.50, er2: 1.10 },
  { low: 100, high: 140, ee: 0.60, er1: 2.10, er2: 1.50 },
  { low: 140, high: 200, ee: 0.85, er1: 2.95, er2: 2.10 }
];

for (let high = 300; high <= 6000; high += 100) {
  const low = high - 100;
  const mid = low + 50;
  const ee = Math.round(mid * 0.005 * 100) / 100;
  const tot = Math.round(mid * 0.0225 * 20) / 20;
  const er1 = Math.round((tot - ee) * 100) / 100;
  const er2 = Math.round((mid * 0.0125 * 20) / 20 * 100) / 100;
  SOCSO_SCHEDULE.push({ low, high, ee, er1, er2 });
}

export function calculateEpf(wages, age = 30, isForeigner = false, config = DEFAULT_STATUTORY_CONFIG) {
  const w = Number(wages) || 0;
  if (w <= 0) return { employee: 0, employer: 0 };
  if (age >= 60) {
    return {
      employee: 0,
      employer: Math.round(w * (config.epfEmployerSeniorRate || 0.04) * 100) / 100
    };
  }
  const ee = Math.ceil(w * (config.epfEmployeeStandardRate || 0.11));
  const erRate = w <= 5000 ? (config.epfEmployerLowWageRate || 0.13) : (config.epfEmployerHighWageRate || 0.12);
  const er = Math.ceil(w * erRate);
  return { employee: ee, employer: er };
}

export function calculateSocso(wages, age = 30, config = DEFAULT_STATUTORY_CONFIG) {
  const w = Number(wages) || 0;
  if (w <= 0) return { employee: 0, employer: 0 };
  const ceiling = config.socsoCeiling || 6000.0;
  const capped = Math.min(w, ceiling);
  let match = SOCSO_SCHEDULE.find(s => capped > s.low && capped <= s.high);
  if (!match) match = SOCSO_SCHEDULE[SOCSO_SCHEDULE.length - 1];
  if (age >= 60) {
    return { employee: 0, employer: match.er2 };
  }
  return { employee: match.ee, employer: match.er1 };
}

export function calculateEis(wages, age = 30, config = DEFAULT_STATUTORY_CONFIG) {
  const w = Number(wages) || 0;
  if (w <= 0 || age >= 60) return { employee: 0, employer: 0 };
  const ceiling = config.eisCeiling || 6000.0;
  const capped = Math.min(w, ceiling);
  let rate;
  if (capped <= 200) {
    if (capped <= 30) rate = 0.05;
    else if (capped <= 50) rate = 0.10;
    else if (capped <= 70) rate = 0.15;
    else if (capped <= 100) rate = 0.20;
    else if (capped <= 140) rate = 0.25;
    else rate = 0.35;
  } else {
    const high = Math.min(6000, Math.ceil(capped / 100) * 100);
    const mid = high - 50;
    rate = Math.round(mid * 0.002 * 100) / 100;
  }
  return { employee: rate, employer: rate };
}

export function calculatePcb(grossPay, epfEmployee = 0, tp1MonthlyRelief = 0, age = 30, config = DEFAULT_STATUTORY_CONFIG) {
  const gross = Number(grossPay) || 0;
  const epfDeduct = Math.min(Number(epfEmployee) || 0, config.pcbEpfMaxMonthlyDeduction || 333.33);
  const indivRelief = config.pcbIndividualReliefMonthly || 750.0;
  const tp1 = Number(tp1MonthlyRelief) || 0;
  const netMonthly = gross - epfDeduct - tp1 - indivRelief;
  if (netMonthly <= 0) return 0;

  const annualP = netMonthly * 12;
  const brackets = [
    { chunk: 5000, rate: 0.00 },
    { chunk: 15000, rate: 0.01 },
    { chunk: 15000, rate: 0.03 },
    { chunk: 15000, rate: 0.06 },
    { chunk: 20000, rate: 0.11 },
    { chunk: 30000, rate: 0.19 },
    { chunk: 300000, rate: 0.25 },
    { chunk: 200000, rate: 0.26 },
    { chunk: 1400000, rate: 0.28 }
  ];

  let rem = annualP;
  let annualTax = 0;
  for (const b of brackets) {
    const taxable = Math.min(rem, b.chunk);
    annualTax += taxable * b.rate;
    rem -= taxable;
    if (rem <= 0) break;
  }
  if (rem > 0) annualTax += rem * 0.30;

  if (annualP <= (config.pcbRebateMaxAnnualIncome || 35000)) {
    annualTax = Math.max(0, annualTax - (config.pcbRebateAmount || 400));
  }

  const monthlyPcb = Math.round((annualTax / 12) * 100) / 100;
  return Math.max(0, monthlyPcb);
}
```

Create `attendance-payroll-vue/src/services/statutory.cjs` exporting the same functions for Node.js test suites.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/statutory.test.cjs`  
Expected: PASS

---

### Task 2: Dynamic HR Statutory & Policy Settings Center (`StatutorySettingsModal.vue` & `GAS_payroll.js`)

**Files:**
- Create: `attendance-payroll-vue/src/components/StatutorySettingsModal.vue`
- Modify: `attendance-payroll-vue/src/components/HrWorkspace.vue`
- Modify: `attendance-payroll-vue/backend/GAS_payroll.js`
- Test: `attendance-payroll-vue/tests/statutory-settings.test.cjs`

**Interfaces:**
- Produces:
  - Apps Script Action `getStatutorySettings`: returns current configured settings
  - Apps Script Action `saveStatutorySettings`: validates and saves settings into `HR_statutorySettings` sheet
  - `StatutorySettingsModal.vue`: dialog with visible statutory act badges and editable input fields

- [ ] **Step 1: Write the failing test for statutory settings API in `tests/statutory-settings.test.cjs`**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

const code = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const r = runtime(code);

// Ensure default settings can be fetched
const getRes = r.post('getStatutorySettings', {}, 'test-token');
assert.equal(getRes.status, 'success');
assert.equal(getRes.data.socsoCeiling, 6000);

// Update settings with new ceiling
const updateRes = r.post('saveStatutorySettings', {
  settings: {
    socsoCeiling: 7000,
    eisCeiling: 7000,
    epfEmployeeStandardRate: 0.11,
    sportsReliefCap: 1200
  }
}, 'test-token');
assert.equal(updateRes.status, 'success');

const checkRes = r.post('getStatutorySettings', {}, 'test-token');
assert.equal(checkRes.data.socsoCeiling, 7000);
console.log('PASS: statutory-settings.test.cjs - Dynamic HR settings load and save verified.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/statutory-settings.test.cjs`  
Expected: FAIL (unrecognized actions `getStatutorySettings`)

- [ ] **Step 3: Implement `getStatutorySettings` and `saveStatutorySettings` in `backend/GAS_payroll.js`**

Add handling in `routePost_`:
- Read / write `HR_statutorySettings` tab.
- Validate that user has `Admin` or `HR` role.
- Log change to `HR_audit`.

- [ ] **Step 4: Create `src/components/StatutorySettingsModal.vue`**
- Group settings by Governing Act:
  - `Employees' Social Security Act 1969 (Act 4)`
  - `Employment Insurance System Act 2017 (Act 800)`
  - `Employees Provident Fund Act 1991 (Act 452)`
  - `Income Tax Act 1967 (Form TP1 & PCB)`
  - `Employment Act 1955 (Section 60A Overtime)`
  - `Metrio Induction Policy (FAM-23/G Benefits)`
- Provide numeric input fields with validations and a "Save Statutory Settings" button.

- [ ] **Step 5: Run tests and verify passes**

Run: `node tests/statutory-settings.test.cjs`  
Expected: PASS

---

### Task 3: Metrio Induction Policy Engine & Fractional Leave (`inductionPolicy.js` & `PayrollDashboard.vue`)

**Files:**
- Create: `attendance-payroll-vue/src/services/inductionPolicy.js`
- Modify: `attendance-payroll-vue/src/components/PayrollDashboard.vue`
- Modify: `attendance-payroll-vue/backend/GAS_payroll.js`
- Test: `attendance-payroll-vue/tests/induction.test.cjs`
- Test: `attendance-payroll-vue/tests/leave-balances.test.cjs`

**Interfaces:**
- Produces:
  - `calculateAnnualLeaveEntitlement(yearsOfService)`: returns `12 + min(14, max(0, years - 1))`
  - `calculateSickLeaveEntitlement(yearsOfService)`: `< 2` yrs $\rightarrow$ 14, `2-5` yrs $\rightarrow$ 18, `5+` yrs $\rightarrow$ 22
  - Fractional leave application payload support (`annualDays`, `unpaidDays`)
  - Two-tier leave approval support (`pending_hod` $\rightarrow$ `pending_admin` $\rightarrow$ `approved`)

- [ ] **Step 1: Write test for fractional leave and induction policy rules in `tests/fractional-leave.test.cjs`**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

const code = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const r = runtime(code);

// Test fractional leave submission (e.g. 0.16 AL + 0.84 NPL)
const submitRes = r.post('submitLeave', {
  name: 'TEST',
  type: 'fractional_split',
  start: '2026-10-20',
  end: '2026-10-20',
  days: 1.0,
  annualDays: 0.16,
  unpaidDays: 0.84,
  reason: 'Split leave due to AL balance exhaustion'
}, 'test-token');

assert.equal(submitRes.status, 'success');
assert.equal(submitRes.data.annualDays, 0.16);
assert.equal(submitRes.data.unpaidDays, 0.84);

console.log('PASS: fractional-leave.test.cjs - 2-decimal fractional AL/NPL split verified.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/fractional-leave.test.cjs`  
Expected: FAIL

- [ ] **Step 3: Implement `src/services/inductionPolicy.js` and update `GAS_payroll.js` `submitLeave`**

- Support `annualDays` and `unpaidDays` in `submitLeave`.
- Validate that `annualDays` does not exceed available AL balance.
- Support 2-tier approval workflow (`pending_hod` by manager, then `approved` by Admin/HR).
- Update `PayrollDashboard.vue` leave submission form to provide a Fractional Split selector when requested days exceed available balance.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/fractional-leave.test.cjs`  
Expected: PASS

---

### Task 4: Pro-Rated Payroll Engine & Month-Lock Integration (`src/services/dashboard.js` & `backend/GAS_payroll.js`)

**Files:**
- Modify: `attendance-payroll-vue/src/services/dashboard.js`
- Modify: `attendance-payroll-vue/backend/GAS_payroll.js`
- Test: `attendance-payroll-vue/tests/payroll-prorated.test.cjs`

**Interfaces:**
- Produces:
  - `calculateProRatedBasic(basicSalary, incrementAmount, incrementDay, workingDays)`
  - `calculateNplDeduction(proRatedBasic, unpaidDays, workingDays)`
  - Integrated `lockMonth`: automatically pulls unpaid leave days and approved claims, applies EPF/SOCSO/EIS/PCB, commits to `Payroll` sheet.

- [ ] **Step 1: Write unit test for pro-rated payroll and NPL deductions in `tests/payroll-prorated.test.cjs`**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

const code = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const r = runtime(code);

// Employee with basic RM 5,200, 26 working days, 1.84 days unpaid leave (NPL)
// NPL deduction = (5200 / 26) * 1.84 = 200 * 1.84 = 368.00
// Gross = 5200 - 368 = 4832.00
const lockRes = r.post('lockMonth', {
  month: '2026-10',
  payrollData: [
    ['2026-10', 'EMP001', 'TEST', 5200, 5200, 1.84, 368.00, 0, 0, 0, 0, 4832.00]
  ]
}, 'test-token');

assert.equal(lockRes.status, 'success');
console.log('PASS: payroll-prorated.test.cjs - Pro-rated basic and NPL integration verified.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/payroll-prorated.test.cjs`  
Expected: FAIL

- [ ] **Step 3: Update `lockMonth` and `generatePayrollData` in `src/services/dashboard.js` and `backend/GAS_payroll.js`**

- Import and apply `src/services/statutory.js` inside `dashboard.js`.
- During `lockMonth`:
  1. Fetch approved unpaid leave days (including fractional splits) for the target month from `Leave` / `HR_leave`.
  2. Fetch approved unpaid medical/expense claims from `HR_claims` submitted on or before the 20th of the month.
  3. Compute pro-rated basic and NPL deductions.
  4. Compute statutory EPF, SOCSO, EIS, and PCB.
  5. Add claims reimbursement to net pay payout.
  6. Update claims status to `Paid` with month reference.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/payroll-prorated.test.cjs`  
Expected: PASS

---

### Task 5: Interactive Year-End Rollover Tool (`YearEndModal.vue` & `GAS_payroll.js`)

**Files:**
- Create: `attendance-payroll-vue/src/components/YearEndModal.vue`
- Modify: `attendance-payroll-vue/src/components/HrWorkspace.vue`
- Modify: `attendance-payroll-vue/backend/GAS_payroll.js`
- Test: `attendance-payroll-vue/tests/year-end.test.cjs`

**Interfaces:**
- Produces:
  - Action `previewYearEndClose(companyId, fromYear, toYear)`: returns projected carry-forward table with 14-day standard cap and 30-April excess expiration.
  - Action `executeYearEndClose(companyId, fromYear, toYear)`: commits new opening balances and records audit log.

- [ ] **Step 1: Write test for Year-End carry-forward capping in `tests/year-end.test.cjs`**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

const code = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const r = runtime(code);

// Test preview with employee having 18 days unutilized leave
// Standard CF <= 14 days (expires 31-Dec)
// Excess CF = 4 days (expires 30-April)
const preview = r.post('previewYearEndClose', { companyId: 'MD', fromYear: 2026, toYear: 2027 }, 'test-token');
assert.equal(preview.status, 'success');
assert.ok(Array.isArray(preview.data));

const exec = r.post('executeYearEndClose', { companyId: 'MD', fromYear: 2026, toYear: 2027 }, 'test-token');
assert.equal(exec.status, 'success');
console.log('PASS: year-end.test.cjs - Dual-window carry-forward rollover verified.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/year-end.test.cjs`  
Expected: FAIL

- [ ] **Step 3: Implement Year-End preview and commit logic in `backend/GAS_payroll.js` and `YearEndModal.vue`**

- In `GAS_payroll.js`, write `previewYearEndClose_` and `executeYearEndClose_`.
- Enforce statutory 14-day cap: values $\le 14$ assigned expiry `31-Dec`; values $> 14$ split into standard + excess expiring `30-April`.
- Create `src/components/YearEndModal.vue` with preview table and commit button.
- Mount modal in `HrWorkspace.vue` under Administration.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/year-end.test.cjs`  
Expected: PASS

---

### Task 6: 360° Staff Profile Enquiry Dossier (`StaffDossierModal.vue` & `GAS_payroll.js`)

**Files:**
- Create: `attendance-payroll-vue/src/components/StaffDossierModal.vue`
- Modify: `attendance-payroll-vue/src/components/PayrollDashboard.vue`
- Modify: `attendance-payroll-vue/backend/GAS_payroll.js`
- Test: `attendance-payroll-vue/tests/dossier.test.cjs`

**Interfaces:**
- Produces:
  - Action `getStaffDossier(employeeName)`: aggregates 5 tabs of employee data (Leave, Claims, Payroll, Assets, Letters).
  - Component `StaffDossierModal.vue`: searchable identity card modal.

- [ ] **Step 1: Write test for dossier aggregation in `tests/dossier.test.cjs`**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

const code = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const r = runtime(code);

const res = r.post('getStaffDossier', { employee: 'TEST' }, 'test-token');
assert.equal(res.status, 'success');
assert.ok(res.data.profile);
assert.ok(res.data.leave);
assert.ok(res.data.claims);
assert.ok(res.data.payroll);
assert.ok(res.data.resources);
assert.ok(res.data.letters);
console.log('PASS: dossier.test.cjs - 360 Staff Dossier aggregation verified.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/dossier.test.cjs`  
Expected: FAIL

- [ ] **Step 3: Implement `getStaffDossier` in `GAS_payroll.js` and `StaffDossierModal.vue`**

- Aggregate data from `Staff`, `Leave`, `Payroll`, `HR_claims`, `HR_bookings`, and `HR_letters`.
- In `StaffDossierModal.vue`, render tabs with responsive styling and instant lookup search field.
- Wire open button into Employee Management table in `PayrollDashboard.vue`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/dossier.test.cjs`  
Expected: PASS

---

### Task 7: Corporate HR Correspondence Letterhead Generator (`LetterGeneratorModal.vue`)

**Files:**
- Create: `attendance-payroll-vue/src/components/LetterGeneratorModal.vue`
- Modify: `attendance-payroll-vue/src/components/HrWorkspace.vue`
- Modify: `attendance-payroll-vue/src/styles/dashboard.css`
- Test: `attendance-payroll-vue/tests/letters.test.cjs`

**Interfaces:**
- Produces:
  - Templates: `increment`, `confirmation`, `transfer`, `memo`
  - Automated reference code generator: `HR/{TEMPLATE}/{YEAR}/{EMP_NO}`
  - Print-ready `@media print` letterhead styling

- [ ] **Step 1: Write test for letter generation template formatting in `tests/letters.test.cjs`**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

const code = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const r = runtime(code);

const saveLetter = r.post('hrSave', {
  module: 'letters',
  record: {
    employee: 'TEST',
    category: 'Increment',
    title: 'Salary Increment 2026',
    date: '2026-10-14',
    refNo: 'HR/INC/2026/EMP001',
    notes: 'Increment of RM 500.00 effective 01 November 2026.'
  }
}, 'test-token');

assert.equal(saveLetter.status, 'success');
console.log('PASS: letters.test.cjs - Letter creation and reference tracking verified.');
```

- [ ] **Step 2: Run test to verify it fails or needs refNo support**

Run: `node tests/letters.test.cjs`

- [ ] **Step 3: Implement `LetterGeneratorModal.vue` with corporate letterhead preview & print CSS**

- Provide dynamic form with template selector (`Increment`, `Confirmation`, `Transfer`, `Memo`).
- Auto-calculate and fill salary changes, effective dates, and employee title.
- Add print-specific CSS in `src/styles/dashboard.css` ensuring clean margin, page-break, and letterhead headers.

- [ ] **Step 4: Run test and verify passes**

Run: `node tests/letters.test.cjs`  
Expected: PASS

---

### Task 8: Full Regression Suite & Production Verification

**Files:**
- Modify: `attendance-payroll-vue/package.json` (add new test scripts)

- [ ] **Step 1: Update `package.json` scripts**
Add `"test:statutory": "node tests/statutory.test.cjs"` and `"test:all": "npm run test:backend && npm run test:hr && npm run test:statutory && npm run test:leave-balances && npm run test:induction"`.

- [ ] **Step 2: Execute all test suites**
Run: `npm run test:all`  
Expected: 100% PASS across all backend, statutory, induction, and leave balance test suites.

- [ ] **Step 3: Run production build**
Run: `npm run build`  
Expected: Clean build output in `dist/` with zero syntax or bundling errors.
