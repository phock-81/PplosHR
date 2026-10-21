const fs = require('fs');
const assert = require('assert');

console.log('--- RUNNING SCHEDULE BUILDER WIDTH & MODAL SIZE TESTS ---');

// 1. Verify hr.css dialog size
const hrCss = fs.readFileSync('src/styles/hr.css', 'utf8');
assert(hrCss.includes('.hr-dialog{display:flex;flex-direction:column;width:min(880px,calc(100vw - 24px))'), 'hr.css must set .hr-dialog to standard comfortable size min(880px)');
console.log('PASS: hr.css dialog reverted to comfortable standard width (880px)');

// 2. Verify HrWorkspace.vue schedule builder enlargement to 100% width
const hrVue = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert(hrVue.includes('isDialogFullscreen=ref(false)'), 'HrWorkspace.vue isDialogFullscreen must default to false (not forced full screen)');
assert(hrVue.includes('<div v-if="active===\'workSchedules\'" class="w-100 mt-3">'), 'HrWorkspace.vue schedule builder must have class="w-100 mt-3"');
const gridCloseIdx = hrVue.indexOf('role="alert">{{validationErrors[field.key]}}</small></div></div>');
const schOpenIdx = hrVue.indexOf('<div v-if="active===\'workSchedules\'" class="w-100 mt-3">');
assert(gridCloseIdx !== -1, 'HrWorkspace.vue must close hr-form-grid');
assert(schOpenIdx !== -1, 'HrWorkspace.vue must have schedule builder');
assert(gridCloseIdx < schOpenIdx, 'HrWorkspace.vue must close hr-form-grid before opening schedule builder so builder spans 100% full width of dialog');
console.log('PASS: HrWorkspace.vue schedule builder is placed outside 2-column grid and spans 100% full width of dialog');

// 3. Verify workspace.css and liquid-glass.css
const wsCss = fs.readFileSync('src/styles/workspace.css', 'utf8');
const lgCss = fs.readFileSync('src/styles/liquid-glass.css', 'utf8');
assert(wsCss.includes('#content{padding:36px 42px 56px;min-width:0;max-width:1720px;margin:0 auto}'), 'workspace.css #content restored to max-width: 1720px');
assert(lgCss.includes('#content{max-width:1740px;padding:34px 38px 112px}'), 'liquid-glass.css #content restored to max-width: 1740px');
console.log('PASS: workspace.css and liquid-glass.css restored to standard previous widths');

// 4. Verify PayrollDashboard.vue modals
const dashVue = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');
assert(dashVue.includes('id="staffProfileModal" tabindex="-1">\n    <div class="modal-dialog modal-lg">') || dashVue.includes('id="staffProfileModal" tabindex="-1">\r\n    <div class="modal-dialog modal-lg">'), 'staffProfileModal restored to modal-lg');
assert(dashVue.includes('id="editRowModal" tabindex="-1">\n    <div class="modal-dialog modal-lg">') || dashVue.includes('id="editRowModal" tabindex="-1">\r\n    <div class="modal-dialog modal-lg">'), 'editRowModal restored to modal-lg');
console.log('PASS: PayrollDashboard.vue modals restored to standard modal-lg');

console.log('--- ALL SCHEDULE BUILDER WIDTH & MODAL SIZE TESTS PASSED ---');
