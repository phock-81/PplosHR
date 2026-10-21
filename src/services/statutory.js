// Malaysian Statutory Calculation Engine (EPF, SOCSO, EIS, PCB)
// Compliant with Malaysian Statutory Mandates (2024–2026):
// - SOCSO Act 4: RM 6,000 ceiling (amended Oct 2024)
// - EIS Act 800: RM 6,000 ceiling (amended Oct 2024) and age >= 60 exemption
// - EPF Act 452: Senior age >= 60 tier (0% EE, 4% ER)
// - LHDN PCB: Progressive resident tax brackets (0% to 30%) & Section 6A RM 400 rebate

export const DEFAULT_STATUTORY_CONFIG = {
  standardWorkingDays: 26,
  socsoCeiling: 6000.0,
  eisCeiling: 6000.0,
  epfEmployeeStandardRate: 0.11,
  epfEmployerLowWageRate: 0.13,
  epfEmployerHighWageRate: 0.12,
  epfEmployerSeniorRate: 0.04,
  pcbIndividualReliefMonthly: 750.0, // RM 9,000 / 12
  pcbEpfMaxMonthlyDeduction: 333.33,  // RM 4,000 / 12
  pcbRebateMaxAnnualIncome: 35000.0,
  pcbRebateAmount: 400.0
};

export const TP1_RELIEF_CAPS = {
  parent_medical: 8000.0,
  serious_diseases_medical: 10000.0,
  lifestyle_general: 2500.0,
  lifestyle_sports: 1000.0,
  childcare_fees: 3000.0,
  sspn_savings: 8000.0,
  life_insurance: 3000.0,
  epf_voluntary: 4000.0,
  prs_annuity: 3000.0,
  education_medical_insurance: 3000.0,
  ev_charging: 2500.0,
  socso_relief: 350.0
};

// Act 4 Third Schedule Table
export const SOCSO_SCHEDULE = [
  { low: 0, high: 30, ee: 0.10, er1: 0.40, er2: 0.30 },
  { low: 30, high: 50, ee: 0.20, er1: 0.70, er2: 0.50 },
  { low: 50, high: 70, ee: 0.30, er1: 1.10, er2: 0.80 },
  { low: 70, high: 100, ee: 0.40, er1: 1.50, er2: 1.10 },
  { low: 100, high: 140, ee: 0.60, er1: 2.10, er2: 1.50 },
  { low: 140, high: 200, ee: 0.85, er1: 2.95, er2: 2.10 }
];

for (let high = 300; high <= 6000; high += 100) {
  const low = high - 100;
  const mid = low + 50;
  const ee = Math.round(mid * 0.005 * 100) / 100;
  const tot = Math.round(mid * 0.0225 * 20) / 20;
  const er1 = Math.round((tot - ee) * 100) / 100;
  const er2 = Math.round(mid * 0.0125 * 20) / 20;
  SOCSO_SCHEDULE.push({ low, high, ee, er1, er2 });
}

export function calculateEpf(wages, age = 30, isForeigner = false, config = DEFAULT_STATUTORY_CONFIG) {
  if (typeof isForeigner === 'object' && isForeigner !== null) {
    config = isForeigner;
    isForeigner = false;
  }
  const cfg = { ...DEFAULT_STATUTORY_CONFIG, ...config };
  const w = Number(wages) || 0;
  if (w <= 0) return { employee: 0, employer: 0 };

  if (age >= 60) {
    return {
      employee: 0,
      employer: Math.round(w * (cfg.epfEmployerSeniorRate || 0.04) * 100) / 100
    };
  }

  const ee = Math.ceil(w * (cfg.epfEmployeeStandardRate || 0.11));
  const erRate = w <= 5000 ? (cfg.epfEmployerLowWageRate || 0.13) : (cfg.epfEmployerHighWageRate || 0.12);
  const er = Math.ceil(w * erRate);
  return { employee: ee, employer: er };
}

export function calculateSocso(wages, age = 30, config = DEFAULT_STATUTORY_CONFIG) {
  if (typeof config === 'number') {
    config = { socsoCeiling: config };
  }
  const cfg = { ...DEFAULT_STATUTORY_CONFIG, ...config };
  const w = Number(wages) || 0;
  if (w <= 0) return { employee: 0, employer: 0 };

  const ceiling = cfg.socsoCeiling || 6000.0;
  const capped = Math.min(w, ceiling);
  let match = SOCSO_SCHEDULE.find(s => capped > s.low && capped <= s.high);

  if (!match) {
    if (capped > SOCSO_SCHEDULE[SOCSO_SCHEDULE.length - 1].high) {
      const high = Math.ceil(capped / 100) * 100;
      const mid = high - 50;
      const ee = Math.round(mid * 0.005 * 100) / 100;
      const tot = Math.round(mid * 0.0225 * 20) / 20;
      const er1 = Math.round((tot - ee) * 100) / 100;
      const er2 = Math.round(mid * 0.0125 * 20) / 20;
      match = { low: high - 100, high, ee, er1, er2 };
    } else {
      match = SOCSO_SCHEDULE[SOCSO_SCHEDULE.length - 1];
    }
  }

  if (age >= 60) {
    return { employee: 0, employer: match.er2 };
  }
  return { employee: match.ee, employer: match.er1 };
}

export function calculateEis(wages, age = 30, config = DEFAULT_STATUTORY_CONFIG) {
  if (typeof config === 'number') {
    config = { eisCeiling: config };
  }
  const cfg = { ...DEFAULT_STATUTORY_CONFIG, ...config };
  const w = Number(wages) || 0;
  if (w <= 0 || age >= 60) return { employee: 0, employer: 0 };

  const ceiling = cfg.eisCeiling || 6000.0;
  const capped = Math.min(w, ceiling);
  const maxContribution = cfg.eisMaxContribution !== undefined
    ? cfg.eisMaxContribution
    : Math.round((ceiling - 50) * 0.002 * 100) / 100;

  const rate = Math.min(maxContribution, Math.round(capped * (cfg.eisRate || 0.002) * 100) / 100);
  return { employee: rate, employer: rate };
}

export function calculatePcb(grossPay, epfEmployee = 0, tp1MonthlyRelief = 0, age = 30, config = DEFAULT_STATUTORY_CONFIG) {
  if (typeof age === 'object' && age !== null) {
    config = age;
    age = 30;
  }
  const cfg = { ...DEFAULT_STATUTORY_CONFIG, ...config };
  const gross = Number(grossPay) || 0;
  const epfDeduct = Math.min(Number(epfEmployee) || 0, cfg.pcbEpfMaxMonthlyDeduction !== undefined ? cfg.pcbEpfMaxMonthlyDeduction : 333.33);
  const indivRelief = cfg.pcbIndividualReliefMonthly !== undefined ? cfg.pcbIndividualReliefMonthly : 750.0;
  const tp1 = Number(tp1MonthlyRelief) || 0;
  const netMonthly = gross - epfDeduct - tp1 - indivRelief;
  if (netMonthly <= 0) return 0;

  const annualP = netMonthly * 12;
  const brackets = [
    { chunk: 5000, rate: 0.00 },
    { chunk: 15000, rate: 0.01 },
    { chunk: 15000, rate: 0.03 },
    { chunk: 15000, rate: 0.06 },
    { chunk: 20000, rate: 0.11 },
    { chunk: 30000, rate: 0.19 },
    { chunk: 300000, rate: 0.25 },
    { chunk: 200000, rate: 0.26 },
    { chunk: 1400000, rate: 0.28 }
  ];

  let rem = annualP;
  let annualTax = 0;
  for (const b of brackets) {
    const taxable = Math.min(rem, b.chunk);
    annualTax += taxable * b.rate;
    rem -= taxable;
    if (rem <= 0) break;
  }
  if (rem > 0) annualTax += rem * 0.30;

  if (annualP <= (cfg.pcbRebateMaxAnnualIncome || 35000)) {
    annualTax = Math.max(0, annualTax - (cfg.pcbRebateAmount || 400));
  }

  const monthlyPcb = Math.round((annualTax / 12) * 100) / 100;
  return Math.max(0, monthlyPcb);
}
