const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Resource Catalogue & Mobile Sync Tests', async (t) => {
  const resourceCodes = [
    'NB', 'PC', 'MON', 'TAB', 'PHONE', 'MSC', 'BB', 'TEL', 'PRT', 'SCN',
    'CM', 'ACC', 'HDD', 'CAR', 'FUEL', 'TOLL', 'PARK', 'KEY', 'ACS', 'REM',
    'UNI', 'PPE', 'TOOL', 'MEAS', 'PTYC', 'ADV', 'OTH'
  ];

  await t.test('STANDARD_RESOURCES file exports all 27 required corporate resources', () => {
    const filePath = path.join(__dirname, '../src/services/resourceCatalogue.js');
    assert.ok(fs.existsSync(filePath), 'resourceCatalogue.js exists');
    const content = fs.readFileSync(filePath, 'utf8');
    resourceCodes.forEach(code => {
      assert.ok(content.includes(`code: '${code}'`), `Resource code ${code} must be defined`);
    });
  });

  await t.test('GAS_payroll.js implements hrSeedResources_ with all 27 resource types', () => {
    const gasPath = path.join(__dirname, '../backend/GAS_payroll.js');
    assert.ok(fs.existsSync(gasPath), 'GAS_payroll.js exists');
    const content = fs.readFileSync(gasPath, 'utf8');
    assert.ok(content.includes('function hrSeedResources_()'), 'hrSeedResources_ function must be declared');
    assert.ok(content.includes('hrSeedResources_();'), 'hrSeedResources_ must be called during bootstrap');
    resourceCodes.forEach(code => {
      assert.ok(content.includes(`code: '${code}'`), `Backend seed must include code ${code}`);
    });
  });

  await t.test('MobileRequests.vue integrates STANDARD_RESOURCES and formats options', () => {
    const reqPath = path.join(__dirname, '../src/components/mobile/MobileRequests.vue');
    const content = fs.readFileSync(reqPath, 'utf8');
    assert.ok(content.includes("import { STANDARD_RESOURCES } from '../../services/resourceCatalogue'"), 'STANDARD_RESOURCES must be imported');
    assert.ok(content.includes('STANDARD_RESOURCES'), 'STANDARD_RESOURCES fallback in availableResources');
    assert.ok(content.includes('r.code ? `[${r.code}] ` : \'\''), 'Option label must format with [CODE]');
  });

  await t.test('workspace.css styles #kpiPanelSum with 5 columns for single-line display', () => {
    const cssPath = path.join(__dirname, '../src/styles/workspace.css');
    const content = fs.readFileSync(cssPath, 'utf8');
    assert.ok(content.includes('#kpiPanelSum{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important'), '#kpiPanelSum must be 5 columns');
  });

  await t.test('MobileAppShell.vue styles top header bar, avatar button, and bell button', () => {
    const shellPath = path.join(__dirname, '../src/components/mobile/MobileAppShell.vue');
    const content = fs.readFileSync(shellPath, 'utf8');
    assert.ok(content.includes('.m-header-bar'), '.m-header-bar styles present');
    assert.ok(content.includes('.m-avatar-btn'), '.m-avatar-btn styles present');
    assert.ok(content.includes('.m-icon-btn'), '.m-icon-btn styles present');
  });

  await t.test('MobileHome.vue alAvailable falls back to entitlements without showing dash', () => {
    const homePath = path.join(__dirname, '../src/components/mobile/MobileHome.vue');
    const content = fs.readFileSync(homePath, 'utf8');
    assert.ok(content.includes('props.user?.alBalance'), 'Checks user alBalance');
    assert.ok(content.includes('s.alBalance'), 'Checks staffSettings alBalance');
    assert.ok(content.includes('s.alEntitlement'), 'Checks staffSettings alEntitlement');
    assert.ok(content.includes('props.user?.alEntitlement'), 'Checks user alEntitlement');
  });
});
