# Integration Design Specification: Combining UBS System into Attendance Payroll Vue System

- **Date:** 2026-10-14
- **Status:** Approved
- **Target Stack:** Vue 3 (Vite, Bootstrap 5.3) Single-Page Application + Google Apps Script (`backend/GAS_payroll.js`) / Google Sheets Backend + Firebase Hosting

---

## 1. Executive Summary & Objective

This specification details the end-to-end integration of the classic Sage UBS Human Resource & Payroll capabilities into the modern **Attendance Payroll Vue** system (`SQHR`). 

The merged system will operate natively within the existing Vue 3 and Google Apps Script / Google Sheets serverless architecture. It unifies:
1. **Attendance Engine & Overtime Calculations** (punch card imports, OT rules, frozen rate locking).
2. **Latest Malaysian Statutory Deductions (2024–2026 Updates) with Explicit Act References & HR Editability** (EPF Act 452, amended SOCSO Act 4 RM 6,000 ceiling, amended EIS Act 800 RM 6,000 ceiling, and computerized LHDN PCB progressive tax calculation with Form TP1 reliefs).
3. **Metrio Group Induction Policy (FAM-23/G Jul 2025)** (Annual leave scale 12–26 days, dual-window carry-forward forfeiture, sick leave tiers, Flexi-Wellness limits, medical check-up, mileage, outstation meals, and Zero MC award).
4. **Pro-Rated Payroll Engine** (mid-month increments, working days formula, automated NPL deductions, automated medical claim reimbursements integrated into month locking).
5. **Fractional Leave Allocations & Automated Year-End Rollover** (decimal AL/NPL split, two-tier approval workflow, 14-day statutory carry-forward cap, 30-April excess forfeiture).
6. **360° Staff Profile Enquiry Dossier** (unified search across 5 operational tabs).
7. **Corporate Correspondence Letterhead Generator** (Increment, Confirmation, Transfer, Memo templates with official reference formatting).
8. **Statutory Regulations Display & Dynamic HR Policy Settings** (All statutory acts and company policies are visibly cited on relevant screens, and all rates, caps, ceilings, and parameters are stored in configurable tables fully editable by HR/Admin without code changes).

---

## 2. Architecture & File Distribution

```text
attendance-payroll-vue/
├── src/
│   ├── components/
│   │   ├── PayrollDashboard.vue     # Core attendance, punch card parsing, OT analysis, monthly lock
│   │   ├── HrWorkspace.vue          # Modular HR workspace (claims, loans, bookings, appraisals, letters, year-end)
│   │   ├── StatutorySettingsModal.vue # HR administration settings for statutory rates, ceilings & caps
│   │   ├── StaffDossierModal.vue    # 360° Staff Profile Enquiry (5-tab identity card)
│   │   ├── LetterGeneratorModal.vue # Corporate correspondence letterhead generator
│   │   ├── YearEndModal.vue         # Interactive Year-End roll-forward preview & commit
│   │   ├── InductionBenefits.vue    # Induction policy indicators & guidance
│   │   └── AccountMenu.vue          # Session & user role controls
│   ├── services/
│   │   ├── dashboard.js             # Attendance processing, statutory calculations, API bridge
│   │   ├── statutory.js             # Clean Malaysian statutory engine (EPF, SOCSO, EIS, PCB)
│   │   └── inductionPolicy.js       # FAM-23/G policy tables & rule validations
│   ├── hr/
│   │   ├── navigation.js            # Role-based sidebar menu definition
│   │   └── schema.js                # HR module metadata & form definitions
│   └── styles/
│       └── dashboard.css            # Base styles + print-ready `@media print` layouts
├── backend/
│   └── GAS_payroll.js               # Google Apps Script web app API (sheets persistence, session auth)
├── tests/
│   ├── backend.test.cjs             # Apps Script engine regression suite
│   ├── statutory.test.cjs           # EPF/SOCSO/EIS/PCB computation accuracy test suite
│   ├── induction.test.cjs           # FAM-23/G policy regression test suite
│   ├── leave-balances.test.cjs      # Fractional leave & carry-forward test suite
│   └── hr.test.cjs                  # HR workspace transitions & permissions test suite
└── docs/
    └── superpowers/specs/           # System design & architecture specifications
```

---

## 3. Malaysian Statutory Deduction Engine (Latest 2024–2026 Mandates)

A dedicated, isolated module (`src/services/statutory.js`) and mirrored Apps Script logic (`backend/GAS_payroll.js`) enforce official Malaysian regulations:

### 3.1 EPF (KWSP - Act 452)
- **Citizens & Permanent Residents (Age < 60):**
  - Monthly Wages $\le$ RM 5,000.00: **Employee 11%**, **Employer 13%**.
  - Monthly Wages $>$ RM 5,000.00: **Employee 11%**, **Employer 12%**.
- **Senior Citizens (Age $\ge$ 60):**
  - **Employee 0%**, **Employer 4%**.
- **Foreign Workers:**
  - Configurable toggle in Staff Master supporting the Budget 2025 phased mandatory contribution rules.
- **Rounding:** Standard rounding to nearest whole Ringgit / 0.01 per official KWSP Schedule.

### 3.2 SOCSO (PERKESO - Act 4)
- **Amended Monthly Wage Ceiling:** **RM 6,000.00** (effective 1 October 2024).
- **Category 1 (Employment Injury & Invalidity Scheme - Age < 60):**
  - Look up against official Act 4 Third Schedule (wages discretized in RM 100 wage bands).
  - Employee: $\sim 0.5\%$, capped at **RM 29.75**.
  - Employer: $\sim 1.75\%$, capped at **RM 104.15**.
  - Total Maximum: **RM 133.90**.
- **Category 2 (Employment Injury Scheme Only - Age $\ge$ 60):**
  - Employee: **RM 0.00** (0%).
  - Employer: $\sim 1.25\%$, capped at **RM 74.40**.

### 3.3 EIS (SIP - Act 800)
- **Amended Monthly Wage Ceiling:** **RM 6,000.00** (effective 1 October 2024).
- **Age < 60:** 0.2% Employee and 0.2% Employer, capped at **RM 11.90** each (total RM 23.80).
- **Age $\ge$ 60:** Strictly **exempt** (Employee RM 0.00, Employer RM 0.00).

### 3.4 LHDN Monthly Tax Deduction (PCB) & Form TP1 Reliefs
Computerized calculation adhering to LHDN Specifications for Monthly Tax Deduction:
1. **Net Chargeable Income ($P$):**
   $$P = \text{Gross Pay} - \min(\text{EPF Employee}, 333.33) - \text{TP1 Monthly Relief} - 750.00 \text{ (Individual Relief)}$$
2. **Annualized Income:** $\text{Annual } P = P \times 12$. If $\text{Annual } P \le 0$, $\text{PCB} = 0$.
3. **Progressive Brackets (YA 2024/2025/2026):**
   - RM 0 – 5,000: 0%
   - RM 5,001 – 20,000: 1%
   - RM 20,001 – 35,000: 3%
   - RM 35,001 – 50,000: 6%
   - RM 50,001 – 70,000: 11%
   - RM 70,001 – 100,000: 19%
   - RM 100,001 – 400,000: 25%
   - RM 400,001 – 600,000: 26%
   - RM 600,001 – 2,000,000: 28%
   - Above RM 2,000,000: 30%
4. **Individual Rebate (Section 6A Income Tax Act 1967):**
   - If $\text{Annual } P \le \text{RM } 35,000$, tax payable is reduced by **RM 400.00** (minimum 0).
5. **Monthly PCB:** $\text{Monthly PCB} = \frac{\text{Annual Tax}}{12}$ (rounded to 2 decimal places).
6. **Form TP1 Statutory Relief Categories & Annual Caps:**
   - Parent medical treatment: RM 8,000
   - Serious diseases medical treatment (incl dental RM 1,000): RM 10,000
   - Lifestyle general (books, computer, smartphone, internet): RM 2,500
   - Lifestyle sports (equipment, gym, competition): RM 1,000
   - Childcare fees (aged $\le 6$): RM 3,000
   - SSPN education savings: RM 8,000
   - Life insurance premiums: RM 3,000
   - Voluntary EPF contributions: RM 4,000
   - PRS / Deferred annuity: RM 3,000
   - Education & medical insurance: RM 3,000
   - EV charging facilities: RM 2,500
   - SOCSO / EIS employee relief: RM 350

### 3.5 Governing Regulations Display on UI Modules
Each module in the user interface will feature explicit statutory citations and regulatory badges to maintain legal transparency and compliance:
* **Payroll Overview & Payslips:**
  - Displays: `EPF Act 1991 (Act 452) · SOCSO Act 1969 (Act 4) · EIS Act 2017 (Act 800) · LHDN PCB (Income Tax Act 1967)`
* **Leave Management Portal:**
  - Displays: `Employment Act 1955 (Act 265) Part XII · Company Induction Manual (FAM-23/G Jul 2025)`
* **Overtime & Working Hours:**
  - Displays: `Employment Act 1955 Section 60A · Induction Policy Section 4.11`
* **Form TP1 Tax Relief Declarations:**
  - Displays: `LHDN Form TP1 (Income Tax Act 1967 Section 38(1A))`
* **Medical & Flexi-Wellness Claims:**
  - Displays: `Induction Policy Section 4.8 & 4.9 (FAM-23/G)`

### 3.6 Dynamic HR-Editable Configuration Center
To avoid hardcoding parameters that change across national budgets and corporate reviews, all statutory parameters and company policies are stored in a new Google Sheets tab `HR_statutorySettings` and managed through an interactive **Statutory & Policy Settings** modal in the HR Workspace (`HrWorkspace.vue` $\rightarrow$ Administration):

| Module / Scope | Governing Regulation / Source | Configurable Parameters Editable by HR |
| :--- | :--- | :--- |
| **SOCSO Ceiling** | Employees' Social Security Act 1969 (Act 4) | Maximum monthly wage ceiling (default `RM 6,000.00`). Updating the ceiling recalculates upper wage bands automatically. |
| **EIS Ceiling** | Employment Insurance System Act 2017 (Act 800) | Maximum monthly wage ceiling (default `RM 6,000.00`) and contribution rate (default `0.2%`). |
| **EPF Rates** | Employees Provident Fund Act 1991 (Act 452) | Employee standard rate (`11%`), employer $\le$ RM 5,000 rate (`13%`), employer $>$ RM 5,000 rate (`12%`), senior citizen employer rate (`4%`). |
| **PCB Tax & TP1 Caps** | Income Tax Act 1967 / LHDN Annual Guidelines | Standard individual relief (`RM 9,000`), individual tax rebate cap (`RM 400` for income $\le$ `RM 35,000`), EPF relief deduction cap (`RM 4,000`), and individual caps for each of the 12 Form TP1 categories. |
| **Overtime Rules** | Employment Act 1955 (Act 265) / FAM-23/G | Salary ceiling for OT entitlement (`RM 4,000`), site supervisor OT ceiling (`RM 7,000`), weekday rate (`1.5x`), rest day rate (`1.0x / 2.0x`), PH rate (`2.0x / 3.0x`), grace period (`15 mins`). |
| **Induction Benefits** | Metrio Induction Manual (FAM-23/G) | Flexi-Wellness limits by grade (`Grade S RM 1,500`, `Grade M RM 1,000`, `Grade E/C/W RM 600`), Medical Check-up limits (`S RM 800`, `M RM 500`), Mileage rates (`Car RM 0.50`, `Motorcycle RM 0.20`), Outstation meal daily allowance (`M RM 70`, `E RM 50`), and Zero MC award (`RM 300`). |

HR administrators can update any value at any time. When updated:
1. Changes take effect on the configured effective year/month without code modifications.
2. The change is audited and logged with timestamp and user ID in the `Audit History`.
3. Validation prevents invalid numbers (e.g. negative caps or rates exceeding 100%).

---

## 4. Metrio Group Induction Policy Implementation (FAM-23/G Jul 2025)

### 4.1 Annual Leave & Carry-Forward Dual Timeline
* **Entitlement Scale (Section 4.1):**
  - Year 1 of service: **12 days**.
  - Subsequent years: +1 day per year up to maximum **26 days**.
  - Tenure formula: $\text{Entitlement} = \min(26, 12 + \max(0, \text{Years of Service} - 1))$.
* **Dual-Window Carry-Forward Expiry & Forfeiture:**
  - $\le 14$ days carried forward: Valid until **31-December** of the following year.
  - $> 14$ days carried forward: The portion exceeding 14 days is strictly valid until **30-April** of the following year; any unutilized portion is automatically forfeited on 1-May.
* **Notice Period & Emergency Leave:**
  - Applications must be submitted $\ge 3$ working days in advance.
  - Applications submitted $< 3$ working days in advance are automatically flagged as **Emergency Leave (EL)**.
* **Half-Day Working Hours:**
  - Office Staff: 4.25 hours (excluding lunch break).
  - Site Staff: 4.00 hours.
  - Saturday leave (site-based): Counts as 1.0 full day.

### 4.2 Sick Leave & Special Leave Tiers (Section 4.2 & 4.3)
* **Outpatient Sick Leave (No Hospitalization):**
  - Service $< 2$ years: **14 days**.
  - Service $2$ to $< 5$ years: **18 days**.
  - Service $\ge 5$ years: **22 days**.
* **Hospitalization Leave:** **60 days** per calendar year (inclusive of rest days and public holidays).
* **Marriage Leave:** 7 consecutive calendar days for first legal marriage (confirmed, $\ge 1$ year service; verified with marriage certificate).
* **Compassionate Leave:** 4 consecutive calendar days on death of spouse, natural parents, natural siblings, natural grandparents, or parents-in-law (confirmed employees).
* **Maternity Leave:** 98 calendar days (min 90 days service; max 5 surviving children).
* **Paternity Leave:** 7 consecutive calendar days (confirmed, $\ge 1$ year service, within 1 week of birth).

### 4.3 Overtime Rules & Rounding (Section 4.11)
* **Salary $\le$ RM 4,000 (Office & Site):**
  - Normal Weekday OT: **1.5x** hourly rate.
  - Rest Day: First 8 hours at **1.0x** rate; subsequent hours at **2.0x** rate.
  - Public Holidays (18 gazetted days): First 8 hours at **2.0x** rate; subsequent hours at **3.0x** rate.
* **Site Staff with Salary RM 4,001 – RM 7,000:**
  - Mon–Sat OT: Flat **1.0x** rate.
  - Sunday & Public Holidays: Flat **1.0x** rate throughout.
* **Office Staff with Salary $>$ RM 4,000:** Not entitled to overtime claim.
* **Overtime Rounding:**
  - Minimum qualification: 1.0 hour.
  - Subsequent time: Office rounds by 15 mins (15–29m = 0.25h; 30–44m = 0.50h; 45–59m = 0.75h); Site rounds by 30 mins (0.50h).
* **Night Casting & Piling Rest Hours (Section 3.13):**
  - Site staff working past 9:00pm receive 12 hours rest before next day shift (e.g. duty till 10:37pm $\rightarrow$ next day start at 10:00am without lateness penalty).

### 4.4 Benefit Claims & Outstation Allowances (Section 4.8, 4.9, 4.12, 4.13, 4.14)
* **Flexi-Wellness Annual Limit:**
  - Grade S: **RM 1,500.00**
  - Grade M: **RM 1,000.00**
  - Grade E / C / W: **RM 600.00**
  - Reimburses Outpatient Medical, Dental, and Optical. Cutoff: 20th of month.
* **Medical Check-Up Annual Limit (Confirmed, $\ge 1$ year service):**
  - Grade S: **RM 800.00**
  - Grade M: **RM 500.00**
  - Grades E, C, W: Not entitled.
* **Mileage Claims:**
  - Motorcar: **RM 0.50 / km**
  - Motorcycle: **RM 0.20 / km**
* **Outstation Meal Allowance ($> 250\text{ km}$ from employment base):**
  - Grade S: Full reimbursement with receipt.
  - Grade M: Max **RM 70.00 / day** (Breakfast RM 15, Lunch RM 25, Dinner RM 30).
  - Grade E: Max **RM 50.00 / day** (Breakfast RM 10, Lunch RM 20, Dinner RM 20).
* **Zero MC Award:**
  - Employees with **0 medical leave days across the full calendar year** receive a **RM 300.00** award in the December payroll.

---

## 5. Pro-Rated Payroll Calculation & Integrated Month-Locking Workflow

### 5.1 Working Days & Pro-Rating Formula
Standard monthly working days = **26 days** (or actual days in month for daily-rated staff).

1. **Mid-Month Increment / New Joiner Pro-Rating:**
   - If join date is mid-month or increment effective day $> 1$:
     $$\text{Pro-Rated Basic} = \left(\frac{\text{Old Basic}}{26} \times (\text{Effective Day} - 1)\right) + \left(\frac{\text{New Basic}}{26} \times (26 - \text{Effective Day} + 1)\right)$$
2. **Automated Unpaid Leave (NPL) Deduction:**
   - Sums approved NPL days and fractional unpaid days in the month:
     $$\text{NPL Deduction} = \frac{\text{Pro-Rated Basic}}{26} \times \text{Unpaid Days}$$
3. **Gross Pay:**
   $$\text{Gross Pay} = \text{Pro-Rated Basic} - \text{NPL Deduction} + \text{OT Pay} + \text{Allowances}$$
4. **Statutory Deductions:**
   - Evaluated via Section 3 on Gross Pay (EPF, SOCSO, EIS, PCB).
5. **Automated Claim Reimbursements:**
   - Approved non-reimbursed claims from `HR_claims` for this employee are added to total payout.
   - Claims are marked as `Paid` referencing the payroll month.
6. **Net Pay:**
   $$\text{Net Pay} = \text{Gross Pay} - (\text{EPF} + \text{SOCSO} + \text{EIS} + \text{PCB} + \text{Advance}) + \text{Approved Claims Reimbursement}$$

### 5.2 Month-Locking Integration
When an administrator clicks **"Freeze / Lock Month"** on the Attendance Dashboard:
1. Validates attendance records and frozen OT rates.
2. Queries approved unpaid leave records for the period and computes NPL deductions.
3. Queries approved claims submitted on or before the 20th of the month.
4. Executes the updated statutory engine (EPF, SOCSO, EIS, PCB).
5. Commits itemized rows into the `Payroll` sheet tab:
   `[Month, Name, Basic, ProRatedBasic, NplDays, NplDeduction, OtHours, OtPay, Allowances, ClaimsReimbursement, GrossPay, EpfEmp, EpfEmpr, SocsoEmp, SocsoEmpr, EisEmp, EisEmpr, PcbTax, NetPay]`.
6. Generates individual PDF payslips ready for employee download and Drive archiving.

---

## 6. Fractional Leave & Automated Year-End Rollover

### 6.1 Fractional Leave (AL / NPL Split)
* When an employee applies for leave with insufficient Annual Leave balance:
  - Form allows entering total days with automatic or manual fractional split down to 2 decimal places (e.g. Applied: 1.00 $\rightarrow$ Annual Leave: 0.16, Unpaid Leave: 0.84).
  - Validation ensures `annual_days` does not exceed available AL balance.
  - Approved `annual_days` deducts from the annual leave balance; approved `unpaid_days` automatically feeds into that month's payroll as NPL deduction.
* **Two-Tier Approval:**
  - HOD recommends / rejects.
  - HR / Superadmin approves / rejects.

### 6.2 Interactive Year-End Rollover
* Accessible under **HR Workspace $\rightarrow$ Administration $\rightarrow$ Year-End Processing**.
* **Step 1 (Reconciliation & Preview):**
  - User selects company and target years (e.g., $2026 \rightarrow 2027$).
  - System generates preview table displaying:
    `Employee | Years Service | 2026 Entitlement | 2026 Taken | Remaining | Standard CF (Max 14d) | Excess CF (Exp 30-Apr) | 2027 New Entitlement | Total 2027 AL`.
* **Step 2 (Commit Rollover):**
  - Creates new `leaveOpeningBalances` rows for the new year.
  - Logs action to immutable `Audit History`.

---

## 7. 360° Staff Profile Enquiry Dossier

A modal dialog accessible from Employee Management (`staff-mgmt`) and HR Workspace:
* **Search Filters:** Fast auto-complete by Employee Name, Employee No, IC No, Email, or Job Title.
* **5-Tab Comprehensive Dossier:**
  1. **Leave Balances & History:** Annual, Medical, Hospitalization balances, carry-forward expiry dates, and recent approved/pending leave requests.
  2. **Claims & Reimbursements:** Lifetime and year-to-date claim history, receipt links, flexi-wellness pool utilization against policy caps, and payment references.
  3. **Payroll & Payslip History:** Historical monthly basic, OT, statutory deductions (EPF, SOCSO, EIS, PCB), net pay, and one-click payslip viewing.
  4. **Assets & Resource Bookings:** Assigned company equipment, pool vehicle bookings, and condition history.
  5. **Issued Correspondence Letters:** Official corporate letters issued to the employee with viewing and reprint options.

---

## 8. Corporate HR Correspondence Letterhead Generator

Accessible under **HR Workspace $\rightarrow$ People $\rightarrow$ Letters & Correspondence $\rightarrow$ "New Letter"**:
* **Pre-Built Corporate Templates:**
  1. **Salary Increment Letter:** Auto-populates old basic, increment amount, effective date, and new basic salary.
  2. **Employment Confirmation Letter:** Auto-populates probationary period, confirmation effective date, revised designation, and terms.
  3. **Transfer & Secondment Letter:** Formatted for transfer across Metrio Group subsidiaries or job redeployment.
  4. **Internal Memorandum:** General administrative notice.
* **Standard Corporate Letterhead & Sign-Off:**
  - Incorporates Company Name, Registration No, and Registered Address.
  - Generates standardized reference code: `HR/{TEMPLATE}/{YEAR}/{EMPLOYEE_NO}`.
  - Styled with CSS `@media print` for high-resolution hard-copy printing and PDF export.

---

## 9. Backend Data Schema & Apps Script (`GAS_payroll.js`) Updates

### 9.1 Google Sheets Tab Structures
* **`Staff` Sheet:** Columns expanded/preserved safely to include `Age`, `JoinDate`, `ConfirmationDate`, `WorkBase` (`Office`/`Site`), `JobGrade` (`S`/`M`/`E`/`C`/`W`), `EpfNo`, `SocsoNo`, `TaxNo`, `BankName`, `BankNo`, `FolderId`, `FolderUrl`.
* **`Payroll` Sheet:** Itemized columns updated to persist `NplDays`, `NplDeduction`, `PcbTax`, `ClaimsReimbursement`, and `EmployerContributions`.
* **`HR_claims` Sheet:** Added `payoutMonth` and `payoutPayrollId` fields.
* **`HR_leave` / `Leave` Sheet:** Added support for `fractionalSplit` (`annualDays`, `unpaidDays`).
* **`HR_leaveOpeningBalances` Sheet:** Stores carry-forward buckets (`cfStandard`, `cfExcess`, `expiryDate`).

### 9.2 Apps Script Endpoints
- `getBootstrap`: Returns session actor, staff directory, statutory metadata, and policy tables in 1 optimized read.
- `lockMonth`: Runs the unified pro-rated payroll engine, statutory calculator, and claims payout linking under a script lock.
- `getStaffDossier`: Compiles 360° summary data for a requested employee across sheets in one call.
- `previewYearEndClose` & `executeYearEndClose`: Generates carry-forward projections and creates new-year openings.

---

## 10. Verification & Test Plan

1. **Statutory Precision Unit Tests (`tests/statutory.test.cjs`):**
   - Verify EPF rates for wages $\le$ RM 5,000 (11%/13%), $>$ RM 5,000 (11%/12%), and age $\ge$ 60 (0%/4%).
   - Verify SOCSO Act 4 Third Schedule matching up to RM 6,000 ceiling (Cat 1 vs Cat 2).
   - Verify EIS Act 800 RM 6,000 ceiling and age $\ge$ 60 exemption.
   - Verify LHDN PCB computerized progressive calculation against benchmark tax cases with Form TP1 reliefs.
2. **Induction Policy Tests (`tests/induction.test.cjs`):**
   - Annual leave tenure scale ($1 \rightarrow 12$, $5 \rightarrow 16$, $15 \rightarrow 26$ days).
   - Dual carry-forward expiration (14-day standard vs 30-April excess forfeiture).
   - Flexi-wellness and medical check-up annual cap validations.
   - Overtime rates and rounding (Office 15-min vs Site 30-min; RM 4,000 and RM 7,000 thresholds).
   - Zero MC award eligibility in year-end payroll.
3. **End-to-End Payroll & UI Regression (`tests/backend.test.cjs`, `tests/hr.test.cjs`):**
   - Simulate punch card upload $\rightarrow$ OT calculation $\rightarrow$ month lock $\rightarrow$ pro-rated basic $\rightarrow$ NPL deduction $\rightarrow$ claims reimbursement $\rightarrow$ payslip issuance.
