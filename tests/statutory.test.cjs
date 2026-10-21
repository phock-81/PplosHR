const assert = require('node:assert/strict');
const statutory = require('../src/services/statutory.cjs');

// Test 1: EPF Calculation
// Below 60, wage <= 5000: 11% EE, 13% ER
const epf1 = statutory.calculateEpf(4000, 30);
assert.equal(epf1.employee, 440);
assert.equal(epf1.employer, 520);

// Below 60, wage > 5000: 11% EE, 12% ER
const epf2 = statutory.calculateEpf(6000, 30);
assert.equal(epf2.employee, 660);
assert.equal(epf2.employer, 720);

// Age 60 and above: 0% EE, 4% ER
const epfSenior = statutory.calculateEpf(5000, 62);
assert.equal(epfSenior.employee, 0);
assert.equal(epfSenior.employer, 200);

// Zero or negative wage
const epfZero = statutory.calculateEpf(0, 30);
assert.equal(epfZero.employee, 0);
assert.equal(epfZero.employer, 0);

// Test 2: SOCSO Calculation (Act 4 amended RM 6,000 ceiling)
// Cat 1 (Age < 60) for wage RM 3,550
const socso1 = statutory.calculateSocso(3550, 35);
assert.equal(socso1.employee, 17.75);
assert.equal(socso1.employer, 62.15);

// Cat 1 for wage RM 6,500 (capped at RM 6,000 ceiling: EE 29.75, ER 104.15)
const socsoMax = statutory.calculateSocso(6500, 35);
assert.equal(socsoMax.employee, 29.75);
assert.equal(socsoMax.employer, 104.15);

// Cat 2 (Age >= 60) for wage RM 6,500 (EE 0, ER capped at 74.40)
const socsoSenior = statutory.calculateSocso(6500, 62);
assert.equal(socsoSenior.employee, 0);
assert.equal(socsoSenior.employer, 74.40);

// Zero or negative wage
const socsoZero = statutory.calculateSocso(0, 30);
assert.equal(socsoZero.employee, 0);
assert.equal(socsoZero.employer, 0);

// Test 3: EIS Calculation (Act 800 amended RM 6,000 ceiling)
const eis1 = statutory.calculateEis(4000, 30);
assert.equal(eis1.employee, 8.00);
assert.equal(eis1.employer, 8.00);

// Capped at RM 6,000: EE 11.90, ER 11.90
const eisMax = statutory.calculateEis(7000, 30);
assert.equal(eisMax.employee, 11.90);
assert.equal(eisMax.employer, 11.90);

// Age >= 60 is strictly exempt (0, 0)
const eisSenior = statutory.calculateEis(5000, 62);
assert.equal(eisSenior.employee, 0);
assert.equal(eisSenior.employer, 0);

// Zero or negative wage
const eisZero = statutory.calculateEis(0, 30);
assert.equal(eisZero.employee, 0);
assert.equal(eisZero.employer, 0);

// Test 4: PCB Calculation
// Income <= RM 3,000 monthly: PCB is 0 (due to basic reliefs + Section 6A rebate)
const pcbLow = statutory.calculatePcb(3000, 330, 0, 30);
assert.equal(pcbLow, 0);

// Income RM 10,000 monthly: PCB computed with progressive brackets
const pcbHigh = statutory.calculatePcb(10000, 333.33, 0, 30);
assert.ok(pcbHigh > 800 && pcbHigh < 1100, `PCB should be in expected tax range, got ${pcbHigh}`);

// TP1 relief should reduce PCB
const pcbWithTp1 = statutory.calculatePcb(10000, 333.33, 500, 30);
assert.ok(pcbWithTp1 < pcbHigh, `TP1 relief should reduce PCB: ${pcbWithTp1} < ${pcbHigh}`);

// Zero income gives 0 PCB
assert.equal(statutory.calculatePcb(0, 0, 0, 30), 0);

// Test 5: Verify exported constants and structures
assert.ok(statutory.DEFAULT_STATUTORY_CONFIG, 'DEFAULT_STATUTORY_CONFIG must be exported');
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.socsoCeiling, 6000.0);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.eisCeiling, 6000.0);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.epfEmployeeStandardRate, 0.11);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.epfEmployerLowWageRate, 0.13);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.epfEmployerHighWageRate, 0.12);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.epfEmployerSeniorRate, 0.04);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.pcbIndividualReliefMonthly, 750.0);
assert.equal(statutory.DEFAULT_STATUTORY_CONFIG.pcbEpfMaxMonthlyDeduction, 333.33);

assert.ok(statutory.TP1_RELIEF_CAPS, 'TP1_RELIEF_CAPS must be exported');
assert.equal(statutory.TP1_RELIEF_CAPS.parent_medical, 8000.0);
assert.equal(statutory.TP1_RELIEF_CAPS.lifestyle_general, 2500.0);
assert.equal(statutory.TP1_RELIEF_CAPS.lifestyle_sports, 1000.0);
assert.equal(statutory.TP1_RELIEF_CAPS.socso_relief, 350.0);

assert.ok(Array.isArray(statutory.SOCSO_SCHEDULE), 'SOCSO_SCHEDULE must be an array');
assert.ok(statutory.SOCSO_SCHEDULE.length > 50, 'SOCSO_SCHEDULE should cover tiers up to 6,000');

console.log('PASS: statutory.test.cjs - EPF, SOCSO, EIS, PCB and statutory constants verified.');
