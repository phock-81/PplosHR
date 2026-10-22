export const normaliseRole = role => ({Staff:'User',Supervisor:'HOD'})[role] || role || 'User';
export const roleLabel = role => normaliseRole(role)==='Admin'?'Superadmin':normaliseRole(role);
const page=(id,label,icon,scope='all')=>({id: scope==='team'?`${scope}-${id}`:id,label,icon,page:id,scope});
const hr=(module,label,scope='personal',icon='folder')=>({id:`${scope}-${module}`,module,label,scope,icon});
const subgroup=(id,label,icon,items)=>({id,label,icon,items,isSubgroup:true});

export function navigationFor(role) {
  role=normaliseRole(role);
  const groups=[{id:'personal',label:'My Workspace',icon:'person',items:[
    subgroup('personal-profile','Profile & Documents','person-badge',[
      page('my-profile','My Profile','person-badge','personal'),
      hr('letters','My Letters','personal','file-earmark-text'),
      hr('resourceAssignments','My Resources','personal','laptop')
    ]),
    subgroup('personal-time-pay','Leave & Compensation','wallet2',[
      page('staff-portal','My Leave','calendar2-check','personal'),
      page('my-attendance','My Attendance','clock-history','personal'),
      page('payslips-portal','My Payslips','receipt','personal'),
      hr('tax','My Tax Declarations','personal','file-earmark-spreadsheet')
    ]),
    subgroup('personal-claims-finance','Claims & Requests','receipt-cutoff',[
      hr('claims','My Claims','personal','receipt-cutoff'),
      hr('loans','My Loans','personal','cash-stack'),
      hr('bookings','My Bookings','personal','calendar2-event')
    ]),
    subgroup('personal-performance-growth','Performance & Growth','graph-up',[
      hr('appraisals','My Appraisals','personal','award'),
      hr('training','My Training','personal','mortarboard')
    ])
  ]}];
  if(['HOD','HR','Admin'].includes(role))groups.push({id:'team',label:'My Team',icon:'people',items:[page('staff-mgmt','Team Directory','people','team'),page('leave-management','Leave Approvals','calendar2-check','team'),page('dashboard','Attendance Approvals','clock-history','team'),hr('recruitment','Candidate Reviews','team','person-plus'),hr('claims','Claim Reviews','team'),hr('loans','Loan Reviews','team'),hr('appraisals','Appraisal Reviews','team')]});
  if(['HR','Admin'].includes(role))groups.push(
    {id:'people',label:'People & Organisation',icon:'building',items:[page('staff-mgmt','Employee Management','people','all'),hr('recruitment','Recruitment','all'),hr('letters','Letters & Correspondence','all')]},
    {id:'operations',label:'HR Operations',icon:'clipboard-check',items:['claims','loans','bookings','resourceAssignments','tax'].map((m,i)=>hr(m,['Claims & Reimbursement','Employee Loans','Booking Approvals','Resource Assignments','Tax Declarations'][i],'all'))},
    {id:'development',label:'Performance & Development',icon:'graph-up',items:['cycles','appraisals','training'].map((m,i)=>hr(m,['Appraisal Cycles','Performance Appraisals','Training & Certifications'][i],'all'))},
    {id:'payroll',label:'Attendance & Payroll',icon:'wallet2',items:[page('summary-dashboard','Payroll Overview','bar-chart'),page('dashboard','Attendance Dashboard','clock-history'),page('holidays','Public Holidays','calendar-event')]},
    {id:'administration',label:role==='Admin'?'Administration & Maintenance':'HR Administration',icon:'gear',items:[hr('leaveOpeningBalances','Leave Opening Balances','all'),hr('adjustments','Leave Adjustments','all'),hr('reports','HR Reports','all'),hr('audit','Audit History','all')]},
    {id:'settings',label:'System Settings',icon:'sliders',items:[hr('companies','System Settings','all','sliders')]}
  );
  return groups;
}

export function flatGroupItems(group) {
  if (!group || !group.items) return [];
  const res = [];
  const walk = (items) => {
    for (const item of items) {
      if (item.items && Array.isArray(item.items)) {
        walk(item.items);
      } else {
        res.push(item);
      }
    }
  };
  walk(group.items);
  return res;
}

export function allNavigationItems(role) {
  return navigationFor(role).flatMap(flatGroupItems);
}

export function canOpenHr(role,module,scope) {
  if(module==='overview')return true;
  const norm = normaliseRole(role);
  if(['Admin','HR'].includes(norm)) return true;
  if(scope==='personal') return true;
  return allNavigationItems(role).some(i=>i.module===module&&i.scope===scope);
}

