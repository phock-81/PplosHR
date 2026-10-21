/**
 * Corporate HR Correspondence Letterhead Generator Service
 * Metrio Group Corporate Standards
 */

export const TEMPLATE_TYPES = ['Increment', 'Confirmation', 'Transfer', 'Memo'];

export const METRIO_COMPANY_INFO = {
  name: 'METRIO GROUP OF COMPANIES',
  tagline: 'Property Development · Engineering · Construction · Project Management',
  address: 'Level 18, Menara Metrio, No. 88 Jalan Sultan Ismail, 50250 Kuala Lumpur, Malaysia',
  registration: 'Registration No. 199801012345 (456789-V)',
  phone: '+60 3-2168 8888',
  fax: '+60 3-2168 8889',
  email: 'hr@metriogroup.com',
  website: 'www.metriogroup.com'
};

/**
 * Generate formal reference number: HR/{TEMPLATE}/{YEAR}/{SEQ}
 * Example: HR/INCREMENT/2026/001
 */
export function generateReferenceNumber(template, year = new Date().getFullYear(), seq = 1) {
  const tpl = typeof template === 'object' && template !== null 
    ? (template.template || 'MEMO') 
    : (template || 'MEMO');
  const yr = typeof template === 'object' && template !== null && template.year 
    ? template.year 
    : year;
  const s = typeof template === 'object' && template !== null && template.seq !== undefined 
    ? template.seq 
    : seq;
  
  const paddedSeq = typeof s === 'number' ? String(s).padStart(3, '0') : String(s);
  return `HR/${String(tpl).toUpperCase()}/${yr}/${paddedSeq}`;
}

/**
 * Generate Increment Letter Body
 */
export function generateIncrementLetter({
  employeeName = '[Employee Name]',
  employeeNo = '',
  currentSalary = 0,
  newSalary = 0,
  incrementAmount = 0,
  percentage = 0,
  effectiveDate = '[Effective Date]',
  jobTitle = '[Designation]',
  department = '[Department]'
} = {}) {
  const numCurrent = Number(currentSalary) || 0;
  const numNew = Number(newSalary) || 0;
  const numInc = Number(incrementAmount) || (numNew - numCurrent);
  const pct = percentage || (numCurrent > 0 ? ((numInc / numCurrent) * 100).toFixed(1) : '0.0');

  return `Dear ${employeeName},

RE: SALARY INCREMENT

We are pleased to inform you that in recognition of your past year's performance, dedication, and invaluable contribution to Metrio Group, the Management has approved an adjustment to your basic remuneration as follows:

1. Current Basic Salary: RM ${numCurrent.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
2. Increment Amount: RM ${numInc.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct}%)
3. Revised Basic Salary: RM ${numNew.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
4. Effective Date: ${effectiveDate}

All other terms and conditions of your Letter of Appointment remain unchanged.

The Management wishes to place on record our sincere appreciation for your continued commitment and diligence. We look forward to your continued contribution toward the future growth and success of Metrio Group.`;
}

/**
 * Generate Confirmation Letter Body
 */
export function generateConfirmationLetter({
  employeeName = '[Employee Name]',
  employeeNo = '',
  jobTitle = '[Job Title]',
  department = '[Department]',
  confirmationDate = '[Confirmation Date]',
  salaryAdjustment = '',
  newSalary = null
} = {}) {
  let salaryClause = '';
  if (newSalary && Number(newSalary) > 0) {
    salaryClause = `\n\nIn conjunction with your confirmation, your monthly basic salary has been adjusted to RM ${Number(newSalary).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, effective from ${confirmationDate}.`;
  } else if (salaryAdjustment) {
    salaryClause = `\n\nIn conjunction with your confirmation, your monthly basic salary has been revised as follows: ${salaryAdjustment}.`;
  }

  return `Dear ${employeeName},

RE: CONFIRMATION OF EMPLOYMENT AS ${jobTitle.toUpperCase()}

Following the satisfactory completion of your probationary period, we have evaluated your performance and are pleased to officially confirm your employment as ${jobTitle} with Metrio Group, with effect from ${confirmationDate}.${salaryClause}

All other terms and conditions of employment set forth in your original employment agreement shall remain in full force and effect.

We congratulate you on this milestone and trust that you will continue to perform your responsibilities with the highest level of professionalism, integrity, and dedication.`;
}

/**
 * Generate Transfer / Re-designation Letter Body
 */
export function generateTransferLetter({
  employeeName = '[Employee Name]',
  employeeNo = '',
  fromDepartment = '[Current Department]',
  fromRole = '[Current Role]',
  toDepartment = '[New Department]',
  toRole = '[New Role]',
  reportingManager = '[Reporting Manager]',
  effectiveDate = '[Effective Date]'
} = {}) {
  return `Dear ${employeeName},

RE: INTERNAL TRANSFER AND RE-DESIGNATION

Management has decided to reassign your portfolio to support our expanding operational objectives. We are pleased to confirm your internal transfer as follows:

1. Previous Department / Role: ${fromDepartment} / ${fromRole}
2. New Department / Role: ${toDepartment} / ${toRole}
3. Reporting Manager: ${reportingManager}
4. Effective Date: ${effectiveDate}

Your existing salary, service tenure, and accrued benefits will remain unchanged. You are requested to hand over your current duties and report to ${reportingManager} on the effective date.

We wish you every success in your new position and are confident you will make meaningful contributions in your new role.`;
}

/**
 * Generate Internal Memorandum Body
 */
export function generateMemoLetter({
  employeeName = '[Employee Name]',
  subject = '[Subject]',
  memoBody = '[Memo Body]',
  signOff = 'Human Resources Department'
} = {}) {
  return `INTERNAL MEMORANDUM

TO: ${employeeName}
FROM: ${signOff}
DATE: ${new Date().toISOString().slice(0, 10)}
SUBJECT: ${subject.toUpperCase()}

${memoBody}

Please do not hesitate to contact the Human Resources Department should you have any questions or require further clarification.`;
}

/**
 * Router to generate letter body based on template type
 */
export function generateLetterBody(templateType, data = {}) {
  switch ((templateType || '').toLowerCase()) {
    case 'increment':
      return generateIncrementLetter(data);
    case 'confirmation':
      return generateConfirmationLetter(data);
    case 'transfer':
      return generateTransferLetter(data);
    case 'memo':
      return generateMemoLetter(data);
    default:
      return data.memoBody || data.notes || '';
  }
}
