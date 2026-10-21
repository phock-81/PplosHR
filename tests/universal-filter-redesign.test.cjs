const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Testing Universal Cascading Filters & Redesigned Listing Interface ---');

// 1. Verify GAS_payroll.js backend seeding and updates
const gasPayrollPath = path.join(__dirname, '..', 'backend', 'GAS_payroll.js');
const gasSource = fs.readFileSync(gasPayrollPath, 'utf8');

assert.match(gasSource, /hrSeedInductionGrades_/, 'hrSeedInductionGrades_ function must exist');
assert.match(gasSource, /code:\s*'S'.*Senior Management/s, 'Grade S must be defined');
assert.match(gasSource, /code:\s*'M'.*Managerial/s, 'Grade M must be defined');
assert.match(gasSource, /code:\s*'E'.*Executive/s, 'Grade E must be defined');
assert.match(gasSource, /code:\s*'C'.*Clerical/s, 'Grade C must be defined');
assert.match(gasSource, /code:\s*'W'.*Worker/s, 'Grade W must be defined');

// Verify that jobTitles can be updated via hrSave_ and hrSyncJobTitles_
assert.match(gasSource, /if\(module==='jobTitles'\)hrSyncJobTitles_\(\);/, 'hrSyncJobTitles_ must be triggered on jobTitles save');
assert.match(gasSource, /result\.jobTitleId=String\(payload\.jobTitleId/, 'saveSingleStaff must validate and store jobTitleId and jobTitle');
console.log('PASS Part 1: Backend Job Grades seeding & Job Titles synchronization verified.');

// 2. Verify PayrollDashboard.vue template markup
const vuePath = path.join(__dirname, '..', 'src', 'components', 'PayrollDashboard.vue');
const vueSource = fs.readFileSync(vuePath, 'utf8');

// Attendance cascading filter check
assert.match(vueSource, /id="attendanceCompanySelect"/, 'attendanceCompanySelect must exist in #controlPanel');
assert.match(vueSource, /id="attendanceDepartmentSelect"/, 'attendanceDepartmentSelect must exist in #controlPanel');
assert.match(vueSource, /id="staffSelect"/, 'staffSelect must exist in #controlPanel');
assert.match(vueSource, /id="monthSelect"/, 'monthSelect must exist in #controlPanel');

// Order in Attendance controlPanel
const compIdx = vueSource.indexOf('id="attendanceCompanySelect"');
const deptIdx = vueSource.indexOf('id="attendanceDepartmentSelect"');
const staffIdx = vueSource.indexOf('id="staffSelect"');
const monthIdx = vueSource.indexOf('id="monthSelect"');

assert.ok(compIdx < deptIdx && deptIdx < staffIdx && staffIdx < monthIdx,
  'Attendance dashboard filter order must strictly be Company > Project/Department > Staff > Month');

// Employee Management cascading filter check
assert.match(vueSource, /id="staffCompanyFilter"/, 'staffCompanyFilter must exist in #staff-mgmt');
assert.match(vueSource, /id="staffDepartmentFilter"/, 'staffDepartmentFilter must exist in #staff-mgmt');
assert.match(vueSource, /id="staffSearch"/, 'staffSearch must exist in #staff-mgmt');
assert.match(vueSource, /id="staffStatusFilter"/, 'staffStatusFilter must exist in #staff-mgmt');
assert.match(vueSource, /id="staffViewTableBtn"/, 'staffViewTableBtn layout switcher must exist');
assert.match(vueSource, /id="staffViewCardsBtn"/, 'staffViewCardsBtn layout switcher must exist');

// Order in Employee Management toolbar
const sCompIdx = vueSource.indexOf('id="staffCompanyFilter"');
const sDeptIdx = vueSource.indexOf('id="staffDepartmentFilter"');
const sSearchIdx = vueSource.indexOf('id="staffSearch"');
const sStatusIdx = vueSource.indexOf('id="staffStatusFilter"');

assert.ok(sCompIdx < sDeptIdx && sDeptIdx < sSearchIdx && sSearchIdx < sStatusIdx,
  'Employee Management filter order must strictly be Company > Project/Department > Staff Search > Status');
console.log('PASS Part 2: Universal cascading filter order (Company > Project/Department > Staff) verified in template.');

// 3. Verify dashboard.js service implementation
const dashboardJsPath = path.join(__dirname, '..', 'src', 'services', 'dashboard.js');
const dashboardSource = fs.readFileSync(dashboardJsPath, 'utf8');

// Check exported actions
assert.match(dashboardSource, /handleAttendanceCompanyChange/, 'handleAttendanceCompanyChange must be defined');
assert.match(dashboardSource, /handleAttendanceDepartmentChange/, 'handleAttendanceDepartmentChange must be defined');
assert.match(dashboardSource, /handleStaffCompanyFilterChange/, 'handleStaffCompanyFilterChange must be defined');
assert.match(dashboardSource, /setStaffViewMode/, 'setStaffViewMode must be defined');
assert.match(dashboardSource, /populateAttendanceFilters/, 'populateAttendanceFilters must be defined');
assert.match(dashboardSource, /populateStaffFilters/, 'populateStaffFilters must be defined');

// Verify table view vs cards view in renderStaffMgmt
assert.match(dashboardSource, /currentStaffViewMode === 'table'/, 'renderStaffMgmt must support table view');
assert.match(dashboardSource, /class="table table-hover align-middle staff-mgmt-table/, 'Data table structure must be present');
assert.match(dashboardSource, /openStaffModal\('UPDATE', '\${name}'\)/, 'Update Profile button must be rendered');
assert.match(dashboardSource, /window\.openStaffDossier/, '360° Dossier button must be rendered');

// Verify that Update Profile appears BEFORE 360 Dossier in rendered button output to preserve smoke test click target
const updateBtnIdx = dashboardSource.indexOf("onclick=\"openStaffModal('UPDATE', '${name}')\"");
const dossierBtnIdx = dashboardSource.indexOf("onclick=\"window.openStaffDossier ? window.openStaffDossier('${name}') : null\"");
assert.ok(updateBtnIdx !== -1 && dossierBtnIdx !== -1 && updateBtnIdx < dossierBtnIdx,
  'Update Profile button must precede 360° Dossier button in DOM for backwards compatibility');

// Verify filterStaffCards incorporates company and department filtering
assert.match(dashboardSource, /const company = \$\('#staffCompanyFilter'\)\.val\(\)/, 'filterStaffCards must read company filter');
assert.match(dashboardSource, /const department = \$\('#staffDepartmentFilter'\)\.val\(\)/, 'filterStaffCards must read department filter');

console.log('PASS Part 3: dashboard.js cascading filters, table view & button precedence verified.');

// 4. Verify HrWorkspace.vue listing views & induction benefits
const hrWorkspacePath = path.join(__dirname, '..', 'src', 'components', 'HrWorkspace.vue');
const hrWorkspaceSource = fs.readFileSync(hrWorkspacePath, 'utf8');

assert.match(hrWorkspaceSource, /active==='jobGrades'/, 'Dedicated high-density template for jobGrades must exist');
assert.match(hrWorkspaceSource, /inductionFlexi\(r\.code\)/, 'Flexi-Wellness benefit helper must be wired in jobGrades');
assert.match(hrWorkspaceSource, /inductionCheckup\(r\.code\)/, 'Medical Check-up benefit helper must be wired in jobGrades');
assert.match(hrWorkspaceSource, /inductionMeals\(r\.code\)/, 'Outstation Meals benefit helper must be wired in jobGrades');
assert.match(hrWorkspaceSource, /inductionOt\(r\.code\)/, 'OT entitlement helper must be wired in jobGrades');
assert.match(hrWorkspaceSource, /inductionLeave\(r\.code\)/, 'Annual leave tenure entitlement helper must be wired in jobGrades');

// Job titles editing
assert.match(hrWorkspaceSource, /active==='jobTitles'/, 'Dedicated high-density template for jobTitles must exist');
assert.match(hrWorkspaceSource, /edit\(r\)/, 'Edit record trigger must exist on jobTitles listing');
assert.match(hrWorkspaceSource, /edit\(detail\)/, 'Edit record trigger must exist in detail dialog');

console.log('PASS Part 4: HrWorkspace listing redesign and job grading benefits verified.');

// 5. Verify CSS definitions
const cssPath = path.join(__dirname, '..', 'src', 'styles', 'dashboard.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');

assert.match(cssSource, /\.staff-mgmt-table/, 'CSS for .staff-mgmt-table must be present');
assert.match(cssSource, /\.staff-avatar/, 'CSS for .staff-avatar must be present');
console.log('PASS Part 5: CSS styling for data table and avatar verified.');

console.log('\nALL UNIVERSAL FILTER & LISTING REDESIGN CHECKS PASSED SUCCESSFULLY!\n');
