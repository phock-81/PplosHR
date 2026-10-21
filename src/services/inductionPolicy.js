/**
 * Metrio Induction Policy Engine (FAM-23/G Jul 2025) & Employment Act 1955
 * 
 * Rules:
 * 1. Annual Leave Entitlement (tenure scale 12-26 days):
 *    - 1st year confirmed: 12 days
 *    - +1 day for each additional completed service year up to max 26 days (12 + Math.min(14, Math.max(0, completedYears - 1)))
 *    - Incomplete 1st year prorated: Math.floor((completedMonths / 12) * 12)
 * 2. Sick Leave Entitlement:
 *    - < 2 years: 14 days
 *    - 2 to < 5 years: 18 days
 *    - 5+ years: 22 days
 *    - Hospitalization: 60 days
 * 3. Carry Forward Rules:
 *    - Standard carry-forward up to 14 days allowed until 31-Dec of following year.
 *    - Excess over 14 days: valid only up to 30-April; after April 30, excess is forfeited.
 * 4. Overtime Eligibility & Rounding (EA 1955 Sec 60A):
 *    - Office/Executive: basic <= 4000 eligible, > 4000 not eligible
 *    - Site: basic <= 7000 eligible (flat 1.0x)
 *    - Rounding: Office rounded to nearest 15 mins (0.25h); Site rounded to nearest 30 mins (0.5h), minimum 1 hour
 * 5. Travel & Mileage Allowance:
 *    - > 250 km from base: Grade S: 'receipt', Grade M: RM 70/day, Grade E: RM 50/day
 *    - Mileage rates: Car RM 0.50/km, Motorcycle RM 0.20/km
 * 6. Zero MC Annual Award:
 *    - RM 300 if confirmed and mcDaysTaken === 0
 */

export const INDUCTION_POLICY_VERSION = 'FAM-23/G Jul 2025';
export const REGULATORY_BADGE = 'Metrio Induction Policy FAM-23/G (Jul 2025) & Employment Act 1955 Sec 60E';

export function calculateAnnualLeaveEntitlement(completedYears, completedMonths = 12) {
  const years = Number(completedYears) || 0;
  if (years >= 1) {
    return 12 + Math.min(14, Math.max(0, Math.floor(years) - 1));
  }
  const months = completedMonths != null ? Number(completedMonths) : 12;
  return Math.floor((months / 12) * 12);
}

export function calculateSickLeaveEntitlement(completedYears, isHospitalization = false) {
  const years = Number(completedYears) || 0;
  let outpatient = 14;
  if (years >= 5) {
    outpatient = 22;
  } else if (years >= 2) {
    outpatient = 18;
  } else {
    outpatient = 14;
  }
  const hospitalization = 60;
  if (isHospitalization === true || isHospitalization === 'hospitalization') {
    return hospitalization;
  }
  return {
    outpatient,
    hospitalization,
    total: outpatient + hospitalization,
    valueOf() { return outpatient; },
    toString() { return String(outpatient); }
  };
}

export function calculateCarryForward(balance, asOfDate = new Date()) {
  const bal = Math.max(0, Number(balance) || 0);
  let dateObj;
  if (asOfDate instanceof Date) {
    dateObj = asOfDate;
  } else if (typeof asOfDate === 'string') {
    dateObj = new Date(asOfDate.length === 10 ? asOfDate + 'T00:00:00Z' : asOfDate);
  } else {
    dateObj = new Date();
  }

  const month = dateObj.getUTCMonth() + 1; // 1 to 12
  const day = dateObj.getUTCDate();
  const isAfterApril30 = month > 4 || (month === 4 && day > 30);

  const standard = Math.min(14, bal);
  const excess = Math.max(0, bal - 14);
  const forfeited = isAfterApril30 ? excess : 0;
  const allowable = bal - forfeited;

  return {
    allowable,
    forfeited,
    standard,
    excess,
    isForfeited: forfeited > 0,
    valueOf() { return allowable; },
    toString() { return String(allowable); }
  };
}

export function checkOvertimeEligibility(basicSalary, roleType) {
  const salary = Number(basicSalary) || 0;
  const isSite = /site/i.test(String(roleType || ''));
  const threshold = isSite ? 7000 : 4000;
  return salary <= threshold;
}

export function roundOvertimeHours(minutes, roleType) {
  const mins = Math.max(0, Number(minutes) || 0);
  if (mins === 0) return 0;
  const isSite = /site/i.test(String(roleType || ''));
  if (isSite) {
    const rounded = Math.round(mins / 30) * 0.5;
    return Math.max(1.0, rounded);
  } else {
    return Math.round(mins / 15) * 0.25;
  }
}

export function getTravelAllowance(gradeCode, distanceKm) {
  const grade = String(gradeCode || '').toUpperCase().trim();
  const dist = Math.max(0, Number(distanceKm) || 0);
  const isOutstation = dist > 250;
  let mealAllowance = 0;
  if (isOutstation) {
    if (grade === 'S') mealAllowance = 'receipt';
    else if (grade === 'M') mealAllowance = 70;
    else if (grade === 'E') mealAllowance = 50;
    else mealAllowance = 0;
  }
  const mileageRates = {
    car: 0.50,
    motorcycle: 0.20
  };
  return {
    grade,
    distanceKm: dist,
    isOutstation,
    mealAllowance,
    dailyMeal: typeof mealAllowance === 'number' ? mealAllowance : mealAllowance,
    mileageRates
  };
}

export function checkZeroMcAwardEligibility(mcDaysTaken, isConfirmed) {
  const days = Number(mcDaysTaken) || 0;
  const confirmed = Boolean(isConfirmed);
  const eligible = confirmed && days === 0;
  const amount = eligible ? 300 : 0;
  return {
    eligible,
    amount,
    valueOf() { return amount; },
    toString() { return String(amount); }
  };
}

export function resolveEmployeeShift(user, schedulesList) {
  const schedules = schedulesList || [];
  if (!schedules.length) return null;
  const compCode = String(user?.companyId || user?.company || '').toUpperCase();
  const userWorkBase = String(user?.workBase || 'OFFICE').toUpperCase();
  const assigned = [];
  if (Array.isArray(user?.schedules)) assigned.push(...user.schedules);
  if (user?.schedule) String(user.schedule).split(',').forEach(s => assigned.push(s.trim()));
  if (user?.shift) assigned.push(user.shift);
  if (user?.workSchedule) assigned.push(user.workSchedule);

  for (const code of assigned) {
    if (!code) continue;
    const norm = String(code).toUpperCase();
    const found = schedules.find(s => s.availability !== 'Inactive' && (
      String(s.code || '').toUpperCase() === norm ||
      String(s.title || '').toUpperCase() === norm ||
      String(s.id || '').toUpperCase() === norm
    ));
    if (found) return found;
  }

  const compShifts = schedules.filter(s => s.availability !== 'Inactive' && (!s.company || !compCode || compCode.includes(String(s.company).toUpperCase())));
  if (compShifts.length) {
    const baseMatch = compShifts.find(s => String(s.workBase || '').toUpperCase() === userWorkBase);
    if (baseMatch) return baseMatch;
    const officeMatch = compShifts.find(s => /office|normal|standard/i.test(s.title || '') || /^08:/.test(s.start || ''));
    if (officeMatch) return officeMatch;
    return compShifts[0];
  }

  const generalOffice = schedules.find(s => s.availability !== 'Inactive' && (/office|normal/i.test(s.title || '') || /^08:/.test(s.start || '')));
  return generalOffice || schedules[0] || null;
}
