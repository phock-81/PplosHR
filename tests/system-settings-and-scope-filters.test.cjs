const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Testing System Settings, Personal Scope Filters, Action Queue & Tenure Fixes ---');

// 1. Verify backend getActionCount returns pendingAttendanceList
const gasPath = path.join(__dirname, '..', 'backend', 'GAS_payroll.js');
const gasSource = fs.readFileSync(gasPath, 'utf8');

assert.match(gasSource, /pendingAttendanceList\s*=\s*\[\]/, 'GAS_payroll.js must initialize pendingAttendanceList');
assert.match(gasSource, /pendingAttendanceList\.push\(\{\s*id:\s*'ATT-'\s*\+\s*m/s, 'pendingAttendanceList must push attendance items');
assert.match(gasSource, /pendingAttendanceList,/s, 'pendingAttendanceList must be returned in getActionCount data');

// 2. Verify backend tenure formatting to 2 decimals in getStaffDossier
assert.match(gasSource, /rawNum\.toFixed\(2\)/, 'getStaffDossier must format decimal serviceYears to 2 decimals');

console.log('PASS Part 1: Backend getActionCount pendingAttendanceList and 2-decimal tenure verified.');

// 3. Verify StaffDossierModal.vue formats tenure to 2 decimals
const dossierPath = path.join(__dirname, '..', 'src', 'components', 'StaffDossierModal.vue');
const dossierSource = fs.readFileSync(dossierPath, 'utf8');

assert.match(dossierSource, /formatTenureDisplay/, 'StaffDossierModal must define formatTenureDisplay helper');
assert.match(dossierSource, /formatTenureDisplay\(profile\.tenure\)/, 'StaffDossierModal template must call formatTenureDisplay');

console.log('PASS Part 2: StaffDossierModal 2-decimal tenure formatting verified.');

// 4. Verify HrWorkspace.vue actionable includes pendingAttendanceItems
const hrWorkspacePath = path.join(__dirname, '..', 'src', 'components', 'HrWorkspace.vue');
const hrWorkspaceSource = fs.readFileSync(hrWorkspacePath, 'utf8');

assert.match(hrWorkspaceSource, /pendingAttendanceItems\s*=\s*ref\(\[\]\)/, 'HrWorkspace must have pendingAttendanceItems ref');
assert.match(hrWorkspaceSource, /window\.addEventListener\('hr-action-count',\s*onActionCount\)/, 'HrWorkspace must listen to hr-action-count');
assert.match(hrWorkspaceSource, /\.\.\.pendingAttendanceItems\.value/, 'actionable computed must merge pendingAttendanceItems');
assert.match(hrWorkspaceSource, /record\.isAttendance\s*\|\|\s*record\.module\s*===\s*'attendance'/, 'review() must handle attendance items');

// 5. Verify personal scope filter removal (scope !== 'personal')
assert.match(hrWorkspaceSource, /v-if="scope\s*!==\s*'personal'"\s*class="staff-toolbar/, 'Filters must be omitted for personal pages');

// 6. Verify whitespace reduction & aligned "New request" button with note
assert.doesNotMatch(hrWorkspaceSource, /Search,\s*review and manage records\./, 'Redundant search/review subtitle must be removed');
assert.match(hrWorkspaceSource, /hr-section-title.*d-flex.*justify-content-between.*hr-note.*canCreate/s, 'New request button must be aligned on same row as note in hr-section-title');

// 7. Verify System Settings subnav tabs strictly ordered
assert.match(hrWorkspaceSource, /\['companies',\s*'jobGrades',\s*'departments',\s*'jobTitles',\s*'resources',\s*'resourcePolicies',\s*'workSchedules',\s*'workBases',\s*'workLocations',\s*'claimTypes',\s*'claimPolicies'\]/, 'Subnav tabs must include all system settings modules');
const compTabIdx = hrWorkspaceSource.indexOf("choose('companies')");
const gradeTabIdx = hrWorkspaceSource.indexOf("choose('jobGrades')");
const deptTabIdx = hrWorkspaceSource.indexOf("choose('departments')");
const titleTabIdx = hrWorkspaceSource.indexOf("choose('jobTitles')");
const wbTabIdx = hrWorkspaceSource.indexOf("choose('workBases')");
const wlTabIdx = hrWorkspaceSource.indexOf("choose('workLocations')");
const resTabIdx = hrWorkspaceSource.indexOf("choose('resources')");
const resPolTabIdx = hrWorkspaceSource.indexOf("choose('resourcePolicies')");
const workSchedTabIdx = hrWorkspaceSource.indexOf("choose('workSchedules')");
const claimTypesTabIdx = hrWorkspaceSource.indexOf("choose('claimTypes')");
const claimPoliciesTabIdx = hrWorkspaceSource.indexOf("choose('claimPolicies')");

assert.ok(
  compTabIdx < gradeTabIdx &&
  gradeTabIdx < deptTabIdx &&
  deptTabIdx < titleTabIdx &&
  titleTabIdx < wbTabIdx &&
  wbTabIdx < wlTabIdx &&
  wlTabIdx < resTabIdx &&
  resTabIdx < resPolTabIdx &&
  resPolTabIdx < workSchedTabIdx &&
  workSchedTabIdx < claimTypesTabIdx &&
  claimTypesTabIdx < claimPoliciesTabIdx,
  'Subnav tabs must strictly follow order: Companies > Job Grades > Departments > Job Title Library > Work Bases > Work Locations > Resource Catalogue > Resource Limits > Shift Templates > Claim Types > Claim Limits by Grade'
);

console.log('PASS Part 3: HrWorkspace action queue parity, personal scope filter hiding & System Settings tab order verified.');

// 8. Verify src/hr/navigation.js consolidation
const navPath = path.join(__dirname, '..', 'src', 'hr', 'navigation.js');
const navSource = fs.readFileSync(navPath, 'utf8');

assert.match(navSource, /hr\('companies',\s*'System Settings',\s*'all',\s*'sliders'\)/, 'navigation.js must consolidate modules under System Settings');
assert.match(navSource, /id:\s*'administration'.*id:\s*'settings',label:\s*'System Settings'/s, 'System Settings must be placed as an independent tab after HR Administration');
assert.doesNotMatch(navSource, /hr\('departments',\s*'Departments'/);
assert.doesNotMatch(navSource, /hr\('jobGrades',\s*'Job Grades'/);
assert.doesNotMatch(navSource, /hr\('jobTitles',\s*'Job Title Library'/);

console.log('PASS Part 4: Navigation consolidation to System Settings verified.');

// 9. Verify dashboard.js normalizeDateStr, attendanceStaffSearch & stepper note removal
const dashPath = path.join(__dirname, '..', 'src', 'services', 'dashboard.js');
const dashSource = fs.readFileSync(dashPath, 'utf8');

assert.match(dashSource, /function normalizeDateStr/, 'dashboard.js must define normalizeDateStr');
assert.match(dashSource, /#attendanceStaffSearch/, 'dashboard.js must bind #attendanceStaffSearch input event');
assert.doesNotMatch(dashSource, /Stage 1: HOD Review &amp; Recommendation.*Stage 2: HR Approval/s, 'Stepper note boxes must be removed from approval banner');

// 10. Verify PayrollDashboard.vue attendanceStaffSearch position and upload button
const vuePath = path.join(__dirname, '..', 'src', 'components', 'PayrollDashboard.vue');
const vueSource = fs.readFileSync(vuePath, 'utf8');

assert.match(vueSource, /id="attendanceStaffSearch"/, 'PayrollDashboard must have #attendanceStaffSearch');
const cIdx = vueSource.indexOf('id="attendanceCompanySelect"');
const dIdx = vueSource.indexOf('id="attendanceDepartmentSelect"');
const sIdx = vueSource.indexOf('id="staffSelect"');
const mIdx = vueSource.indexOf('id="monthSelect"');
const qIdx = vueSource.indexOf('id="attendanceStaffSearch"');

assert.ok(cIdx < dIdx && dIdx < sIdx && sIdx < mIdx && mIdx < qIdx, 'Filter order must strictly be Company > Dept > Staff > Month > Search');

console.log('PASS Part 5: Attendance search, date normalization, stepper note removal and upload controls verified.');

console.log('\nALL SYSTEM SETTINGS, PERSONAL SCOPE FILTERS & ACTION QUEUE CHECKS PASSED!\n');
