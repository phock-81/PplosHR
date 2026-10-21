const fs = require('fs');
const assert = require('assert');

console.log('--- RUNNING FULL-SCREEN VERIFICATION TESTS ---');

// 1. Verify hr.css
const hrCss = fs.readFileSync('src/styles/hr.css', 'utf8');
assert(hrCss.includes('.hr-dialog.is-fullscreen'), 'hr.css must define .hr-dialog.is-fullscreen');
assert(hrCss.includes('width:100vw !important') || hrCss.includes('width:100dvw !important'), 'hr.css must set 100vw for fullscreen dialog');
assert(hrCss.includes('height:100vh !important') || hrCss.includes('height:100dvh !important'), 'hr.css must set 100vh for fullscreen dialog');
assert(hrCss.includes('.hr-dialog-backdrop.is-fullscreen-backdrop'), 'hr.css must define .is-fullscreen-backdrop');
console.log('PASS: hr.css defines full-screen dialog styles and backdrop adjustments');

// 2. Verify HrWorkspace.vue
const hrVue = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert(hrVue.includes('isDialogFullscreen'), 'HrWorkspace.vue must define isDialogFullscreen');
assert(hrVue.includes(":class=\"{'is-fullscreen': isDialogFullscreen}\""), 'HrWorkspace.vue must bind is-fullscreen class on dialogs');
assert(hrVue.includes(":class=\"{'is-fullscreen-backdrop': isDialogFullscreen}\""), 'HrWorkspace.vue must bind is-fullscreen-backdrop on backdrop');
assert(hrVue.includes("isDialogFullscreen ? 'Exit Full Screen' : 'Full Screen'"), 'HrWorkspace.vue must have fullscreen toggle button');
assert(hrVue.includes('.enterprise-ops-card') && hrVue.includes('max-width: 100%'), 'HrWorkspace.vue enterprise ops card must be max-width: 100%');
console.log('PASS: HrWorkspace.vue provides default full-screen dialog and toggle controls');

// 3. Verify workspace.css and liquid-glass.css
const wsCss = fs.readFileSync('src/styles/workspace.css', 'utf8');
const lgCss = fs.readFileSync('src/styles/liquid-glass.css', 'utf8');
assert(wsCss.includes('#content{padding:36px 42px 56px;min-width:0;max-width:100%!important;width:100%'), 'workspace.css must set #content max-width: 100%');
assert(lgCss.includes('#content{max-width:100%!important;width:100%'), 'liquid-glass.css must set #content max-width: 100%');
console.log('PASS: workspace.css and liquid-glass.css expand #content to 100% full screen width');

// 4. Verify PayrollDashboard.vue
const dashVue = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');
assert(dashVue.includes('id="fullscreenToggleBtn"'), 'PayrollDashboard.vue must have #fullscreenToggleBtn in header');
assert(dashVue.includes('toggleBrowserFullscreen'), 'PayrollDashboard.vue must define toggleBrowserFullscreen');
assert(dashVue.includes('modal-dialog modal-xl modal-fullscreen-lg-down'), 'PayrollDashboard.vue modals must use modal-xl modal-fullscreen-lg-down');
console.log('PASS: PayrollDashboard.vue includes browser fullscreen toggle and expansive modals');

console.log('--- ALL FULL-SCREEN VERIFICATION TESTS PASSED ---');
