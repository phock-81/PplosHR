const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Testing Sub-tabs, Action Button Layout & Independent System Settings ---');

// 1. Verify src/hr/navigation.js
const navPath = path.join(__dirname, '..', 'src', 'hr', 'navigation.js');
const navSource = fs.readFileSync(navPath, 'utf8');

assert.match(navSource, /id:\s*'administration'.*id:\s*'settings',label:\s*'System Settings'/s,
  'System Settings must be placed as an independent tab after HR Administration');
assert.doesNotMatch(navSource, /id:\s*'people'.*hr\('companies',\s*'System Settings'/,
  'System Settings must be removed from People & Organisation');
assert.doesNotMatch(navSource, /id:\s*'administration'.*hr\('resourcePolicies'/,
  'Resource Limits must be removed from HR Administration');
assert.doesNotMatch(navSource, /id:\s*'administration'.*hr\('workSchedules'/,
  'Shift Templates must be removed from HR Administration');

console.log('PASS Part 1: Independent System Settings tab & navigation structure verified.');

// 2. Verify HrWorkspace.vue System Settings subnav tabs & filter toolbar
const hrWorkspacePath = path.join(__dirname, '..', 'src', 'components', 'HrWorkspace.vue');
const hrWorkspaceSource = fs.readFileSync(hrWorkspacePath, 'utf8');

assert.match(hrWorkspaceSource, /\['companies',\s*'jobGrades',\s*'departments',\s*'jobTitles',\s*'resources',\s*'resourcePolicies',\s*'workSchedules',\s*'workBases',\s*'workLocations',\s*'claimTypes',\s*'claimPolicies'\]/,
  'HrWorkspace subnav tabs must include resourcePolicies and workSchedules in System Settings');

// Verify action buttons in HrWorkspace toolbar footer
const hrFooterIdx = hrWorkspaceSource.indexOf('{{filtered.length}} matching of {{current.length}} records');
const hrAddBtnIdx = hrWorkspaceSource.lastIndexOf("{{spec.self?'New request':'Add record'}}");
const hrCsvBtnIdx = hrWorkspaceSource.lastIndexOf('title="Export CSV" @click="exportCsv"');

assert.ok(hrFooterIdx !== -1 && hrAddBtnIdx > hrFooterIdx && hrCsvBtnIdx > hrFooterIdx,
  'HrWorkspace action buttons must be placed below the filters in the toolbar footer next to record count');

// Verify search bar is wide (col-12 col-lg-6)
assert.match(hrWorkspaceSource, /class="col-12 col-lg-6">\s*<label[^>]*for="hrSearch"/,
  'HrWorkspace search bar must use col-12 col-lg-6');

console.log('PASS Part 2: HrWorkspace System Settings tabs, wide search & action buttons layout verified.');

// 3. Verify PayrollDashboard.vue Employee Management (#staff-mgmt)
const vuePath = path.join(__dirname, '..', 'src', 'components', 'PayrollDashboard.vue');
const vueSource = fs.readFileSync(vuePath, 'utf8');

// Verify Add Staff & 360 Dossier in toolbar footer next to staffResultCount
const sResultCountIdx = vueSource.indexOf('id="staffResultCount"');
const sAddBtnIdx = vueSource.indexOf('id="btnAddStaff"');
const sDossierBtnIdx = vueSource.indexOf('id="openStaffDossierBtn"');

assert.ok(sResultCountIdx !== -1 && sAddBtnIdx > sResultCountIdx && sDossierBtnIdx > sResultCountIdx,
  '#staff-mgmt action buttons (Add Staff, 360 Dossier) must be below filters beside staffResultCount');

// Verify wider staff search
assert.match(vueSource, /class="col-12 col-sm-8 col-lg-5">\s*<label[^>]*for="staffSearch"/,
  '#staff-mgmt search bar must be widened to col-12 col-sm-8 col-lg-5');

console.log('PASS Part 3: PayrollDashboard #staff-mgmt action button repositioning & wide search verified.');

// 4. Verify Sub-tabs in #staffProfileModal
assert.match(vueSource, /id="staffModalTabs"/, '#staffModalTabs navigation must exist');
assert.match(vueSource, /id="staff-tab-personal-btn"/, 'Personal & Contact tab button must exist');
assert.match(vueSource, /id="staff-tab-employment-btn"/, 'Employment & Org tab button must exist');
assert.match(vueSource, /id="staff-tab-salary-btn"/, 'Salary & Statutory tab button must exist');
assert.match(vueSource, /id="staff-tab-schedule-btn"/, 'Leave & Schedule tab button must exist');
assert.match(vueSource, /id="staff-tab-docs-btn"/, 'Documents tab button must exist');

assert.match(vueSource, /id="staff-tab-personal"/, 'Personal & Contact tab pane must exist');
assert.match(vueSource, /id="staff-tab-employment"/, 'Employment & Org tab pane must exist');
assert.match(vueSource, /id="staff-tab-salary"/, 'Salary & Statutory tab pane must exist');
assert.match(vueSource, /id="staff-tab-schedule"/, 'Leave & Schedule tab pane must exist');
assert.match(vueSource, /id="staff-tab-docs"/, 'Documents tab pane must exist');

// Verify essential fields inside their respective panes
const pPane = vueSource.indexOf('id="staff-tab-personal"');
const ePane = vueSource.indexOf('id="staff-tab-employment"');
const sPane = vueSource.indexOf('id="staff-tab-salary"');
const scPane = vueSource.indexOf('id="staff-tab-schedule"');
const dPane = vueSource.indexOf('id="staff-tab-docs"');

assert.ok(pPane < ePane && ePane < sPane && sPane < scPane && scPane < dPane,
  'Staff modal sub-tab panes must follow exact order: Personal > Employment > Salary > Schedule > Documents');

const nameIdx = vueSource.indexOf('id="staffName"');
const empNoIdx = vueSource.indexOf('id="staffEmployeeNo"');
const bioIdx = vueSource.indexOf('id="staffBiometricId"');
const basicIdx = vueSource.indexOf('id="staffBasic"');
const alEntIdx = vueSource.indexOf('id="staffAlEntitlement"');
const docsIdx = vueSource.indexOf('id="staffDocumentsPanel"');

assert.ok(nameIdx > pPane && nameIdx < ePane, 'staffName must be inside personal tab');
assert.ok(empNoIdx > ePane && empNoIdx < sPane && bioIdx > ePane && bioIdx < sPane, 'employeeNo & biometricId must be inside employment tab');
assert.ok(basicIdx > sPane && basicIdx < scPane, 'basic salary must be inside salary tab');
assert.ok(alEntIdx > scPane && alEntIdx < dPane, 'alEntitlement must be inside schedule tab');
assert.ok(docsIdx > dPane, 'staffDocumentsPanel must be inside docs tab');

console.log('PASS Part 4: #staffProfileModal 5 sub-tabs and field distribution verified.');

// 5. Verify Sub-tabs in #my-profile
assert.match(vueSource, /id="myProfileTabs"/, '#myProfileTabs navigation must exist');
assert.match(vueSource, /id="myprofile-tab-personal-btn"/, 'Personal tab button must exist in #my-profile');
assert.match(vueSource, /id="myprofile-tab-employment-btn"/, 'Employment tab button must exist in #my-profile');
assert.match(vueSource, /id="myprofile-tab-salary-btn"/, 'Salary tab button must exist in #my-profile');
assert.match(vueSource, /id="myprofile-tab-schedule-btn"/, 'Leave & Schedule tab button must exist in #my-profile');

assert.match(vueSource, /id="myprofile-tab-personal"/, 'Personal tab pane must exist in #my-profile');
assert.match(vueSource, /id="myprofile-tab-employment"/, 'Employment tab pane must exist in #my-profile');
assert.match(vueSource, /id="myprofile-tab-salary"/, 'Salary tab pane must exist in #my-profile');
assert.match(vueSource, /id="myprofile-tab-schedule"/, 'Leave & Schedule tab pane must exist in #my-profile');

const mpPane = vueSource.indexOf('id="myprofile-tab-personal"');
const mePane = vueSource.indexOf('id="myprofile-tab-employment"');
const msPane = vueSource.indexOf('id="myprofile-tab-salary"');
const mscPane = vueSource.indexOf('id="myprofile-tab-schedule"');

assert.ok(mpPane < mePane && mePane < msPane && msPane < mscPane,
  'My Profile sub-tab panes must follow exact order: Personal > Employment > Salary > Schedule');

const mpNameIdx = vueSource.indexOf('id="myProfileName"');
const mpEmpNoIdx = vueSource.indexOf('id="myProfileEmployeeNo"');
const mpBioIdx = vueSource.indexOf('id="myProfileBiometricId"');
const mpBasicIdx = vueSource.indexOf('id="myProfileBasic"');
const mpAlIdx = vueSource.indexOf('id="myProfileAl"');

assert.ok(mpNameIdx > mpPane && mpNameIdx < mePane, 'myProfileName must be inside personal tab');
assert.ok(mpEmpNoIdx > mePane && mpEmpNoIdx < msPane && mpBioIdx > mePane && mpBioIdx < msPane, 'myProfileEmployeeNo and biometricId must be inside employment tab');
assert.ok(mpBasicIdx > msPane && mpBasicIdx < mscPane, 'myProfileBasic must be inside salary tab');
assert.ok(mpAlIdx > mscPane, 'myProfileAl must be inside schedule tab');

console.log('PASS Part 5: #my-profile 4 sub-tabs and field distribution verified.');

// 6. Verify dashboard.css styling
const cssPath = path.join(__dirname, '..', 'src', 'styles', 'dashboard.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');

assert.match(cssSource, /\.profile-sub-tabs/, '.profile-sub-tabs styling must exist');
assert.match(cssSource, /\.staff-modal-tabs/, '.staff-modal-tabs styling must exist');

console.log('PASS Part 6: Sub-tabs CSS verified.');

console.log('\nALL SUB-TABS, ACTION BUTTON LAYOUT & SYSTEM SETTINGS TESTS PASSED!\n');
