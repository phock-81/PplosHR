const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Induction Policy Engine (CommonJS) ---');

const policy = require('../src/services/inductionPolicy.cjs');

// 1. calculateAnnualLeaveEntitlement(completedYears, completedMonths = 12)
// 1st year confirmed: 12 days
assert.equal(policy.calculateAnnualLeaveEntitlement(1), 12, '1st year confirmed service should be 12 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(1, 12), 12, '1st year with 12 months should be 12 days');

// Incomplete 1st year prorated: Math.floor((completedMonths / 12) * 12)
assert.equal(policy.calculateAnnualLeaveEntitlement(0, 6), 6, '0 years, 6 months should prorate to 6 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(0, 1), 1, '0 years, 1 month should prorate to 1 day');
assert.equal(policy.calculateAnnualLeaveEntitlement(0, 0), 0, '0 years, 0 months should be 0 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(0, 11), 11, '0 years, 11 months should prorate to 11 days');

// +1 day for each additional completed service year up to max 26 days
assert.equal(policy.calculateAnnualLeaveEntitlement(2), 13, '2 completed years should be 13 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(3), 14, '3 completed years should be 14 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(5), 16, '5 completed years should be 16 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(10), 21, '10 completed years should be 21 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(14), 25, '14 completed years should be 25 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(15), 26, '15 completed years should be max 26 days');
assert.equal(policy.calculateAnnualLeaveEntitlement(20), 26, '20 completed years should cap at 26 days');

// 2. calculateSickLeaveEntitlement(completedYears)
// < 2 years: 14 days
const sick0 = policy.calculateSickLeaveEntitlement(0);
assert.equal(Number(sick0), 14, '< 2 years outpatient sick leave should be 14 days');
assert.equal(sick0.outpatient, 14);
assert.equal(sick0.hospitalization, 60, 'Hospitalization entitlement should be 60 days');

const sick1 = policy.calculateSickLeaveEntitlement(1);
assert.equal(Number(sick1), 14, '1 year service outpatient sick leave should be 14 days');
assert.equal(sick1.outpatient, 14);
assert.equal(sick1.hospitalization, 60);

// 2 to < 5 years: 18 days
const sick2 = policy.calculateSickLeaveEntitlement(2);
assert.equal(Number(sick2), 18, '2 years service outpatient sick leave should be 18 days');
assert.equal(sick2.outpatient, 18);
assert.equal(sick2.hospitalization, 60);

const sick4 = policy.calculateSickLeaveEntitlement(4);
assert.equal(Number(sick4), 18, '4 years service outpatient sick leave should be 18 days');
assert.equal(sick4.outpatient, 18);

// 5+ years: 22 days
const sick5 = policy.calculateSickLeaveEntitlement(5);
assert.equal(Number(sick5), 22, '5 years service outpatient sick leave should be 22 days');
assert.equal(sick5.outpatient, 22);
assert.equal(sick5.hospitalization, 60);

const sick10 = policy.calculateSickLeaveEntitlement(10);
assert.equal(Number(sick10), 22, '10 years service outpatient sick leave should be 22 days');
assert.equal(sick10.outpatient, 22);

// Direct hospitalization query or flag
assert.equal(policy.calculateSickLeaveEntitlement(1, true), 60);

// 3. calculateCarryForward(balance, asOfDate)
// Standard carry-forward up to 14 days allowed until 31-Dec of following year.
// Excess over 14 days: valid only up to 30-April; after April 30, excess is forfeited.

// Case A: Balance <= 14 days (no excess to forfeit)
const cfSmallBefore = policy.calculateCarryForward(10, '2026-04-15');
assert.equal(Number(cfSmallBefore), 10, '10 days before April 30 should retain 10');
assert.equal(cfSmallBefore.allowable, 10);
assert.equal(cfSmallBefore.forfeited, 0);

const cfSmallAfter = policy.calculateCarryForward(10, '2026-05-01');
assert.equal(Number(cfSmallAfter), 10, '10 days after April 30 should retain 10 (no excess)');
assert.equal(cfSmallAfter.allowable, 10);
assert.equal(cfSmallAfter.forfeited, 0);

// Case B: Balance = 18 days (> 14 days: 14 standard + 4 excess)
const cfExcessBefore = policy.calculateCarryForward(18, '2026-04-30');
assert.equal(Number(cfExcessBefore), 18, '18 days on 30-April still retains full 18 days');
assert.equal(cfExcessBefore.allowable, 18);
assert.equal(cfExcessBefore.forfeited, 0);

const cfExcessAfter = policy.calculateCarryForward(18, '2026-05-01');
assert.equal(Number(cfExcessAfter), 14, '18 days on 1-May must forfeit 4 days excess, retaining 14');
assert.equal(cfExcessAfter.allowable, 14);
assert.equal(cfExcessAfter.forfeited, 4);

const cfExcessLater = policy.calculateCarryForward(20, new Date('2026-08-20'));
assert.equal(Number(cfExcessLater), 14, '20 days in August must retain 14 and forfeit 6');
assert.equal(cfExcessLater.allowable, 14);
assert.equal(cfExcessLater.forfeited, 6);

// 4. checkOvertimeEligibility(basicSalary, roleType)
// Office/Executive: basic <= 4000 eligible, > 4000 not eligible
assert.equal(policy.checkOvertimeEligibility(3500, 'Office'), true, 'Office basic 3500 should be eligible');
assert.equal(policy.checkOvertimeEligibility(4000, 'Office'), true, 'Office basic 4000 should be eligible');
assert.equal(policy.checkOvertimeEligibility(4000, 'Executive'), true, 'Executive basic 4000 should be eligible');
assert.equal(policy.checkOvertimeEligibility(4001, 'Office'), false, 'Office basic 4001 should not be eligible');
assert.equal(policy.checkOvertimeEligibility(5000, 'Executive'), false, 'Executive basic 5000 should not be eligible');

// Site: basic <= 7000 eligible (flat 1.0x)
assert.equal(policy.checkOvertimeEligibility(4000, 'Site'), true, 'Site basic 4000 should be eligible');
assert.equal(policy.checkOvertimeEligibility(7000, 'Site'), true, 'Site basic 7000 should be eligible');
assert.equal(policy.checkOvertimeEligibility(7001, 'Site'), false, 'Site basic 7001 should not be eligible');
assert.equal(policy.checkOvertimeEligibility(8000, 'Site Operations'), false, 'Site basic 8000 should not be eligible');

// 5. roundOvertimeHours(minutes, roleType)
// Office: rounded to nearest 15 mins (0.25h)
assert.equal(policy.roundOvertimeHours(0, 'Office'), 0, '0 mins -> 0 hours');
assert.equal(policy.roundOvertimeHours(7, 'Office'), 0, '7 mins rounds down to 0h');
assert.equal(policy.roundOvertimeHours(8, 'Office'), 0.25, '8 mins rounds up to 15 mins (0.25h)');
assert.equal(policy.roundOvertimeHours(15, 'Office'), 0.25, '15 mins -> 0.25h');
assert.equal(policy.roundOvertimeHours(38, 'Office'), 0.75, '38 mins -> 45 mins (0.75h)');
assert.equal(policy.roundOvertimeHours(45, 'Office'), 0.75, '45 mins -> 0.75h');
assert.equal(policy.roundOvertimeHours(50, 'Office'), 0.75, '50 mins -> 45 mins (0.75h)');
assert.equal(policy.roundOvertimeHours(53, 'Office'), 1.0, '53 mins -> 60 mins (1.0h)');
assert.equal(policy.roundOvertimeHours(90, 'Office'), 1.5, '90 mins -> 1.5h');

// Site: rounded to nearest 30 mins (0.5h), minimum 1 hour
assert.equal(policy.roundOvertimeHours(0, 'Site'), 0, '0 mins site -> 0h');
assert.equal(policy.roundOvertimeHours(15, 'Site'), 1.0, '15 mins site rounds to min 1.0h');
assert.equal(policy.roundOvertimeHours(30, 'Site'), 1.0, '30 mins site rounds to min 1.0h');
assert.equal(policy.roundOvertimeHours(45, 'Site'), 1.0, '45 mins site rounds to 60m (1.0h)');
assert.equal(policy.roundOvertimeHours(75, 'Site'), 1.5, '75 mins site rounds to 90m (1.5h)');
assert.equal(policy.roundOvertimeHours(90, 'Site'), 1.5, '90 mins site rounds to 1.5h');
assert.equal(policy.roundOvertimeHours(100, 'Site'), 1.5, '100 mins site rounds to 90m (1.5h)');
assert.equal(policy.roundOvertimeHours(110, 'Site'), 2.0, '110 mins site rounds to 120m (2.0h)');

// 6. getTravelAllowance(gradeCode, distanceKm)
// > 250 km from base:
// Grade S: 'receipt'
// Grade M: RM 70/day
// Grade E: RM 50/day
// Mileage rates: Car RM 0.50/km, Motorcycle RM 0.20/km
const travelS = policy.getTravelAllowance('S', 300);
assert.equal(travelS.mealAllowance, 'receipt', 'Grade S > 250km meal allowance is receipt');
assert.equal(travelS.mileageRates.car, 0.50, 'Car mileage rate should be 0.50');
assert.equal(travelS.mileageRates.motorcycle, 0.20, 'Motorcycle mileage rate should be 0.20');

const travelM = policy.getTravelAllowance('M', 280);
assert.equal(travelM.mealAllowance, 70, 'Grade M > 250km meal allowance is RM 70/day');
assert.equal(travelM.dailyMeal, 70);

const travelE = policy.getTravelAllowance('E', 350);
assert.equal(travelE.mealAllowance, 50, 'Grade E > 250km meal allowance is RM 50/day');

const travelNear = policy.getTravelAllowance('M', 150);
assert.equal(travelNear.mealAllowance, 0, '<= 250km has no outstation meal allowance');

// 7. checkZeroMcAwardEligibility(mcDaysTaken, isConfirmed)
// RM 300 if confirmed and mcDaysTaken === 0
const zeroMcOk = policy.checkZeroMcAwardEligibility(0, true);
assert.equal(Number(zeroMcOk), 300, '0 MC and confirmed employee qualifies for RM 300 award');
assert.equal(zeroMcOk.eligible, true);
assert.equal(zeroMcOk.amount, 300);

const zeroMcFailDays = policy.checkZeroMcAwardEligibility(1, true);
assert.equal(Number(zeroMcFailDays), 0, '1 MC day disqualifies from Zero-MC award');
assert.equal(zeroMcFailDays.eligible, false);
assert.equal(zeroMcFailDays.amount, 0);

const zeroMcFailProbation = policy.checkZeroMcAwardEligibility(0, false);
assert.equal(Number(zeroMcFailProbation), 0, 'Unconfirmed employee does not qualify for Zero-MC award');
assert.equal(zeroMcFailProbation.eligible, false);

console.log('PASS: induction-policy.test.cjs - All Metrio Induction Policy rules verified.');
