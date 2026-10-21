const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Mobile Home pending approval count includes bookings/resources and claims for HOD/Manager', () => {
  const homeVue = fs.readFileSync(path.resolve(__dirname, '../src/components/mobile/MobileHome.vue'), 'utf8');
  assert.match(homeVue, /mod === 'bookings' \|\| mod === 'loans'/, 'pendingApprovalsCount must count pending bookings and loans for managers');
});

test('GAS_payroll backend routes and default template for clock locations', () => {
  const backend = fs.readFileSync(path.resolve(__dirname, '../backend/GAS_payroll.js'), 'utf8');
  
  // Verify default template
  assert.match(backend, /DEFAULT_CLOCK_LOCATIONS\s*=/, 'DEFAULT_CLOCK_LOCATIONS defined');
  assert.match(backend, /'ARCHITECT OFFICE'/, 'Template contains ARCHITECT OFFICE');
  assert.match(backend, /'SITE'/, 'Template contains SITE');
  assert.match(backend, /'VEHICLE MAINTENANCE'/, 'Template contains VEHICLE MAINTENANCE');

  // Verify getClockLocationsData_ and saveClockLocations_
  assert.match(backend, /function getClockLocationsData_\(/, 'getClockLocationsData_ implemented');
  assert.match(backend, /function saveClockLocations_\(/, 'saveClockLocations_ implemented');

  // Verify routes in doPost / READ_ACTIONS
  assert.match(backend, /(case 'getClockLocations':|action === 'getClockLocations')/, 'getClockLocations routed in doPost');
  assert.match(backend, /(case 'saveClockLocations':|action === 'saveClockLocations')/, 'saveClockLocations routed in doPost');

  // Verify mobileClockPunch accepts address, checkInLocation, remark
  assert.match(backend, /const checkInLocation = String\(payload\.checkInLocation/, 'mobileClockPunch saves checkInLocation');
  assert.match(backend, /const address = String\(payload\.address/, 'mobileClockPunch saves address');
  assert.match(backend, /const remark = String\(payload\.remark/, 'mobileClockPunch saves remark');
});

test('MobileAttendance.vue provides GPS Loc, Check In Location dropdown, and Address on punches', () => {
  const attVue = fs.readFileSync(path.resolve(__dirname, '../src/components/mobile/MobileAttendance.vue'), 'utf8');

  // Verify state
  assert.match(attVue, /const selectedCheckInLocation = ref\(/, 'selectedCheckInLocation state defined');
  assert.match(attVue, /const clockRemark = ref\(/, 'clockRemark state defined');
  assert.match(attVue, /const currentGpsAddress = ref\(/, 'currentGpsAddress state defined');
  assert.match(attVue, /const isResolvingAddress = ref\(/, 'isResolvingAddress state defined');
  assert.match(attVue, /const clockLocations = computed\(/, 'clockLocations computed list defined');

  // Verify reverse geocoding function
  assert.match(attVue, /async function reverseGeocode\(lat,\s*lng\)/, 'reverseGeocode helper exists');
  assert.match(attVue, /async function refreshGpsAddress\(\)/, 'refreshGpsAddress helper exists');

  // Verify UI elements in template
  assert.match(attVue, /GPS Loc :/, 'GPS Loc label rendered');
  assert.match(attVue, /Check In Location :/, 'Check In Location dropdown rendered');
  assert.match(attVue, /Remark :/, 'Remark input rendered');
  assert.match(attVue, /mobileTodayIn\?\.address/, 'Today status 1st In shows address');
  assert.match(attVue, /mobileTodayOut\?\.address/, 'Today status Last Out shows address');
});

test('MobileClockPolicyAdmin.vue provides Check-In Location template and HR management', () => {
  const adminVue = fs.readFileSync(path.resolve(__dirname, '../src/components/MobileClockPolicyAdmin.vue'), 'utf8');

  // Verify management state & methods
  assert.match(adminVue, /const DEFAULT_CLOCK_LOCATIONS =/, 'DEFAULT_CLOCK_LOCATIONS template defined');
  assert.match(adminVue, /function addLocation\(\)/, 'addLocation method exists');
  assert.match(adminVue, /function startEditLocation\(/, 'startEditLocation method exists');
  assert.match(adminVue, /function deleteLocation\(/, 'deleteLocation method exists');
  assert.match(adminVue, /function resetToTemplateLocations\(\)/, 'resetToTemplateLocations method exists');
  assert.match(adminVue, /async function saveLocations\(\)/, 'saveLocations method exists');

  // Verify UI card rendered
  assert.match(adminVue, /Check-In Location Dropdown Options/, 'Check-In Location Dropdown Options card exists');
  assert.match(adminVue, /Reset to Default Template/, 'Reset to Default Template button exists');
  assert.match(adminVue, /Save Dropdown Options/, 'Save Dropdown Options button exists');
});
