const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Remediation Suite for Mobile Camera, Login UI, Shift Deduplication, Team Scoping & Profile Parity ---');

const rootDir = path.resolve(__dirname, '..');

// 1. Mobile Camera Upload & Compression
console.log('\n[1/5] Testing Mobile Camera Upload & Compression...');
const compressorPath = path.join(rootDir, 'src/utils/imageCompressor.js');
assert.ok(fs.existsSync(compressorPath), 'imageCompressor.js must exist');
const compressorSrc = fs.readFileSync(compressorPath, 'utf8');
assert.ok(compressorSrc.includes('export async function compressImageToDataUrl'), 'Must export compressImageToDataUrl');
assert.ok(compressorSrc.includes('maxChars'), 'Must support maxChars limit');

const mobileReqPath = path.join(rootDir, 'src/components/mobile/MobileRequests.vue');
const mobileReqSrc = fs.readFileSync(mobileReqPath, 'utf8');
assert.ok(mobileReqSrc.includes('compressImageToDataUrl'), 'MobileRequests.vue must use compressImageToDataUrl');
assert.ok(mobileReqSrc.includes('isCompressingPhoto'), 'MobileRequests.vue must track isCompressingPhoto');
assert.ok(mobileReqSrc.includes('isCompressingLeave'), 'MobileRequests.vue must track isCompressingLeave');
assert.ok(mobileReqSrc.includes('Optimizing camera receipt for upload'), 'Must show loading indicator for camera receipt optimization');
console.log('PASS: Client-side image compressor and mobile upload indicators verified.');

// 2. Login UI & Mobile Interface
console.log('\n[2/5] Testing Login Labels & Mobile Interface Styling...');
const dashboardVuePath = path.join(rootDir, 'src/components/PayrollDashboard.vue');
const dashboardVueSrc = fs.readFileSync(dashboardVuePath, 'utf8');
assert.ok(!dashboardVueSrc.includes('Username (IC/Email)'), 'Login label must not contain (IC/Email)');
assert.ok(dashboardVueSrc.includes('for="loginUser">Username</label>'), 'Login label must be clean "Username"');
assert.ok(dashboardVueSrc.includes('placeholder="Enter your username"'), 'Login placeholder must be "Enter your username"');

const workspaceCssPath = path.join(rootDir, 'src/styles/workspace.css');
const workspaceCssSrc = fs.readFileSync(workspaceCssPath, 'utf8');
assert.ok(workspaceCssSrc.includes('#loginBox,#forgotPassBox{width:100%!important;max-width:390px!important;padding:28px 22px!important;margin:0 auto!important;border-radius:24px!important}'), 'workspace.css must apply proper padding and centering on mobile login');

const liquidGlassCssPath = path.join(rootDir, 'src/styles/liquid-glass.css');
const liquidGlassCssSrc = fs.readFileSync(liquidGlassCssPath, 'utf8');
assert.ok(liquidGlassCssSrc.includes('.login-intro{background:none!important;border:none!important;box-shadow:none!important}'), 'liquid-glass.css must remove intro banner borders on mobile');
console.log('PASS: Clean Username label and responsive mobile login styling verified.');

// 3. Shift Deduplication & Recurring Generate Button Removal
console.log('\n[3/5] Testing Shift Deduplication & Recurring Generate Button Removal...');
const hrWorkspacePath = path.join(rootDir, 'src/components/HrWorkspace.vue');
const hrWorkspaceSrc = fs.readFileSync(hrWorkspacePath, 'utf8');
assert.ok(!hrWorkspaceSrc.includes('Generate MS &amp; SQ Shifts'), 'HrWorkspace must not have recurring seed button');
assert.ok(!hrWorkspaceSrc.includes('Generate Milan Stream &amp; Setar Quay Default Shifts'), 'HrWorkspace must not have empty state recurring seed button');
assert.ok(hrWorkspaceSrc.includes('deduplicateSchedules'), 'HrWorkspace must have deduplicateSchedules function');

const backendPath = path.join(rootDir, 'backend/GAS_payroll.js');
const backendSrc = fs.readFileSync(backendPath, 'utf8');
assert.ok(backendSrc.includes("module==='workSchedules'") && backendSrc.includes('already exists for this company'), 'Backend must validate uniqueness of company + code for workSchedules');
assert.ok(backendSrc.includes('hrSeedWorkSchedules_') && backendSrc.includes('Prune any duplicate schedule rows in the sheet'), 'Backend seed must prune existing duplicate rows');
console.log('PASS: Shift deduplication and UI generator cleanup verified.');

// 4. Team Directory Scoping vs Employee Management
console.log('\n[4/5] Testing Team Directory (Subordinates) vs Employee Management (All Staff)...');
const navPath = path.join(rootDir, 'src/hr/navigation.js');
const navSrc = fs.readFileSync(navPath, 'utf8');
assert.ok(navSrc.includes("page('staff-mgmt','Team Directory','people','team')"), 'Team Directory must have scope: team');
assert.ok(navSrc.includes("page('staff-mgmt','Employee Management','people','all')"), 'Employee Management must have scope: all');

const dashboardJsPath = path.join(rootDir, 'src/services/dashboard.js');
const dashboardJsSrc = fs.readFileSync(dashboardJsPath, 'utf8');
assert.ok(dashboardJsSrc.includes('getSubordinateNames'), 'dashboard.js must implement getSubordinateNames helper');
assert.ok(dashboardJsSrc.includes("currentStaffScope === 'team'"), 'dashboard.js must check currentStaffScope');
assert.ok(dashboardJsSrc.includes("'Team Directory' : 'Employee Management'"), 'Page title must reflect Team Directory vs Employee Management');
assert.ok(dashboardJsSrc.includes("$('#btnAddStaff').hide()"), 'Add Staff button must be hidden in Team Directory');
assert.ok(!dashboardVueSrc.includes('<div id="staff-mgmt" class="tab-section admin-only-element"'), 'staff-mgmt container must not be restricted by admin-only-element');
console.log('PASS: Team Directory subordinate scoping and Employee Management master view verified.');

// 5. My Profile Parity with Staff Profile (Documents tab, folder link, status, password)
console.log('\n[5/5] Testing My Profile 5-Tab Parity with Staff Profile...');
assert.ok(dashboardVueSrc.includes('id="myprofile-tab-docs-btn"'), 'My Profile must have Tab 5 Documents button');
assert.ok(dashboardVueSrc.includes('id="myprofile-tab-docs"'), 'My Profile must have Tab 5 Documents content pane');
assert.ok(dashboardVueSrc.includes('id="myProfileFolderLink"'), 'My Profile must display Google Drive Folder Link');
assert.ok(dashboardVueSrc.includes('id="myProfileAttachmentList"'), 'My Profile must display profile attachments');
assert.ok(dashboardVueSrc.includes('id="myProfileStatus"'), 'My Profile Tab 1 must display Status');
assert.ok(dashboardVueSrc.includes('id="myProfilePassword"'), 'My Profile Tab 1 must allow Password update');

assert.ok(dashboardJsSrc.includes("$('#myProfileStatus').val(currentFullProfile.status || 'Active')"), 'loadMyProfile must populate status');
assert.ok(dashboardJsSrc.includes("$('#myProfileFolderLink').html"), 'loadMyProfile must populate staffFolderUrl');
assert.ok(dashboardJsSrc.includes("$('#myProfileAttachmentList').html"), 'loadMyProfile must populate profile attachments');
assert.ok(dashboardJsSrc.includes("currentFullProfile.password = newPass.trim()"), 'updateMyProfile must support password update');
console.log('PASS: My Profile 5-tab interface parity with Staff Profile verified.');

console.log('\n=============================================================');
console.log('ALL REMEDIATION & PROFILE PARITY TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================');
