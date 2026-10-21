const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Testing Filter Overlap, Universal Filters, Tab/Listing Selector & Resource Management ---');

// 1. Verify HrWorkspace.vue Universal Cascading Filters & Order
const hrWorkspacePath = path.join(__dirname, '..', 'src', 'components', 'HrWorkspace.vue');
const hrWorkspaceSource = fs.readFileSync(hrWorkspacePath, 'utf8');

assert.match(hrWorkspaceSource, /id="hrCompanyFilter"/, 'hrCompanyFilter must exist in HrWorkspace.vue');
assert.match(hrWorkspaceSource, /id="hrDepartmentFilter"/, 'hrDepartmentFilter must exist in HrWorkspace.vue');
assert.match(hrWorkspaceSource, /id="hrStaffFilter"/, 'hrStaffFilter must exist in HrWorkspace.vue');
assert.match(hrWorkspaceSource, /id="hrSearch"/, 'hrSearch must exist in HrWorkspace.vue');
assert.match(hrWorkspaceSource, /id="hrStatusFilter"/, 'hrStatusFilter must exist in HrWorkspace.vue');

const cIdx = hrWorkspaceSource.indexOf('id="hrCompanyFilter"');
const dIdx = hrWorkspaceSource.indexOf('id="hrDepartmentFilter"');
const sIdx = hrWorkspaceSource.indexOf('id="hrStaffFilter"');
const qIdx = hrWorkspaceSource.indexOf('id="hrSearch"');
const stIdx = hrWorkspaceSource.indexOf('id="hrStatusFilter"');

assert.ok(cIdx < dIdx && dIdx < sIdx && sIdx < qIdx && qIdx < stIdx,
  'HrWorkspace filter order must strictly be Company > Project/Department > Staff > Search > Status');

console.log('PASS Part 1: Universal cascading filter order (Company > Department > Staff > Search > Status) verified in HrWorkspace.');

// 2. Verify Tab / Listing View Selector & Default to Tab View
assert.match(hrWorkspaceSource, /orgViewMode\s*=\s*ref\(['"]tab['"]\)/, 'orgViewMode must be initialized to "tab" by default');
assert.match(hrWorkspaceSource, /id="hrOrgTabViewBtn"/, 'hrOrgTabViewBtn must exist');
assert.match(hrWorkspaceSource, /id="hrOrgListingViewBtn"/, 'hrOrgListingViewBtn must exist');

// Verify Listing Table view supports jobGrades, jobTitles, departments, companies
assert.match(hrWorkspaceSource, /active==='jobGrades'.*orgViewMode==='tab'.*orgViewMode==='listing'/s, 'jobGrades must support both tab and listing view');
assert.match(hrWorkspaceSource, /active==='jobTitles'.*orgViewMode==='tab'.*orgViewMode==='listing'/s, 'jobTitles must support both tab and listing view');
assert.match(hrWorkspaceSource, /active==='departments'.*orgViewMode==='tab'.*orgViewMode==='listing'/s, 'departments must support both tab and listing view');
assert.match(hrWorkspaceSource, /active==='companies'.*orgViewMode==='tab'.*orgViewMode==='listing'/s, 'companies must support both tab and listing view');

console.log('PASS Part 2: Organisation sub-module navigation, tab/listing view switchers & default tab view verified.');

// 3. Verify HR/Admin Resource Management (Adding & Editing Resources with Maintenance support)
const gasPayrollPath = path.join(__dirname, '..', 'backend', 'GAS_payroll.js');
const gasSource = fs.readFileSync(gasPayrollPath, 'utf8');

// Maintenance in oldStatus allowlist
assert.match(gasSource, /'Maintenance'\.indexOf\(oldStatus\)!==-1|indexOf\(oldStatus\)!==-1.*Maintenance|'Active'.*'Maintenance'/s,
  'GAS_payroll.js must permit editing resources in Maintenance state');

// Custom/extended resource categories for HR/Admin
assert.match(gasSource, /module==='resources'&&f\.key==='category'&&hrAdmin_\(actor\)/,
  'GAS_payroll.js must allow HR/Admin to define and update custom resource categories');

// HrWorkspace editable supports Maintenance
assert.match(hrWorkspaceSource, /editable\(r\).*'Maintenance'/s, 'HrWorkspace editable() must include Maintenance');

// HrWorkspace canCreate allows admin regardless of scope
assert.match(hrWorkspaceSource, /canCreate\s*=\s*computed\(\(\)\s*=>.*admin\.value/, 'HrWorkspace canCreate must grant Admin/HR ability to add records');

// Specialized resources layout
assert.match(hrWorkspaceSource, /active==='resources'/, 'Dedicated high-density template for resources must exist');

console.log('PASS Part 3: HR/Admin resource creation & Maintenance editing verified.');

// 4. Verify CSS Overlap Fixes & Grade Badge Centering
const workspaceCssPath = path.join(__dirname, '..', 'src', 'styles', 'workspace.css');
const workspaceCss = fs.readFileSync(workspaceCssPath, 'utf8');

// Toolbar display block and 100% width
assert.match(workspaceCss, /\.staff-toolbar\{display:block;margin-bottom:24px\}/, '.staff-toolbar must use display:block');
assert.match(workspaceCss, /\.search-field\{position:relative;width:100%;min-width:0\}/, '.search-field must have width:100% and min-width:0');
assert.match(workspaceCss, /#staffStatusFilter\{width:100%;min-width:0\}/, '#staffStatusFilter must not have fixed 165px width');

// Grade badge flex centering
assert.match(workspaceCss, /\.badge\{display:inline-flex;align-items:center;justify-content:center;line-height:1\.2;vertical-align:middle\}/,
  'Badges must be flex-centered horizontally and vertically');

// dashboard.js gradeBadge inline classes
const dashboardJsPath = path.join(__dirname, '..', 'src', 'services', 'dashboard.js');
const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');
assert.match(dashboardJs, /gradeBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 fw-bold d-inline-flex align-items-center justify-content-center">Grade \${gradeCode}<\/span>`/,
  'dashboard.js gradeBadge must include d-inline-flex align-items-center justify-content-center in both views');

console.log('PASS Part 4: CSS overlap fixes and badge centering verified.');

// 5. Verify UI Response Time & In-Memory Bootstrap Caching
assert.match(hrWorkspaceSource, /async function load\(force=false\)/, 'load function must accept force reload parameter');
assert.match(hrWorkspaceSource, /if\(!force&&loadedScope\.value===requestedScope&&Object\.keys\(records\.value\|\|\{\}\)\.length>0\)return;/,
  'load function must use in-memory cache to avoid duplicate network requests when switching sub-modules');

console.log('PASS Part 5: In-memory bootstrap caching and instant sub-module navigation verified.');

console.log('\nALL FILTER OVERLAP, UNIVERSAL FILTER & RESOURCE MANAGEMENT TESTS PASSED!\n');
