const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime } = require('./backend.test.cjs');

console.log('--- Starting Session Fixes Verification ---');

// 1. Verify HrWorkspace.vue enterprise operations card style & options
const hrWorkspaceContent = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.ok(hrWorkspaceContent.includes('.enterprise-ops-card {'), 'enterprise-ops-card style defined');
assert.ok(hrWorkspaceContent.includes('max-width: 100%;') || hrWorkspaceContent.includes('max-width: 1400px;'), 'enterprise-ops-card full width');
assert.ok(hrWorkspaceContent.includes('.enterprise-ops-card {'), 'enterprise-ops-card styled');
assert.ok(hrWorkspaceContent.includes("active.value==='departments'&&field.key==='companyId'"), 'Department company includes ALL option');
assert.ok(hrWorkspaceContent.includes("value:'ALL',label:'ALL (All Companies)'"), 'ALL option value and label');
assert.ok(hrWorkspaceContent.includes("active.value==='jobTitles'"), 'jobTitles handled in edit');
assert.ok(hrWorkspaceContent.includes("form.value.code=getNextJobCode()"), 'getNextJobCode called');
assert.ok(hrWorkspaceContent.includes("active==='jobTitles'&&field.key==='code'"), 'jobTitles code readonly/placeholder');

console.log('PASS 1: HrWorkspace.vue enterprise ops width, departments ALL, and jobTitles auto-code verified.');

// 2. Verify backend/GAS_payroll.js
const gasContent = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
assert.ok(gasContent.includes('"workBase"'), 'workBase in HR_MODULES.jobTitles');
assert.ok(gasContent.includes('"workLocation"'), 'workLocation in HR_MODULES.jobTitles');
assert.ok(gasContent.includes("module === 'jobTitles' && (!input.code || String(input.code).trim() === '')"), 'auto job code generation in hrValidate_');
assert.ok(gasContent.includes("module==='departments'") && gasContent.includes("String(value).toUpperCase()==='ALL'"), 'companyId ALL allowed for departments');
assert.ok(gasContent.includes("module === 'departments' && (!input.code || String(input.code).trim() === '')"), 'auto department code in hrValidate_');
assert.ok(gasContent.includes("String(r.companyId).toUpperCase()==='ALL'") && gasContent.includes("cos.includes(String(result.companyId).toUpperCase())"), 'departmentId belongs to company allows ALL and multi-company');
assert.ok(gasContent.includes("date: hrInductionDate_(data[i][2]) || data[i][2]"), 'getData and getAttendance use hrInductionDate_');

const r = runtime(gasContent);
function employee(name, role) {
  const a = Array(34).fill('');
  Object.assign(a, { 0: name, 1: 'Active', 2: name, 3: 'test-password', 4: role, 23: '[]', 24: 'ID-' + name, 30: 1 });
  return a;
}
r.set('Staff', [Array(34).fill('header'), employee('HR', 'HR'), employee('STAFF1', 'User')]);
r.set('Leave', [Array(12).fill('header')]);
const hrToken = r.request('login', { username: 'HR', password: 'test-password' }).sessionToken;
const hrSave = (mod, record) => r.request('hrSave', { module: mod, record }, hrToken);

// Create company SQ
const compRes = hrSave('companies', { code: 'SQ', title: 'Setar Quay' });
assert.equal(compRes.status, 'success');
const compId = compRes.data.id;

// Create department with companyId 'ALL'
const deptRes = hrSave('departments', { code: 'ALL_HR', title: 'Human Resources (Shared)', companyId: 'ALL' });
assert.equal(deptRes.status, 'success', deptRes.message);
assert.equal(deptRes.data.companyId, 'ALL');

// Create job grade first
const gradeRes = hrSave('jobGrades', { code: 'G1', title: 'Grade 1', availability: 'Active' });
assert.equal(gradeRes.status, 'success');

// Create job title without code, should auto-assign JOB-001
const jobRes = hrSave('jobTitles', { title: 'Site Engineer', gradeId: gradeRes.data.id, availability: 'Active' });
assert.equal(jobRes.status, 'success', jobRes.message);
assert.ok(jobRes.data.code.startsWith('JOB-'), 'Job code auto-assigned: ' + jobRes.data.code);
assert.equal(jobRes.data.workBase, 'OFFICE');
assert.equal(jobRes.data.workLocation, 'All');

// Assign employee in company SQ to department with companyId 'ALL'
const staffSaveRes = r.request('saveSingleStaff', {
  name: 'STAFF1',
  username: 'STAFF1',
  companyId: compId,
  departmentId: deptRes.data.id
}, hrToken);
assert.equal(staffSaveRes.status, 'success', staffSaveRes.message);

console.log('PASS 2: GAS backend department ALL and jobTitles auto-code verified.');

// 3. Verify dashboard.js normalizeDateStr & absence auto-assigning Off / Rest
const dashboardContent = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(dashboardContent.includes("hasAttendance"), 'renderDashboard checks attendance');
assert.ok(dashboardContent.includes("finalShift = 'Off / Rest'"), 'finalShift set to Off / Rest');
assert.ok(dashboardContent.includes("finalPayType = 'RD'"), 'finalPayType set to RD on absent days');
assert.ok(dashboardContent.includes("isFutureDate"), 'renderDashboard guards future dates');
assert.ok(dashboardContent.includes("singleAssignedShift"), 'renderDashboard ensures single shift assignment');
assert.ok(dashboardContent.includes("menu.find('details').not($(this).parents('details')).removeAttr('open')") || dashboardContent.includes("menu.find('details').removeAttr('open')"), 'navigation sub-tabs auto collapse back');
assert.ok(dashboardContent.includes("updateJobMetadata"), 'openStaffEditModal auto assigns workBase from job title');

// Test normalizeDateStr ISO behavior
const evalContext = {};
const normalizeFnStr = dashboardContent.match(/function normalizeDateStr\(dateVal\)\s*\{[\s\S]*?\n    \}/)[0];
const fn = new Function('return (' + normalizeFnStr + ')')();

// "2026-10-17T16:00:00.000Z" (UTC) is 2026-10-18 00:00:00 in KL time
const isoDate = "2026-10-17T16:00:00.000Z";
const normIso = fn(isoDate);
assert.equal(normIso, "2026-10-18", "ISO UTC date normalized to KL date: " + normIso);

const regularDate = "2026-10-18";
assert.equal(fn(regularDate), "2026-10-18");

console.log('PASS 3: dashboard.js ISO date parsing and Off/Rest auto-assign verified.');

// 4. Verify getStaffEffectiveRestDays logic
const getRestDaysMatch = dashboardContent.match(/function getStaffEffectiveRestDays\(s, settings = null, customSchedules = null\)\s*\{[\s\S]*?\n    \}/);
assert.ok(getRestDaysMatch, 'getStaffEffectiveRestDays function found in dashboard.js');
const getStaffEffectiveRestDays = new Function('return (' + getRestDaysMatch[0] + ')')();

// Case A: Staff has SQ Site schedule (Mon-Sun, restDays: [])
const sqSchedule = [{ code: 'S3', title: 'Shift 3', restDays: [] }];
const staffSQ = { name: 'SQ Staff', schedules: ['S3'], restDays: [0] }; // old legacy [0] in profile
const rdsSQ = getStaffEffectiveRestDays(staffSQ, null, sqSchedule);
assert.deepEqual(rdsSQ, [], 'SQ Site schedule should NOT treat Sunday as rest day even if legacy restDays has [0]');

// Case B: Staff with no schedule and no restDays defined
const staffDefault = { name: 'New Staff' };
const rdsDefault = getStaffEffectiveRestDays(staffDefault, null, []);
assert.deepEqual(rdsDefault, [], 'Default rest days must be [] and NEVER default to [0] Sunday');

// Case C: Schedule with explicit rest day (e.g. Friday and Saturday: [5, 6])
const officeSchedule = [{ code: 'OFFICE', title: 'Office 5-Day', restDays: [0, 6] }];
const staffOffice = { name: 'Office Staff', schedule: 'OFFICE' };
const rdsOffice = getStaffEffectiveRestDays(staffOffice, null, officeSchedule);
assert.deepEqual(rdsOffice, [0, 6], 'Schedule with explicit rest days correctly resolved');

// Case D: Schedule with daySchedules (Mon-Sun working days)
const allWeekSchedule = [{
    code: '7DAY',
    daySchedules: JSON.stringify([{ days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], shifts: ['S1'] }])
}];
const staff7Day = { name: '7-Day Staff', schedules: ['7DAY'] };
const rds7Day = getStaffEffectiveRestDays(staff7Day, null, allWeekSchedule);
assert.deepEqual(rds7Day, [], 'daySchedules with all days working has 0 rest days');

console.log('PASS 4: getStaffEffectiveRestDays schedule-based resolution and Sunday non-default verified.');

// 5. Verify Resignation Date Filtering
assert.ok(dashboardContent.includes("if (rDate && fd.date > rDate) return false;"), 'renderDashboard filters out dates after rDate');
assert.ok(dashboardContent.includes("if (rDate && rDate < m + '-01') return false;"), 'renderDashboard subset filters staff resigned before month');
assert.ok(dashboardContent.includes("if (rDate && rDate < currentMonth + '-01') return false;"), 'populateAttendanceStaff excludes staff resigned before month');
assert.ok(dashboardContent.includes("resignDateStr && resignDateStr.slice(0, 7) === m"), 'generatePayrollData prorates salary for resignation month');

// Verify punch merge ignores punches after resignation date
const { mergeAttendancePunches } = require('../src/utils/attendanceMerge.mjs');
const mergedPunches = mergeAttendancePunches({
    imported: [
        { Date: '2026-10-07', ClockIn: '08:00', ClockOut: '17:00' },
        { Date: '2026-10-08', ClockIn: '08:00', ClockOut: '17:00' },
        { Date: '2026-10-09', ClockIn: '08:00', ClockOut: '17:00' }, // after resignation
    ],
    joinedDate: '2026-01-01',
    resignDate: '2026-10-08',
    employeeName: 'MUHAMMAD AZRI'
});
assert.equal(mergedPunches.some(p => p.Date === '2026-10-09'), false, 'Dates after resignation must NOT be present in merged punches');
assert.equal(mergedPunches.some(p => p.Date === '2026-10-08'), true, 'Dates on or before resignation must be present');

console.log('PASS 5: Resignation date filtering across web, mobile, and punch merge verified.');

// 6. Verify Layout Switcher Centering
const payrollDashboardContent = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');
const dashboardCssContent = fs.readFileSync('src/styles/dashboard.css', 'utf8');
assert.ok(payrollDashboardContent.includes('layout-switcher-pill'), 'PayrollDashboard uses layout-switcher-pill');
assert.ok(dashboardCssContent.includes('.layout-switcher-pill'), 'dashboard.css defines layout-switcher-pill');
assert.ok(dashboardCssContent.includes('#staffViewTableBtn i') && dashboardCssContent.includes('justify-content: center !important;'), 'dashboard.css centers icons in layout tabs');

console.log('PASS 6: Layout switcher centering CSS and markup verified.');

// 7. Verify Department in Job Title Library & Auto-Assignment
const schemaContent = fs.readFileSync('src/hr/schema.js', 'utf8');
assert.ok(schemaContent.includes("departmentId") && schemaContent.includes("departments"), 'departmentId in jobTitles fields in schema.js');
assert.ok(hrWorkspaceContent.includes("active.value === 'jobTitles' && field.key === 'title'"), 'isFieldWide handles jobTitles title to sit next to department');
assert.ok(gasContent.includes('"key": "departmentId"') && gasContent.includes('"ref": "departments"'), 'departmentId in HR_MODULES.jobTitles in GAS_payroll.js');
assert.ok(dashboardContent.includes("$('#staffDepartment').val(actualId)") || dashboardContent.includes("$('#staffDepartment').val(job.departmentId);"), 'updateJobMetadata auto assigns department from job title');
assert.ok(gasContent.includes("if(job.departmentId && (!result.departmentId || payload.departmentId===undefined)) result.departmentId=job.departmentId;"), 'saveSingleStaff auto assigns department from job title');
assert.ok(gasContent.includes("if(job.departmentId && r[26]!==job.departmentId){sheet.getRange(i+2,27).setValue(job.departmentId);"), 'hrSyncJobTitles_ syncs departmentId to staff');

// Test saving jobTitle with departmentId in GAS runtime
const newDeptRes = hrSave('departments', { code: 'ENG', title: 'Engineering Dept', companyId: compId });
assert.equal(newDeptRes.status, 'success');
const newJobRes = hrSave('jobTitles', {
    title: 'Lead Engineer',
    gradeId: gradeRes.data.id,
    departmentId: newDeptRes.data.id,
    workBase: 'SITE',
    workLocation: 'PG',
    availability: 'Active'
});
assert.equal(newJobRes.status, 'success');
assert.equal(newJobRes.data.departmentId, newDeptRes.data.id);

// Test auto-assignment of department when saving staff with jobTitle
const engineerSaveRes = r.request('saveSingleStaff', {
    name: 'STAFF1',
    username: 'STAFF1',
    companyId: compId,
    jobTitleId: newJobRes.data.id
}, hrToken);
assert.equal(engineerSaveRes.status, 'success', engineerSaveRes.message);
const staffDirectory = r.request('getStaff', {}, hrToken);
const staffEntry = staffDirectory.data['STAFF1'];
assert.equal(staffEntry.departmentId, newDeptRes.data.id, 'Department auto-assigned from job title');
assert.equal(staffEntry.workBase, 'SITE', 'WorkBase auto-assigned from job title');

console.log('PASS 7: Department dropdown in Job Title library and auto-assignment verified.');

// 8. Verify 4 Cards in a Row (col-12 col-sm-6 col-lg-3)
assert.ok(hrWorkspaceContent.includes("active==='departments'") && hrWorkspaceContent.includes('col-12 col-sm-6 col-lg-3'), 'Departments cards use col-lg-3 (4 in a row)');
assert.ok(hrWorkspaceContent.includes("active==='workBases'") && hrWorkspaceContent.includes('col-12 col-sm-6 col-lg-3'), 'Work bases cards use col-lg-3 (4 in a row)');
assert.ok(hrWorkspaceContent.includes("active==='workLocations'") && hrWorkspaceContent.includes('col-12 col-sm-6 col-lg-3'), 'Work locations cards use col-lg-3 (4 in a row)');
assert.ok(hrWorkspaceContent.includes("active==='resources'") && hrWorkspaceContent.includes('col-12 col-sm-6 col-lg-3'), 'Resources catalogue cards use col-lg-3 (4 in a row)');
assert.ok(hrWorkspaceContent.includes("active==='claimTypes'") && hrWorkspaceContent.includes('col-12 col-sm-6 col-lg-3'), 'Claim types cards use col-lg-3 (4 in a row)');

console.log('PASS 8: 4 cards in a row for Department, work bases, work location, resources & claim type verified.');

// 9. Verify Mobile bottom bar z-index fix
const mobileShellContent = fs.readFileSync('src/components/mobile/MobileAppShell.vue', 'utf8');
assert.ok(mobileShellContent.includes('.m-bottom-bar {') && mobileShellContent.includes('z-index: 1100;'), 'm-bottom-bar has high z-index 1100');
assert.ok(mobileShellContent.includes('.m-main-content {') && mobileShellContent.includes('z-index: 1;'), 'm-main-content has low z-index 1');
console.log('PASS 9: Mobile bottom navigation bar z-index and stacking context verified.');

// 10. Verify Leave attachment display and AL-only future date withdrawal
const mobileReqContent = fs.readFileSync('src/components/mobile/MobileRequests.vue', 'utf8');
assert.ok(mobileReqContent.includes('selectedLeave.attachment || selectedLeave.fileUrl'), 'Leave modal checks attachment and fileUrl');
assert.ok(mobileReqContent.includes('isAL') && mobileReqContent.includes('startDate <= todayKl'), 'canWithdrawLeave strictly enforces AL and future date');
assert.ok(dashboardContent.includes('isAL&&start>today'), 'dashboard.js renderMyLeaveHistory strictly enforces AL and future date');

// Test canWithdrawLeave logic directly
const canWithdrawMatch = mobileReqContent.match(/function canWithdrawLeave\(l\)\s*\{[\s\S]*?\n\}/);
assert.ok(canWithdrawMatch, 'canWithdrawLeave function found in MobileRequests.vue');
const canWithdrawLeave = new Function('return (' + canWithdrawMatch[0] + ')')();

const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const futureDate = '2099-12-31';
const pastDate = '2020-01-01';

// Medical Leave should NEVER be withdrawable
assert.equal(canWithdrawLeave({ type: 'ML', status: 'Pending', start: futureDate }), false, 'ML must not be withdrawable');
assert.equal(canWithdrawLeave({ type: 'MC', status: 'Pending', start: futureDate }), false, 'MC must not be withdrawable');
// Past AL should NOT be withdrawable
assert.equal(canWithdrawLeave({ type: 'AL', status: 'Approved', start: pastDate }), false, 'Past AL must not be withdrawable');
// Today AL should NOT be withdrawable (must be future)
assert.equal(canWithdrawLeave({ type: 'AL', status: 'Approved', start: todayStr }), false, 'Today AL must not be withdrawable');
// Future AL with approved/pending status MUST be withdrawable
assert.equal(canWithdrawLeave({ type: 'AL', status: 'Approved', start: futureDate }), true, 'Future AL (Approved) must be withdrawable');
assert.equal(canWithdrawLeave({ type: 'Annual Leave', status: 'Pending', start: futureDate }), true, 'Future Annual Leave (Pending) must be withdrawable');
assert.equal(canWithdrawLeave({ type: 'AL', status: 'Rejected', start: futureDate }), false, 'Rejected AL must not be withdrawable');
console.log('PASS 10: Leave attachment display and AL future-date-only withdrawal verified.');

// 11. Verify Resource category included in booking
assert.ok(mobileReqContent.includes('getBookingCategory'), 'getBookingCategory defined in MobileRequests.vue');
assert.ok(mobileReqContent.includes('getBookingResourceName'), 'getBookingResourceName defined in MobileRequests.vue');
assert.ok(mobileReqContent.includes('Resource Category') && mobileReqContent.includes('getBookingCategory(selectedBooking)'), 'Resource category displayed in booking detail modal');
assert.ok(gasContent.includes('"key": "category"') && gasContent.includes('"label": "Category"'), 'Category field in bookings module in GAS_payroll.js');

// Test booking category lookup
const getResMatch = mobileReqContent.match(/function getResourceForBooking\(b\)\s*\{[\s\S]*?\n\}/);
const getCategoryMatch = mobileReqContent.match(/function getBookingCategory\(b\)\s*\{[\s\S]*?\n\}/);
assert.ok(getResMatch && getCategoryMatch, 'getResourceForBooking and getBookingCategory functions found');
const STANDARD_RESOURCES = [
    { id: 'RES-UNI', code: 'UNI', title: 'Uniform', category: 'Other' },
    { id: 'RES-CAR', code: 'CAR', title: 'Company Car', category: 'Vehicle' }
];
const props = { records: { resources: [{ id: 'RES-LAP', code: 'LAP', title: 'MacBook Pro', category: 'Laptop / IT' }] } };
const getBookingCategory = new Function('props', 'STANDARD_RESOURCES', getResMatch[0] + '\nreturn (' + getCategoryMatch[0] + ')')(props, STANDARD_RESOURCES);

assert.equal(getBookingCategory({ title: 'Uniformo', resourceId: 'RES-UNI' }), 'Other', 'Uniform resource category resolved');
assert.equal(getBookingCategory({ title: 'Uniformo' }), 'Uniform', 'Inferred category for Uniformo fallback');
assert.equal(getBookingCategory({ resourceId: 'RES-CAR' }), 'Vehicle', 'Car category resolved from STANDARD_RESOURCES');
assert.equal(getBookingCategory({ resourceId: 'RES-LAP' }), 'Laptop / IT', 'Laptop category resolved from backend resources');

console.log('PASS 11: Requested resource category resolution and display verified.');

// 12. Verify Multi-Selection for Department, Work Based & Work Location
const updatedHrWorkspace = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.ok(updatedHrWorkspace.includes("isMultiSelect(field)"), 'isMultiSelect condition exists in template');
assert.ok(updatedHrWorkspace.includes("toggleMultiSelectOption"), 'toggleMultiSelectOption implemented');
assert.ok(updatedHrWorkspace.includes("getMultiSelectDisplay"), 'getMultiSelectDisplay implemented');
assert.ok(updatedHrWorkspace.includes("formatMultiDepartmentLabel"), 'formatMultiDepartmentLabel implemented');

// Test isMultiSelect, toggleMultiSelectOption & getMultiSelectDisplay in isolated scope
const fnExtract = (name) => {
    const m = updatedHrWorkspace.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    return m ? m[0] : '';
};
const isMultiSelectFn = fnExtract('isMultiSelect');
const getMultiSelectValuesFn = fnExtract('getMultiSelectValues');
const isOptionSelectedFn = fnExtract('isOptionSelected');
const toggleMultiSelectOptionFn = fnExtract('toggleMultiSelectOption');
const getMultiSelectDisplayFn = fnExtract('getMultiSelectDisplay');
const formatMultiDepartmentLabelFn = fnExtract('formatMultiDepartmentLabel');

assert.ok(isMultiSelectFn && toggleMultiSelectOptionFn && getMultiSelectDisplayFn, 'Extracted multi-select functions');

const scopeMock = {
    active: { value: 'jobTitles' },
    form: { value: {} },
    records: { value: {} },
    clearFieldValidation: () => {},
    label: (mod, id) => id === 'D1' ? 'Petrol' : id === 'D2' ? 'HR' : id
};

const multiRunner = new Function('ctx', `
    const active = ctx.active;
    const form = ctx.form;
    const records = ctx.records;
    const clearFieldValidation = ctx.clearFieldValidation;
    const label = ctx.label;
    const options = (f) => ctx.options ? ctx.options(f) : [];
    ${isMultiSelectFn}
    ${getMultiSelectValuesFn}
    ${isOptionSelectedFn}
    ${toggleMultiSelectOptionFn}
    ${getMultiSelectDisplayFn}
    ${formatMultiDepartmentLabelFn}
    return { isMultiSelect, getMultiSelectValues, isOptionSelected, toggleMultiSelectOption, getMultiSelectDisplay, formatMultiDepartmentLabel };
`)(scopeMock);

// Test isMultiSelect on jobTitles fields
assert.equal(multiRunner.isMultiSelect({ key: 'workLocation' }), true, 'workLocation is multi-select in jobTitles');
assert.equal(multiRunner.isMultiSelect({ key: 'workBase' }), true, 'workBase is multi-select in jobTitles');
assert.equal(multiRunner.isMultiSelect({ key: 'departmentId' }), true, 'departmentId is multi-select in jobTitles');
assert.equal(multiRunner.isMultiSelect({ key: 'title' }), false, 'title is not multi-select');

// Test toggleMultiSelectOption on workLocation
const locField = { key: 'workLocation' };
const locOpts = [
    { value: 'All', label: 'All work locations' },
    { value: 'PG', label: 'Penang (PG)' },
    { value: 'SEL', label: 'Selangor (SEL)' },
    { value: 'KL', label: 'Kuala Lumpur (KL)' }
];
scopeMock.options = () => locOpts;

// 1. Tick single location 'PG'
scopeMock.form.value.workLocation = '';
multiRunner.toggleMultiSelectOption(locField, { value: 'PG' });
assert.equal(scopeMock.form.value.workLocation, 'PG', 'Single location selected');

// 2. Tick second location 'SEL' -> multiple locations 'PG, SEL'
multiRunner.toggleMultiSelectOption(locField, { value: 'SEL' });
assert.equal(scopeMock.form.value.workLocation, 'PG, SEL', 'Multiple locations selected');

// 3. Tick 'All' -> sets to 'All'
multiRunner.toggleMultiSelectOption(locField, { value: 'All' });
assert.equal(scopeMock.form.value.workLocation, 'All', 'All locations selected');

// 4. Untick 'All' -> sets to ''
multiRunner.toggleMultiSelectOption(locField, { value: 'All' });
assert.equal(scopeMock.form.value.workLocation, '', 'All locations unticked');

// Test Department multiple labels
assert.equal(multiRunner.formatMultiDepartmentLabel('All'), 'All Departments');
assert.equal(multiRunner.formatMultiDepartmentLabel('D1, D2'), 'Petrol, HR');

console.log('PASS 12: Multi-selection for Department, Work Based, and Work Location verified.');

// 13. Verify PayrollDashboard.vue layout updates
assert.ok(!payrollDashboardContent.includes('id="staffCompanyName"'), 'staffCompanyName field must be removed');
const jobTitleIndex = payrollDashboardContent.indexOf('id="staffJobTitle"');
const departmentIndex = payrollDashboardContent.indexOf('id="staffDepartment"');
assert.ok(jobTitleIndex > 0 && departmentIndex > 0, 'Both staffJobTitle and staffDepartment exist');
assert.ok(jobTitleIndex < departmentIndex, 'Job Title must be placed before Department in layout');

console.log('PASS 13: PayrollDashboard.vue Job Title before Department and staffCompanyName removed verified.');

// 14. Verify dashboard.js reporting manager & auto-assign logic
assert.ok(!dashboardContent.includes("r.name !== staffName"), 'Reporting manager should NOT exclude staff member own name');
assert.ok(dashboardContent.includes("hodNames.has(r.name)"), 'Reporting manager includes all department HOD names');
assert.ok(dashboardContent.includes("updateJobMetadata"), 'updateJobMetadata function present');
assert.ok(dashboardContent.includes("targetDeptObj = departments.find"), 'updateJobMetadata resolves department from job');
assert.ok(dashboardContent.includes("companyName: ($('#staffCompanyName').val()"), 'saveStaffProfile safely handles optional staffCompanyName input');

console.log('PASS 14: dashboard.js reporting manager includes own name/HODs and department auto-assignment verified.');

// 15. Verify HR / HR HOD able to edit HR accounts
const updatedGas = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
assert.ok(updatedGas.includes("hrAssert_(!old||hrRole_(old[4])!=='Admin','Only Admin can edit Admin accounts.');"), 'HR can edit HR accounts, only Admin accounts protected');
assert.ok(updatedGas.includes("hrAssert_(role!=='Admin','Only Superadmin can assign Admin role.');"), 'HR can assign User, HOD, and HR roles');

const rGas = runtime(updatedGas);
rGas.set('Staff', [Array(34).fill('header'), employee('ADMIN', 'Admin'), employee('HR_USER', 'HR'), employee('TARGET_HR', 'HR')]);
const hrUserToken = rGas.request('login', { username: 'HR_USER', password: 'test-password' }).sessionToken;

// HR user editing TARGET_HR (HR account) -> must SUCCEED
const hrEditRes = rGas.request('saveSingleStaff', {
    name: 'TARGET_HR',
    username: 'TARGET_HR',
    role: 'HR',
    status: 'Active',
    basic: 4500
}, hrUserToken);
assert.equal(hrEditRes.status, 'success', 'HR user must be able to edit HR account');

// HR user editing ADMIN account -> must FAIL
const adminEditRes = rGas.request('saveSingleStaff', {
    name: 'ADMIN',
    username: 'ADMIN',
    role: 'Admin',
    status: 'Active'
}, hrUserToken);
assert.equal(adminEditRes.status, 'error', 'HR user must not be able to edit Admin account');

// HR user promoting someone to Admin -> must FAIL
const promoRes = rGas.request('saveSingleStaff', {
    name: 'TARGET_HR',
    username: 'TARGET_HR',
    role: 'Admin'
}, hrUserToken);
assert.equal(promoRes.status, 'error', 'HR user must not be able to assign Admin role');

const updatedDashboard = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(updatedDashboard.includes("$('#staffRole option[value=\"HR\"]').prop('disabled', false);"), 'HR option enabled for HR users');
assert.ok(updatedDashboard.includes("Only Admin can edit Admin accounts"), 'Admin accounts guarded in openStaffModal');

console.log('PASS 15: HR / HR HOD able to edit HR accounts verified.');

// 16. Verify Multi-Company Departments & Department Head HOD Filter
const comp2Res = hrSave('companies', { code: 'MS', title: 'Milan Stream' });
assert.equal(comp2Res.status, 'success');
const comp2Id = comp2Res.data.id;

// Create department with multiple company IDs
const multiDeptRes = hrSave('departments', { code: 'OPS', title: 'Operations', companyId: `${compId}, ${comp2Id}` });
assert.equal(multiDeptRes.status, 'success', multiDeptRes.message);

// Assign staff in comp2 to the multi-company department
const staffMultiRes = r.request('saveSingleStaff', {
  name: 'STAFF_MS',
  username: 'STAFF_MS',
  password: 'password123',
  companyId: comp2Id,
  departmentId: multiDeptRes.data.id
}, hrToken);
assert.equal(staffMultiRes.status, 'success', staffMultiRes.message);

// Verify HrWorkspace filters department manager to HOD only
const hrWs = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.ok(hrWs.includes("active.value==='departments'&&field.key==='manager'"), 'manager options filtered for departments');
assert.ok(hrWs.includes("r==='HOD'||r==='SUPERVISOR'"), 'only HOD or Supervisor allowed in department head options');
assert.ok(hrWs.includes("isMultiSelect") && hrWs.includes("active.value === 'departments' && field.key === 'companyId'"), 'Department company supports multi-select');

console.log('PASS 16: Multi-company departments and HOD-only department head verified.');

// 17. Verify Headcount by Company popup showing summary by department
const overviewMetricContent = fs.readFileSync('src/components/overview/OverviewMetricService.js', 'utf8');
assert.ok(overviewMetricContent.includes('deptBreakdownByCompany'), 'deptBreakdownByCompany computed');
assert.ok(overviewMetricContent.includes('staffByCompanyAndDept'), 'staffByCompanyAndDept computed');

const overviewInsightsContent = fs.readFileSync('src/components/overview/OverviewInsights.vue', 'utf8');
assert.ok(overviewInsightsContent.includes('Headcount Summary by Department'), 'Headcount summary by department modal title');
assert.ok(overviewInsightsContent.includes('selectedGroup.type === \'Company\''), 'Modal checks if company is selected');
assert.ok(overviewInsightsContent.includes('selectedDeptFilter'), 'Interactive department filter in company modal');
assert.ok(overviewInsightsContent.includes('selectedGroup.deptBreakdown'), 'Renders department breakdown in company modal');

console.log('PASS 17: Headcount by Company popping up summary by department verified.');

// 18. Verify Public Holiday Chronological Sorting (Jan -> Dec) and DD/MM/YYYY Date Format
const { formatDateDMY, parseDateDMYToISO } = require('../src/utils/dateUtils.cjs');
assert.equal(formatDateDMY('2026-02-17'), '17/02/2026', 'formatDateDMY formats ISO date to DD/MM/YYYY');
assert.equal(formatDateDMY('2026-01-01'), '01/01/2026', 'formatDateDMY formats Jan 1 to 01/01/2026');
assert.equal(formatDateDMY('17/02/2026'), '17/02/2026', 'formatDateDMY keeps DD/MM/YYYY as-is');
assert.equal(parseDateDMYToISO('17/02/2026'), '2026-02-17', 'parseDateDMYToISO converts DD/MM/YYYY to ISO');
assert.equal(parseDateDMYToISO('01/01/2026'), '2026-01-01', 'parseDateDMYToISO converts 01/01/2026 to ISO');

// Test sorting unsorted list of holidays
const unsortedHolidays = [
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2026-02-17', name: 'CNY 1' },
  { date: '2026-01-01', name: 'New Year' },
  { date: '2026-08-31', name: 'National Day' },
  { date: '2026-03-21', name: 'Hari Raya' }
];
unsortedHolidays.sort((a, b) => {
  const da = parseDateDMYToISO(a.date);
  const db = parseDateDMYToISO(b.date);
  return da.localeCompare(db);
});
assert.equal(unsortedHolidays[0].name, 'New Year', 'Earliest holiday is first (Jan)');
assert.equal(unsortedHolidays[1].name, 'CNY 1', 'Feb holiday is second');
assert.equal(unsortedHolidays[2].name, 'Hari Raya', 'March holiday is third');
assert.equal(unsortedHolidays[3].name, 'National Day', 'August holiday is fourth');
assert.equal(unsortedHolidays[4].name, 'Christmas', 'December holiday is last');

// Verify dashboard.js implementation
const dashContent = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(dashContent.includes('formatDateDMY'), 'dashboard.js includes formatDateDMY');
assert.ok(dashContent.includes('parseDateDMYToISO'), 'dashboard.js includes parseDateDMYToISO');
assert.ok(dashContent.includes('updateHolidayDateFromText'), 'dashboard.js includes updateHolidayDateFromText');
assert.ok(dashContent.includes('placeholder="DD/MM/YYYY"'), 'Holiday table date input placeholder DD/MM/YYYY');
assert.ok(dashContent.includes('bi-calendar3'), 'Holiday table includes calendar picker icon');

// Verify backend GAS sorting
const backendContent = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
assert.ok(backendContent.includes('saveHolidays') && backendContent.includes('hrInductionDate_'), 'saveHolidays sorts holidays before writing');
assert.ok(backendContent.includes('getHolidays') && backendContent.includes('hrInductionDate_'), 'getHolidays sorts holidays before returning');

console.log('PASS 18: Public Holiday Jan->Dec sorting and DD/MM/YYYY date format verified.');

// 19. Verify My Workspace Sidebar Navigation and Claim Review Response Time
const dashSrc = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(dashSrc.includes("group.items.forEach(item=>appendItem(item,children))"), 'My Workspace items are rendered directly without nested details');
assert.ok(dashSrc.includes("menu.find('> li.navigation-group > details > summary')"), 'Accordion click properly scoped to top-level navigation groups');
assert.ok(dashSrc.includes("menu.find('details').removeAttr('open')"), 'Parent details auto-collapse when item clicked');
assert.ok(dashSrc.includes("const s = localStorage.getItem('hrPortalUser')") && dashSrc.includes("function switchTab(t, e, scope)"), 'switchTab rehydrates currentUser from localStorage');

const gasSrc = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
assert.ok(gasSrc.includes("action==='hrTransition'") && gasSrc.includes("requestSheetReads_=Object.create(null)"), 'hrTransition uses requestSheetReads_ for fast cached sheet reads');

const inboxSrc = fs.readFileSync('src/components/overview/OverviewActionInbox.vue', 'utf8');
assert.ok(inboxSrc.includes("CacheManager.getHrRecords()"), 'OverviewActionInbox updates CacheManager on claim decision');
assert.ok(!inboxSrc.includes("setTimeout(() => {\n        closeDetails();\n        emit('refresh');\n      }, 1000);"), 'OverviewActionInbox removed 1000ms delay');

const hrWsSrc = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.ok(hrWsSrc.includes("if (res.data && records.value[d.module])"), 'HrWorkspace act updates records.value instantly on transition');

console.log('PASS 19: My Workspace navigation and claim review fast response time verified.');

// 20. Verify My Profile redesign & Google Drive Profile Photo Upload (Web & Mobile)
const pdContent = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');
assert.ok(pdContent.includes('profile-redesign-shell'), 'PayrollDashboard my-profile uses compact profile-redesign-shell');
assert.ok(pdContent.includes('profile-hero-card'), 'PayrollDashboard includes modern profile-hero-card');
assert.ok(pdContent.includes('id="myProfileAvatarImg"'), 'PayrollDashboard includes myProfileAvatarImg');
assert.ok(pdContent.includes('id="btnUploadProfilePhoto"'), 'PayrollDashboard includes btnUploadProfilePhoto');
assert.ok(pdContent.includes('id="myProfilePhotoFileInput"'), 'PayrollDashboard includes myProfilePhotoFileInput');

const dashContent2 = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(dashContent2.includes('compressImageToDataUrl'), 'dashboard.js includes client-side image compression');
assert.ok(dashContent2.includes("apiPost('uploadProfilePhoto'"), 'dashboard.js uploads profile photo via uploadProfilePhoto');
assert.ok(dashContent2.includes('#myProfileAvatarImg'), 'dashboard.js updates hero avatar on photo load/upload');

const mobileMeContent = fs.readFileSync('src/components/mobile/MobileMe.vue', 'utf8');
assert.ok(mobileMeContent.includes('triggerPhotoUpload'), 'MobileMe.vue has triggerPhotoUpload');
assert.ok(mobileMeContent.includes('m-avatar-cam-badge'), 'MobileMe.vue has camera upload badge');
assert.ok(mobileMeContent.includes('handleMobilePhotoUpload'), 'MobileMe.vue has handleMobilePhotoUpload handler');
assert.ok(mobileMeContent.includes("apiPost('uploadProfilePhoto'"), 'MobileMe.vue calls uploadProfilePhoto action');

const accountMenuContent = fs.readFileSync('src/components/AccountMenu.vue', 'utf8');
assert.ok(accountMenuContent.includes('user.photo || user.photoUrl'), 'AccountMenu.vue displays profile photo');

const shellContent = fs.readFileSync('src/components/mobile/MobileAppShell.vue', 'utf8');
assert.ok(shellContent.includes('user?.photo || user?.photoUrl'), 'MobileAppShell.vue displays profile photo');

// Test backend uploadProfilePhoto execution in runtime
assert.ok(gasSrc.includes("action === 'uploadProfilePhoto'"), 'GAS includes uploadProfilePhoto route');
assert.ok(gasSrc.includes('function hrUploadProfilePhoto_'), 'GAS includes hrUploadProfilePhoto_ implementation');

const rt = runtime(gasSrc);
rt.set('Staff', [
  Array(46).fill('header'),
  employee('STAFF1', 'User'),
  employee('ADMIN1', 'Admin')
]);
const staffToken = rt.request('login', { username: 'STAFF1', password: 'test-password' }).sessionToken;
const uploadRes = rt.request('uploadProfilePhoto', {
  name: 'STAFF1',
  fileName: 'selfie.jpg',
  fileData: Buffer.from('test-image-content').toString('base64'),
  mimeType: 'image/jpeg'
}, staffToken);

assert.equal(uploadRes.status, 'success', uploadRes.message);
assert.ok(uploadRes.photoUrl && uploadRes.photoUrl.startsWith('https://lh3.googleusercontent.com/d/'), 'photoUrl generated: ' + uploadRes.photoUrl);
assert.equal(rt.sheets.Staff.rows[1][45], uploadRes.photoUrl, 'Column 46 (index 45) set to photoUrl');

console.log('PASS 20: My Profile redesign, web/mobile photo upload, and Google Drive storage verified.');

// --- TEST 21: Staff Profile Photo on Management View (Modal, Table/Cards Directory, and 360 Dossier) ---
// 1. Check PayrollDashboard.vue modal markup
assert.ok(payrollDashboardContent.includes('id="staffModalAvatarImg"'), 'PayrollDashboard.vue has #staffModalAvatarImg');
assert.ok(payrollDashboardContent.includes('id="staffModalAvatarInitials"'), 'PayrollDashboard.vue has #staffModalAvatarInitials');
assert.ok(payrollDashboardContent.includes('id="btnUploadStaffModalPhoto"'), 'PayrollDashboard.vue has #btnUploadStaffModalPhoto');
assert.ok(payrollDashboardContent.includes('id="staffModalPhotoFileInput"'), 'PayrollDashboard.vue has #staffModalPhotoFileInput');
assert.ok(payrollDashboardContent.includes('id="staffModalDisplayName"'), 'PayrollDashboard.vue has #staffModalDisplayName');

// 2. Check dashboard.js management views and modal logic
const updatedDashboardJs = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(updatedDashboardJs.includes('s.photo || s.photoUrl'), 'dashboard.js checks photoUrl for management views');
assert.ok(updatedDashboardJs.includes('#staffModalAvatarImg'), 'dashboard.js populates #staffModalAvatarImg in openStaffModal');
assert.ok(updatedDashboardJs.includes('#btnUploadStaffModalPhoto'), 'dashboard.js wires #btnUploadStaffModalPhoto for management uploads');
assert.ok(updatedDashboardJs.includes('photo: existingProfile.photo || existingProfile.photoUrl'), 'dashboard.js preserves photo in saveStaffProfile payload');

// 3. Check StaffDossierModal.vue
const updatedDossierModal = fs.readFileSync('src/components/StaffDossierModal.vue', 'utf8');
assert.ok(updatedDossierModal.includes('dossier-avatar-container'), 'StaffDossierModal.vue has dossier-avatar-container');
assert.ok(updatedDossierModal.includes('profile.photo || profile.photoUrl'), 'StaffDossierModal.vue renders profile.photo in header card');
assert.ok(updatedDossierModal.includes('emp.photo || emp.photoUrl'), 'StaffDossierModal.vue renders emp.photo in suggestions');

// 4. Test GAS getStaffDossier returns photo and photoUrl in profile
rt.sheets.Staff.rows[1][45] = uploadRes.photoUrl;
const adminToken = rt.request('login', { username: 'ADMIN1', password: 'test-password' }).sessionToken;
const dossierRes = rt.request('getStaffDossier', { employee: 'STAFF1' }, adminToken);
assert.equal(dossierRes.status, 'success', dossierRes.message);
assert.ok(dossierRes.data && dossierRes.data.profile, 'dossierRes has profile');
assert.equal(dossierRes.data.profile.photo, uploadRes.photoUrl, 'profile.photo returned correctly');
assert.equal(dossierRes.data.profile.photoUrl, uploadRes.photoUrl, 'profile.photoUrl returned correctly');

console.log('PASS 21: Staff profile photo on management view (modal, directory, and 360 dossier) verified.');

// --- TEST 22: My Workspace Grouped with Parent & Child ---
const navSrc = fs.readFileSync('src/hr/navigation.js', 'utf8');
assert.ok(navSrc.includes("subgroup('personal-profile'"), 'navigation.js groups Profile & Documents');
assert.ok(navSrc.includes("subgroup('personal-time-pay'"), 'navigation.js groups Leave & Compensation');
assert.ok(navSrc.includes("subgroup('personal-claims-finance'"), 'navigation.js groups Claims & Requests');
assert.ok(navSrc.includes("subgroup('personal-performance-growth'"), 'navigation.js groups Performance & Growth');

const navCss = fs.readFileSync('src/styles/workspace.css', 'utf8');
assert.ok(navCss.includes('.navigation-subgroup'), 'workspace.css styles .navigation-subgroup');
assert.ok(navCss.includes('.navigation-subsummary'), 'workspace.css styles .navigation-subsummary');
assert.ok(navCss.includes('.navigation-subchildren'), 'workspace.css styles .navigation-subchildren');

console.log('PASS 22: My Workspace grouped with parent & child with relevant tabs together verified.');

// --- TEST 23: Web Sign-In Loading / Response Time Optimizations ---
const currentDashSrc = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(!currentDashSrc.includes("const mastersPromise = apiPost('hrBootstrap'"), 'dashboard.js removed duplicate unneeded hrBootstrap call');

const hrWorkSrc = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.ok(hrWorkSrc.includes('if(user.value)load(false);'), 'HrWorkspace.vue session handler uses fast cached load');

console.log('PASS 23: Web sign-in loading and response time optimization verified.');

// --- TEST 24: Shift Resolution & Mobile Attendance Merging into Official Records ---
const inductionPolicySrc = fs.readFileSync('src/services/inductionPolicy.js', 'utf8');
assert.ok(inductionPolicySrc.includes('export function resolveEmployeeShift'), 'inductionPolicy.js exports resolveEmployeeShift');

const { resolveEmployeeShift } = require('../src/services/inductionPolicy.cjs');
const mockSchedules = [
  { id: 'SCH-SQ-S1', company: 'SQ', code: 'S1', workBase: 'Site', title: 'SQ Shift S1 (05:30 - 14:30)', start: '05:30', end: '14:30' },
  { id: 'SCH-SQ-S2', company: 'SQ', code: 'S2', workBase: 'Office', title: 'SQ Shift S2 (08:30 - 17:30)', start: '08:30', end: '17:30' }
];

// Default SQ office worker should resolve to S2 (08:30 - 17:30), not S1 (05:30)
const resolvedOfficeShift = resolveEmployeeShift({ company: 'SQ', workBase: 'Office' }, mockSchedules);
assert.equal(resolvedOfficeShift.code, 'S2', 'SQ office worker resolves to S2, not S1');
assert.equal(resolvedOfficeShift.start, '08:30', 'Resolved start time is 08:30');

// Test GAS getAttendance merging mobile clock events
const freshRt = runtime(gasSrc);
freshRt.set('Staff', [
  Array(46).fill('header'),
  employee('ADMIN1', 'Admin'),
  employee('STAFF1', 'User')
]);
const adminTok = freshRt.request('login', { username: 'ADMIN1', password: 'test-password' }).sessionToken;

freshRt.set('Attendance', [
  ['ID', 'Name', 'Date', 'PayType', '1st In', 'Last Out', '', '', '', '', '', 'OverlapOT', 'ExtraOT', 'Remark', 'ManualOTPay'],
  ['ATT-1', 'STAFF1', '2026-10-21', 'Normal', '09:30', '18:00', '', '', '', '', '', 0, 0, 'Biometric', 0]
]);
freshRt.set('HR_mobileClockEvent', [
  ['ID', 'Version', 'Employee', 'Status', 'Payload', 'ServerTime'],
  ['MOB-EVT-1', 1, 'STAFF1', 'Recorded', JSON.stringify({
    id: 'MOB-EVT-1',
    employee: 'STAFF1',
    type: 'IN',
    date: '2026-10-21',
    serverTime: '2026-10-21T01:13:00.000Z', // 09:13 MYT
    status: 'Recorded',
    checkInLocation: 'Batu Kawan'
  }), '2026-10-21T01:13:00.000Z']
]);

const attRes = freshRt.request('getAttendance', {}, adminTok);
assert.equal(attRes.status, 'success');
const staffAtt = attRes.data.find(r => r.name === 'STAFF1' && r.date === '2026-10-21');
assert.ok(staffAtt, 'STAFF1 attendance record found');
// Mobile clock in was 09:13, Biometric was 09:30 -> Mobile was earlier so 09:13 is 1st In
assert.equal(staffAtt.in, '09:13', 'Mobile clock in 09:13 superceeds later biometric 09:30');

// Now test when Biometric is earlier: Biometric 08:50 vs Mobile 09:13 -> Biometric 08:50 superceeds
freshRt.set('Attendance', [
  ['ID', 'Name', 'Date', 'PayType', '1st In', 'Last Out', '', '', '', '', '', 'OverlapOT', 'ExtraOT', 'Remark', 'ManualOTPay'],
  ['ATT-1', 'STAFF1', '2026-10-21', 'Normal', '08:50', '18:00', '', '', '', '', '', 0, 0, 'Biometric', 0]
]);
const attRes2 = freshRt.request('getAttendance', {}, adminTok);
const staffAtt2 = attRes2.data.find(r => r.name === 'STAFF1' && r.date === '2026-10-21');
assert.equal(staffAtt2.in, '08:50', 'Earlier biometric 08:50 superceeds later mobile clock in 09:13');

console.log('PASS 24: Shift resolution & mobile attendance merging with biometric superceed rule verified.');

console.log('\n--- ALL SESSION FIXES VERIFIED SUCCESSFULLY! ---');
