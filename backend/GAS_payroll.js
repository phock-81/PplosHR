// Updated 2026-10-22 07:59:55.241033
const SPREADSHEET_ID = '1xJYsg2qQzFzb-8v3f5IE_CJqRy_l-ZcrWHs2wHf-1Ng';
const STAFF_FOLDER_PARENT_ = '1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf';

// Run this function directly from the Apps Script editor to authorize Sheets, Drive and Mail services
function authorizeAndTestAllServices() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const root = DriveApp.getRootFolder();
  let parentStatus = 'OK';
  try {
    const parent = DriveApp.getFolderById(STAFF_FOLDER_PARENT_);
    parentStatus = parent ? ('Accessible: ' + parent.getName()) : 'Not found';
  } catch (err) {
    parentStatus = 'Inaccessible (' + err.message + ') - fallback to HR_Staff_Uploads';
  }
  let quota = 'N/A';
  try {
    if (typeof MailApp !== 'undefined' && MailApp.getRemainingDailyQuota) {
      quota = MailApp.getRemainingDailyQuota();
    }
  } catch (_) {}
  Logger.log('Connected to Sheet: ' + (ss ? ss.getName() : 'OK'));
  Logger.log('Connected to Drive root: ' + (root ? root.getName() : 'OK'));
  Logger.log('STAFF_FOLDER_PARENT_ status: ' + parentStatus);
  Logger.log('Mail quota remaining: ' + quota);
  return 'All Google services tested! Parent folder: ' + parentStatus;
}

function routePost_(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload;
    
    const actor = body.actor || null;
    
    if (['getBootstrap','getStaff','getHolidays','getData','getAttendance','getLockedMonths','getStatutorySettings'].indexOf(action) !== -1) return routeGet_({parameter:{action:action}});
    const ss = getSpreadsheet_();

    // --- ROUTING: Connect frontend actions to backend functions ---
    if (action === 'login') return handleLogin(payload);
    if (action === 'unlockMonth') return unlockMonth(payload);
    if (action === 'saveSingleStaff') return saveSingleStaff(payload);
    if (action === 'deleteSingleStaff') return deleteSingleStaff(payload);
    if (action === 'updateOwnProfile') return updateOwnProfile(payload); // New Route
    if (action === 'uploadProfilePhoto') return hrUploadProfilePhoto_(payload, actor || payload.actor || {});
    if (action === 'saveHolidays') return saveHolidays(payload);
    if (action === 'saveAttendance') return saveAttendance(payload);
    if (action === 'saveStaffAttendanceRemark') return saveStaffAttendanceRemark(payload, actor || payload.actor || {});
    if (action === 'saveData') return saveData(payload);
    if (action === 'submitLeave') return submitLeave(payload);
    if (action === 'getLeaveData') return getLeaveData(payload);
    if (action === 'updateLeaveStatus') return updateLeaveStatus(payload);
    if (action === 'getPayroll') return getPayroll();
    if (action === 'resetPassword') return resetPassword(payload);
    if (action === 'saveStatutorySettings') return saveStatutorySettings(payload);
    if (action === 'previewYearEndClose') return previewYearEndClose(payload, actor);
    if (action === 'executeYearEndClose') return executeYearEndClose(payload, actor);
    if (action === 'getStaffDossier') return getStaffDossier(payload, actor);
    if (action === 'getAttendanceApproval') return getAttendanceApproval(payload, actor);
    if (action === 'approveAttendanceHOD') return approveAttendanceHOD(payload, actor);
    if (action === 'rejectAttendanceApproval') return rejectAttendanceApproval(payload, actor);
    if (action === 'getActionCount') return getActionCount(payload, actor);
    if (action === 'getClockLocations') return jsonResponse({ status: 'success', data: { locations: getClockLocationsData_() } });
    if (action === 'saveClockLocations') return saveClockLocations_(payload, actor);

    // --- LOCK MONTH LOGIC (also invoked by approveAttendanceHR) ---
    if (action === 'approveAttendanceHR') {
      hrAssert_(actor, 'Sign in required.');
      const hrRole = hrRole_(actor.role);
      hrAssert_(['Admin', 'HR'].indexOf(hrRole) !== -1, 'Only HR Admin can give final attendance approval and lock for payroll.');
      payload.data = payload.data || { rates: {}, savedAt: new Date().toISOString() };
      payload.data.approvalStatus = 'Locked';
      payload.data.status = 'Locked';
      payload.data.hrApprover = actor.name;
      payload.data.hrApprovedAt = new Date().toISOString();
      payload.data.hrComments = payload.comments || '';
      // Completion is recorded by the durable payroll operation; do not audit a lock before it succeeds.
    }
    if (action === 'lockMonth' || action === 'approveAttendanceHR') {
      let lockedSheet = ss.getSheetByName("LockedMonths");
      if (!lockedSheet) {
        lockedSheet = ss.insertSheet("LockedMonths");
        lockedSheet.appendRow(["Month", "Data JSON"]);
      }
      
      hrAssert_(payload && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(payload.month)), 'Valid month (YYYY-MM) is required.');
      const companyScope = payrollCompanyScope_(payload.company);
      const monthKey = companyScope.id ? payload.month + '__' + companyScope.id : payload.month;
      const pending = payrollPendingOperation_();
      if (pending) {
        hrAssert_(pending.key === monthKey, 'A payroll operation is incomplete. Retry approval for ' + pending.key + ' first.');
        payrollApplyOperation_(pending);
        return jsonResponse({status:'success', message:'Payroll operation recovered.'});
      }
      const lockedData = Object.assign({}, payload.data || {rates:{}, savedAt:new Date().toISOString()}, {month:payload.month, company:companyScope.id || 'ALL'});
      const lockRows = lockedSheet.getDataRange().getValues().slice(1);
      const overlapping = lockRows.find(r => {
        const key=String(r[0]);
        if(key===monthKey || (key!==payload.month && !key.startsWith(payload.month+'__'))) return false;
        if(companyScope.id && key!==payload.month) return false;
        let rec; try { rec=JSON.parse(r[1]); } catch(_) { return true; }
        return !!rec.payrollOperationId || !rec.approvalStatus && !rec.status || rec.approvalStatus==='Locked' || rec.status==='Locked';
      });
      hrAssert_(!overlapping, 'An overlapping company or ALL payroll is already locked. Explicitly unlock it before changing approval scope.');
      const existingLock = lockRows.find(r => String(r[0]) === monthKey);
      if (existingLock) {
        let prior = {}; try { prior = JSON.parse(existingLock[1]); } catch (_) {}
        if (prior.payrollOperationId) {
          payrollCompactCompleted_();
          return jsonResponse({status:'success', message:'Payroll already locked.'});
        }
      }
      const staffRowsForScope = hrStaffRows_().slice(1).filter(r => r[0]);
      const staffByName = {};
      staffRowsForScope.forEach(r => { staffByName[hrName_(r[0])] = r; });
      const inCompany = name => {
        const row = staffByName[hrName_(name)];
        return !!row && (!companyScope.id || String(row[25] || '') === companyScope.id);
      };
      // Freeze only this company's rates. These keys may be names or employee IDs.
      const allowedRateKeys = {};
      staffRowsForScope.filter(r => inCompany(r[0])).forEach(r => [r[0],r[24],r[2]].filter(Boolean).forEach(k => allowedRateKeys[hrName_(k)] = true));
      lockedData.rates = Object.keys(lockedData.rates || {}).reduce((out,k) => { if(allowedRateKeys[hrName_(k)]) out[k]=lockedData.rates[k]; return out; }, {});
      const claimUpdates = [], leaveUpdates = [];

      let payrollSheet = ss.getSheetByName("Payroll");
      if (!payrollSheet) {
        payrollSheet = ss.insertSheet("Payroll");
        payrollSheet.appendRow([
          "Month/Year", "Employee ID", "Employee Name", "Basic Salary (RM)", "Worked Days", 
          "Total OT Pay (RM)", "Gross Pay (RM)", "Employee Deduction - EPF (RM)", 
          "Employee Deduction - SOCSO (RM)", "Employee Deduction - EIS (RM)", 
          "Total Employee Deduction (RM)", "Employer Contribution - EPF (RM)", 
          "Employer Contribution - SOCSO (RM)", "Employer Contribution - EIS (RM)", 
          "Total Employer Contribution (RM)", "Nett Pay (RM)",
          "Employee Deduction - PCB (RM)", "NPL Deduction (RM)", "Claims Reimbursement (RM)", "Zero-MC Award (RM)", "Company ID"
        ]);
        payrollSheet.getRange("1:1").setFontWeight("bold");
        payrollSheet.setFrozenRows(1);
      }

      // Stage claims; payment status changes only after payroll is durably written.
      const claimsSheet = ss.getSheetByName('HR_claims');
      const claimsReimbursementByEmployee = {};
      if (claimsSheet) {
        const claimRows = claimsSheet.getDataRange().getValues();
        const cutoffDate = String(payload.month) + '-20';
        for (let i = 1; i < claimRows.length; i++) {
          const row = claimRows[i];
          if (!row[0]) continue;
          let rec = null;
          try {
            rec = typeof row[4] === 'string' ? JSON.parse(row[4]) : row[4];
          } catch (e) {}
          if (!rec) continue;
          const status = String(rec.status || row[3] || '');
          const claimDate = String(rec.date || rec.createdAt || '').slice(0, 10);
          if ((status === 'Approved' || (status === 'Paid' && rec.paymentReference === 'PAYROLL-' + payload.month)) && /^\d{4}-\d{2}-\d{2}$/.test(claimDate) && claimDate <= cutoffDate && inCompany(rec.employee || row[2])) {
            const emp = rec.employee || row[2] || '';
            const amount = Number(rec.amount) || 0;
            hrAssert_(Number.isFinite(Number(rec.amount)) && amount >= 0, 'Invalid approved claim amount.');
            const employeeKey = hrName_(emp);
            claimsReimbursementByEmployee[employeeKey] = (claimsReimbursementByEmployee[employeeKey] || 0) + amount;
            if (status === 'Paid') continue;

            rec.status = 'Paid';
            rec.paymentReference = 'PAYROLL-' + payload.month;
            rec.version = (Number(rec.version) || Number(row[1]) || 1) + 1;
            rec.updatedAt = new Date().toISOString();
            rec.updatedBy = (actor && actor.name) || 'SYSTEM';

            claimUpdates.push({row:i + 1, values:[
              rec.id || row[0], rec.version, rec.employee || row[2] || '', 'Paid', JSON.stringify(rec), rec.updatedAt, rec.updatedBy
            ]});
          }
        }
      }

      // 2. Query approved unpaid leave & MC days in the evaluation year
      const leaveSheet = ss.getSheetByName("Leave");
      const unpaidDaysByEmployee = {};
      const mcDaysByEmployee = {};
      const isDec = String(payload.month).slice(-2) === '12';
      const year = String(payload.month).slice(0, 4);

      if (leaveSheet) {
        const leaveData = leaveSheet.getDataRange().getValues();
        for (let i = 1; i < leaveData.length; i++) {
          const lStatus = String(leaveData[i][8] || '').toLowerCase();
          const lStart = String(leaveData[i][3] || '').slice(0, 7);
          const lYear = String(leaveData[i][3] || '').slice(0, 4);
          const empName = leaveData[i][1];
          const leaveType = String(leaveData[i][2] || '');

          if (lStatus === 'approved' && inCompany(empName)) {
            if (lStart === String(payload.month)) {
              const unpaid = Number(leaveData[i][13]) || (leaveType === 'NPL' || /unpaid/i.test(leaveType) ? Number(leaveData[i][5]) : 0);
              if (unpaid > 0) {
                unpaidDaysByEmployee[empName] = (unpaidDaysByEmployee[empName] || 0) + unpaid;
                if (leaveData[i][14] === 'TAGGED_NPL_DEDUCTION') {
                  leaveUpdates.push({row:i + 1, employee:hrName_(empName), value:'LOCKED_NPL_DEDUCTED'});
                }
              }
            }
            if (isDec && lYear === year) {
              if (leaveType === 'MC' || /medical/i.test(leaveType) || leaveType === 'Sick Leave') {
                mcDaysByEmployee[empName] = (mcDaysByEmployee[empName] || 0) + (Number(leaveData[i][5]) || 0);
              }
            }
          }
        }
      }

      // 3. Generate payroll data if not provided in payload
      let generatedPayrollData = [];
      if (!payload.payrollData || payload.payrollData.length === 0) {
        const staffSheet = ss.getSheetByName('Staff');
        if (staffSheet) {
          const staffRows = staffSheet.getDataRange().getValues();
          const settings = typeof getStatutorySettingsData_ === 'function' ? getStatutorySettingsData_() : DEFAULT_HR_STATUTORY_SETTINGS;
          const totalWorkingDays = Number(settings.standardWorkingDays) || 26;

          for (let i = 1; i < staffRows.length; i++) {
            const sRow = staffRows[i];
            const name = sRow[0];
            if (!name || !inCompany(name)) continue;
            const status = sRow[1] || 'Active';
            if (status !== 'Active') continue;

            const basicSalary = parseFloat(sRow[5]) || 0;
            if (basicSalary <= 0) continue;

            const empId = sRow[24] || sRow[2] || name;

            // Worked days
            let workedDays = totalWorkingDays;
            if (payload.workedDays && payload.workedDays[name] !== undefined) {
              workedDays = Number(payload.workedDays[name]);
            } else if (payload.workedDays && payload.workedDays[empId] !== undefined) {
              workedDays = Number(payload.workedDays[empId]);
            } else if (sRow[12] && String(sRow[12]).slice(0, 7) === String(payload.month)) {
              const joinDay = new Date(sRow[12]).getDate() || 1;
              workedDays = Math.max(1, Math.round(totalWorkingDays * ((30 - joinDay + 1) / 30)));
            }

            // Pro-rated basic
            let basic = basicSalary;
            if (workedDays < totalWorkingDays) {
              basic = Math.round((basicSalary * (workedDays / totalWorkingDays)) * 100) / 100;
            }

            // NPL deduction
            const unpaid = unpaidDaysByEmployee[name] || 0;
            const dailyRate = basicSalary / totalWorkingDays;
            const nplDeduction = Math.round(dailyRate * unpaid * 100) / 100;

            // Zero-MC award in December
            let allowances = 0;
            let zeroMcAward = 0;
            if (isDec) {
              const confirmDate = sRow[13] ? String(sRow[13]).slice(0, 10) : '';
              const isConfirmed = !!(confirmDate && confirmDate <= year + '-12-31');
              const mcCount = mcDaysByEmployee[name] || 0;
              if (isConfirmed && mcCount === 0) {
                zeroMcAward = Number(settings.inductionBenefits && settings.inductionBenefits.zeroMcAward) || 300.0;
                allowances += zeroMcAward;
              }
            }

            // OT Pay
            let otPay = 0;
            if (payload.otPay && (payload.otPay[name] !== undefined || payload.otPay[empId] !== undefined)) {
              otPay = Number(payload.otPay[name] || payload.otPay[empId]) || 0;
            }

            // Gross pay
            const grossPay = Math.round((basic - nplDeduction + allowances + otPay) * 100) / 100;

            // Age
            let age = Number(sRow[36]) || 0;
            if (!age || age <= 0) {
              const ic = String(sRow[8] || '').trim();
              if (/^(\d{2})/.test(ic)) {
                const yr = Number(RegExp.$1);
                const birthYear = yr > 40 ? 1900 + yr : 2000 + yr;
                age = Number(year) - birthYear;
              } else {
                age = 30;
              }
            }

            // Statutory deductions
            const epf = calculateEpf_(grossPay, age, false, settings);
            const socso = calculateSocso_(grossPay, age, settings);
            const eis = calculateEis_(grossPay, age, settings);

            // PCB with TP1 relief
            let tp1MonthlyRelief = 0;
            try {
              if (typeof hrRows_ === 'function') {
                const taxRows = hrRows_('tax').filter(t => t.employee === name && String(t.year) === year && ['Reviewed', 'Submitted'].indexOf(t.status) !== -1);
                const totalTp1 = taxRows.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
                tp1MonthlyRelief = Math.round((totalTp1 / 12) * 100) / 100;
              }
            } catch (e) {}

            const pcb = calculatePcb_(grossPay, epf.employee, tp1MonthlyRelief, age, settings);
            const totalEmpDed = Math.round((epf.employee + socso.employee + eis.employee + pcb) * 100) / 100;
            const totalEmprCont = Math.round((epf.employer + socso.employer + eis.employer) * 100) / 100;

            // Claims reimbursement
            const claimsReimbursement = claimsReimbursementByEmployee[hrName_(name)] || 0;

            // Nett pay
            const nettPay = Math.round((grossPay - totalEmpDed + claimsReimbursement) * 100) / 100;

            generatedPayrollData.push([
              payload.month, empId, name, basicSalary, workedDays, otPay.toFixed(2), grossPay.toFixed(2),
              epf.employee.toFixed(2), socso.employee.toFixed(2), eis.employee.toFixed(2), totalEmpDed.toFixed(2),
              epf.employer.toFixed(2), socso.employer.toFixed(2), eis.employer.toFixed(2), totalEmprCont.toFixed(2),
              nettPay.toFixed(2), pcb.toFixed(2), nplDeduction.toFixed(2), claimsReimbursement.toFixed(2), zeroMcAward.toFixed(2)
            ]);
          }
        }
      }

      const supplied = payload.payrollData && payload.payrollData.length > 0;
      const candidateRows = supplied ? payload.payrollData : generatedPayrollData;
      const seenEmployees = {};
      const dataToWrite = candidateRows.filter(row => {
        hrAssert_(Array.isArray(row), 'Invalid payroll row.');
        const staff = staffByName[hrName_(row[2])];
        hrAssert_(staff, 'Unknown payroll employee. Refresh staff and retry.');
        return inCompany(row[2]);
      }).map(row => {
        hrAssert_(String(row[0]) === payload.month && row.length >= 16, 'Invalid payroll period or row.');
        const key = hrName_(row[2]), staff = staffByName[key];
        hrAssert_(!seenEmployees[key], 'Duplicate payroll employee.');
        seenEmployees[key] = true;
        const result = row.slice(0,20);
        while(result.length < 20) result.push('0.00');
        const claims = claimsReimbursementByEmployee[key] || 0;
        const oldClaims = Number(result[18]) || 0;
        hrAssert_(Number.isFinite(Number(result[15])) && Number.isFinite(oldClaims), 'Invalid payroll net pay or claims.');
        result[15] = (Math.round((Number(result[15]) - oldClaims + claims) * 100) / 100).toFixed(2);
        result[18] = claims.toFixed(2);
        result[20] = String(staff[25] || '');
        return result;
      });
      // A claim must never be paid unless its employee is present in this payroll.
      Object.keys(claimsReimbursementByEmployee).forEach(name => hrAssert_(seenEmployees[name], 'Approved claims have no payroll row for ' + name + '. Include the employee before locking.'));
      hrAssert_(dataToWrite.length > 0, 'No payroll rows for the selected company.');
      const previousPayroll = payrollSheet.getDataRange().getValues().slice(1).filter(r => r[0]);
      const kept = previousPayroll.filter(row => {
        if(String(row[0]) !== payload.month) return true;
        if(!companyScope.id) return false;
        // New rows carry stable company identity; legacy rows use the employee master.
        const rowCompany = String(row[20] || (staffByName[hrName_(row[2])] || [])[25] || '');
        hrAssert_(rowCompany, 'Cannot identify company for an existing payroll row. Assign its employee company before approval.');
        return rowCompany !== companyScope.id;
      });
      const width = Math.max(21, ...kept.map(r => r.length));
      const finalPayroll = kept.concat(dataToWrite).map(r => { const row=r.slice(); while(row.length<width)row.push(''); return row; });
      payrollStageOperation_({key:monthKey, lockedData, payroll:finalPayroll, claims:claimUpdates, leaves:leaveUpdates.filter(update => seenEmployees[update.employee])});
      payrollApplyOperation_(payrollPendingOperation_());

      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown POST action: ' + action })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Sheets are not transactional. Persist the complete intended result before mutating
// payroll/payment/lock state. The script mutation lock serializes staging and replay.
// A failed operation is replayed verbatim, never recalculated from partly paid claims.
function payrollCompanyScope_(value) {
  const input = String(value || '').trim();
  if(!input || input.toUpperCase() === 'ALL') return {id:''};
  const matches = hrRows_('companies').filter(c => [c.id,c.code,c.title,c.name].some(v => v && String(v).trim() === input));
  const staffIds = hrStaffRows_().slice(1).some(r => String(r[25] || '') === input);
  hrAssert_(matches.length <= 1 && (matches.length === 1 || staffIds), 'Unknown or ambiguous company. Select a company ID.');
  return {id:String(matches.length ? matches[0].id : input)};
}
function payrollPendingOperation_() {
  const sheet = getSpreadsheet_().getSheetByName('PayrollOperations');
  if(!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((r,i) => i > 0 && r[1] === 'Prepared' && r[2] === 'meta');
  if(index < 0) return null;
  const meta = JSON.parse(rows[index][4]);
  return {id:rows[index][0], key:rows[index][3], index:index + 1, meta,
    entries:rows.filter(r => r[0] === rows[index][0] && r[2] !== 'meta').map(r => ({kind:r[2], data:JSON.parse(r[4])}))};
}
function payrollStageOperation_(operation) {
  const ss=getSpreadsheet_();
  let sheet=ss.getSheetByName('PayrollOperations');
  if(!sheet){sheet=ss.insertSheet('PayrollOperations');sheet.appendRow(['Operation ID','State','Kind','Key','Data JSON']);}
  const id=Utilities.getUuid(); operation.lockedData.payrollOperationId=id;
  const rows=[[id,'Prepared','meta',operation.key,JSON.stringify({lockedData:operation.lockedData})]];
  ['payroll','claims','leaves'].forEach(kind => operation[kind].forEach(data => rows.push([id,'',kind,operation.key,JSON.stringify(data)])));
  hrAssert_(rows.every(r => String(r[4]).length < 45000), 'Payroll operation data exceeds safe cell size.');
  ensureRows_(sheet,sheet.getLastRow()+rows.length);
  sheet.getRange(sheet.getLastRow()+1,1,rows.length,5).setValues(rows);
  SpreadsheetApp.flush();
}
function payrollApplyOperation_(operation) {
  hrAssert_(operation, 'Payroll operation is missing.');
  const ss=getSpreadsheet_(), payroll=ss.getSheetByName('Payroll');
  const rows=operation.entries.filter(e => e.kind==='payroll').map(e => e.data);
  hrAssert_(rows.length, 'Payroll operation contains no payroll rows.');
  if(payroll.getMaxColumns()<rows[0].length)payroll.insertColumnsAfter(payroll.getMaxColumns(),rows[0].length-payroll.getMaxColumns());
  replaceRows_(payroll, rows);
  payroll.getRange(1,21).setValue('Company ID');
  SpreadsheetApp.flush();
  operation.entries.filter(e => e.kind==='claims').forEach(e => ss.getSheetByName('HR_claims').getRange(e.data.row,1,1,7).setValues([e.data.values]));
  operation.entries.filter(e => e.kind==='leaves').forEach(e => ss.getSheetByName('Leave').getRange(e.data.row,15).setValue(e.data.value));
  const locked=ss.getSheetByName('LockedMonths'), lockRows=locked.getDataRange().getValues();
  const index=lockRows.findIndex((r,i) => i>0 && String(r[0])===operation.key);
  if(index<0)locked.appendRow([operation.key,JSON.stringify(operation.meta.lockedData)]);
  else locked.getRange(index+1,2).setValue(JSON.stringify(operation.meta.lockedData));
  SpreadsheetApp.flush();
  ss.getSheetByName('PayrollOperations').getRange(operation.index,2).setValue('Complete');
  SpreadsheetApp.flush();
  payrollCompactCompleted_();
}

// Only incomplete operations need replay payloads. Keep a compact completion
// marker after the Complete state is durable; cleanup failure never undoes success.
// This runs under the same mutation lock and is retried on idempotent approval.
function payrollCompactCompleted_() {
  try {
    const sheet=getSpreadsheet_().getSheetByName('PayrollOperations');
    if(!sheet)return;
    const rows=sheet.getDataRange().getValues(), completed={};
    rows.forEach((row,index) => {
      if(index>0 && row[1]==='Complete' && row[2]==='meta') {
        completed[row[0]]=true;
        if(String(row[4]).indexOf('lockedData')!==-1) sheet.getRange(index+1,5).setValue(JSON.stringify({completedAt:new Date().toISOString()}));
      }
    });
    for(let i=rows.length-1;i>0;i--) {
      if(completed[rows[i][0]] && rows[i][2]!=='meta') {
        const end=i+1;
        while(i>1 && completed[rows[i-1][0]] && rows[i-1][2]!=='meta')i--;
        sheet.deleteRows(i+1,end-i);
      }
    }
  } catch(error) {
    console.log('Completed payroll journal cleanup deferred; retry the approval to compact it.');
  }
}

function routeGet_(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getBootstrap') return getBootstrap();
    if (action === 'getStaff') return getStaff();
    if (action === 'getHolidays') return getHolidays();
    if (action === 'getData') return getData();
    if (action === 'getAttendance') return getAttendance();
    if (action === 'getLockedMonths') return getLockedMonths();
    if (action === 'getStatutorySettings') return getStatutorySettings();
    if (action === 'getStaffDossier') return getStaffDossier(e.parameter || {});
    if (action === 'getAttendanceApproval') return getAttendanceApproval(e.parameter || {});
    if (action === 'getActionCount') return getActionCount(e.parameter || {});
    return jsonResponse({ status: 'error', message: 'Unknown action.' });
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() });
  }
}

const defaultBiometrics_ = {
  'BAIRAVI A/P LETCHUMANAN': '711011',
  'SANTHINI A/P RAJA': '711012',
  'YUVARANI A/P MANIRAJAN': '711023',
  'NG KE NAM': '700033',
  'DEMO HR': '700016',
  'HOCK': '700016'
};

function hrStaffCols_(headerRow) {
  let bioCol = -1;
  let restDaysCol = -1;
  if (Array.isArray(headerRow)) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || '').trim().toLowerCase();
      if (h.includes('biometric') || h === 'bio id') bioCol = i;
      if (h.includes('rest day') || h.includes('restday') || h.includes('rest_day')) restDaysCol = i;
    }
  }
  // If no explicit biometric column found in headers:
  // Legacy / test schema default: restDays is Column X (index 23), Biometric ID is Column AR (index 43)
  if (bioCol === -1) {
    if (restDaysCol === -1) restDaysCol = 23;
    bioCol = 43;
  } else {
    // Biometric column explicitly found (e.g. Column X / index 23 in real Sheet)
    if (restDaysCol === -1) restDaysCol = 43;
  }
  return { bioCol, restDaysCol };
}

// --- STAFF MANAGEMENT ---
function getStaff() {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found' });
  
  const data = readSheet_(sheet, true);
  const staffSettings = {};
  const headerRow = data[0] || [];
  const { bioCol, restDaysCol } = hrStaffCols_(headerRow);
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; 
    
    let parsedRestDays = [];
    if (restDaysCol !== -1 && row[restDaysCol]) {
      try { parsedRestDays = JSON.parse(row[restDaysCol]); } catch(e) {}
    }
    if (!parsedRestDays.length && row[23] && String(row[23]).trim().startsWith('[')) {
      try { parsedRestDays = JSON.parse(row[23]); } catch(e) {}
    }
    
    let bioVal = '';
    if (bioCol !== -1 && row[bioCol] && !String(row[bioCol]).trim().startsWith('[')) {
      bioVal = String(row[bioCol]).trim();
    }
    if (!bioVal && row[43]) bioVal = String(row[43]).trim();
    if (!bioVal && row[23] && !String(row[23]).trim().startsWith('[')) bioVal = String(row[23]).trim();
    if (!bioVal) bioVal = defaultBiometrics_[row[0].toUpperCase()] || defaultBiometrics_[row[0]] || '';
    
    staffSettings[row[0].toUpperCase()] = {
      name: row[0].toUpperCase(),
      status: row[1] || "Active",
      username: row[2],
      password: row[3],
      role: hrRole_(row[4]),
      jobTitleId:row[32]||'',gradeId:row[33]||'',assignedResources: row[31]||'',
      resources: (function() {
        if (!row[31]) return [];
        try {
          const p = JSON.parse(row[31]);
          return Array.isArray(p) ? p : [];
        } catch(e) {
          const s = String(row[31]).trim();
          if (s && s !== 'No resources assigned') {
            return [{ id: 'res-1', name: s, serialNo: '', issueDate: '', returned: false, returnedDate: '', remarks: '' }];
          }
          return [];
        }
      })(),
      fixedAllowance: parseFloat(row[46]) || 0,
      otEligible: (row[48] !== undefined && row[48] !== '') ? (row[48] === true || row[48] === 'true' || row[48] === 1 || row[48] === 'Yes') : (parseFloat(row[5]) <= 4000 || String(row[38] || '').toUpperCase() === 'SITE'),
      fixedAllowances: (function() {
        if (!row[47]) return [];
        try {
          const p = JSON.parse(row[47]);
          return Array.isArray(p) ? p : [];
        } catch(e) { return []; }
      })(),
      employeeNo: row[24]||'', companyId: row[25]||'', departmentId: row[26]||'', manager: row[27]||'', jobTitle: row[28]||'', location: row[29]||'', version: Number(row[30])||1,
      basic: parseFloat(row[5]) || 0,
      hourly: parseFloat(row[6]) || 0,
      gender: row[7] || "Male",
      icNo: row[8],
      contactNo: row[9],
      address: row[10],
      emergency: row[11],
      joinedDate: row[12],
      confirmDate: row[13],
      resignDate: row[14],
      salaryHistory: row[15],
      attachment: row[16],
      socsoNo: row[17],
      epfNo: row[18],
      taxNo: row[19],
      bankNo: row[20],
      alEntitlement: row[21],
      mcEntitlement: row[22],
      email:row[34]||'',race:row[35]||'',ageSource:row[36]===undefined?'':row[36],academicLevel:row[37]||'',workBase:row[38]||'',serviceYearsSource:row[39]===undefined?'':row[39],companyName:row[40]||'',staffFolderId:row[41]||'',staffFolderUrl:row[42]||'',
      biometricId: bioVal,
      photo: row[45] || '',
      photoUrl: row[45] || '',
      schedules: (function() {
        if (!row[44]) return [];
        try {
          const p = JSON.parse(row[44]);
          return Array.isArray(p) ? p : String(row[44]).split(',').map(s=>s.trim()).filter(Boolean);
        } catch(e) {
          return String(row[44]).split(',').map(s=>s.trim()).filter(Boolean);
        }
      })(),
      schedule: row[44] ? (String(row[44]).startsWith('[') ? (JSON.parse(row[44]) || []).join(', ') : String(row[44])) : '',
      restDays: Array.isArray(parsedRestDays) ? parsedRestDays : [] 
    };
  }
  return jsonResponse({ status: 'success', data: staffSettings });
}

function saveSingleStaff(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found' });
  
  const data = readSheet_(sheet, false);
  let rowIndex = -1;
  const staffName = payload.name.toUpperCase();
  let oldBasic = 0;
  let oldHistory = "";
  let oldStatus = "Active";
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toUpperCase() === staffName) {
      rowIndex = i + 1;
      oldStatus = data[i][1] || "Active";       // Col B
      oldBasic = parseFloat(data[i][5]) || 0;   // Col F
      oldHistory = data[i][15] || "";           // Col P
      break;
    }
  }
  
  const headerRow = data[0] || [];
  const { bioCol, restDaysCol } = hrStaffCols_(headerRow);
  const targetBioCol = (bioCol !== -1) ? (bioCol + 1) : 44;
  const targetRestCol = (restDaysCol !== -1) ? (restDaysCol + 1) : 24;

  let restDaysStr = payload.restDays ? JSON.stringify(payload.restDays) : (rowIndex>0?(data[rowIndex-1][restDaysCol] || data[rowIndex-1][23] || '[]'):'[]');
  if (payload.isQuickSave && rowIndex > 0) {
    if (payload.restDays !== undefined) sheet.getRange(rowIndex, targetRestCol).setValue(restDaysStr);
    if (payload.biometricId !== undefined) {
      const bioTrimmed = String(payload.biometricId).trim();
      sheet.getRange(rowIndex, targetBioCol).setValue(bioTrimmed);
    }
    sheet.getRange(rowIndex,31).setValue((Number(data[rowIndex-1][30])||1)+1);
    return jsonResponse({status:'success'});
  }
  const existing=rowIndex>0?data[rowIndex-1]:[];
  const employeeNo=payload.employeeNo||existing[24]||Utilities.getUuid();
  let folder=null,folderError=null;
  try {folder=hrStaffFolder_(employeeNo,staffName,existing[41]);} catch(e){folderError='Staff folder unavailable: '+e.message+'. Save again to retry.';}
  let fileUrl=Array.from(new Set(String(existing[16]||'').split(' | ').concat(String(payload.existingAttachment||'').split(' | ')).map(v=>v.trim()).filter(Boolean))).join(' | ');
  if(payload.fileData||payload.fileName){hrAssert_(!!folder,folderError);fileUrl=[fileUrl,hrUploadFile_(folder,payload)].filter(Boolean).join(' | ');}
  let salaryHistory = oldHistory;
  let newBasic = parseFloat(payload.basic) || 0;
  
  if (rowIndex > 0 && oldBasic !== newBasic) {
     const now = new Date();
     const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "ddMMyy - HH:mm");
     const logEntry = `${dateStr} - RM ${newBasic.toFixed(2)}`;
     salaryHistory = salaryHistory ? salaryHistory + "\n" + logEntry : logEntry;
  } else if (rowIndex === -1) {
     const now = new Date();
     const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "ddMMyy - HH:mm");
     salaryHistory = `${dateStr} - RM ${newBasic.toFixed(2)} (Initial)`;
  }

  // Auto-set Resignation Date if triggered by Admin
  let resignDate = payload.resignDate || "";
  if (payload.status === "Resigned" && oldStatus !== "Resigned" && !resignDate) {
      const tz = Session.getScriptTimeZone();
      resignDate = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  } else if (payload.status === "Active") {
      resignDate = ""; 
  }

  const bioVal = payload.biometricId !== undefined ? String(payload.biometricId).trim() : (targetBioCol === 24 ? existing[23] : (existing[43] || defaultBiometrics_[staffName] || ''));

  const rowData = [
    payload.name,                      // 0: A
    payload.status || "Active",        // 1: B
    payload.username || "",            // 2: C
    payload.password || (rowIndex > 0 ? data[rowIndex - 1][3] : ""), // 3: D (preserve unchanged password)
    payload.role || "Staff",           // 4: E
    newBasic,                          // 5: F
    payload.hourly || 0,               // 6: G
    payload.gender || "Male",          // 7: H
    payload.icNo || "",                // 8: I
    payload.contactNo || "",           // 9: J
    payload.address || "",             // 10: K
    payload.emergency || "",           // 11: L
    payload.joinedDate || "",          // 12: M
    payload.confirmDate || "",         // 13: N
    resignDate,                        // 14: O
    salaryHistory,                     // 15: P
    fileUrl,                           // 16: Q
    payload.socsoNo || "",             // 17: R
    payload.epfNo || "",               // 18: S
    payload.taxNo || "",               // 19: T
    payload.bankNo || "",              // 20: U
    payload.alEntitlement || "",       // 21: V
    payload.mcEntitlement || "",       // 22: W
    targetBioCol === 24 ? bioVal : restDaysStr, // 23: X (Biometric ID in real sheet, restDays in legacy)
    employeeNo,                        // 24: Y
    payload.companyId || '', payload.departmentId || '', payload.manager || '',
    payload.jobTitle || '', payload.location || '', payload.version || 1,
    (payload.resources !== undefined ? (Array.isArray(payload.resources) ? JSON.stringify(payload.resources) : String(payload.resources)) : (payload.assignedResources !== undefined ? String(payload.assignedResources) : (rowIndex>0?(data[rowIndex-1][31]||''):''))),payload.jobTitleId||'',payload.gradeId||'',
    ...['email','race','ageSource','academicLevel','workBase','serviceYearsSource','companyName'].map((k,i)=>payload[k]===undefined?(existing[34+i]||''):payload[k]),
    folder?folder.getId():(existing[41]||''),folder?folder.getUrl():(existing[42]||''),
    targetBioCol === 24 ? restDaysStr : bioVal, // 43: AR (Rest days when X is Biometric ID, otherwise Biometric ID)
    payload.schedules !== undefined ? (Array.isArray(payload.schedules) ? JSON.stringify(payload.schedules) : String(payload.schedules)) : (existing[44] || ''), // 44: AS Schedules
    payload.photo !== undefined ? (payload.photo || '') : (payload.photoUrl !== undefined ? (payload.photoUrl || '') : (existing[45] || '')), // 45: AT Photo URL
    payload.fixedAllowance !== undefined ? (parseFloat(payload.fixedAllowance) || 0) : (parseFloat(existing[46]) || 0), // 46: AU Fixed Allowance Total
    payload.fixedAllowances !== undefined ? (Array.isArray(payload.fixedAllowances) ? JSON.stringify(payload.fixedAllowances) : String(payload.fixedAllowances)) : (existing[47] || '[]'), // 47: AV Fixed Allowances Breakdown
    payload.otEligible !== undefined ? (payload.otEligible ? 'true' : 'false') : (existing[48] || '') // 48: AW OT Eligible
  ];

  if (typeof sheet.getMaxColumns === 'function' && sheet.getMaxColumns() < 49) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 49 - sheet.getMaxColumns());
    sheet.getRange(1, 47).setValue('Fixed Allowance');
    sheet.getRange(1, 48).setValue('Fixed Allowances JSON');
    sheet.getRange(1, 49).setValue('OT Eligible');
  }
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
  
  return jsonResponse({status:'success',folderError,staffFolderId:rowData[41],staffFolderUrl:rowData[42]});
}

function updateOwnProfile(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  const data = readSheet_(sheet, false);
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toUpperCase() === payload.name.toUpperCase()) {
      const rowIndex = i + 1;
      
      sheet.getRange(rowIndex, 10, 1, 3).setValues([[
        payload.contactNo || '', payload.address || '', payload.emergency || ''
      ]]);
      if (payload.photo || payload.photoUrl) {
        if (sheet.getMaxColumns && sheet.getMaxColumns() < 46 && typeof sheet.insertColumnsAfter === 'function') sheet.insertColumnsAfter(sheet.getMaxColumns(), 46 - sheet.getMaxColumns());
        if (!sheet.getRange(1, 46).getValue()) sheet.getRange(1, 46).setValue('Photo URL');
        sheet.getRange(rowIndex, 46).setValue(payload.photo || payload.photoUrl);
      }
      const oldHistory = data[i][15] || '';
      const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'ddMMyy - HH:mm');
      const logEntry = `${dateStr} - Profile details (Contact/Address) updated by staff`;
      sheet.getRange(rowIndex, 16).setValue(oldHistory ? oldHistory + '\n' + logEntry : logEntry);

      return jsonResponse({ status: 'success' });
    }
  }
  return jsonResponse({ status: 'error', message: 'Staff record not found.' });
}

function deleteSingleStaff(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  const data = readSheet_(sheet, false);
  const staffName = payload.name.toUpperCase();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toUpperCase() === staffName) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ status: 'success' });
    }
  }
  return jsonResponse({ status: 'error', message: 'Staff not found' });
}

// --- OTHER DATA FUNCTIONS ---
function saveHolidays(holidaysArray) {
  const sheet = getSpreadsheet_().getSheetByName('Holidays');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Holidays sheet not found.' });

  // Ensure header row has full schema
  const headers = ['Date', 'Name', 'Company', 'WorkBase', 'Location', 'Matrix'];
  ensureRows_(sheet, 1);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Sort holidays chronologically: earliest date to latest date (Jan to Dec)
  const list = Array.isArray(holidaysArray) ? holidaysArray.slice() : [];
  list.sort(function(a, b) {
    const da = hrInductionDate_(a && a.date) || String(a && a.date || '');
    const db = hrInductionDate_(b && b.date) || String(b && b.date || '');
    return da.localeCompare(db);
  });

  const rows = list.map(h => [
    h.date || '',
    h.name || '',
    h.company || 'All',
    h.workBase || 'All',
    h.location || 'All',
    typeof h.matrix === 'object' ? JSON.stringify(h.matrix) : (h.matrix || '{}')
  ]);
  if (rows.length) { ensureRows_(sheet, rows.length + 1); sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@'); }
  replaceRows_(sheet, rows);
  return jsonResponse({ status: 'success', message: 'Holidays saved.' });
}

function saveAttendance(records) {
  const sheet = getSpreadsheet_().getSheetByName('Attendance');
  const rows = records.map(r => [
    r.id, r.name, r.date, r.payType, r.in, r.out, r.totalHrs, 
    r.shift, r.lateIn, r.earlyOut, r.payableHrs, r.overlapOT, r.extraOT, r.remark, r.manualOTPay || ''
  ]);
  replaceRows_(sheet, rows);
  return jsonResponse({ status: 'success', message: 'Attendance saved.' });
}

function saveData(rawData) {
  const sheet = getSpreadsheet_().getSheetByName('Data');
  const items = Array.isArray(rawData) ? rawData : (rawData && Array.isArray(rawData.data)) ? rawData.data : [];
  const rows = items.map(r => [r.id, r.name, r.date, r.weekday, r.in, r.out, r.totalHrs]);
  replaceRows_(sheet, rows);
  return jsonResponse({ status: 'success', message: 'Raw data saved.' });
}

function getHolidays() {
  const sheet = getSpreadsheet_().getSheetByName('Holidays');
  if (!sheet) return jsonResponse({ status: 'success', data: [] });
  const data = readSheet_(sheet, true);
  const h = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      let matrix = {};
      if (data[i][5]) {
        try { matrix = JSON.parse(data[i][5]); } catch(e){}
      }
      h.push({
        date: data[i][0],
        name: data[i][1],
        company: data[i][2] || 'All',
        workBase: data[i][3] || 'All',
        location: data[i][4] || 'All',
        matrix: matrix
      });
    }
  }
  h.sort(function(a, b) {
    const da = hrInductionDate_(a && a.date) || String(a && a.date || '');
    const db = hrInductionDate_(b && b.date) || String(b && b.date || '');
    return da.localeCompare(db);
  });
  return jsonResponse({ status: 'success', data: h });
}

function getData() {
  const sheet = getSpreadsheet_().getSheetByName('Data');
  const data = readSheet_(sheet, true);
  const records = [];
  for(let i=1; i<data.length; i++) {
    if(data[i][0]) records.push({ id: data[i][0], name: data[i][1], date: hrInductionDate_(data[i][2]) || data[i][2], weekday: data[i][3], in: data[i][4], out: data[i][5], totalHrs: data[i][6] });
  }
  return jsonResponse({ status: 'success', data: records });
}

function getAttendance() {
  const sheet = getSpreadsheet_().getSheetByName('Attendance');
  const data = readSheet_(sheet, true);
  const records = [];
  const recMap = {};

  for(let i=1; i<data.length; i++) {
    if(data[i][0]) {
      const rec = { 
        id: data[i][0], 
        name: data[i][1], 
        date: hrInductionDate_(data[i][2]) || data[i][2], 
        payType: data[i][3], 
        in: data[i][4], 
        out: data[i][5], 
        overlapOT: data[i][11], 
        extraOT: data[i][12], 
        remark: data[i][13], 
        manualOTPay: data[i][14]
      };
      records.push(rec);
      const key = hrName_(rec.name) + '__' + hrInductionDate_(rec.date);
      recMap[key] = rec;
    }
  }

  // Merge mobile GPS clock events so mobile clock-in is part of official attendance records
  try {
    const mobileSheet = getSpreadsheet_().getSheetByName('HR_mobileClockEvent');
    if (mobileSheet) {
      const mRows = readSheet_(mobileSheet, false);
      const parseMins = (t) => {
        if (!t || t === '-' || t === '—') return null;
        const m = String(t).match(/^(\d{1,2}):(\d{2})/);
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
      };

      for (let j = 1; j < mRows.length; j++) {
        const row = mRows[j];
        if (!row || !row[0]) continue;
        let evt = null;
        try { evt = row[4] ? JSON.parse(row[4]) : null; } catch (_) {}
        if (!evt || evt.status !== 'Recorded') continue;

        const empName = hrName_(evt.employee || row[2]);
        const dateStr = hrInductionDate_(evt.date || (evt.serverTime ? evt.serverTime.slice(0, 10) : ''));
        if (!empName || !dateStr) continue;

        let timeStr = '';
        if (evt.serverTime) {
          const d = new Date(evt.serverTime);
          if (!isNaN(d.getTime())) {
            try {
              timeStr = Utilities.formatDate(d, 'Asia/Kuala_Lumpur', 'HH:mm');
            } catch (_) {}
            if (!timeStr || !/^\d{1,2}:\d{2}/.test(timeStr)) {
              const klMs = d.getTime() + (8 * 60 * 60 * 1000);
              const klDate = new Date(klMs);
              const h = String(klDate.getUTCHours()).padStart(2, '0');
              const min = String(klDate.getUTCMinutes()).padStart(2, '0');
              timeStr = h + ':' + min;
            }
          }
        }
        if (!timeStr) continue;

        const key = empName + '__' + dateStr;
        let existing = recMap[key];

        if (!existing) {
          existing = {
            id: 'MOB-' + (evt.id || j),
            name: evt.employee || row[2],
            date: dateStr,
            payType: 'Normal',
            in: evt.type === 'IN' ? timeStr : '—',
            out: evt.type === 'OUT' ? timeStr : '—',
            overlapOT: 0,
            extraOT: 0,
            remark: 'Mobile GPS (' + (evt.checkInLocation || 'Mobile') + ')',
            manualOTPay: 0,
            clockInSource: evt.type === 'IN' ? 'Mobile GPS' : '',
            clockOutSource: evt.type === 'OUT' ? 'Mobile GPS' : ''
          };
          records.push(existing);
          recMap[key] = existing;
        } else {
          // If already exists from biometric:
          // Rule: "once mobile clock in will be the attendance unless biometric will superceed the 1st in time if the time is earlier than mobile clock in"
          if (evt.type === 'IN') {
            const curInMins = parseMins(existing.in);
            const newInMins = parseMins(timeStr);
            if (curInMins == null) {
              existing.in = timeStr;
              existing.clockInSource = 'Mobile GPS';
            } else if (newInMins != null && newInMins < curInMins) {
              // Mobile clock in is earlier than current in
              existing.in = timeStr;
              existing.clockInSource = 'Mobile GPS';
            }
            // If biometric is earlier (curInMins <= newInMins), biometric stays!
          } else if (evt.type === 'OUT') {
            const curOutMins = parseMins(existing.out);
            const newOutMins = parseMins(timeStr);
            if (curOutMins == null || (newOutMins != null && newOutMins > curOutMins)) {
              existing.out = timeStr;
              existing.clockOutSource = 'Mobile GPS';
            }
          }
        }
      }
    }
  } catch (mErr) {
    if (typeof Logger !== 'undefined') Logger.log('Error merging mobile clock events: ' + mErr);
  }

  return jsonResponse({ status: 'success', data: records });
}

function getLockedMonths() {
  const sheet = getSpreadsheet_().getSheetByName('LockedMonths');
  if (!sheet) return jsonResponse({ status: 'success', data: {} }); 
  const data = readSheet_(sheet, true);
  const locked = {};
  for(let i=1; i<data.length; i++) {
    if(data[i][0] && data[i][1]) {
      try { locked[data[i][0]] = JSON.parse(data[i][1]); } catch(e) {}
    }
  }
  return jsonResponse({ status: 'success', data: locked });
}

function unlockMonth(payload) {
  const sheet = getSpreadsheet_().getSheetByName('LockedMonths');
  if (!sheet) return jsonResponse({ status: 'success', message: 'Month not found.' });
  const data = readSheet_(sheet, false);
  const companyId = payrollCompanyScope_(payload.company).id;
  const targetKey = companyId ? payload.month + '__' + companyId : payload.month;
  for(let i=1; i<data.length; i++) {
    if(String(data[i][0]) === String(targetKey) || (!payload.company && String(data[i][0]) === String(payload.month))) { 
      sheet.deleteRow(i + 1); 
      return jsonResponse({ status: 'success', message: 'Month unlocked.' });
    }
  }
  return jsonResponse({ status: 'success', message: 'Month not found.' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// --- LOGIN LOGIC ---
function handleLogin(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  const data = readSheet_(sheet, false);
  
  for (let i = 1; i < data.length; i++) {
    const status = data[i][1];   // Col B
    const username = data[i][2]; // Col C
    const password = data[i][3]; // Col D
    const icNo = data[i][8];     // Col I
    
    // Check against Username or IC No
    if ((username == payload.username || icNo == payload.username) && password == payload.password) {
      
      // Block Login if Resigned
      if (status === "Resigned") {
          return jsonResponse({ status: 'error', message: 'Account deactivated. Please contact Admin.' });
      }

      const staffName = data[i][0]; // Col A
      const role = data[i][4] || "Staff"; // Col E
      const gender = data[i][7] || "Male"; // Col H
      const joinedDateStr = data[i][12]; // Col M
      
      let alEntitlement = 0;
      let mlEntitlement = 14;
      const currentYear = new Date().getFullYear();

      if (joinedDateStr) {
          let joined = new Date(joinedDateStr);
          let completedYears = currentYear - joined.getFullYear();
          let now = new Date();
          if (now.getMonth() < joined.getMonth() || (now.getMonth() === joined.getMonth() && now.getDate() < joined.getDate())) {
              completedYears--;
          }
          if (completedYears < 0) completedYears = 0;

          if (currentYear === joined.getFullYear()) {
              let monthsWorked = 12 - joined.getMonth();
              alEntitlement = Math.round(12 * (monthsWorked / 12));
          } else {
              alEntitlement = Math.min(26, 12 + Math.max(0, completedYears - 1));
          }

          if (completedYears < 2) mlEntitlement = 14;
          else if (completedYears < 5) mlEntitlement = 18;
          else mlEntitlement = 22;
      } else {
          alEntitlement = parseFloat(data[i][21]) || 0; // Col V
          mlEntitlement = parseFloat(data[i][22]) || 0; // Col W
      }
      
      const leaveSheet = getSpreadsheet_().getSheetByName('Leave');
      const leaveData = leaveSheet ? readSheet_(leaveSheet, false) : [];
      let approvedAL = 0;
      let approvedML = 0;
      
      for(let j = 1; j < leaveData.length; j++) {
        if(leaveData[j][1] === staffName && leaveData[j][8] === "Approved") {
          let leaveDateStr = leaveData[j][3];
          if (leaveDateStr) {
              let leaveYear = new Date(leaveDateStr).getFullYear();
              if (leaveYear === currentYear) {
                  let typeStr = leaveData[j][2] || "";
                  if (typeStr.startsWith("AL") || typeStr.startsWith("EL")) approvedAL += parseFloat(leaveData[j][5]) || 0;
                  if (typeStr.startsWith("ML") || typeStr.startsWith("MC")) approvedML += parseFloat(leaveData[j][5]) || 0;
              }
          }
        }
      }
      
      const gradeId = data[i][33] || '';
      let gradeCode = '';
      if (gradeId) {
        try {
          const gRow = hrRows_('jobGrades').find(g => g.id === gradeId);
          if (gRow && gRow.code) gradeCode = String(gRow.code).toUpperCase();
        } catch(e) {}
      }

      return jsonResponse({ 
        status: 'success', 
        user: { 
          name: staffName, role: role, icNo: icNo, gender: gender,
          alEntitlement: alEntitlement, alBalance: alEntitlement - approvedAL,
          mcEntitlement: mlEntitlement, mcBalance: mlEntitlement - approvedML,
          socsoNo: data[i][17], epfNo: data[i][18], taxNo: data[i][19], bankNo: data[i][20],
          employeeNo: data[i][24] || '',
          companyId: data[i][25] || '',
          departmentId: data[i][26] || '',
          manager: data[i][27] || '',
          jobTitle: data[i][28] || '',
          gradeId: gradeId,
          gradeCode: gradeCode,
          jobTitleId: data[i][32] || '',
          joinedDate: data[i][12] || '',
          confirmDate: data[i][13] || '',
          photo: data[i][45] || '',
          photoUrl: data[i][45] || ''
        } 
      });
    }
  } 
  return jsonResponse({ status: 'error', message: 'Invalid credentials.' });
}

function hrGetHrHodEmail_() {
  try {
    const profiles = typeof hrProfiles_ === 'function' ? hrProfiles_() : [];
    const hrHod = profiles.find(p => {
      const role = String(p.role || '').toUpperCase();
      const dept = String(p.department || p.departmentId || '').toUpperCase();
      return (role === 'HOD' || role === 'ADMIN') && (dept.includes('HR') || dept.includes('HUMAN'));
    }) || profiles.find(p => String(p.role || '').toUpperCase() === 'HR' && p.email);
    if (hrHod && hrHod.email) return hrHod.email;
  } catch (_) {}
  return (typeof HR_ADMIN_EMAIL_ !== 'undefined' && HR_ADMIN_EMAIL_) ? HR_ADMIN_EMAIL_ : "hock@metrio.com.my";
}

function submitLeave(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Leave');
  let fileUrl = "";
  
  if(payload.fileData||payload.fileName){
    try {
      const target=hrStaffTarget_(payload.staffName);
      let folder;
      try {
        folder=hrEnsureStaffFolder_(target);
      } catch(folderErr) {
        try {
          folder = target.row[41] ? DriveApp.getFolderById(String(target.row[41])) : DriveApp.getRootFolder();
        } catch(_) {
          folder = DriveApp.getRootFolder();
        }
      }
      fileUrl=hrUploadFile_(folder,payload);
    } catch(err) {
      fileUrl = payload.fileName || "";
    }
  }

  const reqId = "LV-" + Utilities.getUuid();
  const appliedDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
  
  const isFractional = (payload.type === 'fractional_split' || payload.leaveType === 'fractional_split');
  const leaveType = isFractional ? 'fractional_split' : (payload.leaveType || payload.type || 'AL');
  const totalDays = Number(payload.totalDays);
  const annualDays = isFractional ? Number(payload.annualDays || 0) : (leaveType === 'AL' ? totalDays : 0);
  const unpaidDays = isFractional ? Number(payload.unpaidDays || 0) : (leaveType === 'NPL' ? totalDays : 0);

  // Check if employee has a manager (direct manager or department HOD)
  const profiles = hrProfiles_();
  const profile = profiles.find(p => p.employee === hrName_(payload.staffName));
  let managerName = profile ? (profile.manager || '') : '';
  if (!managerName && profile && profile.departmentId) {
    const deptHod = profiles.find(p => p.departmentId === profile.departmentId && ['HOD','Supervisor'].indexOf(hrRole_(p.role)) !== -1 && p.employee !== profile.employee);
    if (deptHod) managerName = deptHod.employee;
  }
  const hasManager = Boolean(managerName);
  const initialStatus = hasManager ? 'pending_hod' : 'pending_admin';

  // Save application to the Google Sheet
  sheet.appendRow([
    reqId, payload.staffName, leaveType, payload.startDate, payload.endDate, 
    totalDays, payload.reason, fileUrl, initialStatus, appliedDate,
    '', '', annualDays, unpaidDays, ''
  ]);
  
  // --- SEND EMAIL NOTIFICATION (AUTO NOTIFY HOD / HR) ---
  try {
    const adminEmail = hrGetHrHodEmail_();
    let managerEmail = "";
    if (hasManager) {
      const mgrProf = profiles.find(p => hrName_(p.employee) === hrName_(managerName));
      if (mgrProf && mgrProf.email) managerEmail = mgrProf.email;
    }

    const subject = managerEmail
      ? `[Action Required] New Leave Application: ${payload.staffName} (${leaveType}) - Awaiting HOD Endorsement`
      : `[Action Required] New Leave Application: ${payload.staffName} (${leaveType}) - Awaiting HR Approval`;
    
    let body = managerEmail
      ? `Hello ${managerName || 'HOD'},\n\nA new leave application has been submitted by your team member and is awaiting your endorsement.\n\n`
      : `Hello Admin / HR,\n\nA new leave application has been submitted and is awaiting your approval.\n\n`;
    body += `--------------------------------------\n`;
    body += `Staff Name : ${payload.staffName}\n`;
    body += `Leave Type : ${leaveType}\n`;
    body += `Start Date : ${payload.startDate}\n`;
    body += `End Date   : ${payload.endDate}\n`;
    body += `Total Days : ${payload.totalDays}\n`;
    body += `Reason     : ${payload.reason || '-'}\n`;
    if (hasManager) body += `Reporting Manager : ${managerName}\n`;
    if (fileUrl) body += `Attachment : ${fileUrl}\n`;
    body += `--------------------------------------\n\n`;
    body += `Please log in to the Metrio HR Portal / Mobile App to review and process this request.`;
    
    const targetRecipient = managerEmail || adminEmail;

    MailApp.sendEmail({
      to: targetRecipient,
      subject: subject,
      body: body
    });
  } catch(e) {
    console.log("Email Notification Failed: " + e);
  }

  try {
    hrAudit_(
      { name: payload.staffName, role: 'Staff' },
      'leave',
      { id: reqId, employee: payload.staffName, title: `Leave Application: ${payload.staffName} (${leaveType})`, manager: managerName },
      hasManager ? 'Submitted to HOD' : 'Submitted to HR'
    );
  } catch(e) {}
  
  return jsonResponse({ status: 'success', message: 'Leave submitted successfully.' });
}

function getLeaveData(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Leave');
  if(!sheet) return jsonResponse({status: 'success', data: []});
  
  const data = readSheet_(sheet, false);
  let results = [];
  const testHistory=hrLeaveTestIds_();
  const staffTarget = hrName_(payload ? (payload.staffName || payload.name || '') : '');
  
  for (let i = 1; i < data.length; i++) {
    let row = {
      id: data[i][0], name: data[i][1], type: data[i][2], start: data[i][3], end: data[i][4],
      days: data[i][5], reason: data[i][6], attachment: data[i][7], status: data[i][8], date: data[i][9], decision:data[i][10]||'', decisionRemark:data[i][11]||'', rowIndex: i + 1,
      annualDays: data[i][12] != null && data[i][12] !== '' ? Number(data[i][12]) : (data[i][2] === 'AL' ? Number(data[i][5]) : 0),
      unpaidDays: data[i][13] != null && data[i][13] !== '' ? Number(data[i][13]) : (data[i][2] === 'NPL' ? Number(data[i][5]) : 0),
      nplTag: data[i][14] || '',
      isTestHistory:!!testHistory[hrName_(data[i][1])+'|'+String(data[i][0])]
    };
    
    if (payload && payload.scope === 'personal') {
      if (staffTarget && hrName_(row.name) === staffTarget) results.push(row);
    } else if (payload && (payload.role === "Admin" || payload.role === "Supervisor")) {
      results.push(row);
    } else {
      if (!staffTarget || hrName_(row.name) === staffTarget) results.push(row);
    }
  }
  return jsonResponse({ status: 'success', data: results });
}

function updateLeaveStatus(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Leave');
  
  const rowIndex = Number(payload.rowIndex);
  if (!Number.isInteger(rowIndex) || rowIndex < 2 || rowIndex > sheet.getLastRow()) {
    return jsonResponse({ status: 'error', message: 'Invalid leave row.' });
  }
  const maxCol = Math.max(15, sheet.getLastColumn());
  const fullRow = sheet.getRange(rowIndex, 1, 1, maxCol).getValues()[0];
  const curStatus = String(fullRow[8] || '').trim();
  let nextStatus = payload.newStatus;

  const isApproval = /approve/i.test(String(payload.newStatus || ''));
  const isRejection = /reject/i.test(String(payload.newStatus || ''));

  if (isRejection) {
    if (curStatus === 'Withdrawal Requested' || curStatus === 'withdrawal_pending_hod' || curStatus === 'withdrawal_pending_hr') {
      nextStatus = 'Approved';
    } else {
      nextStatus = 'rejected';
    }
  } else if (isApproval) {
    if (curStatus === 'pending_hod') {
      nextStatus = 'pending_admin';
    } else if (curStatus === 'pending_admin') {
      nextStatus = 'approved';
    } else if (curStatus === 'Pending') {
      nextStatus = 'Approved';
    } else if (curStatus === 'Withdrawal Requested' || curStatus === 'withdrawal_pending_hod') {
      nextStatus = 'withdrawal_pending_hr';
    } else if (curStatus === 'withdrawal_pending_hr') {
      nextStatus = 'Withdrawn';
    } else {
      nextStatus = payload.newStatus;
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB') + ', ' + now.toLocaleTimeString('en-GB');
  const decisionStr = `${dateStr} by ${payload.approver || 'Admin'}`;
  let decisionRemark = fullRow[11] || '';
  if (payload.withdrawRemark) decisionRemark = payload.withdrawRemark;
  if (payload.reason) decisionRemark = payload.reason;
  if (payload.approverRemark) decisionRemark = payload.approverRemark;

  const unpaidDays = Number(fullRow[13]) || (fullRow[2] === 'NPL' ? Number(fullRow[5]) : 0);
  let nplTag = fullRow[14] || '';
  if ((nextStatus === 'approved' || nextStatus === 'Approved') && unpaidDays > 0) {
    nplTag = 'TAGGED_NPL_DEDUCTION';
  }

  sheet.getRange(rowIndex, 9, 1, 7).setValues([[
    nextStatus,
    fullRow[9] || '',
    decisionStr,
    decisionRemark,
    fullRow[12] != null ? fullRow[12] : '',
    fullRow[13] != null ? fullRow[13] : '',
    nplTag
  ]]);

  // --- NOTIFICATION ROUTING (HOD -> HR -> STAFF) ---
  try {
    const adminEmail = hrGetHrHodEmail_();
    const staffName = fullRow[1];
    const leaveType = fullRow[2];
    const startDate = fullRow[3];
    const endDate = fullRow[4];
    const totalDays = fullRow[5];
    const profile = hrProfiles_().find(p => p.employee === hrName_(staffName));
    const staffEmail = profile ? profile.email : '';

    if (curStatus === 'pending_hod' && nextStatus === 'pending_admin') {
      // 1. HOD Endorsed -> Automatically notify HR
      const subject = `[Action Required] Leave Application Endorsed by HOD: ${staffName} - Awaiting HR Final Approval`;
      let body = `Hello HR,\n\n`;
      body += `${payload.approver || 'HOD'} has endorsed the leave application for ${staffName}.\n\n`;
      body += `--------------------------------------\n`;
      body += `Staff Name : ${staffName}\n`;
      body += `Leave Type : ${leaveType}\n`;
      body += `Start Date : ${startDate}\n`;
      body += `End Date   : ${endDate}\n`;
      body += `Total Days : ${totalDays}\n`;
      body += `Endorsement Remark: ${decisionRemark || '-'}\n`;
      body += `--------------------------------------\n\n`;
      body += `Please log in to the Metrio HR Portal / Mobile App to process final approval.`;

      MailApp.sendEmail({ to: adminEmail, subject: subject, body: body });
      try {
        hrAudit_({ name: payload.approver || 'HOD', role: 'HOD' }, 'leave', { id: fullRow[0], employee: staffName, title: 'Leave Endorsed: ' + staffName }, 'Endorsed by HOD to HR');
      } catch (_) {}
    } else if ((curStatus === 'pending_admin' || curStatus === 'Pending') && (nextStatus === 'approved' || nextStatus === 'Approved')) {
      // 2. HR Approved -> Notify Staff
      const targetEmail = staffEmail || adminEmail;
      if (targetEmail) {
        const subject = `Leave Application Approved: ${staffName} (${leaveType})`;
        let body = `Hello ${staffName},\n\n`;
        body += `Your leave application has been approved by HR (${payload.approver || 'HR'}).\n\n`;
        body += `--------------------------------------\n`;
        body += `Leave Type : ${leaveType}\n`;
        body += `Start Date : ${startDate}\n`;
        body += `End Date   : ${endDate}\n`;
        body += `Total Days : ${totalDays}\n`;
        body += `--------------------------------------\n\n`;
        body += `You can view your updated balance in the Metrio HR Portal / Mobile App.`;

        MailApp.sendEmail({ to: targetEmail, subject: subject, body: body });
      }
      try {
        hrAudit_({ name: payload.approver || 'HR', role: 'HR' }, 'leave', { id: fullRow[0], employee: staffName, title: 'Leave Approved: ' + staffName }, 'Approved by HR');
      } catch (_) {}
    } else if (isRejection) {
      // 3. Rejected -> Notify Staff
      const targetEmail = staffEmail || adminEmail;
      if (targetEmail) {
        const subject = `Leave Application Rejected: ${staffName} (${leaveType})`;
        let body = `Hello ${staffName},\n\n`;
        body += `Your leave application (${leaveType}, ${startDate} to ${endDate}) was rejected by ${payload.approver || 'Manager/HR'}.\n\n`;
        body += `Reason: ${decisionRemark || '-'}\n\n`;
        body += `Please contact HR or your reporting manager if you have questions.`;

        MailApp.sendEmail({ to: targetEmail, subject: subject, body: body });
      }
      try {
        hrAudit_({ name: payload.approver || 'Manager', role: 'Manager' }, 'leave', { id: fullRow[0], employee: staffName, title: 'Leave Rejected: ' + staffName }, 'Rejected');
      } catch (_) {}
    } else if (payload.newStatus === 'Withdrawal Requested') {
      // 4. Withdrawal Requested -> Notify HR
      const subject = `Leave Cancellation Request: ${staffName}`;
      let body = `Hello Admin,\n\n`;
      body += `${staffName} has requested to cancel their previously applied leave.\n\n`;
      body += `--------------------------------------\n`;
      body += `Leave Type   : ${leaveType}\n`;
      body += `Start Date   : ${startDate}\n`;
      body += `End Date     : ${endDate}\n`;
      body += `Total Days   : ${totalDays}\n`;
      body += `Cancel Reason: ${payload.withdrawRemark || '-'}\n`;
      body += `--------------------------------------\n\n`;
      body += `Please log in to the Metrio HR Portal to approve or reject this cancellation.`;
      
      MailApp.sendEmail({
        to: adminEmail,
        subject: subject,
        body: body
      });
    }
  } catch(e) {
    console.log("Status Transition Email Notification Failed: " + e);
  }
  // ---------------------------------------------------------

  return jsonResponse({ status: 'success' });
}

function getPayroll() {
  hrAssert_(!payrollPendingOperation_(), 'Payroll recovery is in progress. Ask HR to retry the incomplete approval.');
  const sheet = getSpreadsheet_().getSheetByName('Payroll');
  if (!sheet) return jsonResponse({ status: 'success', data: [] });
  const data = readSheet_(sheet, true);
  const records = [];
  for(let i=1; i<data.length; i++) {
    if(data[i][0]) {
      records.push({
        month: data[i][0], id: data[i][1], name: data[i][2], basic: data[i][3], 
        workedDays: data[i][4], otPay: data[i][5], gross: data[i][6],
        epfEmp: data[i][7], socsoEmp: data[i][8], eisEmp: data[i][9], totalEmpDed: data[i][10],
        epfEmpr: data[i][11], socsoEmpr: data[i][12], eisEmpr: data[i][13], totalEmprCont: data[i][14],
        nettPay: data[i][15],
        pcb: data[i][16] || 0,
        nplDeduction: data[i][17] || 0,
        claims: data[i][18] || 0,
        zeroMcAward: data[i][19] || 0,
        companyId: data[i][20] || ''
      });
    }
  }
  return jsonResponse({ status: 'success', data: records });
}

function resetPassword(payload) {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found' });
  
  const data = readSheet_(sheet, false);
  
  // Clean up user inputs and REMOVE DASHES for a safe, foolproof comparison
  const targetUser = payload.username.trim().toLowerCase();
  const targetIC = payload.icNo.trim().replace(/-/g, ""); 
  
  for (let i = 1; i < data.length; i++) {
    const username = (data[i][2] || "").toString().trim().toLowerCase(); // Col C
    const icNo = (data[i][8] || "").toString().trim().replace(/-/g, ""); // Col I (removes dashes)
    
    // Check if the typed username matches Col C exactly AND IC matches Col I
    if (username === targetUser && icNo === targetIC) {
      
      // Match found! Update password in Col D (4th column)
      sheet.getRange(i + 1, 4).setValue(payload.newPassword);
      return jsonResponse({ status: 'success', message: 'Password updated successfully' });
    }
  }
  
  // If no match found
  return jsonResponse({ status: 'error', message: 'Failed to verify identity. Username or IC No incorrect.' });
}

// Request-local reuse only; credentials and payroll are not placed in shared caches.
let requestSpreadsheet_ = null;
// Reuse reads only within read-only requests. Mutations always reread Sheets.
let requestSheetReads_ = null;
const READ_ACTIONS_ = ['leaveOverview','hrBootstrap','getBootstrap','getStaff','getHolidays','getData','getAttendance','getLockedMonths','getLeaveData','getPayroll','getStatutorySettings','previewYearEndClose','getStaffDossier','getAttendanceApproval','getActionCount','mobileClockConfig','getClockLocations'];
function getSpreadsheet_() {
  if (!requestSpreadsheet_) requestSpreadsheet_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return requestSpreadsheet_;
}
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'inspectDepts') {
    const sheet = hrSheet_('departments', false);
    const rows = sheet ? readSheet_(sheet, false) : [];
    const parsed = hrRows_('departments');
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      rawRows: rows,
      parsedCount: parsed.length,
      parsed: parsed
    })).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'saveHolidays2026') {
    const list = [
      { date: '2026-01-01', name: 'New Year', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-01-14', name: "Yang di-Pertuan Besar Negeri Sembilan's Birthday", company: 'All', workBase: 'SITE', location: 'NS', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 1 } },
      { date: '2026-01-17', name: 'Israk dan Mikraj', company: 'All', workBase: 'SITE', location: 'NS', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 1 } },
      { date: '2026-02-01', name: 'Thaipusam (Replacement on 02-Feb-26 Monday)', company: 'All', workBase: 'SITE', location: 'All', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-02-01', name: 'Federal Territory Day (Replacement on 03-Feb-26 Tuesday)', company: 'All', workBase: 'SITE', location: 'KL', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 1, SITE_NS: 0 } },
      { date: '2026-02-16', name: 'Replacement Thaipusam (Office staff only)', company: 'All', workBase: 'OFFICE', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 0 } },
      { date: '2026-02-17', name: 'Chinese New Year (1st Day)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-02-18', name: 'Chinese New Year (2nd Day)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-03-07', name: 'Nuzul Al-Quran', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 0 } },
      { date: '2026-03-21', name: 'Hari Raya Puasa (1st Day)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-03-22', name: 'Hari Raya Puasa (2nd Day) (Replacement on 23-Mar-26 Monday)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-05-01', name: 'Labour Day', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-05-27', name: 'Hari Raya Haji', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-05-31', name: 'Wesak Day (Replacement on 1-Jun-26 Monday)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-06-01', name: "Agong's Birthday (Replacement on 2-Jun-26 Tuesday)", company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-06-17', name: 'Awal Muharam', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-07-07', name: 'George Town World Heritage Day', company: 'All', workBase: 'All', location: 'PG', matrix: { OFFICE_PG: 1, OFFICE_SEL: 0, SITE_PG: 1, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 0 } },
      { date: '2026-07-11', name: "Penang Governor's Birthday", company: 'All', workBase: 'All', location: 'PG', matrix: { OFFICE_PG: 1, OFFICE_SEL: 0, SITE_PG: 1, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 0 } },
      { date: '2026-08-25', name: "Prophet Muhammad's Birthday", company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-08-31', name: 'National Day', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-09-16', name: 'Malaysia Day', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-11-08', name: 'Deepavali (Replacement on 09-Nov-26 Monday)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
      { date: '2026-12-11', name: "Sultan of Selangor's Birthday", company: 'All', workBase: 'All', location: 'SEL', matrix: { OFFICE_PG: 0, OFFICE_SEL: 1, SITE_PG: 0, SITE_SEL: 1, SITE_KL: 0, SITE_NS: 0 } },
      { date: '2026-12-25', name: 'Christmas', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } }
    ];
    return saveHolidays(list);
  }
  if (e && e.parameter && e.parameter.action === 'getHolidays') {
    return getHolidays();
  }
  return jsonResponse({status:'error',message:'Sign-in required. Use authenticated POST requests.',version:'HR-2'});
}
function doPost(e) {
  requestSpreadsheet_ = null;
  requestSheetReads_ = null;
  let lock = null;
  try {
    const body = JSON.parse(e.postData.contents), action = body.action;
    if(action==='login'||action==='hrTransition'||READ_ACTIONS_.indexOf(action)!==-1)requestSheetReads_=Object.create(null);
    if(action === 'login') {
      const response=JSON.parse(handleLogin(body.payload||{}).getContent());
      if(response.status==='success') {
        response.user.role=hrRole_(response.user.role);
        response.sessionToken=hrIssueSession_(response.user);
        Object.assign(response.user,hrLeaveSummary_(response.user.name,response.user));
      }
      return jsonResponse(response);
    }
    if(action === 'resetPassword') return jsonResponse({status:'error',message:'For account recovery, contact your HR administrator. Self-service recovery is disabled.'});
    const actor=hrAuthenticate_(body.sessionToken);
    if(action==='logout'){CacheService.getScriptCache().remove('hr-session:'+body.sessionToken);return jsonResponse({status:'success'});}
    if(action==='whoami')return jsonResponse({status:'success',user:actor});
    // Payroll readers share the commit lock so they cannot cross a staged write.
    if(READ_ACTIONS_.indexOf(action)===-1 || ['getPayroll','getStaffDossier'].indexOf(action)!==-1) {
      lock=LockService.getScriptLock();
      if(!lock.tryLock(5000))return jsonResponse({status:'error',message:'System busy. Please retry.'});
      const pendingPayroll = payrollPendingOperation_();
      if(pendingPayroll && ['lockMonth','approveAttendanceHR'].indexOf(action) === -1) throw new Error('Payroll recovery required. HR must retry approval for ' + pendingPayroll.key + ' before further changes.');
    }
    if(action==='syncBioTimeAttendance')return syncBioTimeAttendance_(body.payload||{},actor);
    if(action==='syncBioTimeDirect')return syncBioTimeAttendance_(body.payload||{},{role:'Admin'});
    if(action==='leaveOverview')return hrLeaveOverview_(actor);
    if(action==='hrBootstrap')return hrBootstrap_(actor,body.payload||{});
    if(action==='staffDocumentUpload')return hrStaffDocumentUpload_(body.payload||{},actor);
    if(action==='uploadProfilePhoto')return hrUploadProfilePhoto_(body.payload||{},actor);
    if(action==='uploadCandidateCv')return hrUploadCandidateCv_(body.payload||{},actor);
    if(action==='hrDelete')return hrDelete_(body.payload||{},actor);
    if(action==='hrSave')return hrSave_(body.payload||{},actor);
    if(action==='hrTransition')return hrTransition_(body.payload||{},actor);
    if(action==='getStatutorySettings')return getStatutorySettings(actor);
    if(action==='saveStatutorySettings')return saveStatutorySettings(body.payload||{},actor);
    if(action==='previewYearEndClose')return previewYearEndClose(body.payload||{},actor);
    if(action==='executeYearEndClose')return executeYearEndClose(body.payload||{},actor);
    if(action==='getStaffDossier')return getStaffDossier(body.payload||{},actor);
    if(action==='mobileClockConfig')return mobileClockConfig_(body.payload||{},actor);
    if(action==='mobileClockSiteSave')return mobileClockSiteSave_(body.payload||{},actor);
    if(action==='mobileClockPolicySave')return mobileClockPolicySave_(body.payload||{},actor);
    if(action==='mobileClockPunch')return mobileClockPunch_(body.payload||{},actor);
    if(action==='getClockLocations')return jsonResponse({status:'success',data:{locations:getClockLocationsData_()}});
    if(action==='saveClockLocations')return saveClockLocations_(body.payload||{},actor);
    const payload=hrLegacyPayload_(action,body.payload||{},actor);
    const response=routePost_({postData:{contents:JSON.stringify({action:action,payload:payload,actor:actor})}});
    if(action==='saveSingleStaff'&&JSON.parse(response.getContent()).status==='success')hrAudit_(actor,'profiles',{id:payload.employeeNo||payload.name,employee:payload.name,title:'Employee record updated'},'Updated');
    return hrLegacyResponse_(action,response,actor);
  } catch(error) {
    return jsonResponse({status:'error',message:error.message||String(error)});
  } finally {
    if(lock&&lock.hasLock()){try{SpreadsheetApp.flush();}finally{lock.releaseLock();}}
    requestSpreadsheet_=null;
    requestSheetReads_=null;
  }
}
function readSheet_(sheet, display) {
  if (!sheet) throw new Error('Required sheet not found.');
  const key=sheet.getName()+'|'+(display?'display':'raw');
  if(requestSheetReads_&&Object.prototype.hasOwnProperty.call(requestSheetReads_,key))return copySheetRows_(requestSheetReads_[key]);
  const lastRow = sheet.getLastRow();
  if (!lastRow) return [];
  const widths = {Staff:46, Holidays:6, Data:7, Attendance:15, LockedMonths:2, Leave:15, Payroll:20, HR_statutorySettings:7};
  const width = Math.max(widths[sheet.getName()] || 0, sheet.getLastColumn());
  const range = sheet.getRange(1, 1, lastRow, width);
  const rows=display ? range.getDisplayValues() : range.getValues();
  if(requestSheetReads_)requestSheetReads_[key]=copySheetRows_(rows);
  return rows;
}
function invalidateSheetRead_(sheet) {
  if(!requestSheetReads_ || !sheet) return;
  delete requestSheetReads_[sheet.getName() + '|raw'];
  delete requestSheetReads_[sheet.getName() + '|display'];
}
function copySheetRows_(rows) {
  // Preserve Date values without allowing one consumer to mutate another's data.
  return rows.map(row=>row.map(value=>value instanceof Date?new Date(value.getTime()):value));
}
function ensureRows_(sheet, count) {
  const maxRows = sheet.getMaxRows();
  if (count > maxRows) sheet.insertRowsAfter(maxRows, count - maxRows);
}
function replaceRows_(sheet, rows) {
  const oldLastRow = sheet.getLastRow();
  const oldWidth = sheet.getLastColumn();
  if (rows.length) {
    const width = rows[0].length;
    if (rows.some(row => row.length !== width)) throw new Error('Inconsistent row widths.');
    ensureRows_(sheet, rows.length + 1);
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    // Match previous clear-and-replace behavior for unused columns.
    if (oldWidth > width && oldLastRow > 1) {
      sheet.getRange(2, width + 1, oldLastRow - 1, oldWidth - width).clearContent();
    }
  }
  const nextRow = rows.length + 2;
  if (oldLastRow >= nextRow && oldWidth) {
    sheet.getRange(nextRow, 1, oldLastRow - nextRow + 1, oldWidth).clearContent();
  }
}
function getBootstrap() {
  const output = {};
  const readers = {staff:getStaff, holidays:getHolidays, data:getData,
    attendance:getAttendance, lockedMonths:getLockedMonths,
    leaves:() => getLeaveData({role:'Admin'})};
  Object.keys(readers).forEach(key => {
    output[key] = JSON.parse(readers[key]().getContent());
  });
  return jsonResponse({status:'success', data:output});
}

// HR extension (included in this single deployment script).
const HR_MODULES = {
  "jobGrades": {
    "label": "Job Grades",
    "icon": "layers",
    "group": "Organisation",
    "admin": true,
    "fields": [
      {
        "key": "code",
        "label": "Grade code",
        "type": "text",
        "required": true
      },
      {
        "key": "title",
        "label": "Grade name",
        "type": "text",
        "required": true
      },
      {
        "key": "availability",
        "label": "Availability",
        "type": "select",
        "options": [
          "Active",
          "Inactive"
        ],
        "required": true
      },
      {
        "key": "notes",
        "label": "Description",
        "type": "textarea"
      }
    ]
  },
  "jobTitles": {
    "label": "Job Title Library",
    "icon": "person-badge",
    "group": "Organisation",
    "admin": true,
    "fields": [
      {
        "key": "code",
        "label": "Job code",
        "type": "text",
        "required": true
      },
      {
        "key": "title",
        "label": "Job title",
        "type": "text",
        "required": true
      },
      {
        "key": "gradeId",
        "label": "Job grade",
        "type": "ref",
        "ref": "jobGrades",
        "required": true
      },
      {
        "key": "departmentId",
        "label": "Department",
        "type": "ref",
        "ref": "departments",
        "required": false
      },
      {
        "key": "workBase",
        "label": "Work Based",
        "type": "select",
        "options": [
          "Office",
          "Site"
        ],
        "required": true
      },
      {
        "key": "workLocation",
        "label": "Work Location",
        "type": "select",
        "options": [
          "All",
          "PG",
          "SEL",
          "KL",
          "NS"
        ],
        "required": true
      },
      {
        "key": "availability",
        "label": "Availability",
        "type": "select",
        "options": [
          "Active",
          "Inactive"
        ],
        "required": true
      },
      {
        "key": "notes",
        "label": "Description",
        "type": "textarea"
      }
    ]
  },
  "resourcePolicies": {
    "label": "Resource Limits",
    "icon": "sliders",
    "group": "Administration",
    "admin": true,
    "fields": [
      {
        "key": "title",
        "label": "Policy name",
        "type": "text",
        "required": true
      },
      {
        "key": "companyId",
        "label": "Company",
        "type": "ref",
        "ref": "companies",
        "required": true
      },
      {
        "key": "gradeId",
        "label": "Job grade (blank = all grades)",
        "type": "ref",
        "ref": "jobGrades"
      },
      {
        "key": "category",
        "label": "Resource category",
        "type": "select",
        "options": [
          "Vehicle",
          "Room",
          "Equipment",
          "Laptop",
          "Other"
        ],
        "required": true
      },
      {
        "key": "maxAssigned",
        "label": "Maximum active resources per employee",
        "type": "number",
        "required": true,
        "min": 0,
        "max": 1000
      },
      {
        "key": "maxValue",
        "label": "Total asset-value cap (RM; 0 = no value cap)",
        "type": "number",
        "min": 0
      },
      {
        "key": "notes",
        "label": "Policy notes",
        "type": "textarea"
      }
    ]
  },
  "claimTypes": {
    "label": "Claim Types",
    "icon": "tags",
    "group": "Administration",
    "admin": true,
    "fields": [
      {
        "key": "code",
        "label": "Type code",
        "type": "text",
        "required": true
      },
      {
        "key": "title",
        "label": "Claim type name",
        "type": "text",
        "required": true
      },
      {
        "key": "availability",
        "label": "Availability",
        "type": "select",
        "options": [
          "Active",
          "Inactive"
        ],
        "required": true
      },
      {
        "key": "notes",
        "label": "Guidance",
        "type": "textarea"
      }
    ]
  },
  "resourceAssignments": {
    "label": "Resource Assignments",
    "icon": "person-workspace",
    "group": "People",
    "admin": true,
    "immutable": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "resourceId",
        "label": "Resource",
        "type": "ref",
        "ref": "resources",
        "required": true
      },
      {
        "key": "category",
        "label": "Category",
        "type": "text"
      },
      {
        "key": "date",
        "label": "Assigned date",
        "type": "date",
        "required": true
      },
      {
        "key": "condition",
        "label": "Condition at handover",
        "type": "text"
      },
      {
        "key": "notes",
        "label": "Handover notes",
        "type": "textarea"
      }
    ]
  },
  "companies": {
    "label": "Companies",
    "icon": "building",
    "group": "Organisation",
    "admin": true,
    "fields": [
      {
        "key": "code",
        "label": "Company code",
        "type": "text",
        "required": true
      },
      {
        "key": "title",
        "label": "Company name",
        "type": "text",
        "required": true
      },
      {
        "key": "registration",
        "label": "Registration no.",
        "type": "text"
      },
      {
        "key": "address",
        "label": "Address",
        "type": "textarea"
      },
      {
        "key": "epf",
        "label": "Employer EPF no.",
        "type": "text"
      },
      {
        "key": "socso",
        "label": "Employer SOCSO no.",
        "type": "text"
      },
      {
        "key": "tax",
        "label": "Employer tax no.",
        "type": "text"
      },
      {
        "key": "inductionPolicy",
        "label": "Benefits policy",
        "type": "select",
        "options": [
          "FAM-23/G Jul 2025"
        ]
      }
    ]
  },
  "departments": {
    "label": "Departments",
    "icon": "diagram-3",
    "group": "Organisation",
    "admin": true,
    "fields": [
      {
        "key": "code",
        "label": "Department code",
        "type": "text",
        "required": true
      },
      {
        "key": "title",
        "label": "Department name",
        "type": "text",
        "required": true
      },
      {
        "key": "companyId",
        "label": "Company",
        "type": "ref",
        "ref": "companies",
        "required": true
      },
      {
        "key": "manager",
        "label": "Department head",
        "type": "staff"
      }
    ]
  },
  "profiles": {
    "label": "Employee directory",
    "icon": "person-badge",
    "group": "Organisation",
    "admin": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "companyId",
        "label": "Company",
        "type": "ref",
        "ref": "companies",
        "required": true
      },
      {
        "key": "departmentId",
        "label": "Department",
        "type": "ref",
        "ref": "departments",
        "required": true
      },
      {
        "key": "manager",
        "label": "Approving manager",
        "type": "staff"
      },
      {
        "key": "jobTitle",
        "label": "Job title",
        "type": "text"
      },
      {
        "key": "employeeNo",
        "label": "Employee number",
        "type": "text"
      },
      {
        "key": "location",
        "label": "Work location",
        "type": "text"
      }
    ]
  },
  "claimPolicies": {
    "label": "Claim Limits by Grade",
    "icon": "sliders",
    "group": "Administration",
    "admin": true,
    "fields": [
      {
        "key": "title",
        "label": "Policy name",
        "type": "text",
        "required": true
      },
      {
        "key": "companyId",
        "label": "Company",
        "type": "ref",
        "ref": "companies",
        "required": true
      },
      {
        "key": "gradeId",
        "label": "Job grade (blank = all grades)",
        "type": "ref",
        "ref": "jobGrades"
      },
      {
        "key": "category",
        "label": "Claim type",
        "type": "select",
        "options": [
          "Medical",
          "Travel",
          "Mileage",
          "Accommodation",
          "Other"
        ],
        "source": "claimTypes",
        "required": true
      },
      {
        "key": "year",
        "label": "Policy year",
        "type": "number",
        "required": true,
        "min": 2000,
        "max": 2100
      },
      {
        "key": "receiptLimit",
        "label": "Maximum per receipt (RM)",
        "type": "number",
        "required": true,
        "min": 0
      },
      {
        "key": "annualLimit",
        "label": "Annual limit per employee (RM)",
        "type": "number",
        "required": true,
        "min": 0
      }
    ]
  },
  "loans": {
    "label": "Employee loans",
    "icon": "wallet2",
    "group": "Applications",
    "self": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "title",
        "label": "Loan purpose",
        "type": "text",
        "required": true
      },
      {
        "key": "date",
        "label": "Requested date",
        "type": "date",
        "required": true
      },
      {
        "key": "amount",
        "label": "Principal (RM)",
        "type": "number",
        "required": true,
        "min": 0.01
      },
      {
        "key": "instalments",
        "label": "Planned instalments",
        "type": "number",
        "required": true,
        "min": 1,
        "max": 120
      },
      {
        "key": "notes",
        "label": "Agreement / repayment notes",
        "type": "textarea"
      }
    ]
  },
  "claims": {
    "label": "Claims & reimbursement",
    "icon": "receipt",
    "group": "Applications",
    "self": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "category",
        "label": "Claim type",
        "type": "select",
        "options": [
          "Medical",
          "Travel",
          "Mileage",
          "Accommodation",
          "Other"
        ],
        "source": "claimTypes",
        "required": true
      },
      {
        "key": "title",
        "label": "Clinic / merchant",
        "type": "text",
        "required": true
      },
      {
        "key": "receiptNo",
        "label": "Receipt / claim reference",
        "type": "text",
        "required": true
      },
      {
        "key": "date",
        "label": "Receipt date",
        "type": "date",
        "required": true
      },
      {
        "key": "amount",
        "label": "Amount (RM)",
        "type": "number",
        "required": true,
        "min": 0.01
      },
      {
        "key": "evidenceUrl",
        "label": "Upload document",
        "type": "url"
      },
      {
        "key": "vehicleType",
        "label": "Personal vehicle type",
        "type": "select",
        "options": [
          "Car",
          "Motorcycle"
        ],
        "categories": [
          "Mileage"
        ]
      },
      {
        "key": "distanceKm",
        "label": "Business distance (km)",
        "type": "number",
        "min": 0,
        "categories": [
          "Mileage"
        ]
      },
      {
        "key": "personalVehicle",
        "label": "Using your own vehicle?",
        "type": "select",
        "options": [
          "Yes",
          "No"
        ],
        "categories": [
          "Mileage"
        ]
      },
      {
        "key": "tripAuthorisation",
        "label": "Business trip approval reference",
        "type": "text",
        "categories": [
          "Mileage",
          "Outstation Meals"
        ]
      },
      {
        "key": "returnDistanceKm",
        "label": "Return distance from employment base (km)",
        "type": "number",
        "min": 0,
        "categories": [
          "Outstation Meals"
        ]
      },
      {
        "key": "mealType",
        "label": "Meal",
        "type": "select",
        "options": [
          "Breakfast",
          "Lunch",
          "Dinner"
        ],
        "categories": [
          "Outstation Meals"
        ]
      },
      {
        "key": "mealProvided",
        "label": "Was this meal provided?",
        "type": "select",
        "options": [
          "Yes",
          "No"
        ],
        "categories": [
          "Outstation Meals"
        ]
      },
      {
        "key": "notes",
        "label": "Remarks / missing meal receipt justification",
        "type": "textarea"
      }
    ]
  },
  "resources": {
    "label": "Resource catalogue",
    "icon": "box-seam",
    "group": "Applications",
    "admin": true,
    "public": true,
    "fields": [
      { "key": "code", "label": "Resource code", "type": "text" },
      { "key": "availability", "label": "Availability", "type": "select", "options": ["Available", "Maintenance", "Inactive"], "required": true },
      { "key": "title", "label": "Resource name", "type": "text", "required": true },
      { "key": "notes", "label": "Description", "type": "textarea" }
    ]
  },
  "bookings": {
    "label": "Resource Requests",
    "icon": "calendar2-range",
    "group": "Applications",
    "self": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "resourceId",
        "label": "Resource",
        "type": "ref",
        "ref": "resources",
        "required": true
      },
      {
        "key": "category",
        "label": "Category",
        "type": "text"
      },
      {
        "key": "start",
        "label": "Start",
        "type": "datetime-local",
        "required": true
      },
      {
        "key": "end",
        "label": "End",
        "type": "datetime-local",
        "required": true
      },
      {
        "key": "title",
        "label": "Purpose",
        "type": "text",
        "required": true
      }
    ]
  },
  "cycles": {
    "label": "Appraisal cycles",
    "icon": "calendar3",
    "group": "Performance",
    "admin": true,
    "public": true,
    "fields": [
      {
        "key": "title",
        "label": "Cycle name",
        "type": "text",
        "required": true
      },
      {
        "key": "start",
        "label": "Start date",
        "type": "date",
        "required": true
      },
      {
        "key": "end",
        "label": "End date",
        "type": "date",
        "required": true
      },
      {
        "key": "year",
        "label": "Year",
        "type": "number",
        "required": true,
        "min": 2000,
        "max": 2100
      }
    ]
  },
  "appraisals": {
    "label": "Performance appraisals",
    "icon": "graph-up",
    "group": "Performance",
    "admin": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "cycleId",
        "label": "Cycle",
        "type": "ref",
        "ref": "cycles",
        "required": true
      },
      {
        "key": "manager",
        "label": "Reviewer",
        "type": "staff"
      },
      {
        "key": "title",
        "label": "Objectives",
        "type": "text",
        "required": true
      },
      {
        "key": "notes",
        "label": "Success measures / development plan",
        "type": "textarea"
      }
    ]
  },
  "tax": {
    "label": "Tax-relief declarations",
    "icon": "file-earmark-text",
    "group": "Applications",
    "self": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "year",
        "label": "Assessment year",
        "type": "number",
        "required": true,
        "min": 2000,
        "max": 2100
      },
      {
        "key": "category",
        "label": "Relief category",
        "type": "select",
        "options": [
          "Parent medical",
          "Medical treatment",
          "Lifestyle",
          "Sports",
          "Childcare",
          "SSPN",
          "Life insurance",
          "Voluntary EPF",
          "PRS / annuity",
          "Education / medical insurance",
          "EV charging",
          "SOCSO",
          "Other"
        ],
        "required": true
      },
      {
        "key": "title",
        "label": "Declaration description",
        "type": "text",
        "required": true
      },
      {
        "key": "amount",
        "label": "Declared amount (RM)",
        "type": "number",
        "required": true,
        "min": 0.01
      },
      {
        "key": "evidenceUrl",
        "label": "Attachment",
        "type": "url"
      },
      {
        "key": "notes",
        "label": "Remarks",
        "type": "textarea"
      }
    ]
  },
  "letters": {
    "label": "Letters & correspondence",
    "icon": "envelope-paper",
    "group": "People",
    "admin": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "category",
        "label": "Letter type",
        "type": "select",
        "options": [
          "Confirmation",
          "Increment",
          "Transfer",
          "Memo",
          "Offer",
          "Other"
        ],
        "required": true
      },
      {
        "key": "title",
        "label": "Subject",
        "type": "text",
        "required": true
      },
      {
        "key": "date",
        "label": "Issue date",
        "type": "date",
        "required": true
      },
      {
        "key": "refNo",
        "label": "Reference no.",
        "type": "text"
      },
      {
        "key": "notes",
        "label": "Letter content",
        "type": "textarea",
        "required": true
      }
    ]
  },
  "recruitment": {
    "label": "Recruitment pipeline",
    "icon": "person-plus",
    "group": "People",
    "fields": [
      { "key": "title", "label": "Candidate name", "type": "text", "required": true },
      { "key": "contactNo", "label": "Contact number", "type": "text" },
      { "key": "jobTitle", "label": "Position", "type": "select", "options": ["Other"], "required": true },
      { "key": "otherJobTitle", "label": "Other position (if not in list)", "type": "text" },
      { "key": "department", "label": "Department", "type": "text" },
      { "key": "hod", "label": "HOD (Head of Department)", "type": "staff" },
      { "key": "date", "label": "Interview / target date", "type": "date" },
      { "key": "stage", "label": "Stage", "type": "select", "options": ["Applied", "Shortlisted", "Interview", "Offer", "Hired", "Rejected"], "required": true },
      { "key": "evidenceUrl", "label": "CV link", "type": "url" },
      { "key": "notes", "label": "Interview notes", "type": "textarea" },
      { "key": "recommendation", "label": "HOD Decision / Recommendation", "type": "select", "options": ["Pending Review", "Recommended", "Rejected"] }
    ]
  },
  "training": {
    "label": "Training & certifications",
    "icon": "mortarboard",
    "group": "Performance",
    "admin": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "title",
        "label": "Course / certification",
        "type": "text",
        "required": true
      },
      {
        "key": "provider",
        "label": "Provider",
        "type": "text"
      },
      {
        "key": "date",
        "label": "Training date",
        "type": "date",
        "required": true
      },
      {
        "key": "expiry",
        "label": "Certificate expiry",
        "type": "date"
      },
      {
        "key": "amount",
        "label": "Cost (RM)",
        "type": "number",
        "min": 0
      },
      {
        "key": "evidenceUrl",
        "label": "Certificate link",
        "type": "url"
      },
      {
        "key": "notes",
        "label": "Development goals",
        "type": "textarea"
      }
    ]
  },
  "leaveOpeningBalances": {
    "label": "Leave Opening Balances",
    "icon": "calendar2-check",
    "group": "Administration",
    "admin": true,
    "immutable": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "year",
        "label": "Leave year",
        "type": "number",
        "required": true,
        "min": 2000,
        "max": 2100
      },
      {
        "key": "category",
        "label": "Leave type",
        "type": "select",
        "options": [
          "Annual",
          "Medical",
          "Hospitalisation"
        ],
        "required": true
      },
      {
        "key": "effectiveDate",
        "label": "Balance effective date",
        "type": "date",
        "required": true
      },
      {
        "key": "days",
        "label": "Available days at effective date",
        "type": "number",
        "required": true,
        "min": 0,
        "max": 365
      },
      {
        "key": "historyMode",
        "label": "How should existing leave records be treated?",
        "type": "select",
        "options": [
          "Exclude existing test records",
          "Keep existing records after effective date"
        ],
        "required": true,
        "noDefault": true
      },
      {
        "key": "title",
        "label": "HR verification / source reference",
        "type": "text",
        "required": true
      }
    ]
  },
  "adjustments": {
    "label": "Leave adjustments",
    "icon": "calendar2-plus",
    "group": "Administration",
    "admin": true,
    "immutable": true,
    "fields": [
      {
        "key": "employee",
        "label": "Employee",
        "type": "staff",
        "required": true
      },
      {
        "key": "year",
        "label": "Leave year",
        "type": "number",
        "required": true,
        "min": 2000,
        "max": 2100
      },
      {
        "key": "category",
        "label": "Leave type",
        "type": "select",
        "options": [
          "Annual",
          "Medical",
          "Hospitalisation"
        ],
        "required": true
      },
      {
        "key": "days",
        "label": "Adjustment days (+ / −)",
        "type": "number",
        "required": true,
        "min": -365,
        "max": 365
      },
      {
        "key": "title",
        "label": "Reason / carry-forward reference",
        "type": "text",
        "required": true
      }
    ]
  },
  "workSchedules": {
    "label": "Working Schedule Templates",
    "icon": "clock",
    "group": "Administration",
    "admin": true,
    "public": true,
    "fields": [
      {
        "key": "company",
        "label": "Company",
        "type": "select",
        "options": ["SQ", "MS", "All"],
        "required": true
      },
      {
        "key": "workBase",
        "label": "Work Base (Office/Site)",
        "type": "select",
        "options": ["Office", "Site"],
        "required": true
      },
      {
        "key": "workLocation",
        "label": "Work Location",
        "type": "select",
        "options": ["All", "PG", "SEL", "KL", "NS"],
        "required": true
      },
      {
        "key": "code",
        "label": "Shift code",
        "type": "text",
        "required": true
      },
      {
        "key": "title",
        "label": "Shift description",
        "type": "text",
        "required": true
      },
      {
        "key": "start",
        "label": "Start time (HH:MM)",
        "type": "text",
        "required": true
      },
      {
        "key": "end",
        "label": "End time (HH:MM)",
        "type": "text",
        "required": true
      },
      {
        "key": "breakHours",
        "label": "Break duration (hours)",
        "type": "number",
        "required": true,
        "min": 0,
        "max": 10
      },
      {
        "key": "netHours",
        "label": "Net scheduled hours",
        "type": "number",
        "required": true,
        "min": 0,
        "max": 24
      },
      {
        "key": "availability",
        "label": "Availability",
        "type": "select",
        "options": ["Active", "Inactive"],
        "required": true
      },
      {
        "key": "notes",
        "label": "Notes / Grace period",
        "type": "textarea"
      },
      {
        "key": "daySchedules",
        "label": "Day Schedules",
        "type": "textarea"
      },
      {
        "key": "workingDays",
        "label": "Working Days",
        "type": "text"
      },
      {
        "key": "restDays",
        "label": "Rest Days",
        "type": "text"
      },
      {
        "key": "offDays",
        "label": "Off Days",
        "type": "text"
      }
    ]
  },
  "workBases": {
    "label": "Work Bases",
    "icon": "briefcase",
    "group": "Organisation",
    "admin": true,
    "public": true,
    "fields": [
      { "key": "code", "label": "Base code", "type": "text", "required": true },
      { "key": "title", "label": "Base name", "type": "text", "required": true },
      { "key": "availability", "label": "Availability", "type": "select", "options": ["Active", "Inactive"], "required": true },
      { "key": "notes", "label": "Description / Scope", "type": "textarea" }
    ]
  },
  "workLocations": {
    "label": "Work Locations",
    "icon": "geo-alt",
    "group": "Organisation",
    "admin": true,
    "public": true,
    "fields": [
      { "key": "code", "label": "Location code", "type": "text", "required": true },
      { "key": "title", "label": "Location name", "type": "text", "required": true },
      { "key": "state", "label": "State / Territory", "type": "text" },
      { "key": "availability", "label": "Availability", "type": "select", "options": ["Active", "Inactive"], "required": true },
      { "key": "notes", "label": "Description", "type": "textarea" }
    ]
  }
};
function hrAdmin_(actor) {
  if (!actor) return false;
  if (['Admin','HR'].indexOf(actor.role)!==-1) return true;
  if (['HOD','Supervisor'].indexOf(actor.role)!==-1) {
    try {
      const rows = hrStaffRows_().slice(1);
      const staff = rows.find(r => hrName_(r[0]) === hrName_(actor.name));
      if (staff && staff[26]) {
        const dept = hrRows_('departments').find(d => d.id === staff[26]);
        if (dept && (String(dept.code).toUpperCase() === 'HR' || /human resource|hr/i.test(dept.title || ''))) {
          return true;
        }
      }
    } catch(e) {}
  }
  return false;
}
function hrManager_(actor) { return ['Admin','HR','HOD','Supervisor'].indexOf(actor.role) !== -1; }
function hrName_(value) { return String(value || '').trim().toUpperCase(); }
function hrIssueSession_(user) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('hr-session:' + token, JSON.stringify({name:hrName_(user.name), expires:Date.now()+21600000}), 21600);
  return token;
}
function hrAuthenticate_(token) {
  if (typeof token !== 'string' || token.length > 100) throw new Error('Please sign in again.');
  const raw=CacheService.getScriptCache().get('hr-session:'+token);
  if (!raw) throw new Error('Session expired. Please sign in again.');
  const saved=JSON.parse(raw);
  if(saved.expires<Date.now()) throw new Error('Session expired. Please sign in again.');
  const rows=readSheet_(getSpreadsheet_().getSheetByName('Staff'), false);
  const row=rows.slice(1).find(r=>hrName_(r[0])===saved.name);
  if(!row || row[1]==='Resigned') throw new Error('Account is inactive.');
  return {name:saved.name,role:hrRole_(row[4])};
}
function hrSheet_(module,create) {
  const ss=getSpreadsheet_(),name='HR_'+module;
  let sheet=ss.getSheetByName(name);
  if(!sheet && create){sheet=ss.insertSheet(name);sheet.appendRow(['ID','Version','Employee','Status','Record JSON','Updated At','Updated By']);sheet.setFrozenRows(1);}
  return sheet;
}
function hrRows_(module) {
  if(module==='profiles')return hrProfiles_();
  const sheet=hrSheet_(module,false);
  if(!sheet) return [];
  const rows = readSheet_(sheet,false).slice(1);
  const result = [];
  const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[4] || !String(r[4]).trim()) continue;
    try {
      const record = JSON.parse(r[4]);
      record._row = i + 2;
      if (module === 'workSchedules') {
        if (!record.workingDays || !Array.isArray(record.workingDays) || record.workingDays.length === 0) {
          record.workingDays = allDays;
        }
        if (!record.daySchedules) {
          record.daySchedules = JSON.stringify([{
            days: record.workingDays || allDays,
            start: record.start || '08:00',
            end: record.end || '17:30',
            breakHours: record.breakHours !== undefined ? Number(record.breakHours) : 1,
            netHours: record.netHours !== undefined ? Number(record.netHours) : 8.5
          }]);
        }
        if (!record.restDays) record.restDays = [];
        if (!record.offDays) record.offDays = [];
      }
      result.push(record);
    } catch(e) {}
  }
  return result;
}
function hrPublic_(record) {const copy=Object.assign({},record);delete copy._row;return copy;}
function hrCanSee_(module,r,actor) {
  if(hrAdmin_(actor)) return true;
  if(['resources','cycles','companies','departments','claimTypes','jobGrades','jobTitles','workSchedules','workBases','workLocations'].indexOf(module)!==-1) return true;
  if(module==='letters') return hrName_(r.employee)===hrName_(actor.name) && r.status==='Issued';
  if(module==='recruitment' && hrManager_(actor) && (!r.hod || hrName_(r.hod)===hrName_(actor.name) || hrName_(r.department)===hrName_(actor.department) || hrTeam_(actor, r.hod))) return true;
  if(['claims','loans','bookings','appraisals'].indexOf(module)!==-1 && hrManager_(actor) && (hrName_(r.manager)===hrName_(actor.name) || hrTeam_(actor, r.employee))) return true;
  return hrName_(r.employee)===hrName_(actor.name);
}
function hrDirectory_() {
  const sheet = getSpreadsheet_().getSheetByName('Staff');
  if (!sheet) return [];
  const rows = readSheet_(sheet, false);
  if (!rows || rows.length <= 1) return [];
  const header = rows[0] || [];
  const { bioCol } = hrStaffCols_(header);
  return rows.slice(1).filter(r => r[0]).map(r => {
    const name = hrName_(r[0]);
    const bio = (bioCol !== -1 && r[bioCol] && !String(r[bioCol]).trim().startsWith('[')) ? String(r[bioCol]).trim() : (r[43] || defaultBiometrics_[name] || '');
    return {
      id: r[24] || name,
      name: name,
      employee: name,
      status: r[1] || 'Active',
      role: hrRole_(r[4]),
      employeeNo: r[24] || '',
      companyId: r[25] || '',
      company: r[25] || '',
      departmentId: r[26] || '',
      department: r[26] || '',
      manager: hrName_(r[27]),
      jobTitle: r[28] || '',
      location: r[29] || '',
      version: Number(r[30]) || 1,
      jobTitleId: r[32] || '',
      gradeId: r[33] || '',
      companyName: r[40] || '',
      biometricId: bio
    };
  });
}
function hrSeedWorkSchedules_() {
  const sheet = hrSheet_('workSchedules', true);
  if (!sheet) return;
  const existing = hrRows_('workSchedules');
  const allWeekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Prune any duplicate schedule rows in the sheet
  const seen = new Set();
  const toDelete = [];
  for (let i = existing.length - 1; i >= 0; i--) {
    const key = (String(existing[i].company || '') + '_' + String(existing[i].code || '')).toUpperCase();
    if (seen.has(key)) {
      if (existing[i]._row) toDelete.push(existing[i]._row);
    } else {
      seen.add(key);
    }
  }
  toDelete.sort((a,b) => b - a).forEach(rowIdx => {
    try { sheet.deleteRow(rowIdx); invalidateSheetRead_(sheet); } catch(e) {}
  });

  const updatedExisting = toDelete.length ? hrRows_('workSchedules') : existing;
  
  // Update existing rows that do not have full workingDays or daySchedules
  for (let i = 0; i < updatedExisting.length; i++) {
    const cur = updatedExisting[i];
    if (!cur._row) continue;
    let needsUpdate = false;
    if (!cur.workingDays || !Array.isArray(cur.workingDays) || cur.workingDays.length === 0) {
      cur.workingDays = allWeekdays;
      needsUpdate = true;
    }
    if (!cur.daySchedules) {
      cur.daySchedules = JSON.stringify([{
        days: cur.workingDays || allWeekdays,
        start: cur.start || '08:00',
        end: cur.end || '17:30',
        breakHours: cur.breakHours !== undefined ? Number(cur.breakHours) : 1,
        netHours: cur.netHours !== undefined ? Number(cur.netHours) : 8.5
      }]);
      needsUpdate = true;
    }
    if (cur.restDays === undefined) { cur.restDays = []; needsUpdate = true; }
    if (cur.offDays === undefined) { cur.offDays = []; needsUpdate = true; }
    if (needsUpdate) {
      const copy = Object.assign({}, cur);
      delete copy._row;
      try {
        sheet.getRange(cur._row, 5).setValue(JSON.stringify(copy));
        invalidateSheetRead_(sheet);
      } catch (e) {}
    }
  }

  const initial = [
    { company: 'SQ', workBase: 'Site', code: 'S1', title: 'SQ Shift S1 (05:30 - 14:30)', start: '05:30', end: '14:30', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'Morning Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'SQ', workBase: 'Office', code: 'S2', title: 'SQ Shift S2 (08:30 - 17:30)', start: '08:30', end: '17:30', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'Normal Office Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'SQ', workBase: 'Site', code: 'S3', title: 'SQ Shift S3 (14:30 - 23:30)', start: '14:30', end: '23:30', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'Evening Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'SQ', workBase: 'Site', code: 'S4', title: 'SQ Shift S4 (23:00 - 08:00)', start: '23:00', end: '08:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'Night / Overnight Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'SQ', workBase: 'Site', code: 'F1', title: 'SQ Full Shift F1 (05:30 - 17:30)', start: '05:30', end: '17:30', breakHours: 1.5, netHours: 10.5, availability: 'Active', notes: 'Full Day Shift 10.5h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'SQ', workBase: 'Site', code: 'F2', title: 'SQ Full Shift F2 (11:30 - 23:30)', start: '11:30', end: '23:30', breakHours: 1.5, netHours: 10.5, availability: 'Active', notes: 'Late Full Shift 10.5h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Site', code: 'M1', title: 'MS Shift M1 (06:00 - 15:00)', start: '06:00', end: '15:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'MS Morning Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Office', code: 'M2', title: 'MS Shift M2 (08:00 - 17:00)', start: '08:00', end: '17:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'MS Day Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Site', code: 'M3', title: 'MS Shift M3 (14:00 - 23:00)', start: '14:00', end: '23:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'MS Afternoon Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Site', code: 'M4', title: 'MS Shift M4 (23:00 - 08:00)', start: '23:00', end: '08:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', notes: 'MS Night / Overnight Shift 8h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Site', code: 'M', title: 'MS Morning Shift M (07:00 - 15:30)', start: '07:00', end: '15:30', breakHours: 1.0, netHours: 7.5, availability: 'Active', notes: 'MS Morning 7.5h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Site', code: 'A', title: 'MS Afternoon Shift A (15:00 - 23:30)', start: '15:00', end: '23:30', breakHours: 1.0, netHours: 7.5, availability: 'Active', notes: 'MS Afternoon 7.5h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Office', code: 'N', title: 'MS Normal Shift N (11:00 - 19:30)', start: '11:00', end: '19:30', breakHours: 1.0, netHours: 7.5, availability: 'Active', notes: 'MS Mid-day 7.5h', workingDays: allWeekdays, restDays: [], offDays: [] },
    { company: 'MS', workBase: 'Site', code: 'A1', title: 'MS Extended Afternoon A1 (13:00 - 23:30)', start: '13:00', end: '23:30', breakHours: 1.0, netHours: 9.5, availability: 'Active', notes: 'MS Extended 9.5h', workingDays: allWeekdays, restDays: [], offDays: [] }
  ];
  initial.forEach(item => {
    if (!updatedExisting.some(e => String(e.code).toUpperCase() === item.code && String(e.company).toUpperCase() === item.company)) {
      const id = 'SCH-' + item.company + '-' + item.code;
      item.daySchedules = JSON.stringify([{
        days: allWeekdays,
        start: item.start,
        end: item.end,
        breakHours: item.breakHours,
        netHours: item.netHours
      }]);
      const rec = Object.assign({ id, version: 1, createdBy: 'SYSTEM', createdAt: new Date().toISOString() }, item);
      sheet.appendRow([id, 1, '', 'Active', JSON.stringify(rec), new Date().toISOString(), 'SYSTEM']);
      invalidateSheetRead_(sheet);
    }
  });
}
function hrSeedWorkBases_() {
  const sheet = hrSheet_('workBases', true);
  if (!sheet) return;
  const existing = hrRows_('workBases');

  // Prune any duplicate workBase rows in the sheet
  const seen = new Set();
  const toDelete = [];
  for (let i = existing.length - 1; i >= 0; i--) {
    const key = String(existing[i].code || existing[i].title || '').trim().toUpperCase();
    if (seen.has(key)) {
      if (existing[i]._row) toDelete.push(existing[i]._row);
    } else {
      seen.add(key);
    }
  }
  toDelete.sort((a,b) => b - a).forEach(rowIdx => {
    try { sheet.deleteRow(rowIdx); invalidateSheetRead_(sheet); } catch(e) {}
  });

  const updatedExisting = toDelete.length ? hrRows_('workBases') : existing;
  const initial = [
    { code: 'OFFICE', title: 'Office', availability: 'Active', notes: 'Office / Corporate operations' },
    { code: 'SITE', title: 'Site', availability: 'Active', notes: 'Field / Site project operations' }
  ];
  initial.forEach(item => {
    if (!updatedExisting.some(e => String(e.code).toUpperCase() === item.code)) {
      const id = 'WB-' + item.code;
      const rec = Object.assign({ id, version: 1, createdBy: 'SYSTEM', createdAt: new Date().toISOString() }, item);
      sheet.appendRow([id, 1, '', 'Active', JSON.stringify(rec), new Date().toISOString(), 'SYSTEM']);
      invalidateSheetRead_(sheet);
    }
  });
}
function hrSeedWorkLocations_() {
  const sheet = hrSheet_('workLocations', true);
  if (!sheet) return;
  const existing = hrRows_('workLocations');

  // Prune any duplicate workLocation rows in the sheet
  const seen = new Set();
  const toDelete = [];
  for (let i = existing.length - 1; i >= 0; i--) {
    const key = String(existing[i].code || existing[i].title || '').trim().toUpperCase();
    if (seen.has(key)) {
      if (existing[i]._row) toDelete.push(existing[i]._row);
    } else {
      seen.add(key);
    }
  }
  toDelete.sort((a,b) => b - a).forEach(rowIdx => {
    try { sheet.deleteRow(rowIdx); invalidateSheetRead_(sheet); } catch(e) {}
  });

  const updatedExisting = toDelete.length ? hrRows_('workLocations') : existing;
  const initial = [
    { code: 'PG', title: 'Penang', state: 'Pulau Pinang', availability: 'Active', notes: 'Penang HQ / Site Hub' },
    { code: 'SEL', title: 'Selangor', state: 'Selangor', availability: 'Active', notes: 'Selangor Projects & Site Hub' },
    { code: 'KL', title: 'Kuala Lumpur', state: 'Wilayah Persekutuan Kuala Lumpur', availability: 'Active', notes: 'Kuala Lumpur HQ & Projects' },
    { code: 'NS', title: 'Negeri Sembilan', state: 'Negeri Sembilan', availability: 'Active', notes: 'Negeri Sembilan Site Operations' }
  ];
  initial.forEach(item => {
    if (!updatedExisting.some(e => String(e.code).toUpperCase() === item.code)) {
      const id = 'LOC-' + item.code;
      const rec = Object.assign({ id, version: 1, createdBy: 'SYSTEM', createdAt: new Date().toISOString() }, item);
      sheet.appendRow([id, 1, '', 'Active', JSON.stringify(rec), new Date().toISOString(), 'SYSTEM']);
      invalidateSheetRead_(sheet);
    }
  });
}
function hrSeedResources_() {
  const sheet = hrSheet_('resources', true);
  if (!sheet) return;
  const existing = hrRows_('resources');
  const catalog = [
    { code: 'NB', title: 'Notebook / Laptop', category: 'Laptop', location: 'HQ / Remote', assetValue: 3500, availability: 'Available', notes: 'Notebook / Laptop' },
    { code: 'PC', title: 'Desktop Computer', category: 'Equipment', location: 'Office Station', assetValue: 2800, availability: 'Available', notes: 'Desktop Computer' },
    { code: 'MON', title: 'Monitor', category: 'Equipment', location: 'Office Station', assetValue: 600, availability: 'Available', notes: 'External Display Monitor' },
    { code: 'TAB', title: 'Tablet', category: 'Equipment', location: 'Site / Office', assetValue: 1500, availability: 'Available', notes: 'Tablet Device' },
    { code: 'PHONE', title: 'Mobile Phone', category: 'Equipment', location: 'Company Line', assetValue: 1200, availability: 'Available', notes: 'Company Mobile Phone' },
    { code: 'MSC', title: 'Mobile SIM Card', category: 'Other', location: 'Telco Line', assetValue: 50, availability: 'Available', notes: 'Mobile SIM Card / Plan' },
    { code: 'BB', title: 'Broadband / Internet Device', category: 'Equipment', location: 'Site / Remote', assetValue: 400, availability: 'Available', notes: 'Broadband / WiFi Dongle' },
    { code: 'TEL', title: 'Office Telephone', category: 'Equipment', location: 'Office Desk', assetValue: 250, availability: 'Available', notes: 'Office Telephone Extension' },
    { code: 'PRT', title: 'Printer', category: 'Equipment', location: 'Office Common', assetValue: 1200, availability: 'Available', notes: 'Office Laser/Inkjet Printer' },
    { code: 'SCN', title: 'Scanner', category: 'Equipment', location: 'Office Common', assetValue: 800, availability: 'Available', notes: 'Document Scanner' },
    { code: 'CM', title: 'Camera', category: 'Equipment', location: 'Media / Site', assetValue: 2500, availability: 'Available', notes: 'Site / Corporate Camera' },
    { code: 'ACC', title: 'Computer / Phone Accessories', category: 'Equipment', location: 'IT Store', assetValue: 150, availability: 'Available', notes: 'Computer / Phone Accessories' },
    { code: 'HDD', title: 'External Hard Drive / Storage Device', category: 'Equipment', location: 'IT Store', assetValue: 350, availability: 'Available', notes: 'External Storage Backup Drive' },
    { code: 'CAR', title: 'Company Car / Vehicle', category: 'Vehicle', location: 'Company Fleet', assetValue: 65000, availability: 'Available', notes: 'Company Car / Vehicle' },
    { code: 'FUEL', title: 'Fuel Card', category: 'Other', location: 'Admin Fleet', assetValue: 0, availability: 'Available', notes: 'Company Fleet Fuel Card' },
    { code: 'TOLL', title: 'Touch ’n Go / Toll Card', category: 'Other', location: 'Admin Fleet', assetValue: 100, availability: 'Available', notes: 'Touch ’n Go / Toll Card' },
    { code: 'PARK', title: 'Parking Card / Pass', category: 'Other', location: 'Building Management', assetValue: 150, availability: 'Available', notes: 'Season Parking Pass / Card' },
    { code: 'KEY', title: 'Physical Key', category: 'Other', location: 'Office Facility', assetValue: 50, availability: 'Available', notes: 'Office / Facility Key' },
    { code: 'ACS', title: 'Access Card', category: 'Other', location: 'Security Reception', assetValue: 50, availability: 'Available', notes: 'Door Access / Security Card' },
    { code: 'REM', title: 'Remote Control', category: 'Equipment', location: 'Meeting Room', assetValue: 80, availability: 'Available', notes: 'Aircon / Projector / Gate Remote' },
    { code: 'UNI', title: 'Uniform', category: 'Other', location: 'HR Admin', assetValue: 120, availability: 'Available', notes: 'Company Uniform / Attire' },
    { code: 'PPE', title: 'Personal Protective Equipment', category: 'Equipment', location: 'Safety Store', assetValue: 200, availability: 'Available', notes: 'Safety Helmet / Boots / Vest' },
    { code: 'TOOL', title: 'Tools / Equipment', category: 'Equipment', location: 'Site Workshop', assetValue: 500, availability: 'Available', notes: 'Hand / Power Tools' },
    { code: 'MEAS', title: 'Measuring Device', category: 'Equipment', location: 'Site QA/QC', assetValue: 350, availability: 'Available', notes: 'Measuring Tape / Laser Meter' },
    { code: 'PTYC', title: 'Petty Cash Float', category: 'Other', location: 'Accounts Dept', assetValue: 500, availability: 'Available', notes: 'Petty Cash Operational Float' },
    { code: 'ADV', title: 'Cash Advance', category: 'Other', location: 'Finance Dept', assetValue: 1000, availability: 'Available', notes: 'Operational Cash Advance' },
    { code: 'OTH', title: 'Other Resources', category: 'Other', location: 'General Storage', assetValue: 0, availability: 'Available', notes: 'Other Company Resources' }
  ];

  catalog.forEach(item => {
    if (!existing.some(e => (e.code && String(e.code).trim().toUpperCase() === item.code) || String(e.title || '').trim().toLowerCase() === item.title.toLowerCase())) {
      const id = 'RES-' + item.code;
      const rec = Object.assign({ id, version: 1, createdBy: 'SYSTEM', createdAt: new Date().toISOString() }, item);
      sheet.appendRow([id, 1, '', 'Available', JSON.stringify(rec), new Date().toISOString(), 'SYSTEM']);
      invalidateSheetRead_(sheet);
    }
  });
}
function hrBootstrap_(actor,options) {
  const scope=(options&&options.scope)||'overview';
  hrAssert_(['overview','personal','team','all'].indexOf(scope)!==-1,'Unknown workspace scope.');
  if(scope==='all')hrAssert_(hrAdmin_(actor),'HR or Superadmin access required.');
  if(scope==='team')hrAssert_(hrManager_(actor),'Team access requires HOD, HR or Superadmin.');
  // READ-ONLY bootstrap: skips seeding when tables exist, initial seed only on empty table.
  try {
    if (hrRows_('jobGrades').length === 0) hrSeedInductionGrades_();
  } catch(e) {}
  try {
    if (hrRows_('workSchedules').length === 0) hrSeedWorkSchedules_();
  } catch(e) {}
  try {
    if (hrRows_('workBases').length === 0) hrSeedWorkBases_();
  } catch(e) {}
  try {
    if (hrRows_('workLocations').length === 0) hrSeedWorkLocations_();
  } catch(e) {}
  try {
    hrSeedResources_();
  } catch(e) {}
  const shared=['companies','departments','resources','cycles','claimTypes','jobGrades','jobTitles','workSchedules','workBases','workLocations'];
  const records={};Object.keys(HR_MODULES).forEach(m=>records[m]=hrRows_(m).filter(r=>{
    if(!hrCanSee_(m,r,actor))return false;
    if(shared.indexOf(m)!==-1)return true;
    if(scope==='personal')return r.employee===actor.name;
    if(scope==='team')return hrName_(r.employee)!==hrName_(actor.name)&&(hrName_(r.manager)===hrName_(actor.name) || hrTeam_(actor, r.employee));
    return true;
  }).map(hrPublic_));

  if (records.resources && Array.isArray(records.resources)) {
    const sorted = [...records.resources].sort((a, b) => (b.code ? 1 : 0) - (a.code ? 1 : 0));
    const seenCode = new Set();
    const seenTitle = new Set();
    records.resources = sorted.filter(r => {
      const code = String(r.code || '').trim().toUpperCase();
      const title = String(r.title || '').trim().toLowerCase();
      if (code && seenCode.has(code)) return false;
      if (title && seenTitle.has(title)) return false;
      if (code) seenCode.add(code);
      if (title) seenTitle.add(title);
      return true;
    });
  }
  
  // Provide leave applications according to role & scope
  const leaveRows = hrLeaveRows_();
  const testHistory = hrLeaveTestIds_();
  const visibleLeaves = leaveRows.map((row, idx) => {
    row._rowIndex = idx + 2;
    return row;
  }).filter((row) => {
    const applicant = hrName_(row[1]);
    if (!applicant) return false;
    if (scope === 'personal') return applicant === hrName_(actor.name);
    if (hrAdmin_(actor)) return true;
    if (hrManager_(actor)) {
      return applicant === hrName_(actor.name) || hrTeam_(actor, applicant);
    }
    return applicant === hrName_(actor.name);
  }).map((row) => {
    return {
      id: row[0] || ('LV-' + row._rowIndex),
      employee: hrName_(row[1]),
      name: hrName_(row[1]),
      type: row[2] || 'AL',
      start: hrLeaveDate_(row[3]),
      end: hrLeaveDate_(row[4]),
      days: Number(row[5]) || 1,
      reason: row[6] || '',
      attachment: row[7] || '',
      status: row[8] || 'Pending',
      date: row[9] || '',
      decision: row[10] || '',
      decisionRemark: row[11] || '',
      annualDays: row[12] != null && row[12] !== '' ? Number(row[12]) : (row[2] === 'AL' ? Number(row[5]) : 0),
      unpaidDays: row[13] != null && row[13] !== '' ? Number(row[13]) : (row[2] === 'NPL' ? Number(row[5]) : 0),
      nplTag: row[14] || '',
      rowIndex: row._rowIndex,
      isTestHistory: !!testHistory[hrName_(row[1]) + '|' + String(row[0])]
    };
  });
  records.leave = visibleLeaves;

  const employees=hrDirectory_();
  const visibleEmployees = scope==='personal' ? employees.filter(r=>r.name===actor.name) : hrAdmin_(actor) ? employees : hrManager_(actor) ? employees.filter(r=>r.name===actor.name||hrTeam_(actor,r.name)) : employees.filter(r=>r.name===actor.name);
  return jsonResponse({status:'success',data:{actor,employees:visibleEmployees,records,teamLeave:hrTeamLeave_(actor),audit:hrAdmin_(actor)&&(scope==='all'||(!options||!options.scope))?hrRows_('audit').filter(r=>r.module!=='lifecycle').slice(-500).reverse().map(hrPublic_):[]}});
}

function hrTeamLeave_(actor) {
  try {
    const profiles=hrProfiles_().filter(p=>p.status!=='Resigned');
    const me=profiles.find(p=>p.employee===actor.name)||{};
    const visible={};
    if(hrAdmin_(actor)) {
      profiles.forEach(p=>visible[p.employee]=p);
    } else if(hrManager_(actor)) {
      // HOD/Supervisor: everyone under supervision (direct and indirect reports)
      let frontier=[hrName_(actor.name)];
      while(frontier.length) {
        const next=[];
        profiles.forEach(p=>{
          if(p.employee!==actor.name&&!visible[p.employee]&&(frontier.indexOf(hrName_(p.manager))!==-1 || hrTeam_(actor, p.employee))){visible[p.employee]=p;next.push(p.employee);}
        });
        frontier=next;
      }
    } else if(me.companyId&&me.departmentId) {
      // Staff: colleagues in the same company and department
      profiles.forEach(p=>{
        if(p.employee!==actor.name&&p.companyId===me.companyId&&p.departmentId===me.departmentId)visible[p.employee]=p;
      });
    }
    const tz='Asia/Kuala_Lumpur', day=86400000, now=new Date();
    const today=Utilities.formatDate(now,tz,'yyyy-MM-dd');
    const until=Utilities.formatDate(new Date(now.getTime()+30*day),tz,'yyyy-MM-dd');
    const comps={},depts={};
    hrRows_('companies').forEach(c=>comps[c.id]=c.title||c.name||'');
    hrRows_('departments').forEach(d=>depts[d.id]=d.title||d.name||'');
    const isMgrOrAdmin = hrManager_(actor) || hrAdmin_(actor);
    return hrLeaveRows_().map((r, i) => {
      r._rowIndex = i + 2;
      return r;
    }).filter(r=>{
      const emp = hrName_(r[1]);
      if (!visible[emp]) return false;
      const st = String(r[8] || '').trim();
      if (st === 'Approved') return true;
      if (isMgrOrAdmin && (/pending/i.test(st) || st === 'Withdrawal Requested')) return true;
      return false;
    }).map(r=>{
      const p=visible[hrName_(r[1])] || {};
      return {
        id:r[0],
        employee:hrName_(r[1]),
        type:r[2],
        start:hrLeaveDate_(r[3]),
        end:hrLeaveDate_(r[4]),
        days:r[5],
        reason:r[6]||'',
        attachment:r[7]||'',
        status:r[8]||'Pending',
        date:r[9]||'',
        decision:r[10]||'',
        decisionRemark:r[11]||'',
        annualDays:r[12]!=null&&r[12]!==''?Number(r[12]):(r[2]==='AL'?Number(r[5]):0),
        unpaidDays:r[13]!=null&&r[13]!==''?Number(r[13]):(r[2]==='NPL'?Number(r[5]):0),
        rowIndex:r._rowIndex,
        company:comps[p.companyId]||'',
        department:depts[p.departmentId]||'',
        jobTitle:p.jobTitle||''
      };
    }).filter(r=>{
      if (r.status === 'Approved') return r.end>=today&&r.start<=until;
      return true;
    }).sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0);
  } catch(e) { return []; }
}

function hrAssert_(ok,message){if(!ok)throw new Error(message);}
function hrDate_(value,datetime){
  let s=String(value||'').trim();
  if (datetime) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) {
      s = s.slice(0, 16);
    }
    hrAssert_(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s),'Invalid date.');
  } else {
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      s = s.slice(0, 10);
    } else if (/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(s)) {
      const parts = s.split(/[-/]/);
      s = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
    } else if (/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.test(s)) {
      const parts = s.split(/[-/]/);
      if (Number(parts[0]) > 12) {
        s = `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
      } else if (Number(parts[1]) > 12) {
        s = `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
      } else {
        s = `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
      }
    }
    hrAssert_(/^\d{4}-\d{2}-\d{2}$/.test(s),'Invalid date.');
  }
  hrAssert_(!isNaN(Date.parse(s)),'Invalid date.');
  return s;
}
function hrValidate_(module,input,actor) {
  const spec=HR_MODULES[module];hrAssert_(!!spec,'Unknown HR module.');
  if (module === 'jobTitles' && (!input.code || String(input.code).trim() === '')) {
    const existing = hrRows_('jobTitles');
    const numbers = existing.map(r => {
      const m = String(r.code || '').match(/^JOB-(\d+)$/i);
      return m ? parseInt(m[1], 10) : 0;
    }).filter(n => n > 0);
    const nextNum = numbers.length ? Math.max(...numbers) + 1 : 1;
    input.code = 'JOB-' + ('000' + nextNum).slice(-3);
  }
  if (module === 'departments' && (!input.code || String(input.code).trim() === '')) {
    const existing = hrRows_('departments');
    let maxNum = 0;
    let hasDepPrefix = false;
    existing.forEach(d => {
      const code = String(d.code || '').trim();
      const matchDep = code.match(/^DEP-?(\d+)$/i);
      const matchNum = code.match(/^(\d+)$/);
      if (matchDep) {
        hasDepPrefix = true;
        const n = parseInt(matchDep[1], 10);
        if (n > maxNum) maxNum = n;
      } else if (matchNum) {
        const n = parseInt(matchNum[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    const nextNum = maxNum + 1;
    input.code = hasDepPrefix ? ('DEP-' + ('000' + nextNum).slice(-3)) : ('000' + nextNum).slice(-3);
  }
  const record={};
  spec.fields.forEach(f=>{
    let value=(module==='workSchedules'&&f.key==='netHours')?0:((module==='workSchedules'||module==='jobTitles')&&f.key==='workLocation'&&!input[f.key]?'All':(module==='jobTitles'&&f.key==='workBase'&&!input[f.key]?'Office':input[f.key]));
    if(f.type==='number') {
      if(value===''||value==null){hrAssert_(!f.required,f.label+' is required.');value=0;}
      value=Number(value);hrAssert_(Number.isFinite(value),f.label+' must be a number.');
      if(['amount','receiptLimit','annualLimit','assetValue','maxValue'].indexOf(f.key)!==-1)hrAssert_(Math.abs(value*100-Math.round(value*100))<0.00001&&value<=100000000,'Amounts must use at most two decimals.');
      if(f.min!=null)hrAssert_(value>=f.min,f.label+' is too low.');if(f.max!=null)hrAssert_(value<=f.max,f.label+' is too high.');
    } else {
      const maxLen = 45000;
      value=String(value==null?'':value).trim();hrAssert_(value.length<=maxLen,f.label+' is too long.');
      if(f.required)hrAssert_(value.length>0,f.label+' is required.');
      if(value && f.type==='select'){
        const types=f.source?hrRows_(f.source):[];
        const choices=types.length?types.filter(r=>r.availability!=='Inactive').map(r=>r.title):f.options;
        if((module==='workSchedules' || module==='jobTitles') && ['company','workBase','workLocation'].includes(f.key)){
          const isAll=f.key!=='workBase'&&value.toUpperCase()==='ALL';
          const moduleName=f.key==='company'?'companies':f.key==='workBase'?'workBases':'workLocations';
          const reference=hrRows_(moduleName).filter(r=>r.availability!=='Inactive');
          const match=reference.find(r=>[r.code,r.title,r.name].some(x=>String(x||'').toUpperCase()===value.toUpperCase()));
          if(!isAll) {
            if(reference.length)hrAssert_(!!match,'Select an active '+f.label+' from System Settings.');
            else hrAssert_((f.key==='company'?['SQ','MS']:f.key==='workBase'?['OFFICE','SITE']:['PG','SEL','KL','NS']).includes(value.toUpperCase()),'Invalid '+f.label+'.');
          }
          value=isAll?'All':String(match?.code||value).toUpperCase();
        } else if(module==='resources'&&f.key==='category'&&hrAdmin_(actor)){
          hrAssert_(value.length>0&&value.length<=100,'Invalid resource type.');
        } else {
          hrAssert_(choices.indexOf(value)!==-1,'Invalid or inactive '+f.label+'.');
        }
      }
      if(value && ['date','datetime-local'].indexOf(f.type)!==-1) value = hrDate_(value,f.type==='datetime-local');
      if(value && f.type==='url')hrAssert_(/^(https:\/\/[^\s]+|data:[^\s]+)$/i.test(value),'Document links must use HTTPS or valid uploaded attachment.');
      if(value && f.type==='email')hrAssert_(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),'Invalid email.');
      if(f.type==='staff')value=hrName_(value);
      if(value && f.type==='ref') {
        if((module==='departments'||module==='jobTitles'||module==='workSchedules')&&(f.key==='companyId'||f.key==='company')&&String(value).toUpperCase()==='ALL') {
          value='ALL';
        } else if((module==='departments'||module==='jobTitles'||module==='workSchedules')&&(f.key==='companyId'||f.key==='company')&&String(value).includes(',')) {
          const ids = String(value).split(',').map(s=>s.trim()).filter(Boolean);
          const companies = hrRows_('companies');
          hrAssert_(ids.length > 0 && ids.every(id => String(id).toUpperCase()==='ALL' || companies.some(r => r.id === id || r.code === id)), 'Selected '+f.label+' no longer exists.');
          value = ids.join(', ');
        } else if(module==='jobTitles'&&f.key==='departmentId'&&String(value).includes(',')) {
          const ids = String(value).split(',').map(s=>s.trim()).filter(Boolean);
          const depts = hrRows_('departments');
          hrAssert_(ids.length > 0 && ids.every(id => String(id).toUpperCase()==='ALL' || depts.some(r => r.id === id || r.code === id)), 'Selected '+f.label+' no longer exists.');
          value = ids.join(', ');
        } else {
          hrAssert_(hrRows_(f.ref).some(r=>r.id===value),'Selected '+f.label+' no longer exists.');
        }
      }
    }
    record[f.key]=value;
  });
  const directory=hrDirectory_();spec.fields.filter(f=>f.type==='staff').forEach(f=>{if(record[f.key])hrAssert_(directory.some(s=>s.name===record[f.key]&&s.status!=='Resigned'),'Select an active '+f.label+'.');});
  if(spec.self && !hrAdmin_(actor))record.employee=actor.name;
  if(record.employee)hrAssert_(directory.some(s=>s.name===record.employee&&s.status!=='Resigned'),'Employee is inactive.');
  if(record.manager)hrAssert_(directory.some(s=>s.name===record.manager&&['Admin','HR','HOD','Supervisor'].indexOf(s.role)!==-1),'Reviewer must be an Admin, Supervisor or HOD.');
  if (module === 'workSchedules') {
    const timeToMin = value => {
      hrAssert_(/^([01]?\d|2[0-3]):[0-5]\d$/.test(value), 'Use HH:MM in 24-hour format.');
      return Number(value.split(':')[0])*60+Number(value.split(':')[1]);
    };
    const startMin = timeToMin(record.start), endMin = timeToMin(record.end);
    hrAssert_(startMin !== endMin, 'Start and end time must differ.');
    const grossMin = (endMin < startMin ? endMin + 1440 : endMin) - startMin;
    const net = Math.round((grossMin / 60 - record.breakHours) * 100) / 100;
    hrAssert_(net > 0 && net <= 24, 'Break time must be shorter than working duration.');
    record.netHours = net;

    const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    if (input.daySchedules !== undefined && input.daySchedules !== null && String(input.daySchedules).trim() !== '') {
      record.daySchedules = typeof input.daySchedules === 'string' ? input.daySchedules : JSON.stringify(input.daySchedules);
    } else {
      record.daySchedules = JSON.stringify([{
        days: allDays,
        start: record.start,
        end: record.end,
        breakHours: record.breakHours,
        netHours: record.netHours
      }]);
    }
    if (input.workingDays !== undefined && input.workingDays !== null && (Array.isArray(input.workingDays) || typeof input.workingDays === 'string')) {
      record.workingDays = Array.isArray(input.workingDays) ? input.workingDays : String(input.workingDays).split(',').map(s=>s.trim()).filter(Boolean);
      if (record.workingDays.length === 0) record.workingDays = allDays;
    } else {
      record.workingDays = allDays;
    }
    if (input.restDays !== undefined && input.restDays !== null) {
      record.restDays = Array.isArray(input.restDays) ? input.restDays : [];
    } else {
      record.restDays = [];
    }
    if (input.offDays !== undefined && input.offDays !== null) {
      record.offDays = Array.isArray(input.offDays) ? input.offDays : [];
    } else {
      record.offDays = [];
    }
  } else if(record.start && record.end) {
    hrAssert_(record.end > record.start, 'End must be after start.');
  }
  if(module==='adjustments')hrAssert_(record.days!==0,'Adjustment cannot be zero.');
  if(module==='leaveOpeningBalances'){
    hrAssert_(Number(record.effectiveDate.slice(0,4))===record.year,'Effective date must be in the leave year.');
    hrAssert_(new Date(record.effectiveDate+'T00:00:00Z').toISOString().slice(0,10)===record.effectiveDate,'Invalid effective date.');
  }
  if(module==='profiles')hrAssert_(record.manager!==record.employee,'An employee cannot be their own manager.');
  return record;
}
function hrConflict_(record) {
  hrAssert_(!hrRows_('resourceAssignments').some(r=>r.resourceId===record.resourceId&&r.status==='Assigned'),'Resource is assigned to an employee and cannot be booked.');
  const resource=hrRows_('resources').find(r=>r.id===record.resourceId);
  hrAssert_(resource&&resource.availability==='Available','Resource is unavailable.');
  hrAssert_(!hrRows_('bookings').some(b=>b.id!==record.id&&b.resourceId===record.resourceId&&['Pending admin','Approved','Pending manager'].indexOf(b.status)!==-1&&record.start<b.end&&record.end>b.start),'Resource already booked for this time window.');
}
function hrAudit_(actor,module,record,action) {
  const sheet=hrSheet_('audit',true),now=new Date().toISOString();
  const log={id:Utilities.getUuid(),version:1,employee:record.employee||'',status:action,module,recordId:record.id,title:record.title||record.employee||'',actor:actor.name,updatedAt:now};
  sheet.appendRow([log.id,1,log.employee,action,JSON.stringify(log),now,actor.name]);
}
function hrWrite_(module,record,actor,old,action) {
  record.version=old?old.version+1:1;record.updatedAt=new Date().toISOString();record.updatedBy=actor.name;
  const sheet=hrSheet_(module,true),row=[record.id,record.version,record.employee||'',record.status,JSON.stringify(record),record.updatedAt,actor.name];
  if(old)sheet.getRange(old._row,1,1,7).setValues([row]);else sheet.appendRow(row);
  invalidateSheetRead_(sheet);
  if(module==='resourceAssignments')hrSyncAssignedResources_(record.employee);
  if(module==='jobTitles')hrSyncJobTitles_();
  if(module==='resources')hrProfiles_().forEach(p=>hrSyncAssignedResources_(p.employee));
  hrAudit_(actor,module,record,action);return jsonResponse({status:'success',data:record});
}

function hrDelete_(payload, actor) {
  hrAssert_(hrAdmin_(actor), 'Only HR administrators can delete records.');
  const module = payload.module;
  const id = payload.id;
  hrAssert_(!!module && !!id, 'Module and record ID are required.');
  const sheet = hrSheet_(module, false);
  hrAssert_(!!sheet, 'Sheet for ' + module + ' not found.');
  const rows = hrRows_(module);
  const target = rows.find(r => r.id === id || r.code === id);
  hrAssert_(!!target, 'Record not found.');
  if (target._row) {
    sheet.deleteRow(target._row);
    invalidateSheetRead_(sheet);
  }
  return jsonResponse({ status: 'success', message: 'Record deleted successfully.' });
}

function hrSave_(payload,actor) {
  const module=payload.module,spec=HR_MODULES[module];hrAssert_(!!spec,'Unknown HR module.');
  hrAssert_(module!=='profiles','Use Employee Management to edit the employee master.');
  hrAssert_(hrAdmin_(actor)||spec.self||(module==='recruitment'&&hrManager_(actor)),'Only HR administrators can create these records.');
  const rows=hrRows_(module);
  if(!payload.id&&payload.requestId){hrAssert_(/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId),'Invalid request reference.');const prior=rows.find(r=>r.id===payload.requestId);if(prior){hrAssert_(prior.createdBy===actor.name,'Request reference already exists.');return jsonResponse({status:'success',data:hrPublic_(prior)});}}
  let old=payload.id?rows.find(r=>r.id===payload.id):null;
  if(payload.id && !old && module==='workSchedules' && payload.record && payload.record.code && payload.record.company) {
    const matchCoCode = rows.find(r=>String(r.company||'').toUpperCase()===String(payload.record.company||'').toUpperCase() && String(r.code||'').toUpperCase()===String(payload.record.code||'').toUpperCase());
    if (matchCoCode) old = matchCoCode;
  }
  if(payload.id){
    hrAssert_(!!old,'Record not found.');
    if(payload.version!=null && module!=='workSchedules') hrAssert_(Number(payload.version)===Number(old.version),'Record changed. Refresh and try again.');
    hrAssert_(!spec.immutable,'Adjustments cannot be edited; add a reversing adjustment.');
    const oldStatus = old.status || old.availability || 'Active';
    hrAssert_((hrAdmin_(actor)||(module==='recruitment'&&hrManager_(actor)))&&['Active','Draft','Open','Applied','Shortlisted','Interview','Offer','Hired','Rejected','Planned','Available','Inactive','Maintenance'].indexOf(oldStatus)!==-1,'Submitted records cannot be edited.');
  }
  const record=hrValidate_(module,payload.record||{},actor);
  record.id=old?old.id:(payload.requestId||Utilities.getUuid());record.createdBy=old?old.createdBy:actor.name;record.createdAt=old?old.createdAt:new Date().toISOString();
  const profile=record.employee?hrRows_('profiles').find(r=>r.employee===record.employee):null;
  if(['claims','loans','bookings'].indexOf(module)!==-1) {
    record.manager=profile?profile.manager:'';
    record.status=record.manager?'Pending manager':'Pending admin';
    if(module==='bookings') {
      const resMatch=hrRows_('resources').find(r=>r.id===record.resourceId||r.code===record.resourceId);
      if(resMatch&&resMatch.category) record.category=resMatch.category;
      hrConflict_(record);
      if(!old) {
        record.requestedAt = new Date().toISOString();
        record.requestedBy = actor.name;
        record.historyLog = JSON.stringify([{
          action: 'Requested',
          actor: actor.name,
          timestamp: record.requestedAt,
          comments: record.notes || record.title || ''
        }]);
      }
    }
  }
  else if(module==='appraisals'){record.status='Pending self';hrAssert_(hrRows_('cycles').some(c=>c.id===record.cycleId&&c.status==='Active'),'Cycle must be active.');if(!record.manager&&profile)record.manager=profile.manager||'';hrAssert_(record.manager!==record.employee,'Reviewer cannot be the employee.');hrAssert_(!rows.some(r=>r.id!==record.id&&r.employee===record.employee&&r.cycleId===record.cycleId),'An appraisal already exists for this employee and cycle.');}
  else if(module==='tax')record.status='Submitted';
  else if(module==='letters')record.status=(payload.record&&payload.record.status==='Issued')||payload.status==='Issued'?'Issued':'Draft';
  else if(module==='training')record.status='Planned';
  else if(module==='adjustments')record.status='Posted';
  else if(module==='recruitment'){ record.status=record.stage; 
  if (module === 'recruitment' && record.recommendation === 'Recommended' && (!old || old.recommendation !== 'Recommended')) {
    try {
      const adminEmail = (typeof HR_ADMIN_EMAIL_ !== 'undefined' && HR_ADMIN_EMAIL_) ? HR_ADMIN_EMAIL_ : 'phock.solution@gmail.com';
      MailApp.sendEmail({
        to: adminEmail,
        subject: '[Candidate Recommended] ' + (record.title || 'Candidate') + ' for ' + (record.jobTitle || 'Position') + ' - Ready for HR Onboarding',
        body: 'Hello HR Team,\n\nCandidate ' + (record.title || '') + ' has been Recommended by HOD (' + (record.hod || actor.name) + ') for position: ' + (record.jobTitle || '') + ' (' + (record.department || 'General') + ').\n\nContact Number: ' + (record.contactNo || '-') + '\nHOD Decision: Recommended\nInterview Notes: ' + (record.notes || '-') + '\nCV Link: ' + (record.evidenceUrl || '-') + '\n\nPlease review and proceed with the employment / offer process.'
      });
    } catch (recErr) {
      console.log('Recruitment Recommendation Notification Error: ' + recErr);
    }
  }
 }
  else record.status=record.availability || 'Active';
  if(module==='resourceAssignments'){hrResourceLimit_(record);record.employeeId=profile?profile.employeeNo:'';record.status='Assigned';hrAssert_(!hrRows_('resourceAssignments').some(r=>r.resourceId===record.resourceId&&r.status==='Assigned'),'Resource is already assigned. Record its return first.');hrAssert_(hrRows_('resources').some(r=>r.id===record.resourceId&&r.availability==='Available'),'Resource is unavailable.');hrAssert_(!hrRows_('bookings').some(r=>r.resourceId===record.resourceId&&['Approved','Pending admin','Pending manager'].indexOf(r.status)!==-1&&r.end>=record.date),'Resource has an active or upcoming booking. Resolve the booking first.');}
  if(module==='claims') hrClaimLimit_(record);
  if(module==='loans')hrAssert_(Number.isInteger(Number(record.instalments)),'Instalments must be a whole number.');
  if(module==='claimPolicies')hrAssert_(!rows.some(r=>r.id!==record.id&&r.companyId===record.companyId&&r.category===record.category&&r.year===record.year&&(r.gradeId||'')===(record.gradeId||'')),'A policy already exists for this company, grade, type and year.');
  if(['companies','departments','resources','claimTypes','jobGrades','jobTitles','workBases','workLocations'].indexOf(module)!==-1)hrAssert_(!rows.some(r=>r.id!==record.id&&r.code.toLowerCase()===record.code.toLowerCase()),'Code already exists.');
  if(module==='workSchedules')hrAssert_(!rows.some(r=>r.id!==record.id&&String(r.company||'').toUpperCase()===String(record.company||'').toUpperCase()&&String(r.code||'').toUpperCase()===String(record.code||'').toUpperCase()),'A shift schedule with this code already exists for this company.');
  if(module==='resourcePolicies'){hrAssert_(Number.isInteger(record.maxAssigned),'Resource quantity must be a whole number.');hrAssert_(!rows.some(r=>r.id!==record.id&&r.companyId===record.companyId&&r.category===record.category&&(r.gradeId||'')===(record.gradeId||'')),'A resource policy already exists for this company, grade and category.');}
  if(module==='claimTypes'&&old&&(old.title!==record.title||old.code!==record.code))hrAssert_(['Medical','Dental','Optical','Medical Check-up','Mileage','Outstation Meals'].indexOf(hrInductionCategory_(old.title))===-1,'Induction claim types cannot be renamed or have their codes changed. Deactivate the type if needed.');
  if(module==='claimTypes'&&old&&old.title!==record.title)hrAssert_(!hrRows_('claims').concat(hrRows_('claimPolicies')).some(r=>r.category===old.title),'This type is already used. Make it inactive and create a new type instead of renaming it.');
  if(module==='claimTypes')hrAssert_(!rows.some(r=>r.id!==record.id&&r.title.toLowerCase()===record.title.toLowerCase()),'Claim type name already exists.');
  if(module==='profiles')hrAssert_(!rows.some(r=>r.id!==record.id&&r.employee===record.employee),'Employee organisation already exists; edit the existing record.');
  if(module==='leaveOpeningBalances'){
    record.excludedRequestIds=record.historyMode==='Exclude existing test records'?hrLeaveRows_().filter(r=>hrName_(r[1])===record.employee).map(r=>String(r[0])):[];
    record.excludedAdjustmentIds=hrRows_('adjustments').filter(r=>r.employee===record.employee&&r.year===record.year&&r.category===record.category).map(r=>r.id);
  }
  const writeRes = hrWrite_(module,record,actor,old,old?'Updated':'Created');
  if(!old && ['claims','loans','bookings'].indexOf(module)!==-1) {
    try {
      const adminEmail = hrGetHrHodEmail_();
      let managerEmail = "";
      if (record.manager) {
        const mgrProf = hrProfiles_().find(p => hrName_(p.employee) === hrName_(record.manager));
        if (mgrProf && mgrProf.email) managerEmail = mgrProf.email;
      }
      const targetRecipient = managerEmail || adminEmail;
      const modLabel = module === 'claims' ? `Claim: RM ${Number(record.amount || 0).toFixed(2)} (${record.category || 'Expense'})`
        : module === 'loans' ? `Loan: RM ${Number(record.amount || 0).toFixed(2)}`
        : `Resource: ${record.title || record.resourceId}`;
      const awaitingWho = record.manager ? 'Awaiting HOD Endorsement' : 'Awaiting HR Approval';
      MailApp.sendEmail({
        to: targetRecipient,
        subject: `[Action Required] New ${module === 'bookings' ? 'RESOURCE' : module.slice(0, -1).toUpperCase()} Request: ${record.employee} - ${awaitingWho}`,
        replyTo: targetRecipient,
        body: `Hello ${managerEmail ? (record.manager || 'HOD') : 'HR / Admin'},\n\nA new ${module === 'bookings' ? 'resource' : module.slice(0, -1)} request has been submitted by ${record.employee}.\n\nDetails: ${modLabel}\nStatus: ${record.status}\n\nPlease log in to the Metrio HR Portal / Mobile App to review and process this request.`
      });
    } catch (e) {
      console.log("New Request Notification Failed: " + e);
    }
  }
  return writeRes;
}
function hrTransition_(payload,actor) {
  hrAssert_(!!HR_MODULES[payload.module],'Unknown or retired HR module.');
  const module=payload.module,old=hrRows_(module).find(r=>r.id===payload.id);hrAssert_(!!old,'Record not found.');hrAssert_(payload.version===old.version,'Record changed. Refresh and try again.');
  const r=hrPublic_(old),action=payload.command,admin=hrAdmin_(actor),manager=hrManager_(actor)&&(hrName_(r.manager)===hrName_(actor.name)||hrTeam_(actor,r.employee)),self=hrName_(r.employee)===hrName_(actor.name);
  const decision=['approve','reject','paid','review'].indexOf(action)!==-1;
  if(decision)hrAssert_(!self,'You cannot approve your own request.');
  if(action==='cancel') {hrAssert_((self||admin)&&['claims','loans','bookings'].indexOf(module)!==-1&&['Pending manager','Pending admin'].indexOf(r.status)!==-1,'Request cannot be cancelled.');r.status='Cancelled';}
  else if(module==='claims'&&['approve','reject','paid'].indexOf(action)!==-1){
    if(action==='paid'){hrAssert_(admin&&r.status==='Approved','Only approved claims can be marked paid.');hrAssert_(String(payload.reference||'').trim(),'Payment reference is required.');r.status='Paid';r.paymentReference=String(payload.reference).trim();}
    else {
      if(action==='approve'){try{hrClaimLimit_(r);}catch(e){throw new Error(e.message+' If supporting details are missing, cancel this pending claim and resubmit with the required information.');}}
      hrAssert_((r.status==='Pending manager'&&(manager||admin))||(r.status==='Pending admin'&&admin),'You cannot review this claim at this stage.');
      const prevStatus = r.status;
      r.status=action==='reject'?'Rejected':r.status==='Pending manager'?'Pending admin':'Approved';
      // Multi-tier claim notification routing
      try {
        const adminEmail = hrGetHrHodEmail_();
        const empProf = hrProfiles_().find(p => p.employee === hrName_(r.employee));
        const empEmail = empProf ? empProf.email : '';
        if (prevStatus === 'Pending manager' && r.status === 'Pending admin') {
          // HOD Endorsed -> Notify HR
          MailApp.sendEmail({
            to: adminEmail,
            subject: `[Action Required] Claim Endorsed by HOD: ${r.employee} (RM ${Number(r.amount || 0).toFixed(2)}) - Awaiting HR Action`,
            body: `Hello HR,\n\n${actor.name} has endorsed the claim for ${r.employee}.\n\nCategory: ${r.category}\nAmount: RM ${Number(r.amount || 0).toFixed(2)}\nNotes: ${r.notes || '-'}\n\nPlease log in to the Metrio HR Portal / Mobile App to process final approval and payment.`
          });
        } else if (r.status === 'Approved') {
          // HR Approved -> Notify Staff
          const targetEmail = empEmail || adminEmail;
          if (targetEmail) {
            MailApp.sendEmail({
              to: targetEmail,
              subject: `Claim Approved: ${r.employee} (RM ${Number(r.amount || 0).toFixed(2)})`,
              body: `Hello ${r.employee},\n\nYour claim of RM ${Number(r.amount || 0).toFixed(2)} (${r.category}) has been approved by HR.`
            });
          }
        } else if (r.status === 'Rejected') {
          // Rejected -> Notify Staff
          const targetEmail = empEmail || adminEmail;
          if (targetEmail) {
            MailApp.sendEmail({
              to: targetEmail,
              subject: `Claim Rejected: ${r.employee} (RM ${Number(r.amount || 0).toFixed(2)})`,
              body: `Hello ${r.employee},\n\nYour claim of RM ${Number(r.amount || 0).toFixed(2)} (${r.category}) was rejected by ${actor.name}.\nReason: ${payload.comments || '-'}`
            });
          }
        }
      } catch (e) {
        console.log("Claim Notification Failed: " + e);
      }
    }
  }
  else if(module==='loans'){
    if(action==='approve'||action==='reject'){
      hrAssert_((r.status==='Pending manager'&&(manager||admin))||(r.status==='Pending admin'&&admin),'Loan is not awaiting your decision.');
      const prevStatus = r.status;
      r.status=action==='reject'?'Rejected':r.status==='Pending manager'?'Pending admin':'Approved';
      try {
        const adminEmail = hrGetHrHodEmail_();
        const empProf = hrProfiles_().find(p => p.employee === hrName_(r.employee));
        const empEmail = empProf ? empProf.email : '';
        if (prevStatus === 'Pending manager' && r.status === 'Pending admin') {
          MailApp.sendEmail({
            to: adminEmail,
            subject: `[Action Required] Loan Application Endorsed by HOD: ${r.employee} (RM ${Number(r.amount || 0).toFixed(2)}) - Awaiting HR Action`,
            body: `Hello HR,\n\n${actor.name} has endorsed the loan application for ${r.employee}.\n\nAmount: RM ${Number(r.amount || 0).toFixed(2)}\nInstalments: ${r.instalments || '-'}\n\nPlease log in to the Metrio HR Portal / Mobile App to process final approval.`
          });
        } else if (r.status === 'Approved') {
          const targetEmail = empEmail || adminEmail;
          if (targetEmail) {
            MailApp.sendEmail({
              to: targetEmail,
              subject: `Loan Application Approved: ${r.employee} (RM ${Number(r.amount || 0).toFixed(2)})`,
              body: `Hello ${r.employee},\n\nYour loan application of RM ${Number(r.amount || 0).toFixed(2)} has been approved by HR.`
            });
          }
        } else if (r.status === 'Rejected') {
          const targetEmail = empEmail || adminEmail;
          if (targetEmail) {
            MailApp.sendEmail({
              to: targetEmail,
              subject: `Loan Application Rejected: ${r.employee} (RM ${Number(r.amount || 0).toFixed(2)})`,
              body: `Hello ${r.employee},\n\nYour loan application of RM ${Number(r.amount || 0).toFixed(2)} was rejected by ${actor.name}.\nReason: ${payload.comments || '-'}`
            });
          }
        }
      } catch (e) {
        console.log("Loan Notification Failed: " + e);
      }
    }
    else if(action==='disburse'){hrAssert_(admin&&!self&&r.status==='Approved','Loan cannot be disbursed.');hrAssert_(String(payload.reference||'').trim(),'Payment reference is required.');r.status='Active';r.paymentReference=String(payload.reference).trim();r.outstanding=r.amount;r.repayments=[];}
    else if(action==='repay'){const amount=Number(payload.repayment);hrAssert_(admin&&r.status==='Active','Loan is not active.');hrAssert_(amount>0&&Number.isFinite(amount)&&amount<=r.outstanding,'Repayment must be positive and within outstanding balance.');hrAssert_(String(payload.reference||'').trim(),'Repayment reference is required.');hrAssert_(!(r.repayments||[]).some(p=>p.reference===String(payload.reference).trim()),'Repayment reference already recorded.');r.repayments.push({amount:amount,reference:String(payload.reference).trim(),date:new Date().toISOString(),actor:actor.name});r.outstanding=Number((r.outstanding-amount).toFixed(2));if(r.outstanding===0)r.status='Settled';}
    else throw new Error('Invalid loan action.');
  }
  else if(module==='resourceAssignments'&&action==='returnResource'){hrAssert_(admin&&r.status==='Assigned','Only HR can return an assigned resource.');r.status='Returned';r.returnedAt=new Date().toISOString();r.returnNotes=String(payload.comments||'').slice(0,12000);}
  else if(module==='bookings'){
    if(!Array.isArray(r.historyLog)){
      try { r.historyLog = r.historyLog ? JSON.parse(r.historyLog) : []; } catch(_) { r.historyLog = []; }
    }
    if(action==='approve'||action==='reject'){
      hrAssert_((r.status==='Pending manager'&&(manager||admin))||(r.status==='Pending admin'&&admin),'Resource request is not awaiting your approval.');
      if(action==='approve'&&r.status==='Pending admin')hrConflict_(r);
      const prevStatus = r.status;
      if (action === 'reject') {
        r.status = 'Rejected';
        r.rejectedAt = new Date().toISOString();
        r.rejectedBy = actor.name;
        r.rejectionReason = String(payload.comments || '-');
        r.historyLog.push({ action: 'Rejected', actor: actor.name, timestamp: r.rejectedAt, comments: payload.comments || '' });
      } else if (r.status === 'Pending manager') {
        r.status = 'Pending admin';
        r.hodApprovedAt = new Date().toISOString();
        r.hodApprover = actor.name;
        r.hodRemark = String(payload.comments || 'Recommended by HOD');
        r.historyLog.push({ action: 'HOD Recommended', actor: actor.name, timestamp: r.hodApprovedAt, comments: payload.comments || '' });
      } else {
        r.status = 'Approved';
        r.hrApprovedAt = new Date().toISOString();
        r.hrApprover = actor.name;
        r.hrRemark = String(payload.comments || 'Approved by HR');
        r.historyLog.push({ action: 'HR Approved', actor: actor.name, timestamp: r.hrApprovedAt, comments: payload.comments || '' });
      }
      try {
        const adminEmail = hrGetHrHodEmail_();
        const empProf = hrProfiles_().find(p => p.employee === hrName_(r.employee));
        const empEmail = empProf ? empProf.email : '';
        if (prevStatus === 'Pending manager' && r.status === 'Pending admin') {
          MailApp.sendEmail({
            to: adminEmail,
            subject: `[Action Required] Resource Request Endorsed by HOD: ${r.employee} (${r.title || 'Resource'}) - Awaiting HR Approval`,
            body: `Hello HR,\n\n${actor.name} (HOD) has recommended / endorsed the resource request for ${r.employee}.\n\nResource: ${r.title || r.resourceId}\nRemark: ${payload.comments || '-'}\n\nPlease log in to the Metrio HR Portal / Mobile App to process final approval.`
          });
        } else if (r.status === 'Approved') {
          const targetEmail = empEmail || adminEmail;
          if (targetEmail) {
            MailApp.sendEmail({
              to: targetEmail,
              subject: `Resource Request Approved: ${r.employee} (${r.title || 'Resource'})`,
              body: `Hello ${r.employee},\n\nYour resource request (${r.title || r.resourceId}) has been approved by HR. HR will prepare the item and notify you once it is ready for collection.`
            });
          }
        } else if (r.status === 'Rejected') {
          const targetEmail = empEmail || adminEmail;
          if (targetEmail) {
            MailApp.sendEmail({
              to: targetEmail,
              subject: `Resource Request Rejected: ${r.employee} (${r.title || 'Resource'})`,
              body: `Hello ${r.employee},\n\nYour resource request (${r.title || r.resourceId}) was rejected by ${actor.name}.\nReason: ${payload.comments || '-'}`
            });
          }
        }
      } catch (e) {
        console.log("Resource Request Notification Failed: " + e);
      }
    }
    else if(action==='ready'){
      hrAssert_(admin&&r.status==='Approved','Only approved resource requests can be marked ready.');
      r.status = 'Ready';
      r.readyAt = new Date().toISOString();
      r.readyBy = actor.name;
      r.readyNotes = String(payload.comments || '');
      r.historyLog.push({ action: 'Resource Ready for Handover', actor: actor.name, timestamp: r.readyAt, comments: payload.comments || '' });
      try {
        const empProf = hrProfiles_().find(p => p.employee === hrName_(r.employee));
        const empEmail = empProf ? empProf.email : '';
        if (empEmail) {
          MailApp.sendEmail({
            to: empEmail,
            subject: `[Action Required: Collection] Your Requested Resource is Ready: ${r.title || r.resourceId}`,
            body: `Hello ${r.employee},\n\nYour requested resource (${r.title || r.resourceId}) is now ready for handover / collection.\nInstructions / Location: ${payload.comments || 'Please proceed to HR for collection.'}\n\nPlease collect your resource and log in to the HR Portal to click 'Acknowledge & Receive' to confirm handover.`
          });
        }
      } catch (e) {
        console.log("Ready Notification Failed: " + e);
      }
    }
    else if(action==='acknowledge'){
      hrAssert_((self||admin)&&(r.status==='Ready'||r.status==='Approved'),'Resource must be ready or approved before acknowledgment.');
      r.status = 'Received';
      r.receivedAt = new Date().toISOString();
      r.acknowledgedBy = actor.name;
      r.acknowledgeNotes = String(payload.comments || '');
      r.historyLog.push({ action: 'Staff Acknowledged & Received', actor: actor.name, timestamp: r.receivedAt, comments: payload.comments || '' });
      // Automatically register the resource under staff profile "My Resources"
      try {
        const assignId = Utilities.getUuid();
        const assignRecord = {
          id: assignId,
          employee: r.employee,
          resourceId: r.resourceId,
          date: r.receivedAt.slice(0, 10),
          status: 'Assigned',
          notes: 'Assigned via Resource Request #' + r.id + (payload.comments ? ' (' + payload.comments + ')' : '')
        };
        hrWrite_('resourceAssignments', assignRecord, actor, null, 'Created');
        hrSyncAssignedResources_(r.employee);
      } catch (assignErr) {
        console.log('Auto-assign resource on acknowledge error: ' + assignErr);
      }
      try {
        const adminEmail = hrGetHrHodEmail_();
        MailApp.sendEmail({
          to: adminEmail,
          subject: `Resource Handover Completed: ${r.employee} (${r.title || r.resourceId})`,
          body: `Hello HR,\n\n${actor.name} has acknowledged receipt of resource: ${r.title || r.resourceId} on ${r.receivedAt.slice(0, 10)}.\n\nIt has been automatically registered under their staff profile My Resources.`
        });
      } catch (e) {
        console.log("Handover Completed Notification Failed: " + e);
      }
    }
    else throw new Error('Invalid resource request action.');
  }
  else if(module==='tax'&&action==='review'){hrAssert_(admin&&r.status==='Submitted','Declaration cannot be reviewed.');r.status='Reviewed';}
  else if(module==='cycles'&&action==='closeCycle'){hrAssert_(admin&&r.status==='Active','Cycle cannot be closed.');hrAssert_(!hrRows_('appraisals').some(a=>a.cycleId===r.id&&a.status!=='Completed'),'Complete all appraisals before closing the cycle.');r.status='Closed';}
  else if(module==='letters'&&action==='issue'){hrAssert_(admin&&r.status==='Draft','Letter cannot be issued.');r.status='Issued';}
  else if(module==='training'&&action==='complete'){hrAssert_(admin&&r.status==='Planned','Training cannot be completed.');r.status='Completed';}
  else if(module==='appraisals'){
    const rating=Number(payload.rating);hrAssert_(rating>=1&&rating<=5,'Rating must be between 1 and 5.');
    if(action==='selfReview'){hrAssert_(self&&r.status==='Pending self','Self review is not available.');r.selfRating=rating;r.selfComments=String(payload.comments||'').slice(0,12000);r.status=r.manager?'Pending manager':'Pending admin';}
    else if(action==='managerReview'){hrAssert_((manager||admin)&&!self&&r.status==='Pending manager','Manager review is not available.');r.managerRating=rating;r.managerComments=String(payload.comments||'').slice(0,12000);r.status='Pending admin';}
    else if(action==='finalise'){hrAssert_(admin&&!self&&r.status==='Pending admin','Appraisal cannot be finalised.');r.finalRating=Number(((Number(r.selfRating)+Number(r.managerRating||rating))/2).toFixed(2));r.status='Completed';r.finalComments=String(payload.comments||'').slice(0,12000);}
    else throw new Error('Invalid appraisal action.');
  } else throw new Error('Action is not available for this record.');
  if(action==='reject')hrAssert_(String(payload.comments||'').trim(),'Reason is required for rejection.');
  r.decisionComments=String(payload.comments||'').slice(0,12000);r.decisionBy=actor.name;r.decisionAt=new Date().toISOString();
  return hrWrite_(module,r,actor,old,action);
}
function hrLeaveAdjustments_(employee,year) {
  const sums={Annual:0,Medical:0};hrRows_('adjustments').filter(r=>r.employee===hrName_(employee)&&r.year===year).forEach(r=>sums[r.category]+=Number(r.days));return sums;
}
function hrLegacyPayload_(action,payload,actor) {
  const admin=hrAdmin_(actor);
  const adminActions=['unlockMonth','saveSingleStaff','deleteSingleStaff','saveHolidays','saveAttendance','saveData','lockMonth','approveAttendanceHR','getBootstrap','getData','getAttendance','getLockedMonths'];
  if(action==='saveSingleStaff')payload=hrEmployeePayload_(payload,actor);
  if(action==='deleteSingleStaff')throw new Error('Set the employee status to Resigned to preserve HR and payroll history.');
  if(adminActions.indexOf(action)!==-1)hrAssert_(admin,'Administrator access is required.');
  if(action==='getAttendanceApproval'||action==='approveAttendanceHOD'||action==='rejectAttendanceApproval')hrAssert_(hrManager_(actor),'Manager or Administrator access required.');
  if(['submitLeave','updateOwnProfile'].indexOf(action)!==-1){payload=Object.assign({},payload);payload.staffName=actor.name;payload.name=actor.name;}
  if(action==='submitLeave'){
    if(payload.type&&!payload.leaveType) payload.leaveType=payload.type;
    if(payload.leaveType&&!payload.type) payload.type=payload.leaveType;
  }
  if(action==='updateLeaveStatus') {
    const index=Number(payload.rowIndex),sheet=getSpreadsheet_().getSheetByName('Leave');
    hrAssert_(sheet&&Number.isInteger(index)&&index>=2&&index<=sheet.getLastRow(),'Invalid leave row.');
    const maxCol = Math.max(15, sheet.getLastColumn());
    const row=sheet.getRange(index,1,1,maxCol).getValues()[0];
    hrAssert_(!hrLeaveTestIds_()[hrName_(row[1])+'|'+String(row[0])],'This preserved test-history request is excluded from operational leave.');
    if(payload.requestId!=null)hrAssert_(String(payload.requestId)===String(row[0]),'Request moved. Refresh and try again.');
    if(payload.expectedStatus!=null)hrAssert_(payload.expectedStatus===row[8],'Request changed. Refresh and review the latest status.');
    const isRej = /reject/i.test(String(payload.newStatus||''));
    const isAppr = /approve/i.test(String(payload.newStatus||''));
    if(isRej)hrAssert_(String(payload.approverRemark||'').trim(),'A rejection reason is required.');
    const isMgr = hrTeam_(actor,row[1]);
    const curStatus = String(row[8]||'').trim();
    if(isMgr) {
      if(isAppr && (curStatus === 'pending_admin' || curStatus === 'withdrawal_pending_hr')) hrAssert_(false, 'This leave request is pending Admin/HR approval.');
      hrAssert_(isAppr || isRej || payload.newStatus==='Withdrawn' || payload.newStatus==='withdrawal_pending_hr','Invalid leave decision.');
    } else if(!admin) {
      hrAssert_(hrName_(row[1])===actor.name&&(payload.newStatus==='Withdrawal Requested' || payload.newStatus==='withdrawal_pending_hod')&&['Pending','Approved','approved','pending_hod','pending_admin'].indexOf(curStatus)!==-1,'You can only request withdrawal of your own active leave.');
    } else {
      hrAssert_(hrName_(row[1])!==actor.name,'A different approver must decide your leave.');
      if(isAppr && !isMgr && (curStatus === 'pending_hod' || curStatus === 'withdrawal_pending_hod')) hrAssert_(false, 'This leave request is pending HOD approval.');
      hrAssert_(isAppr || isRej || payload.newStatus==='Withdrawn' || payload.newStatus==='withdrawal_pending_hr','Invalid leave decision.');
    }
    payload=Object.assign({},payload,{approver:actor.name});
    if(isAppr){
      if(curStatus === 'pending_admin' || curStatus === 'Pending' || (!isMgr && admin)) {
        hrCheckLeave_(row[1],row[2],row[3],row[4],row[5],String(row[0]),{annualDays:row[12],unpaidDays:row[13]});
        if(['Marriage','Compassionate','Maternity','Paternity'].indexOf(hrLeaveCategory_(row[2]))!==-1)
          hrAssert_(String(payload.approverRemark||'').trim(),'Record the event eligibility and evidence reviewed in the approval remark.');
      }
    }
  }
  if(action==='submitLeave')hrCheckLeave_(actor.name,payload.leaveType||payload.type,payload.startDate,payload.endDate,payload.totalDays,'',payload);
  if(action==='getLeaveData')payload=Object.assign({},payload,{role:payload.scope==='personal'?'Staff':(admin||hrManager_(actor))?'Admin':'Staff',staffName:actor.name});
  return payload;
}
// HOD attendance review needs times and OT hours, never monetary overrides.
// A whitelist prevents future payroll fields from leaking through read wrappers.
function hrAttendanceResponse_(rows, actor) {
  if(hrAdmin_(actor))return rows || [];
  const visibleNames=new Set([hrName_(actor.name)]);
  if(hrManager_(actor))hrProfiles_().filter(p=>p.manager===hrName_(actor.name)).forEach(p=>visibleNames.add(p.employee));
  const fields=['id','name','date','payType','in','out','totalHrs','shift','lateIn','earlyOut','payableHrs','overlapOT','extraOT','remark'];
  return (rows || []).filter(row=>visibleNames.has(hrName_(row.name))).map(row=>{
    const clean={}; fields.forEach(key=>{if(row[key]!==undefined)clean[key]=row[key];}); return clean;
  });
}
function hrLegacyResponse_(action,response,actor) {
  const data=JSON.parse(response.getContent());
  const admin=hrAdmin_(actor);
  function sanitiseStaff(staff){const clean={};Object.keys(staff||{}).forEach(name=>{if(admin||hrName_(name)===actor.name||hrTeam_(actor,name)){clean[name]=Object.assign({},staff[name]);delete clean[name].password;if(!admin){delete clean[name].staffFolderId;delete clean[name].staffFolderUrl;if(hrName_(name)!==actor.name){clean[name].basic=0;clean[name].hourly=0;clean[name].salaryHistory='';clean[name].bankNo='';clean[name].taxNo='';clean[name].epfNo='';clean[name].socsoNo='';}}}});return clean;}
  if(action==='getLeaveData'&&data.status==='success'&&!admin)data.data=data.data.filter(r=>hrName_(r.name)===actor.name||hrTeam_(actor,r.name));
  if(action==='getStaff'&&data.status==='success')data.data=sanitiseStaff(data.data);
  if(action==='getBootstrap'&&data.data&&data.data.staff)data.data.staff.data=sanitiseStaff(data.data.staff.data);
  if(action==='getAttendance'&&data.status==='success')data.data=hrAttendanceResponse_(data.data,actor);
  if(action==='getBootstrap'&&data.data&&data.data.attendance)data.data.attendance.data=hrAttendanceResponse_(data.data.attendance.data,actor);
  if(action==='getPayroll'&&data.status==='success'&&!admin)data.data=data.data.filter(r=>hrName_(r.name)===actor.name);
  return jsonResponse(data);
}

function hrClaimLimit_(record) {
  hrInductionClaimLimit_(record);
  const profile=hrRows_('profiles').find(r=>r.employee===record.employee),year=Number(record.date.slice(0,4));
  const candidates=profile?hrRows_('claimPolicies').filter(p=>p.companyId===profile.companyId&&p.category===record.category&&p.year===year):[];
  const policy=hrPolicyForGrade_(candidates,profile);
  const others=hrRows_('claims').filter(r=>r.id!==record.id&&r.employee===record.employee&&r.category===record.category&&r.date.slice(0,4)===String(year)&&['Pending manager','Pending admin','Approved','Paid'].indexOf(r.status)!==-1);
  hrAssert_(!others.some(r=>r.receiptNo===record.receiptNo&&r.date===record.date&&(hrInductionCategory_(record.category)!=='Outstation Meals'||!r.mealType||r.mealType===record.mealType)),'This receipt has already been submitted.');
  if(policy){record.gradeId=profile.gradeId||'';record.policyId=policy.id;hrAssert_(record.amount<=policy.receiptLimit,'Claim exceeds the per-receipt policy limit.');hrAssert_(others.reduce((sum,r)=>sum+r.amount,0)+record.amount<=policy.annualLimit,'Claim exceeds the annual limit including pending requests.');}
}

// Employee master: Staff A:X remains compatible with existing payroll.
const EMPLOYEE_HEADERS_ = ['Employee ID','Company ID','Department ID','Reporting Manager','Job Title','Work Location','Record Version','Assigned Resources','Job Title ID','Job Grade ID','Email','Race','Age (source)','Academic Level','Work Base','Length of Service (Years)','Company Name','Staff Folder ID','Staff Folder URL'];
function hrRole_(role) { return ({Staff:'User',Supervisor:'HOD'})[role] || role || 'User'; }
function hrStaffRows_() { return readSheet_(getSpreadsheet_().getSheetByName('Staff'),false); }
function hrProfiles_() {
  const rows = hrStaffRows_();
  if (!rows || rows.length <= 1) return [];
  const header = rows[0] || [];
  const { bioCol } = hrStaffCols_(header);
  return rows.slice(1).filter(r => r[0]).map((r, i) => {
    const name = hrName_(r[0]);
    const bio = (bioCol !== -1 && r[bioCol] && !String(r[bioCol]).trim().startsWith('[')) ? String(r[bioCol]).trim() : (r[43] || defaultBiometrics_[name] || '');
    return {
      id: r[24] || name,
      employee: name,
      name: name,
      employeeNo: r[24] || '',
      companyId: r[25] || '',
      company: r[25] || '',
      departmentId: r[26] || '',
      department: r[26] || '',
      manager: hrName_(r[27]),
      email: r[34] || '',
      role: hrRole_(r[4]),
      jobTitle: r[28] || '',
      jobTitleId: r[32] || '',
      gradeId: r[33] || '',
      location: r[29] || '',
      version: Number(r[30]) || 1,
      status: r[1] || 'Active',
      companyName: r[40] || '',
      biometricId: bio,
      photo: r[45] || '',
      photoUrl: r[45] || ''
    };
  });
}
function hrTeam_(actor,name) {
  if (!hrManager_(actor)) return false;
  const targetName = hrName_(name);
  const actorName = hrName_(actor.name);
  if (targetName === actorName) return false;
  return hrProfiles_().some(r => r.employee === targetName && hrName_(r.manager) === actorName && r.employee !== actorName);
}
function hrEmployeePayload_(payload,actor) {
  hrAssert_(hrAdmin_(actor),'HR or Admin access is required.');
  const rows=hrStaffRows_(),name=hrName_(payload.name),old=rows.slice(1).find(r=>hrName_(r[0])===name);
  hrAssert_(name&&name.length<=160,'Employee name is required (maximum 160 characters).');
  if(old&&payload.version!=null)hrAssert_(Number(payload.version)===(Number(old[30])||1),'Employee changed. Refresh and try again.');
  if(payload.isQuickSave){hrAssert_(actor.role==='Admin'||!old||hrRole_(old[4])!=='Admin','Only Admin can edit Admin accounts.');return payload;}
  if(old){const legacy=['name','status','username','password','role','basic','hourly','gender','icNo','contactNo','address','emergency','joinedDate','confirmDate','resignDate'];payload=Object.assign({},payload);legacy.forEach((k,i)=>{if(payload[k]===undefined)payload[k]=old[i];});['socsoNo','epfNo','taxNo','bankNo','alEntitlement','mcEntitlement'].forEach((k,i)=>{if(payload[k]===undefined)payload[k]=old[17+i];});}
  const role=hrRole_(payload.role || (old&&old[4]));
  hrAssert_(['User','HOD','HR','Admin'].indexOf(role)!==-1,'Select User, HOD, HR or Admin.');
  if(actor.role!=='Admin') {
    hrAssert_(!old||hrRole_(old[4])!=='Admin','Only Admin can edit Admin accounts.');
    // HR may appoint team HODs or HR staff, but must not create or promote Admin accounts.
    hrAssert_(role!=='Admin','Only Superadmin can assign Admin role.');
  }
  if(old&&hrRole_(old[4])==='Admin'&&(role!=='Admin'||payload.status==='Resigned'))
    hrAssert_(rows.slice(1).some(r=>hrName_(r[0])!==name&&r[1]!=='Resigned'&&hrRole_(r[4])==='Admin'),'Keep at least one active Admin.');
  hrAssert_(['Active','Resigned'].indexOf(payload.status||'Active')!==-1,'Invalid employment status.');
  const username=String(payload.username||'').trim();
  hrAssert_(username,'Username is required.');
  hrAssert_(!rows.slice(1).some(r=>hrName_(r[0])!==name&&String(r[2]).trim().toLowerCase()===username.toLowerCase()),'Username already exists.');
  if(!old)hrAssert_(String(payload.password||'').length>=8,'New accounts require a password of at least 8 characters.');
  if(old&&payload.version!=null)hrAssert_(Number(payload.version)===(Number(old[30])||1),'Employee changed. Refresh and try again.');
  const fields=['employeeNo','companyId','departmentId','manager','jobTitle','location'];
  const result=Object.assign({},payload,{name,username,role});
  fields.forEach((k,i)=>result[k]=String(payload[k]===undefined?(old&&old[24+i]||''):payload[k]).trim());
  result.employeeNo=result.employeeNo||Utilities.getUuid(); result.manager=hrName_(result.manager);
  const conflictStaff = rows.slice(1).find(r=>hrName_(r[0])!==name&&r[24]&&String(r[24]).trim().toUpperCase()===String(result.employeeNo).trim().toUpperCase());
  if (conflictStaff) {
    hrAssert_(false, `Employee ID '${result.employeeNo}' already exists for staff '${conflictStaff[0]}'. Please use a unique Employee ID.`);
  }
  if(result.companyId)hrAssert_(hrRows_('companies').some(r=>r.id===result.companyId),'Select a valid company.');
  if(result.departmentId)hrAssert_(hrRows_('departments').some(r=>{
    if(r.id!==result.departmentId) return false;
    if(!result.companyId) return true;
    if(!r.companyId || String(r.companyId).toUpperCase()==='ALL') return true;
    const cos = String(r.companyId).split(',').map(s=>s.trim().toUpperCase());
    return cos.includes('ALL') || cos.includes(String(result.companyId).toUpperCase());
  }),'Department must belong to the selected company.');
  if(result.manager){
    const mgrMatch=hrDirectory_().find(r=>(r.name===result.manager||r.id===result.manager||(r.employeeNo&&r.employeeNo===result.manager))&&r.status!=='Resigned'&&hrManager_(r));
    hrAssert_(result.manager!==name&&!!mgrMatch,'Select another active HOD, HR or Admin as manager.');
    result.manager=mgrMatch.name;
  }
  const seen=[name]; let manager=result.manager;
  let steps=0;
  while(manager && steps < rows.length){
    steps++;
    const row=rows.slice(1).find(r=>hrName_(r[0])===manager);
    const nextManager=row ? hrName_(row[27]) : '';
    if(nextManager === name){
      hrAssert_(false, 'Reporting lines cannot contain a cycle.');
    }
    if(!nextManager || nextManager === manager || seen.indexOf(nextManager) !== -1){
      break;
    }
    seen.push(manager);
    manager = nextManager;
  }
  result.jobTitleId=String(payload.jobTitleId===undefined?(old&&old[32]||''):payload.jobTitleId).trim();
  const requestedGrade=payload.gradeId!==undefined?String(payload.gradeId||'').trim():((old&&old[32]===result.jobTitleId)?String(old[33]||'').trim():'');
  let jobGrade='';
  if(result.jobTitleId){
    const job=hrRows_('jobTitles').find(j=>j.id===result.jobTitleId);
    hrAssert_(job&&job.availability==='Active','Select an active job title.');
    jobGrade=String(job.gradeId||'');result.jobTitle=job.title;
    if(job.departmentId && (!result.departmentId || payload.departmentId===undefined)) result.departmentId=job.departmentId;
    if(job.workBase && (!result.workBase || payload.workBase===undefined)) result.workBase=job.workBase;
  } else if(old&&old[32]) result.jobTitle='';
  result.gradeId=requestedGrade||jobGrade;
  if(result.gradeId)hrAssert_(hrRows_('jobGrades').some(g=>g.id===result.gradeId&&g.availability==='Active'),'Select an active Job Grade from System Settings.');
  ['email','race','ageSource','academicLevel','workBase','serviceYearsSource','companyName'].forEach((k,i)=>{const v=payload[k]===undefined?(result[k]||(old&&old[34+i])):payload[k];result[k]=v==null?'':String(v).trim();hrAssert_(result[k].length<=250,'Staff field is too long: '+k);});
  hrAssert_(!result.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email),'Enter a valid email address.');
  ['ageSource','serviceYearsSource'].forEach(k=>hrAssert_(result[k]===''||(Number.isFinite(Number(result[k]))&&Number(result[k])>=0&&Number(result[k])<=120),'Invalid source value: '+k));
  result.workBase=String(result.workBase||'').toUpperCase();
  result.location=String(result.location||'').toUpperCase();
  const baseMap = { OFFICE: 'OFFICE', SITE: 'SITE' };
  const locMap = {
    PG: 'PG', PENANG: 'PG', 'PULAU PINANG': 'PG',
    SEL: 'SEL', SELANGOR: 'SEL',
    KL: 'KL', 'KUALA LUMPUR': 'KL', 'WILAYAH PERSEKUTUAN KUALA LUMPUR': 'KL',
    NS: 'NS', 'NEGERI SEMBILAN': 'NS'
  };
  if (baseMap[result.workBase]) result.workBase = baseMap[result.workBase];
  if (locMap[result.location]) result.location = locMap[result.location];
  for(const [key,master,defaults] of [['workBase','workBases',['OFFICE','SITE']],['location','workLocations',['PG','SEL','KL','NS']] ]){
    if(!result[key])continue;
    const masterRows = hrRows_(master);
    if(masterRows.length) {
      const match = masterRows.find(r=>r.availability!=='Inactive' && (String(r.code||'').toUpperCase()===result[key] || String(r.title||'').toUpperCase()===result[key]));
      hrAssert_(!!match || defaults.includes(result[key]),'Choose an active '+(key==='workBase'?'Work Base':'Work Location')+' from System Settings.');
      if(match && match.code) result[key] = String(match.code).toUpperCase();
    } else {
      hrAssert_(defaults.includes(result[key]),'Choose an active '+(key==='workBase'?'Work Base':'Work Location')+' from System Settings.');
    }
  }
  result.biometricId = String(payload.biometricId === undefined ? (old && old[43] || defaultBiometrics_[name] || '') : payload.biometricId).trim();
  delete result.staffFolderId;delete result.staffFolderUrl;
  result.version=(Number(old&&old[30])||0)+1;
  return result;
}
// Run once from the Apps Script editor after replacing the deployment code.
function setupHrBackend() {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    requestSpreadsheet_=null;const ss=getSpreadsheet_(),staff=ss.getSheetByName('Staff');
    hrAssert_(!!staff,'Existing Staff sheet is required.');
    if(staff.getMaxColumns && staff.getMaxColumns()<45 && typeof staff.insertColumnsAfter==='function')staff.insertColumnsAfter(staff.getMaxColumns(),45-staff.getMaxColumns());
    const scheduleHeader=String(staff.getRange(1,45).getValue()||'').trim();
    hrAssert_(!scheduleHeader||scheduleHeader==='Schedules','Column AS is occupied by an unexpected field. Check the Staff sheet before continuing.');
    staff.getRange(1,45).setValue('Schedules');
    const actual=staff.getRange(1,25,1,19).getValues()[0];
    actual.forEach((v,i)=>hrAssert_(!v||v===EMPLOYEE_HEADERS_[i],'Unexpected Staff column '+(i+25)+'. No columns overwritten.'));
    staff.getRange(1,25,1,19).setValues([EMPLOYEE_HEADERS_]);
    const rows=hrStaffRows_();
    rows.slice(1).forEach((r,i)=>{if(!r[0])return;const values=Array.from({length:19},(_,j)=>r[24+j]==null?'':r[24+j]);values[0]=values[0]||Utilities.getUuid();values[6]=Number(values[6])||1;staff.getRange(i+2,25,1,19).setValues([values]);});
    Object.keys(HR_MODULES).filter(m=>m!=='profiles').concat(['audit']).forEach(m=>hrSheet_(m,true));
    hrSeedClaimTypes_();
    hrSeedInductionGrades_();
    const inductionCompanies=hrEnableInductionCompanies_();
    hrSyncJobTitles_();
    hrSeedWorkSchedules_();
    hrSeedWorkBases_();
    hrSeedWorkLocations_();
    hrProfiles_().forEach(p=>hrSyncAssignedResources_(p.employee));
    staff.setFrozenRows(1);
    return {status:'success',message:'Employee master and all HR registers ready.',spreadsheetUrl:ss.getUrl(),inductionCompanies};
  } finally {lock.releaseLock();requestSpreadsheet_=null;}
}

function hrLeaveOverview_(actor) {
  const row=hrStaffRows_().slice(1).find(r=>hrName_(r[0])===actor.name);
  hrAssert_(!!row,'Employee not found.');
  const result=JSON.parse(handleLogin({username:row[2]||row[8],password:row[3]}).getContent());
  hrAssert_(result.status==='success'&&hrName_(result.user.name)===actor.name,'Unable to calculate your leave balance.');
  return jsonResponse({status:'success',data:hrLeaveSummary_(actor.name,result.user)});
}

function hrLeaveRows_(){const s=getSpreadsheet_().getSheetByName('Leave');return s?readSheet_(s,false).slice(1).filter(r=>r[0]):[];}
function hrLeaveTestIds_(){const ids={};hrRows_('leaveOpeningBalances').forEach(r=>(r.excludedRequestIds||[]).forEach(id=>ids[hrName_(r.employee)+'|'+String(id)]=true));return ids;}
function hrLeaveCategory_(value){
  const raw=String(value||'').trim().toLowerCase();
  if(!raw) return '';
  if(raw==='fractional_split'||raw.startsWith('fractional_split')) return 'fractional_split';
  const code=String(value||'').trim().split(/[\s-_/]/)[0].toUpperCase();
  const direct=({AL:'Annual',EL:'Annual',ML:'Medical',MC:'Medical',SL:'Medical',HPL:'Hospitalisation',HL:'Hospitalisation',RPL:'Replacement',RL:'Replacement',CPL:'Compassionate',CL:'Compassionate',MRL:'Marriage',MTL:'Maternity',PL:'Paternity',NPL:'Unpaid',UL:'Unpaid'})[code];
  if(direct) return direct;
  if(raw.includes('annual')||raw.includes('emergency')) return 'Annual';
  if(raw.includes('hosp')) return 'Hospitalisation';
  if(raw.includes('medic')||raw.includes('sick')||raw.includes('clinic')) return 'Medical';
  if(raw.includes('marr')) return 'Marriage';
  if(raw.includes('compass')) return 'Compassionate';
  if(raw.includes('mater')) return 'Maternity';
  if(raw.includes('pater')) return 'Paternity';
  if(raw.includes('unpaid')||raw.includes('non pay')||raw.includes('no pay')||raw.includes('without pay')) return 'Unpaid';
  if(raw.includes('replac')) return 'Replacement';
  return ['Annual','Medical','Hospitalisation','Marriage','Compassionate','Maternity','Paternity','Unpaid','Replacement','fractional_split'].find(c=>c.toLowerCase()===raw)||'';
}
function hrLeaveDate_(value){return value instanceof Date?Utilities.formatDate(value,'Asia/Kuala_Lumpur','yyyy-MM-dd'):String(value||'').slice(0,10);}
function hrLeaveBalance_(employee,category,year,excludeId){
  const opening=hrRows_('leaveOpeningBalances').filter(r=>r.employee===hrName_(employee)&&r.category===category&&r.year===year).slice(-1)[0];
  const testHistory=hrLeaveTestIds_();
  const effectiveStart = opening ? opening.effectiveDate : String(year) + '-01-01';
  const used=hrLeaveRows_().filter(r=>hrName_(r[1])===hrName_(employee)&&String(r[0])!==excludeId&&!testHistory[hrName_(r[1])+'|'+String(r[0])]&&['Approved','approved','Withdrawal Requested','withdrawal_pending_hod','withdrawal_pending_hr'].indexOf(r[8])!==-1&&hrLeaveDate_(r[3])>=effectiveStart&&Number(hrLeaveDate_(r[3]).slice(0,4))===year).reduce((s,r)=>{
    const cat = hrLeaveCategory_(r[2]);
    if (category === 'Annual') {
      if (r[2] === 'fractional_split' || cat === 'fractional_split') {
        const annDays = r[12] != null && r[12] !== '' ? Number(r[12]) : 0;
        return s + annDays;
      }
      if (cat === 'Annual') return s + (Number(r[5]) || 0);
    } else if (category === 'Unpaid') {
      if (r[2] === 'fractional_split' || cat === 'fractional_split') {
        const unpDays = r[13] != null && r[13] !== '' ? Number(r[13]) : 0;
        return s + unpDays;
      }
      if (cat === 'Unpaid') return s + (Number(r[5]) || 0);
    } else if (cat === category) {
      return s + (Number(r[5]) || 0);
    }
    return s;
  },0);
  const adjustments=hrRows_('adjustments').filter(r=>r.employee===hrName_(employee)&&r.category===category&&r.year===year&&(!opening||(opening.excludedAdjustmentIds||[]).indexOf(r.id)===-1)).reduce((s,r)=>s+Number(r.days),0);

  if (opening) {
    return {category,year,entitlement:opening.days,balance:Number((opening.days+adjustments-used).toFixed(2)),openingBalance:opening.days,effectiveDate:opening.effectiveDate,used:Number(used.toFixed(2)),adjustments,status:'Ready'};
  }

  // Fallback to backend captured entitlement from Staff profile
  const staff=hrStaffRows_().slice(1).find(r=>hrName_(r[0])===hrName_(employee));
  let baseEntitlement = null;
  if (staff) {
    if (category === 'Annual') {
      const colVal = staff[21];
      if (colVal !== undefined && colVal !== '' && !isNaN(Number(colVal))) {
        baseEntitlement = Number(colVal);
      }
    } else if (category === 'Medical') {
      const colVal = staff[22];
      if (colVal !== undefined && colVal !== '' && !isNaN(Number(colVal))) {
        baseEntitlement = Number(colVal);
      }
    } else if (category === 'Hospitalisation') {
      baseEntitlement = 60;
    }

    // If still null/unspecified, calculate tenure scale from joinedDate
    if (baseEntitlement == null && staff[12]) {
      const dStr = hrLeaveDate_(staff[12]);
      const joined = dStr ? new Date(dStr + (dStr.length === 10 ? 'T00:00:00Z' : '')) : null;
      if (joined && !isNaN(joined.getTime())) {
        let completedYears = year - joined.getUTCFullYear();
        const now = new Date();
        if (now.getUTCMonth() < joined.getUTCMonth() || (now.getUTCMonth() === joined.getUTCMonth() && now.getUTCDate() < joined.getUTCDate())) {
          completedYears--;
        }
        if (completedYears < 0) completedYears = 0;
        if (category === 'Annual') {
          if (year === joined.getUTCFullYear()) {
            const monthsWorked = 12 - joined.getUTCMonth();
            baseEntitlement = Math.round(12 * (monthsWorked / 12));
          } else {
            baseEntitlement = Math.min(26, 12 + Math.max(0, completedYears - 1));
          }
        } else if (category === 'Medical') {
          if (completedYears < 2) baseEntitlement = 14;
          else if (completedYears < 5) baseEntitlement = 18;
          else baseEntitlement = 22;
        }
      }
    }
  }

  // If still not specified, fall back to Induction Policy / Employment Act statutory standard
  if (baseEntitlement == null && staff) {
    if (category === 'Annual') baseEntitlement = 12;
    else if (category === 'Medical') baseEntitlement = 14;
    else if (category === 'Hospitalisation') baseEntitlement = 60;
  }

  if (baseEntitlement != null) {
    const bal = Number((baseEntitlement + adjustments - used).toFixed(2));
    return {category,year,entitlement:baseEntitlement,balance:bal,openingBalance:baseEntitlement,effectiveDate:String(year)+'-01-01',used:Number(used.toFixed(2)),adjustments,status:'Ready'};
  }

  return {category,year,entitlement:null,balance:null,openingBalance:null,effectiveDate:String(year)+'-01-01',used:0,adjustments:0,status:'Opening balance required'};
}
function hrLeaveSummary_(employee,legacy){
  const year=new Date().getFullYear(),leaveBalances=['Annual','Medical','Hospitalisation'].map(c=>hrLeaveBalance_(employee,c,year,''));
  if (leaveBalances[0].entitlement == null && legacy && legacy.alEntitlement != null) leaveBalances[0].entitlement = legacy.alEntitlement;
  if (leaveBalances[1].entitlement == null && legacy && legacy.mcEntitlement != null) leaveBalances[1].entitlement = legacy.mcEntitlement;
  const profile=hrProfiles_().find(p=>p.employee===hrName_(employee)),company=profile&&hrRows_('companies').find(c=>c.id===profile.companyId),enabled=company&&company.inductionPolicy==='FAM-23/G Jul 2025';
  if(enabled)leaveBalances[2].entitlement=60;
  const leaveEvents=[{category:'Marriage',daysPerEvent:7,conditions:'First legal marriage; confirmed with one year of service; evidence required.'},{category:'Compassionate',daysPerEvent:4,conditions:'Confirmed employee; eligible family relationship and evidence reviewed by HR.'},{category:'Maternity',daysPerEvent:98,conditions:'Calendar days per event; HR must review service and documentation conditions.'},{category:'Paternity',daysPerEvent:7,conditions:'Confirmed with one year service; first five children; starts within the first week after birth; HR reviews evidence.'},{category:'Unpaid',daysPerEvent:null,conditions:'Subject to approval; no paid leave balance.'}].map(e=>enabled?e:Object.assign({},e,{daysPerEvent:null,conditions:'HR must confirm the company policy and event eligibility.'}));
  const alBal = leaveBalances[0].balance != null ? leaveBalances[0].balance : (legacy && legacy.alBalance != null ? legacy.alBalance : null);
  const mcBal = leaveBalances[1].balance != null ? leaveBalances[1].balance : (legacy && legacy.mcBalance != null ? legacy.mcBalance : null);
  return {alEntitlement:leaveBalances[0].entitlement||(legacy&&legacy.alEntitlement)||0,mcEntitlement:leaveBalances[1].entitlement||(legacy&&legacy.mcEntitlement)||0,alBalance:alBal,mcBalance:mcBal,leaveBalances,leaveEvents};
}
function hrCheckLeave_(employee,type,start,end,days,excludeId,extraPayload){
  const isFractional = (type === 'fractional_split' || hrLeaveCategory_(type) === 'fractional_split');
  const from=hrLeaveDate_(start),to=hrLeaveDate_(end),n=Number(days);
  if(!isFractional){
    const category=hrLeaveCategory_(type);
    hrAssert_(!!category,'Select a supported leave type.');
  }
  hrDate_(from,false);hrDate_(to,false);
  hrAssert_([from,to].every(d=>new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d),'Invalid leave calendar date.');
  hrAssert_(to>=from&&Number.isFinite(n)&&n>0&&n<=366,'Invalid leave dates or days.');
  const calendarDays=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  hrAssert_(n<=calendarDays,'Leave days cannot exceed the date span.');
  if(!excludeId){
    const testHistory=hrLeaveTestIds_();
    hrAssert_(!hrLeaveRows_().some(r=>hrName_(r[1])===hrName_(employee)&&!testHistory[hrName_(r[1])+'|'+String(r[0])]&&['Pending','Approved','approved','pending_hod','pending_admin','Withdrawal Requested','withdrawal_pending_hod','withdrawal_pending_hr'].indexOf(r[8])!==-1&&hrLeaveDate_(r[3])<=to&&hrLeaveDate_(r[4])>=from),'Leave dates overlap an existing active request.');
  }
  if(isFractional){
    hrAssert_(from.slice(0,4)===to.slice(0,4),'Split balance-based leave across calendar years into separate requests.');
    const p = extraPayload || {};
    const ann = p.annualDays != null && p.annualDays !== '' ? Number(p.annualDays) : 0;
    const unp = p.unpaidDays != null && p.unpaidDays !== '' ? Number(p.unpaidDays) : 0;
    hrAssert_(Number.isFinite(ann) && ann >= 0, 'Annual leave split days cannot be negative.');
    hrAssert_(Number.isFinite(unp) && unp >= 0, 'Unpaid leave split days cannot be negative.');
    hrAssert_(Math.abs((ann + unp) - n) < 0.001, 'Annual and unpaid split days must sum exactly to total days.');
    const balance = hrLeaveBalance_(employee, 'Annual', Number(from.slice(0,4)), excludeId);
    hrAssert_(balance.balance !== null, 'No Annual leave balance found for this employee. Contact HR.');
    hrAssert_(from >= balance.effectiveDate, 'Leave starts before the opening balance effective date. Contact HR.');
    hrAssert_(ann <= balance.balance, 'Annual leave split (' + ann + ' days) exceeds available AL balance (' + balance.balance + ' days).');
    return;
  }
  const category=hrLeaveCategory_(type);
  if(category==='Hospitalisation')hrAssert_(n===calendarDays,'Hospitalisation leave must count every calendar day in the date span.');
  if(['Annual','Medical','Hospitalisation'].indexOf(category)!==-1){
    hrAssert_(from.slice(0,4)===to.slice(0,4),'Split balance-based leave across calendar years into separate requests.');
    const balance=hrLeaveBalance_(employee,category,Number(from.slice(0,4)),excludeId);
    hrAssert_(balance.balance!==null,'No '+category+' leave balance found for this employee. Contact HR.');
    hrAssert_(from>=balance.effectiveDate,'Leave starts before the opening balance effective date. Contact HR.');
    const opening=hrRows_('leaveOpeningBalances').filter(r=>r.employee===hrName_(employee)&&r.category===category&&r.year===Number(from.slice(0,4))).slice(-1)[0];
    hrAssert_(!excludeId||!opening||(opening.excludedRequestIds||[]).indexOf(excludeId)===-1,'This test-history request was excluded at opening. Submit a new real request.');
    hrAssert_(n<=balance.balance,'Leave exceeds the available '+category+' balance.');
  }
  const eventLimits={Marriage:7,Compassionate:4,Maternity:98,Paternity:7};
  if(eventLimits[category]){
    const profile=hrProfiles_().find(p=>p.employee===hrName_(employee)),company=profile&&hrRows_('companies').find(c=>c.id===profile.companyId);
    if(company&&company.inductionPolicy===hrInductionPolicy_().version){
      hrAssert_(n===calendarDays,'This event leave must count every calendar day in the date span.');
      hrAssert_(calendarDays<=eventLimits[category],'Leave exceeds the per-event '+category+' limit.');
      const staff=hrStaffRows_().slice(1).find(r=>hrName_(r[0])===hrName_(employee));
      if(category!=='Maternity')hrAssert_(staff&&staff[13]&&hrLeaveDate_(staff[13])<=from,'This event leave requires employment confirmation.');
      if(category==='Marriage'||category==='Paternity'){
        const joined=staff&&hrLeaveDate_(staff[12]),anniversary=new Date(joined+'T00:00:00Z');
        hrAssert_(joined&&!isNaN(anniversary.getTime()),'Record the employee joining date.');
        anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
        hrAssert_(anniversary.toISOString().slice(0,10)<=from,'This event leave requires one year of service.');
      }
    }
  }
}

function hrSyncAssignedResources_(employee) {
  const sheet=getSpreadsheet_().getSheetByName('Staff'),rows=hrStaffRows_();
  const index=rows.findIndex((r,i)=>i>0&&hrName_(r[0])===hrName_(employee));if(index<1)return;
  const resources=hrRows_('resources');
  const assignments=hrRows_('resourceAssignments').filter(r=>r.employee===hrName_(employee)&&r.status==='Assigned');
  const structuredList = assignments.map(a => {
    const r = resources.find(res => res.id === a.resourceId);
    return {
      type: r ? (r.category || 'Equipment') : 'Equipment',
      model: r ? (r.title || r.name) : (a.notes || a.resourceId),
      name: r ? r.title : a.resourceId,
      serialNo: r ? (r.code || '-') : '-',
      issueDate: a.date || (a.createdAt ? a.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)),
      returned: false,
      remarks: a.notes || 'Assigned'
    };
  });
  const val = structuredList.length ? JSON.stringify(structuredList) : '';
  sheet.getRange(index+1,32).setValue(val);
}
function hrSeedClaimTypes_() {
  const existing=hrRows_('claimTypes');
  ['Medical','Dental','Optical','Medical Check-up','Outstation Meals','Travel','Mileage','Accommodation','Other'].forEach(title=>{
    const code=title.toUpperCase(),id='type-'+title.toLowerCase().replace(/\s+/g,'-');
    if(existing.some(r=>r.id===id||String(r.code).toUpperCase()===code||String(r.title).toLowerCase()===title.toLowerCase()))return;
    hrWrite_('claimTypes',{id,code,title,availability:'Active',status:'Active'},{name:'SYSTEM'},null,'Initial setup');
  });
}

// FAM-23/G, July 2025. Activation is explicit per company; no employer is inferred.
function hrInductionCategory_(value) {
  const names=['Medical','Dental','Optical','Medical Check-up','Mileage','Outstation Meals'];
  const normal=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
  const direct=names.find(n=>normal(n)===normal(value));if(direct)return direct;
  const type=hrRows_('claimTypes').find(t=>normal(t.title)===normal(value));
  return type?(names.find(n=>normal(n)===normal(type.code))||value):value;
}
function hrInductionPolicy_() {
  return {version:'FAM-23/G Jul 2025',flexi:{S:1500,M:1000,E:600,C:600,W:600},checkup:{S:800,M:500},mileage:{Car:0.50,Motorcycle:0.20},meals:{M:{Breakfast:15,Lunch:25,Dinner:30,daily:70},E:{Breakfast:10,Lunch:20,Dinner:20,daily:50}}};
}
function hrEnableInductionCompanies_() {
  const companies=hrRows_('companies'),result={enabled:[],preserved:[],disabled:[],missing:[]};
  ['milan streams','setar quay'].forEach(name=>{
    const matches=companies.filter(c=>String(c.title||'').trim().replace(/\s+/g,' ').toLowerCase()===name);
    if(matches.length!==1){result.missing.push(name+(matches.length>1?' (ambiguous duplicate names)':''));return;}
    const old=matches[0];
    if(Object.prototype.hasOwnProperty.call(old,'inductionPolicy')){result.preserved.push(old.title);if(old.inductionPolicy!==hrInductionPolicy_().version)result.disabled.push(old.title);return;}
    const record=hrPublic_(old);record.inductionPolicy=hrInductionPolicy_().version;
    hrWrite_('companies',record,{name:'SYSTEM'},old,'Induction policy enabled for requested company');result.enabled.push(old.title);
  });
  return result;
}
function hrSeedInductionGrades_() {
  const existing=hrRows_('jobGrades'),policy=hrInductionPolicy_();
  const gradeDefs = [
    { code: 'S', title: 'Grade S - Senior Management', notes: 'FAM-23/G Jul 2025. Flexi-Wellness RM1,500/yr (Dental, Optical, Health Screening, Gym, Vaccine). Medical Check-up RM800/yr (Age 40+ or Senior Mgt). Outstation Meals: Actual reimbursement with receipt (>250km). Mileage: Car RM0.50/km, Motorcycle RM0.20/km. OT: Exempt. AL: 22-26 days.' },
    { code: 'M', title: 'Grade M - Managerial', notes: 'FAM-23/G Jul 2025. Flexi-Wellness RM1,000/yr. Medical Check-up RM500/yr (Age 40+ or Managers). Outstation Meals: RM70/day (Breakfast RM15, Lunch RM25, Dinner RM30, >250km). Mileage: Car RM0.50/km, Motorcycle RM0.20/km. OT: Exempt. AL: 18-24 days.' },
    { code: 'E', title: 'Grade E - Executive', notes: 'FAM-23/G Jul 2025. Flexi-Wellness RM600/yr. Outstation Meals: RM50/day (Breakfast RM10, Lunch RM20, Dinner RM20, >250km). Mileage: Car RM0.50/km, Motorcycle RM0.20/km. OT: Basic <= RM4,000 (Office: 1.5x) or Site <= RM7,000 (Site: 1.0x). AL: 14-20 days.' },
    { code: 'C', title: 'Grade C - Clerical & Supervisory', notes: 'FAM-23/G Jul 2025. Flexi-Wellness RM600/yr. Outstation Meals: RM50/day (>250km). Mileage: Car RM0.50/km, Motorcycle RM0.20/km. OT: Eligible (Office: 1.5x hourly, Rest Day: 2.0x, Public Holiday: 3.0x; Site: 1.0x). AL: 12-18 days.' },
    { code: 'W', title: 'Grade W - Worker & Operative', notes: 'FAM-23/G Jul 2025. Flexi-Wellness RM600/yr. Mileage: Car RM0.50/km, Motorcycle RM0.20/km. OT: Eligible (Office: 1.5x hourly; Site: 1.0x). AL: 12-18 days.' }
  ];
  gradeDefs.forEach(gDef => {
    const id = 'grade-' + gDef.code.toLowerCase();
    if (existing.some(r => r.id === id || String(r.code).toUpperCase() === gDef.code)) return;
    hrWrite_('jobGrades', { id, code: gDef.code, title: gDef.title, availability: 'Active', status: 'Active', notes: gDef.notes }, { name: 'SYSTEM' }, null, 'Induction grade setup');
  });
}
function hrInductionDate_(value) {
  if(!value) return '';
  if(value instanceof Date){
    if(isNaN(value.getTime()))return '';
    return Utilities.formatDate(value,'Asia/Kuala_Lumpur','yyyy-MM-dd');
  }
  const str = String(value).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
    }
  }
  const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const date=str.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed=new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  }
  return '';
}
function hrInductionClaimLimit_(record) {
  const policy=hrInductionPolicy_(),profile=hrRows_('profiles').find(p=>p.employee===record.employee);
  const submitted=record.inductionPolicyVersion===policy.version;
  const company=hrRows_('companies').find(c=>c.id===(submitted?record.inductionCompanyId:profile&&profile.companyId));
  if(!submitted&&(!company||company.inductionPolicy!==policy.version))return;
  hrAssert_(company,'The submitted policy company no longer exists.');
  const flexi=['Medical','Dental','Optical'],covered=flexi.concat(['Medical Check-up','Mileage','Outstation Meals']);
  const category=hrInductionCategory_(record.category);
  if(covered.indexOf(category)===-1)return;
  const grade=hrRows_('jobGrades').find(g=>g.id===(profile&&profile.gradeId) || (g.code && profile && String(g.code).toUpperCase()===String(profile.gradeId).toUpperCase()));
  const code=submitted?record.inductionGradeCode:(grade?String(grade.code).toUpperCase():(profile&&profile.gradeId&&['S','M','E','C','W'].indexOf(String(profile.gradeId).toUpperCase())!==-1?String(profile.gradeId).toUpperCase():''));
  if(category!=='Mileage')hrAssert_((submitted||(grade&&grade.availability==='Active')||(code&&Object.prototype.hasOwnProperty.call(policy.flexi,code)))&&code&&Object.prototype.hasOwnProperty.call(policy.flexi,code),'Assign an active induction job grade S, M, E, C or W before claiming this benefit.');
  const date=hrInductionDate_(record.date);
  hrAssert_(date,'A valid receipt date is required.');
  const amount=Number(record.amount);
  hrAssert_(Number.isFinite(amount)&&amount>0,'Claim amount must be positive.');
  const others=hrRows_('claims').filter(r=>r.id!==record.id&&r.employee===record.employee&&['Pending manager','Pending admin','Approved','Paid'].indexOf(r.status)!==-1);
  const annual=others.filter(r=>String(r.date).slice(0,4)===date.slice(0,4));
  const sum=rows=>rows.reduce((total,r)=>total+Number(r.amount||0),0);
  const within=(used,limit,message)=>hrAssert_(Math.round((used+amount)*100)<=Math.round(limit*100),message);
  if(flexi.indexOf(category)!==-1||category==='Medical Check-up'){
    hrAssert_(String(record.evidenceUrl||'').trim(),'A receipt link is required for wellness and medical check-up claims.');
    const staff=hrStaffRows_().slice(1).find(r=>hrName_(r[0])===record.employee);
    const rawConfirm=staff?String(staff[13]||'').trim():'';
    const isTextConfirmed=/confirmed|yes|true/i.test(rawConfirm);
    const confirmed=staff&&hrInductionDate_(staff[13]);
    const isActiveStaff=staff&&String(staff[1]||'').trim().toLowerCase()==='active';
    if(confirmed&&date){
      hrAssert_(confirmed<=date,'This benefit requires employment confirmation on or before the receipt date.');
    }else{
      hrAssert_(isTextConfirmed||(isActiveStaff&&!rawConfirm),'This benefit requires employment confirmation on or before the receipt date.');
    }
    if(flexi.indexOf(category)!==-1){
      const pool=annual.filter(r=>flexi.indexOf(hrInductionCategory_(r.category))!==-1);
      hrAssert_(!pool.some(r=>r.receiptNo===record.receiptNo&&r.date===record.date),'This Flexi receipt has already been submitted.');
      within(sum(pool),policy.flexi[code],'Claim exceeds the shared annual Medical/Dental/Optical Flexi limit, including pending claims.');
    } else {
      hrAssert_(!!policy.checkup[code],'Medical check-up benefit is available only to grades S and M.');
      const joined=staff&&hrInductionDate_(staff[12]);
      hrAssert_(joined,'A valid joining date is required for the medical check-up benefit.');
      const anniversary=new Date(joined+'T00:00:00Z');anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
      hrAssert_(anniversary.toISOString().slice(0,10)<=date,'Medical check-up requires at least one year of service on the receipt date.');
      within(sum(annual.filter(r=>hrInductionCategory_(r.category)==='Medical Check-up')),policy.checkup[code],'Claim exceeds the annual medical check-up limit, including pending claims.');
    }
  }
  if(category==='Mileage'){
    hrAssert_(record.personalVehicle==='Yes'&&String(record.tripAuthorisation||'').trim(),'Mileage requires a personal vehicle and an authorised business trip reference.');
    const rate=policy.mileage[record.vehicleType],distance=Number(record.distanceKm);
    hrAssert_(rate&&Number.isFinite(distance)&&distance>0,'Select Car or Motorcycle and enter positive claimable kilometres.');
    within(0,distance*rate,'Mileage exceeds the induction rate for the selected vehicle and distance.');
    record.inductionMileageRate=rate;
  }
  if(category==='Outstation Meals'){
    hrAssert_(code==='S'||!!policy.meals[code],'Outstation meal entitlement for grades C and W requires policy clarification before use.');
    hrAssert_(Number(record.returnDistanceKm)>250&&Number.isFinite(Number(record.returnDistanceKm)),'Outstation meals require return travel exceeding 250 km.');
    hrAssert_(String(record.tripAuthorisation||'').trim()&&record.mealProvided==='No','Outstation meals require an authorised trip reference and must not have been provided.');
    hrAssert_(['Breakfast','Lunch','Dinner'].indexOf(record.mealType)!==-1,'Select the meal being claimed.');
    hrAssert_(code==='S'?String(record.evidenceUrl||'').trim():String(record.evidenceUrl||record.notes||'').trim(),code==='S'?'Grade S meal claims require a receipt link.':'Provide a receipt link or remarks explaining the missing meal receipt.');
    const daily=others.filter(r=>hrInductionCategory_(r.category)==='Outstation Meals'&&r.date===record.date);
    hrAssert_(!daily.some(r=>r.mealType===record.mealType),'This meal has already been claimed for this date.');
    if(policy.meals[code]){
      within(0,policy.meals[code][record.mealType],'Claim exceeds the induction limit for this meal.');
      within(sum(daily),policy.meals[code].daily,'Claim exceeds the daily outstation meal limit, including pending claims.');
    }
  }
  record.inductionPolicyVersion=policy.version;record.inductionCompanyId=company.id;record.inductionGradeCode=code||'';
}

function hrSyncJobTitles_(){
  const jobs=hrRows_('jobTitles'),sheet=getSpreadsheet_().getSheetByName('Staff');
  hrStaffRows_().slice(1).forEach((r,i)=>{
    if(!r[0]||!r[32])return;
    const job=jobs.find(j=>j.id===r[32]);
    if(!job)return;
    let needsUpdate = false;
    if(r[28]!==job.title){sheet.getRange(i+2,29).setValue(job.title); needsUpdate = true;}
    if(r[33]!==job.gradeId){sheet.getRange(i+2,34).setValue(job.gradeId); needsUpdate = true;}
    if(job.departmentId && r[26]!==job.departmentId){sheet.getRange(i+2,27).setValue(job.departmentId); needsUpdate = true;}
    if(job.workBase && (!r[38] || r[38]!==job.workBase)){sheet.getRange(i+2,39).setValue(job.workBase); needsUpdate = true;}
    if(needsUpdate){sheet.getRange(i+2,31).setValue((Number(r[30])||1)+1);}
  });
}
function hrPolicyForGrade_(policies,profile){
  if(!policies.length)return null;
  const policy=profile&&(policies.find(p=>p.gradeId&&p.gradeId===profile.gradeId)||policies.find(p=>!p.gradeId));
  hrAssert_(!!policy,'No policy covers this employee job grade. Assign a job title/grade or configure an all-grades policy.');
  return policy;
}
function hrResourceLimit_(record){
  const profile=hrProfiles_().find(p=>p.employee===record.employee),resources=hrRows_('resources'),resource=resources.find(r=>r.id===record.resourceId);
  if(!profile||!resource)return;
  const candidates=hrRows_('resourcePolicies').filter(p=>p.companyId===profile.companyId&&p.category===resource.category);
  const policy=hrPolicyForGrade_(candidates,profile);if(!policy)return;
  const active=hrRows_('resourceAssignments').filter(a=>a.id!==record.id&&a.employee===record.employee&&a.status==='Assigned').map(a=>resources.find(r=>r.id===a.resourceId)).filter(r=>r&&r.category===resource.category);
  hrAssert_(active.length+1<=policy.maxAssigned,'Resource quantity exceeds the employee job-grade limit.');
  if(policy.maxValue>0){hrAssert_(active.concat([resource]).every(r=>Number(r.assetValue)>0),'Set asset values for all assigned resources before enforcing the value cap.');hrAssert_(active.reduce((sum,r)=>sum+Number(r.assetValue),0)+Number(resource.assetValue)<=policy.maxValue,'Resource value exceeds the employee job-grade limit.');}
  record.gradeId=profile.gradeId||'';record.policyId=policy.id;
}

// Employee files stay in the staff-specific folder under the configured HR parent.
function hrStaffFolder_(employeeNo,name,savedId){
  hrAssert_(employeeNo&&name,'Employee ID and name are required for a staff folder.');
  let parent = null;
  try {
    parent = DriveApp.getFolderById(STAFF_FOLDER_PARENT_);
  } catch (err) {
    if (err.message && err.message.includes('outside')) throw err;
  }
  if (!parent) {
    try {
      const root = DriveApp.getRootFolder();
      const existing = root.getFoldersByName('HR_Staff_Uploads');
      if (existing && existing.hasNext && existing.hasNext()) {
        parent = existing.next();
      } else if (root && root.createFolder) {
        parent = root.createFolder('HR_Staff_Uploads');
      }
    } catch (_) {
      try { parent = DriveApp.getRootFolder(); } catch (_) { parent = null; }
    }
  }
  if (!parent) parent = DriveApp.getFolderById(STAFF_FOLDER_PARENT_);

  if(savedId){
    const saved=DriveApp.getFolderById(String(savedId));
    hrAssert_(!saved.isTrashed(),'Saved staff folder is in the bin; restore it and retry.');
    const targetParentId = parent.getId ? parent.getId() : STAFF_FOLDER_PARENT_;
    const parents=saved.getParents();let matched=false;
    while(parents.hasNext()) if(parents.next().getId()===targetParentId) matched=true;
    hrAssert_(matched,'Saved staff folder is outside the configured HR parent.');
    return saved;
  }
  const folderName=(String(employeeNo)+'_'+String(name)).replace(/[\x00-\x1f\x7f]/g,'').trim();
  const matches=parent.getFoldersByName(folderName);let found=null;
  while(matches.hasNext()){const candidate=matches.next();if(!candidate.isTrashed()){hrAssert_(!found,'Multiple staff folders match this employee. HR must resolve the duplicate.');found=candidate;}}
  return found||parent.createFolder(folderName);
}
function hrStaffTarget_(name){const rows=hrStaffRows_(),i=rows.findIndex((r,i)=>i>0&&hrName_(r[0])===hrName_(name));hrAssert_(i>0,'Employee not found.');return {row:rows[i],index:i+1};}
function hrEnsureStaffFolder_(target){const folder=hrStaffFolder_(target.row[24],hrName_(target.row[0]),target.row[41]);getSpreadsheet_().getSheetByName('Staff').getRange(target.index,42,1,2).setValues([[folder.getId(),folder.getUrl()]]);return folder;}
function hrUploadFile_(folder,payload){
  const name=String(payload.fileName||'').trim();
  let encoded=String(payload.fileData||'');
  let mime=String(payload.mimeType||'').toLowerCase();
  if (encoded.indexOf(';base64,') !== -1) {
    const parts = encoded.split(';base64,');
    if (!mime) mime = parts[0].replace(/^data:/, '').toLowerCase();
    encoded = parts[1];
  }
  const types={'application/pdf':['pdf'],'image/jpeg':['jpg','jpeg'],'image/png':['png'],'application/msword':['doc'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],'application/vnd.ms-excel':['xls'],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx']};
  if (!mime) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    mime = map[ext] || 'image/jpeg';
  }
  hrAssert_(name&&name.length<=180&&!/[\\/\x00-\x1f]/.test(name),'Invalid attachment filename.');
  hrAssert_(types[mime]&&types[mime].indexOf(name.split('.').pop().toLowerCase())!==-1,'Use PDF, JPG, PNG, Word or Excel attachments with matching file type.');
  hrAssert_(encoded.length>0&&encoded.length<=13981016&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'Attachment must be valid base64 and no larger than 10 MB.');
  const bytes=Utilities.base64Decode(encoded);hrAssert_(bytes.length>0&&bytes.length<=10*1024*1024,'Attachment must be no larger than 10 MB.');
  return folder.createFile(Utilities.newBlob(bytes,mime,name)).getUrl();
}
function hrStaffDocumentUpload_(payload,actor){
  hrAssert_(hrAdmin_(actor),'Only HR or Admin can upload staff documents.');
  const target=hrStaffTarget_(payload.name);const folder=hrEnsureStaffFolder_(target);const url=hrUploadFile_(folder,payload);
  const attachment=[target.row[16]||'',url].filter(Boolean).join(' | ');
  const staffSheet=getSpreadsheet_().getSheetByName('Staff'),version=(Number(target.row[30])||1)+1;
  staffSheet.getRange(target.index,17).setValue(attachment);
  staffSheet.getRange(target.index,31).setValue(version);
  hrAudit_(actor,'profiles',{id:target.row[24],employee:hrName_(target.row[0]),title:'Staff attachment: '+String(payload.category||'Document').slice(0,100)},'Uploaded');
  return jsonResponse({status:'success',fileUrl:url,staffFolderId:folder.getId(),staffFolderUrl:folder.getUrl(),attachment,version});
}

function hrUploadCandidateCv_(payload, actor) {
  const candidate = String(payload.candidate || payload.name || 'Candidate').trim() || 'Candidate';
  const department = String(payload.department || 'General').trim() || 'General';
  const jobTitle = String(payload.jobTitle || 'General').trim() || 'General';

  let rootFolder;
  try {
    const parentId = (typeof STAFF_FOLDER_PARENT_ !== 'undefined' && STAFF_FOLDER_PARENT_) ? STAFF_FOLDER_PARENT_ : '1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf';
    rootFolder = DriveApp.getFolderById(parentId);
  } catch (_) {
    try { rootFolder = DriveApp.getRootFolder(); } catch (e) { throw new Error('Google Drive unavailable: ' + e); }
  }

  function getOrCreateChildFolder_(parent, folderName) {
    const safeName = String(folderName).replace(/[/\\]/g, '-').trim() || 'General';
    const it = parent.getFoldersByName(safeName);
    if (it.hasNext()) return it.next();
    return parent.createFolder(safeName);
  }

  const recruitFolder = getOrCreateChildFolder_(rootFolder, 'Recruitment');
  const deptFolder = getOrCreateChildFolder_(recruitFolder, department);
  const jobFolder = getOrCreateChildFolder_(deptFolder, jobTitle);
  const candidateFolder = getOrCreateChildFolder_(jobFolder, candidate);

  let encoded = String(payload.fileData || '');
  let mime = String(payload.mimeType || 'application/pdf').toLowerCase();
  if (encoded.indexOf(';base64,') !== -1) {
    const parts = encoded.split(';base64,');
    if (parts[0].indexOf(':') !== -1) mime = parts[0].split(':')[1];
    encoded = parts[1];
  }
  const bytes = Utilities.base64Decode(encoded);
  hrAssert_(bytes.length > 0 && bytes.length <= 15 * 1024 * 1024, 'CV file must be 15 MB or less.');

  const safeCand = candidate.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = payload.fileName || ('CV_' + safeCand + '.pdf');

  const blob = Utilities.newBlob(bytes, mime || 'application/pdf', fileName);
  const file = candidateFolder.createFile(blob);
  try {
    if (file && typeof file.setSharing === 'function' && typeof DriveApp !== 'undefined' && DriveApp.Access) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  } catch (_) {}

  return jsonResponse({
    status: 'success',
    url: file.getUrl(),
    fileName: fileName,
    folderUrl: candidateFolder.getUrl()
  });
}

function hrUploadProfilePhoto_(payload, actor) {
  const staffName = payload.name || (actor && actor.name) || '';
  hrAssert_(staffName, 'Staff name is required.');
  hrAssert_(hrAdmin_(actor) || hrName_(actor.name) === hrName_(staffName), 'You can only update your own profile photo.');
  hrAssert_(payload.fileData, 'Image file data is required.');

  const target = hrStaffTarget_(staffName);
  let folder;
  try {
    folder = hrEnsureStaffFolder_(target);
  } catch (err) {
    try {
      folder = target.row[41] ? DriveApp.getFolderById(String(target.row[41])) : DriveApp.getRootFolder();
    } catch (_) {
      folder = DriveApp.getRootFolder();
    }
  }

  let encoded = String(payload.fileData || '');
  let mime = String(payload.mimeType || 'image/jpeg').toLowerCase();
  if (encoded.indexOf(';base64,') !== -1) {
    const parts = encoded.split(';base64,');
    if (parts[0].indexOf(':') !== -1) mime = parts[0].split(':')[1];
    encoded = parts[1];
  }
  const bytes = Utilities.base64Decode(encoded);
  hrAssert_(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024, 'Profile photo must be 4 MB or less.');

  const safeEmp = String(target.row[24] || staffName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = 'ProfilePhoto_' + safeEmp + '.jpg';

  // Trash previous profile photo if present in staff folder
  try {
    if (folder && folder.getFilesByName) {
      const prevFiles = folder.getFilesByName(fileName);
      while (prevFiles && prevFiles.hasNext && prevFiles.hasNext()) {
        const prev = prevFiles.next();
        if (prev && typeof prev.setTrashed === 'function' && !prev.isTrashed()) {
          prev.setTrashed(true);
        }
      }
    }
  } catch (_) {}

  const blob = Utilities.newBlob(bytes, mime || 'image/jpeg', fileName);
  const file = folder.createFile(blob);
  try {
    if (file && typeof file.setSharing === 'function' && typeof DriveApp !== 'undefined' && DriveApp.Access) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  } catch (_) {}

  const fileId = file.getId ? file.getId() : Utilities.getUuid();
  const directPhotoUrl = 'https://lh3.googleusercontent.com/d/' + fileId;
  const driveUrl = file.getUrl ? file.getUrl() : '';

  const staffSheet = getSpreadsheet_().getSheetByName('Staff');
  if (staffSheet.getMaxColumns && staffSheet.getMaxColumns() < 46 && typeof staffSheet.insertColumnsAfter === 'function') {
    staffSheet.insertColumnsAfter(staffSheet.getMaxColumns(), 46 - staffSheet.getMaxColumns());
  }
  const headerCol46 = String(staffSheet.getRange(1, 46).getValue() || '').trim();
  if (!headerCol46) {
    staffSheet.getRange(1, 46).setValue('Photo URL');
  }
  staffSheet.getRange(target.index, 46).setValue(directPhotoUrl);
  staffSheet.getRange(target.index, 31).setValue((Number(target.row[30]) || 1) + 1);

  hrAudit_(actor, 'profiles', { id: target.row[24] || staffName, employee: hrName_(target.row[0]), title: 'Updated profile photo' }, 'Uploaded');

  return jsonResponse({
    status: 'success',
    photoUrl: directPhotoUrl,
    driveUrl: driveUrl,
    fileId: fileId,
    staffFolderUrl: folder.getUrl ? folder.getUrl() : ''
  });
}

// --- DYNAMIC HR STATUTORY & POLICY SETTINGS ---
const DEFAULT_HR_STATUTORY_SETTINGS = {
  // Statutory Rates & Ceilings
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
  pcbRebateAmount: 400.0,

  // Fixed Allowance Types & Statutory Compliance (EPF, SOCSO, EIS, PCB)
  allowanceTypes: [
    { id: 'transport', name: 'Transportation Allowance', epf: true, socso: false, eis: false, pcb: false, description: 'Official travel / petrol allowance (exempt from SOCSO/EIS; tax-exempt up to RM6,000/yr for official duties)' },
    { id: 'communication', name: 'Communication Allowance', epf: true, socso: true, eis: true, pcb: false, description: 'Mobile phone and broadband allowance (tax-exempt up to RM2,400/yr for official duties)' },
    { id: 'business_travel', name: 'Business Travel Allowance', epf: false, socso: false, eis: false, pcb: false, description: 'Reimbursement / per diem for business travel (exempt from EPF, SOCSO, EIS & PCB)' },
    { id: 'other', name: 'Other Allowance', epf: true, socso: true, eis: true, pcb: true, description: 'General fixed allowances (subject to EPF, SOCSO, EIS and PCB)' }
  ],

  // TP1 Personal Tax Relief Caps (Income Tax Act 1967 Form TP1)
  tp1Caps: {
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
  },

  // Overtime Salary Entitlement Ceilings (Employment Act 1955 Section 60A)
  overtimeCeilings: {
    general: 4000.0,
    site: 7000.0
  },

  // Metrio Induction Benefits Policy (FAM-23/G Jul 2025)
  inductionBenefits: {
    mileageCar: 0.50,
    mileageMotorcycle: 0.20,
    zeroMcAward: 300.0,
    wellnessByGrade: {
      S: 1500.0,
      M: 1000.0,
      E: 600.0,
      C: 600.0,
      W: 600.0
    },
    checkupByGrade: {
      S: 800.0,
      M: 500.0,
      E: 0.0,
      C: 0.0,
      W: 0.0
    },
    outstationMeals: {
      S: 'Actual expense with receipt',
      M: 70.0,
      E: 50.0,
      C: 'Not listed',
      W: 'Not listed'
    }
  },

  // Governing Regulatory Framework Citations
  regulations: [
    { act: 'Employees Provident Fund Act 1991 (Act 452)', scope: 'EPF employee/employer contribution rates & senior rates' },
    { act: "Employees' Social Security Act 1969 (Act 4)", scope: 'SOCSO wage ceiling (RM 6,000) & contribution tiers' },
    { act: 'Employment Insurance System Act 2017 (Act 800)', scope: 'EIS wage ceiling (RM 6,000) & age >= 60 exemption' },
    { act: 'Income Tax Act 1967 (Form TP1 & PCB)', scope: 'Monthly tax deductions & Form TP1 personal tax relief caps' },
    { act: 'Employment Act 1955 (Section 60A Overtime)', scope: 'Overtime salary entitlement ceilings (General RM 4,000 & Site RM 7,000)' },
    { act: 'Metrio Induction Policy (FAM-23/G Jul 2025)', scope: 'Flexi-wellness, medical check-up, mileage, outstation meals, and Zero-MC award' }
  ]
};

function getStatutorySettingsData_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('HR_statutorySettings');
  if (!sheet) {
    return JSON.parse(JSON.stringify(DEFAULT_HR_STATUTORY_SETTINGS));
  }
  const rows = readSheet_(sheet, false);
  if (!rows || rows.length <= 1) {
    return JSON.parse(JSON.stringify(DEFAULT_HR_STATUTORY_SETTINGS));
  }

  let recordJson = null;
  let version = 1;
  let updatedAt = '';
  let updatedBy = '';

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === 'GLOBAL' || r[0] === 'SETTINGS' || r[4]) {
      try {
        recordJson = typeof r[4] === 'string' ? JSON.parse(r[4]) : r[4];
        version = Number(r[1]) || 1;
        updatedAt = r[5] || '';
        updatedBy = r[6] || '';
        break;
      } catch (e) {}
    }
  }

  if (!recordJson) {
    return JSON.parse(JSON.stringify(DEFAULT_HR_STATUTORY_SETTINGS));
  }

  return Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS, recordJson, {
    tp1Caps: Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS.tp1Caps, recordJson.tp1Caps || {}),
    overtimeCeilings: Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS.overtimeCeilings, recordJson.overtimeCeilings || {}),
    inductionBenefits: {
      ...DEFAULT_HR_STATUTORY_SETTINGS.inductionBenefits,
      ...(recordJson.inductionBenefits || {}),
      wellnessByGrade: Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS.inductionBenefits.wellnessByGrade, recordJson.inductionBenefits?.wellnessByGrade || {}),
      checkupByGrade: Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS.inductionBenefits.checkupByGrade, recordJson.inductionBenefits?.checkupByGrade || {}),
      outstationMeals: Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS.inductionBenefits.outstationMeals, recordJson.inductionBenefits?.outstationMeals || {})
    },
    allowanceTypes: (recordJson.allowanceTypes && recordJson.allowanceTypes.length) ? recordJson.allowanceTypes : DEFAULT_HR_STATUTORY_SETTINGS.allowanceTypes,
    regulations: DEFAULT_HR_STATUTORY_SETTINGS.regulations,
    version: version,
    updatedAt: updatedAt,
    updatedBy: updatedBy
  });
}

function getStatutorySettings() {
  return jsonResponse({ status: 'success', data: getStatutorySettingsData_() });
}

function saveStatutorySettings(payload, actor) {
  hrAssert_(actor && hrAdmin_(actor), 'Only HR administrators or Admin can save statutory settings.');
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('HR_statutorySettings');
  if (!sheet) {
    sheet = ss.insertSheet('HR_statutorySettings');
    sheet.appendRow(['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By']);
    sheet.setFrozenRows(1);
  }

  const rows = readSheet_(sheet, false);
  let rowIndex = -1;
  let currentVersion = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'GLOBAL' || rows[i][0] === 'SETTINGS') {
      rowIndex = i + 1;
      currentVersion = Number(rows[i][1]) || 1;
      break;
    }
  }

  const newVersion = currentVersion + 1;
  const now = new Date().toISOString();
  const settingsData = (payload && payload.settings) ? payload.settings : (payload || {});

  const toStore = Object.assign({}, settingsData);
  delete toStore.version;
  delete toStore.updatedAt;
  delete toStore.updatedBy;
  delete toStore.regulations;

  const rowData = ['GLOBAL', newVersion, '', 'Active', JSON.stringify(toStore), now, actor.name];

  if (rowIndex > 1) {
    sheet.getRange(rowIndex, 1, 1, 7).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  hrAudit_(actor, 'statutorySettings', { id: 'GLOBAL', employee: '', title: 'Statutory and policy settings updated' }, 'Updated');

  return jsonResponse({
    status: 'success',
    data: Object.assign({}, toStore, { version: newVersion, updatedAt: now, updatedBy: actor.name })
  });
}

// --- STATUTORY CALCULATION HELPERS ---
const SOCSO_SCHEDULE_ = [
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
  SOCSO_SCHEDULE_.push({ low, high, ee, er1, er2 });
}

function calculateEpf_(wages, age, isForeigner, config) {
  if (typeof isForeigner === 'object' && isForeigner !== null) {
    config = isForeigner;
    isForeigner = false;
  }
  const cfg = Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS, config);
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

function calculateSocso_(wages, age, config) {
  if (typeof config === 'number') config = { socsoCeiling: config };
  const cfg = Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS, config);
  const w = Number(wages) || 0;
  if (w <= 0) return { employee: 0, employer: 0 };
  const ceiling = cfg.socsoCeiling || 6000.0;
  const capped = Math.min(w, ceiling);
  let match = SOCSO_SCHEDULE_.find(s => capped > s.low && capped <= s.high);
  if (!match) {
    if (capped > SOCSO_SCHEDULE_[SOCSO_SCHEDULE_.length - 1].high) {
      const high = Math.ceil(capped / 100) * 100;
      const mid = high - 50;
      const ee = Math.round(mid * 0.005 * 100) / 100;
      const tot = Math.round(mid * 0.0225 * 20) / 20;
      const er1 = Math.round((tot - ee) * 100) / 100;
      const er2 = Math.round(mid * 0.0125 * 20) / 20;
      match = { low: high - 100, high, ee, er1, er2 };
    } else {
      match = SOCSO_SCHEDULE_[SOCSO_SCHEDULE_.length - 1];
    }
  }
  if (age >= 60) {
    return { employee: 0, employer: match.er2 };
  }
  return { employee: match.ee, employer: match.er1 };
}

function calculateEis_(wages, age, config) {
  if (typeof config === 'number') config = { eisCeiling: config };
  const cfg = Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS, config);
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

function calculatePcb_(grossPay, epfEmployee, tp1MonthlyRelief, age, config) {
  if (typeof age === 'object' && age !== null) {
    config = age;
    age = 30;
  }
  const cfg = Object.assign({}, DEFAULT_HR_STATUTORY_SETTINGS, config);
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

function previewYearEndCloseData_(payload, actor) {
  hrAssert_(actor && hrAdmin_(actor), 'HR or Admin access is required.');
  const companyId = (payload && payload.companyId) || '';
  const currentYear = new Date().getFullYear();
  const fromYear = Number(payload && payload.fromYear) || (currentYear - 1);
  const toYear = Number(payload && payload.toYear) || (fromYear + 1);

  const staffRows = hrStaffRows_().slice(1).filter(r => {
    if (!r[0]) return false;
    const status = String(r[1] || 'Active').trim().toLowerCase();
    if (status !== 'active') return false;
    if (companyId && companyId !== 'all' && (r[25] || '') !== companyId) {
      return false;
    }
    return true;
  });

  const preview = [];
  const leaveRows = hrLeaveRows_();
  const testIds = hrLeaveTestIds_();

  staffRows.forEach(r => {
    const empName = hrName_(r[0]);
    const empCompany = r[25] || '';
    const joinedDateStr = r[12];
    const serviceYearsSource = r[39];
    const legacyAlEnt = parseFloat(r[21]) || 12;

    // 1. Compute unutilized balance for fromYear
    let unutilized = 0;
    const balObj = hrLeaveBalance_(empName, 'Annual', fromYear, '');
    if (balObj && balObj.balance !== null) {
      unutilized = Math.max(0, Number(balObj.balance));
    } else {
      let approvedAL = 0;
      for (let j = 0; j < leaveRows.length; j++) {
        const lr = leaveRows[j];
        if (hrName_(lr[1]) === empName && ['Approved','approved','Withdrawal Requested','withdrawal_pending_hod','withdrawal_pending_hr'].indexOf(lr[8]) !== -1 && !testIds[empName + '|' + String(lr[0])]) {
          const lDate = hrLeaveDate_(lr[3]);
          if (lDate && Number(lDate.slice(0, 4)) === fromYear) {
            if (lr[2] === 'fractional_split' || hrLeaveCategory_(lr[2]) === 'fractional_split') {
              approvedAL += Number(lr[12]) || 0;
            } else if (hrLeaveCategory_(lr[2]) === 'Annual') {
              approvedAL += Number(lr[5]) || 0;
            }
          }
        }
      }
      unutilized = Math.max(0, Number((legacyAlEnt - approvedAL).toFixed(2)));
    }

    // 2. Dual-window carry forward rules (Metrio Induction Policy FAM-23/G & EA 1955 Sec 60E):
    // Standard carry forward: up to 14 days, expiring 31-Dec of toYear
    const standardCarryForward = Math.min(14, unutilized);
    const standardExpiryDate = `${toYear}-12-31`;

    // Excess carry forward: balance - 14, expiring 30-Apr of toYear
    const excessCarryForward = Math.max(0, Number((unutilized - 14).toFixed(2)));
    const excessExpiryDate = `${toYear}-04-30`;

    // 3. New Entitlement from service years (12 - 26 days):
    let serviceYears = 0;
    if (serviceYearsSource !== undefined && serviceYearsSource !== '' && !isNaN(Number(serviceYearsSource))) {
      serviceYears = Number(serviceYearsSource);
    } else if (joinedDateStr) {
      const joined = new Date(joinedDateStr);
      serviceYears = Math.max(0, toYear - joined.getFullYear());
    } else {
      serviceYears = 1;
    }

    let newEntitlement = 12;
    if (serviceYears >= 1) {
      newEntitlement = Math.min(26, 12 + Math.max(0, serviceYears - 1));
    } else {
      newEntitlement = 12;
    }
    newEntitlement = Math.min(26, Math.max(12, newEntitlement));

    // 4. Total Opening Balance
    const totalOpeningBalance = Number((standardCarryForward + excessCarryForward + newEntitlement).toFixed(2));

    preview.push({
      employee: empName,
      employeeName: empName,
      companyId: empCompany,
      serviceYears: serviceYears,
      unutilized: unutilized,
      unutilizedAL: unutilized,
      standardCarryForward: standardCarryForward,
      standardExpiryDate: standardExpiryDate,
      excessCarryForward: excessCarryForward,
      excessExpiryDate: excessExpiryDate,
      newEntitlement: newEntitlement,
      totalOpeningBalance: totalOpeningBalance
    });
  });

  return preview;
}

function previewYearEndClose(payload, actor) {
  hrAssert_(actor && hrAdmin_(actor), 'HR or Admin access is required.');
  const companyId = (payload && payload.companyId) || '';
  const currentYear = new Date().getFullYear();
  const fromYear = Number(payload && payload.fromYear) || (currentYear - 1);
  const toYear = Number(payload && payload.toYear) || (fromYear + 1);

  const preview = previewYearEndCloseData_(payload || {}, actor);
  return jsonResponse({
    status: 'success',
    data: preview,
    preview: preview,
    records: preview,
    companyId: companyId,
    fromYear: fromYear,
    toYear: toYear
  });
}

function executeYearEndClose(payload, actor) {
  hrAssert_(actor && hrAdmin_(actor), 'HR or Admin access is required.');
  const companyId = (payload && payload.companyId) || '';
  const currentYear = new Date().getFullYear();
  const fromYear = Number(payload && payload.fromYear) || (currentYear - 1);
  const toYear = Number(payload && payload.toYear) || (fromYear + 1);

  let records = (payload && payload.records) || [];
  if (!Array.isArray(records) || records.length === 0) {
    records = previewYearEndCloseData_(payload || {}, actor);
  }

  const existingOpening = hrRows_('leaveOpeningBalances');
  const committed = [];

  records.forEach(row => {
    const emp = row.employee || row.employeeName;
    const old = existingOpening.find(r => r.employee === emp && r.category === 'Annual' && Number(r.year) === toYear);
    const standardCF = Number(row.standardCarryForward !== undefined ? row.standardCarryForward : Math.min(14, Number(row.unutilized || 0)));
    const excessCF = Number(row.excessCarryForward !== undefined ? row.excessCarryForward : Math.max(0, Number(row.unutilized || 0) - 14));
    const newEnt = Number(row.newEntitlement !== undefined ? row.newEntitlement : 12);
    const totalDays = Number(row.totalOpeningBalance !== undefined ? row.totalOpeningBalance : (standardCF + excessCF + newEnt));

    const record = {
      id: old ? old.id : Utilities.getUuid(),
      employee: emp,
      year: toYear,
      category: 'Annual',
      effectiveDate: `${toYear}-01-01`,
      days: totalDays,
      standardCarryForward: standardCF,
      standardExpiryDate: row.standardExpiryDate || `${toYear}-12-31`,
      excessCarryForward: excessCF,
      excessExpiryDate: row.excessExpiryDate || `${toYear}-04-30`,
      newEntitlement: newEnt,
      serviceYears: Number(row.serviceYears || 0),
      historyMode: 'Exclude existing test records',
      title: `Year-End Rollover ${fromYear} -> ${toYear} (Policy FAM-23/G & EA 1955 Sec 60E)`,
      source: 'Year-End Rollover',
      status: 'Active',
      createdBy: old ? old.createdBy : actor.name,
      createdAt: old ? old.createdAt : new Date().toISOString()
    };
    hrWrite_('leaveOpeningBalances', record, actor, old, old ? 'Updated' : 'Rollover');
    committed.push(record);
  });

  hrAudit_(actor, 'yearEndClose', {
    employee: 'SYSTEM',
    title: `Committed year-end rollover ${fromYear} -> ${toYear} for ${committed.length} employees`
  }, 'Executed');

  return jsonResponse({
    status: 'success',
    data: {
      committedCount: committed.length,
      fromYear: fromYear,
      toYear: toYear,
      records: committed
    }
  });
}

// --- 360° STAFF PROFILE ENQUIRY DOSSIER ---
function getStaffDossier(payload, actor) {
  if (!actor || !actor.name) {
    return jsonResponse({ status: 'error', message: 'Unauthorized. Authentication required.' });
  }

  const ss = getSpreadsheet_();
  const staffSheet = ss.getSheetByName('Staff');
  if (!staffSheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found.' });

  const staffRows = readSheet_(staffSheet, false);
  if (!staffRows || staffRows.length <= 1) {
    return jsonResponse({ status: 'error', message: 'No staff records available.' });
  }

  const query = String(payload.employee || payload.name || payload.staffName || payload.employeeNo || payload.employeeId || '').trim();
  const rawIc = payload.icNo ? String(payload.icNo).replace(/\D/g, '') : '';
  const queryIc = rawIc || (query ? query.replace(/\D/g, '') : '');

  let matchedRow = null;
  for (let i = 1; i < staffRows.length; i++) {
    const row = staffRows[i];
    if (!row[0]) continue;
    const name = hrName_(row[0]);
    const empNo = String(row[24] || '').trim();
    const ic = String(row[8] || '').replace(/\D/g, '');

    if (query && (name.toUpperCase() === query.toUpperCase() || empNo.toUpperCase() === query.toUpperCase())) {
      matchedRow = row;
      break;
    }
    if (queryIc && queryIc.length >= 6 && ic === queryIc) {
      matchedRow = row;
      break;
    }
  }

  // Keyword / partial search fallback: match name substring, employeeNo substring, or department/jobTitle
  if (!matchedRow && query) {
    const qUpper = query.toUpperCase();
    for (let i = 1; i < staffRows.length; i++) {
      const row = staffRows[i];
      if (!row[0]) continue;
      const name = hrName_(row[0]).toUpperCase();
      const empNo = String(row[24] || '').trim().toUpperCase();
      const dept = String(row[26] || '').trim().toUpperCase();
      const jobTitle = String(row[28] || '').trim().toUpperCase();
      const email = String(row[34] || '').trim().toUpperCase();
      if (name.includes(qUpper) || empNo.includes(qUpper) || (qUpper.length >= 3 && (dept.includes(qUpper) || jobTitle.includes(qUpper) || email.includes(qUpper)))) {
        matchedRow = row;
        break;
      }
    }
  }

  // If no target specified in query, default to actor
  if (!matchedRow && !query && !rawIc) {
    matchedRow = staffRows.slice(1).find(r => hrName_(r[0]) === hrName_(actor.name));
  }

  if (!matchedRow) {
    return jsonResponse({ status: 'error', message: 'Employee not found.' });
  }

  const targetName = hrName_(matchedRow[0]);

  // Authorization check:
  // Admin/HR -> can query any staff
  // HOD -> can query subordinates (via hrTeam_) or self
  // Staff/User -> can only query self
  const isAdmin = hrAdmin_(actor);
  const isSelf = hrName_(actor.name) === targetName;
  const isSubordinate = hrTeam_(actor, targetName);

  if (!isAdmin && !isSelf && !isSubordinate) {
    return jsonResponse({ status: 'error', message: 'Unauthorized. Access denied to employee dossier.' });
  }

  // 1. Profile Details
  let parsedRestDays = [];
  try { parsedRestDays = matchedRow[23] ? JSON.parse(matchedRow[23]) : []; } catch(e) {}

  const companies = hrRows_('companies');
  const departments = hrRows_('departments');
  const jobGrades = hrRows_('jobGrades');
  const jobTitles = hrRows_('jobTitles');

  const compId = matchedRow[25] || '';
  const deptId = matchedRow[26] || '';
  const gradeId = matchedRow[33] || '';
  const titleId = matchedRow[32] || '';

  const compObj = companies.find(c => c.id === compId);
  const deptObj = departments.find(d => d.id === deptId);
  const gradeObj = jobGrades.find(g => g.id === gradeId);
  const titleObj = jobTitles.find(t => t.id === titleId);

  // Tenure calculation
  let tenureString = 'N/A';
  let serviceYears = 0;
  if (matchedRow[39] !== undefined && matchedRow[39] !== '' && !isNaN(Number(matchedRow[39]))) {
    const rawNum = Number(matchedRow[39]);
    serviceYears = Math.round(rawNum * 100) / 100;
    const formattedYears = rawNum % 1 === 0 ? String(rawNum) : rawNum.toFixed(2);
    tenureString = `${formattedYears} year${rawNum === 1 ? '' : 's'}`;
  } else if (matchedRow[12]) {
    const joined = new Date(matchedRow[12]);
    if (!isNaN(joined.getTime())) {
      const now = new Date();
      let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
      if (now.getDate() < joined.getDate()) months--;
      months = Math.max(0, months);
      const y = Math.floor(months / 12);
      const m = months % 12;
      serviceYears = y;
      if (y > 0 && m > 0) tenureString = `${y} yr${y > 1 ? 's' : ''} ${m} mo`;
      else if (y > 0) tenureString = `${y} year${y > 1 ? 's' : ''}`;
      else tenureString = `${m} month${m === 1 ? '' : 's'}`;
    }
  }

  const profile = {
    name: targetName,
    status: matchedRow[1] || 'Active',
    username: matchedRow[2] || '',
    role: hrRole_(matchedRow[4]),
    basic: parseFloat(matchedRow[5]) || 0,
    hourly: parseFloat(matchedRow[6]) || 0,
    gender: matchedRow[7] || 'Male',
    icNo: matchedRow[8] || '',
    contactNo: matchedRow[9] || '',
    address: matchedRow[10] || '',
    emergency: matchedRow[11] || '',
    joinedDate: matchedRow[12] || '',
    confirmDate: matchedRow[13] || '',
    resignDate: matchedRow[14] || '',
    salaryHistory: matchedRow[15] || '',
    attachment: matchedRow[16] || '',
    socsoNo: matchedRow[17] || '',
    epfNo: matchedRow[18] || '',
    taxNo: matchedRow[19] || '',
    bankNo: matchedRow[20] || '',
    alEntitlement: parseFloat(matchedRow[21]) || 0,
    mcEntitlement: parseFloat(matchedRow[22]) || 0,
    employeeNo: matchedRow[24] || '',
    companyId: compId,
    companyName: compObj ? (compObj.title || compObj.name || compObj.code) : (matchedRow[40] || ''),
    departmentId: deptId,
    departmentName: deptObj ? (deptObj.title || deptObj.name) : '',
    manager: hrName_(matchedRow[27]),
    jobTitle: matchedRow[28] || (titleObj ? titleObj.title : ''),
    jobTitleId: titleId,
    gradeId: gradeId,
    gradeCode: gradeObj ? String(gradeObj.code).toUpperCase() : '',
    gradeTitle: gradeObj ? gradeObj.title : '',
    location: matchedRow[29] || '',
    version: Number(matchedRow[30]) || 1,
    assignedResources: matchedRow[31] || '',
    email: matchedRow[34] || '',
    race: matchedRow[35] || '',
    academicLevel: matchedRow[37] || '',
    workBase: matchedRow[38] || '',
    serviceYears: serviceYears,
    tenure: tenureString,
    photo: matchedRow[45] || '',
    photoUrl: matchedRow[45] || '',
    restDays: parsedRestDays
  };

  if (!isAdmin && !isSelf) {
    profile.basic = 0;
    profile.hourly = 0;
    profile.salaryHistory = '';
    profile.bankNo = '';
    profile.taxNo = '';
    profile.epfNo = '';
    profile.socsoNo = '';
  }

  // 2. Leaves Aggregation
  let leaveHistory = [];
  const leaveSheet = ss.getSheetByName('Leave');
  if (leaveSheet) {
    const rawLeave = readSheet_(leaveSheet, false);
    for (let i = 1; i < rawLeave.length; i++) {
      const l = rawLeave[i];
      if (!l[0] && !l[1]) continue;
      if (hrName_(l[1]) === targetName) {
        leaveHistory.push({
          id: l[0],
          name: l[1],
          type: l[2],
          start: l[3],
          end: l[4],
          days: Number(l[5]) || 0,
          reason: l[6] || '',
          attachment: l[7] || '',
          status: l[8] || '',
          date: l[9] || '',
          decision: l[10] || '',
          decisionRemark: l[11] || '',
          annualDays: l[12] != null && l[12] !== '' ? Number(l[12]) : (l[2] === 'AL' ? Number(l[5]) : 0),
          unpaidDays: l[13] != null && l[13] !== '' ? Number(l[13]) : (l[2] === 'NPL' ? Number(l[5]) : 0),
          nplTag: l[14] || ''
        });
      }
    }
  }

  let leaveSummary = { alBalance: 0, mcBalance: 0, leaveBalances: [], leaveEvents: [] };
  try {
    leaveSummary = hrLeaveSummary_(targetName, { alEntitlement: profile.alEntitlement, mcEntitlement: profile.mcEntitlement });
  } catch(e) {}

  const openingBalances = hrRows_('leaveOpeningBalances').filter(r => hrName_(r.employee) === targetName);

  const leaves = {
    history: leaveHistory,
    applications: leaveHistory,
    balances: leaveSummary.leaveBalances || [],
    leaveEvents: leaveSummary.leaveEvents || [],
    openingBalances: openingBalances,
    alBalance: leaveSummary.alBalance,
    mcBalance: leaveSummary.mcBalance,
    alEntitlement: profile.alEntitlement,
    mcEntitlement: profile.mcEntitlement
  };

  // 3. Claims Aggregation
  const allClaims = hrRows_('claims').filter(r => hrName_(r.employee) === targetName);
  allClaims.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  // Flexi-Wellness Utilisation calculation
  const curYear = new Date().getFullYear();
  let policy = { flexi: { S: 1500, M: 1000, E: 600, C: 600, W: 600 }, checkup: { S: 800, M: 500 } };
  try {
    policy = hrInductionPolicy_();
  } catch(e) {}

  const gradeCode = profile.gradeCode || 'M';
  const flexiCap = (policy.flexi && policy.flexi[gradeCode]) || 0;
  const checkupCap = (policy.checkup && policy.checkup[gradeCode]) || 0;

  const validStatuses = ['Pending manager', 'Pending admin', 'Approved', 'Paid'];
  const curYearClaims = allClaims.filter(c => String(c.date || '').slice(0, 4) === String(curYear) && validStatuses.indexOf(c.status) !== -1);
  const flexiSpent = curYearClaims
    .filter(c => {
      const cat = typeof hrInductionCategory_ === 'function' ? hrInductionCategory_(c.category) : c.category;
      return ['Medical', 'Dental', 'Optical'].indexOf(cat) !== -1;
    })
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const checkupSpent = curYearClaims
    .filter(c => {
      const cat = typeof hrInductionCategory_ === 'function' ? hrInductionCategory_(c.category) : c.category;
      return cat === 'Medical Check-up';
    })
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  const claims = {
    history: allClaims,
    records: allClaims,
    utilisation: {
      year: curYear,
      gradeCode: gradeCode,
      flexiCap: flexiCap,
      flexiSpent: Number(flexiSpent.toFixed(2)),
      flexiRemaining: Number(Math.max(0, flexiCap - flexiSpent).toFixed(2)),
      checkupCap: checkupCap,
      checkupSpent: Number(checkupSpent.toFixed(2)),
      checkupRemaining: Number(Math.max(0, checkupCap - checkupSpent).toFixed(2))
    }
  };

  // 4. Payroll History Aggregation
  let payrollRecords = [];
  if (isAdmin || isSelf) {
    hrAssert_(!payrollPendingOperation_(), 'Payroll recovery is in progress. Ask HR to retry the incomplete approval.');
    const payrollSheet = ss.getSheetByName('Payroll');
    if (payrollSheet) {
      const rawPayroll = readSheet_(payrollSheet, true);
      for (let i = 1; i < rawPayroll.length; i++) {
        const p = rawPayroll[i];
        if (!p[0]) continue;
        if (hrName_(p[2]) === targetName || (profile.employeeNo && p[1] === profile.employeeNo)) {
          payrollRecords.push({
            month: p[0],
            id: p[1],
            name: p[2],
            basic: parseFloat(p[3]) || 0,
            workedDays: p[4] || 0,
            otPay: parseFloat(p[5]) || 0,
            gross: parseFloat(p[6]) || 0,
            epfEmp: parseFloat(p[7]) || 0,
            socsoEmp: parseFloat(p[8]) || 0,
            eisEmp: parseFloat(p[9]) || 0,
            totalEmpDed: parseFloat(p[10]) || 0,
            epfEmpr: parseFloat(p[11]) || 0,
            socsoEmpr: parseFloat(p[12]) || 0,
            eisEmpr: parseFloat(p[13]) || 0,
            totalEmprCont: parseFloat(p[14]) || 0,
            nettPay: parseFloat(p[15]) || 0,
            pcb: parseFloat(p[16]) || 0,
            nplDeduction: parseFloat(p[17]) || 0,
            claims: parseFloat(p[18]) || 0,
            zeroMcAward: parseFloat(p[19]) || 0
          });
        }
      }
      payrollRecords.sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
    }
  }

  const payroll = {
    history: payrollRecords,
    records: payrollRecords,
    latest: payrollRecords[0] || null
  };

  // 5. Assets / Equipment Aggregation
  const resourceCatalog = hrRows_('resources');
  const assignments = hrRows_('resourceAssignments').filter(r => hrName_(r.employee) === targetName);
  const assetItems = assignments.map(a => {
    const res = resourceCatalog.find(r => r.id === a.resourceId);
    return {
      id: a.id,
      assignmentId: a.id,
      resourceId: a.resourceId,
      employee: a.employee,
      date: a.date,
      condition: a.condition || '',
      notes: a.notes || '',
      status: a.status || 'Assigned',
      returnedAt: a.returnedAt || '',
      returnNotes: a.returnNotes || '',
      code: res ? res.code : '',
      title: res ? res.title : '',
      resourceTitle: res ? res.title : '',
      category: res ? res.category : '',
      location: res ? res.location : '',
      assetValue: res ? (Number(res.assetValue) || 0) : 0
    };
  });
  assetItems.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const assets = {
    records: assetItems,
    assignments: assetItems,
    activeCount: assetItems.filter(a => a.status === 'Assigned').length
  };

  // 6. HR Letters Aggregation
  let lettersList = hrRows_('letters').filter(r => hrName_(r.employee) === targetName);
  if (!isAdmin && !isSubordinate) {
    // Regular staff can only see Issued letters
    lettersList = lettersList.filter(l => l.status === 'Issued');
  }
  lettersList.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const letters = {
    records: lettersList,
    history: lettersList
  };

  // 7. Attendance Verification Photos Aggregation
  const mobileClockEvents = (typeof hrRows_ === 'function' ? hrRows_('mobileClockEvent') : []).filter(r => hrName_(r.employee) === targetName || (profile.employeeNo && String(r.employeeNo) === String(profile.employeeNo)));
  const staffDocs = (typeof hrRows_ === 'function' ? hrRows_('staffDocuments') : []).filter(r => hrName_(r.employee) === targetName);
  const photoDocs = staffDocs.filter(d => d.category === 'Attendance Photo' || (d.title && String(d.title).includes('Attendance Selfie')));
  
  const photosMap = {};
  mobileClockEvents.forEach(e => {
    if (e.photo) {
      photosMap[e.id] = {
        id: e.id,
        punchId: e.id,
        punchType: e.type,
        type: e.type,
        serverTime: e.serverTime,
        date: e.date || (e.serverTime ? e.serverTime.slice(0, 10) : ''),
        url: e.photo,
        photo: e.photo,
        mode: e.mode || '',
        location: { latitude: e.latitude, longitude: e.longitude, accuracyM: e.accuracyM },
        title: 'Attendance Selfie (' + (e.type || 'PUNCH') + ') · ' + (e.date || '')
      };
    }
  });
  photoDocs.forEach(d => {
    if (d.url && (!d.punchId || !photosMap[d.punchId])) {
      const id = d.punchId || d.id;
      photosMap[id] = {
        id: d.id,
        punchId: d.punchId || d.id,
        punchType: d.punchType || 'IN',
        type: d.punchType || 'IN',
        serverTime: d.punchTime || d.updatedAt || d.date,
        date: d.date || '',
        url: d.url,
        photo: d.url,
        mode: d.mode || 'GEOFENCED',
        location: d.location || null,
        title: d.title || 'Attendance Selfie'
      };
    }
  });
  const attendancePhotos = Object.values(photosMap).sort((a, b) => String(b.serverTime || b.date || '').localeCompare(String(a.serverTime || a.date || '')));

  return jsonResponse({
    status: 'success',
    data: {
      employee: targetName,
      profile,
      leaves,
      claims,
      payroll,
      assets,
      letters,
      attendancePhotos
    }
  });
}

// --- ATTENDANCE APPROVAL & NOTIFICATION ACTION COUNT ---
function getAttendanceApproval(payload, actor) {
  hrAssert_(actor && hrManager_(actor), 'Manager or Administrator access required.');
  const admin = hrAdmin_(actor);
  const profiles = hrProfiles_();
  const visibleNames = {};
  profiles.filter(p => admin || p.employee === hrName_(actor.name) || p.manager === hrName_(actor.name)).forEach(p => visibleNames[p.employee] = true);
  const visible = row => !!visibleNames[hrName_(row.name || row.employee)];
  const approvalKey = payload && payload.company && payload.company !== 'ALL' ? (payload.month || payload.monthYear) + '__' + payrollCompanyScope_(payload.company).id : payload && (payload.month || payload.monthYear);
  const ss = getSpreadsheet_();
  const lockedSheet = ss.getSheetByName('LockedMonths');
  const month = payload && (payload.month || payload.monthYear);
  
  const records = {};
  if (lockedSheet) {
    const data = readSheet_(lockedSheet, true);
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][1]) {
        try {
          const parsed = JSON.parse(data[i][1]);
          const company = String(parsed.company || '').trim();
          if(!admin && company && company !== 'ALL' && !profiles.some(p => visibleNames[p.employee] && p.companyId === company)) continue;
          const safe = {};
          ['month','company','approvalStatus','status','hodApprover','hodApprovedAt','hrApprover','hrApprovedAt','savedAt','hodComments','hrComments','rejectedBy','rejectedAt','rejectionReason'].forEach(k => { if(parsed[k] !== undefined)safe[k]=parsed[k]; });
          if(admin) {
            safe.rates = {};
            Object.keys(parsed.rates || {}).forEach(key => { const rate=parsed.rates[key] || {}; safe.rates[key]={basic:rate.basic, restDays:rate.restDays}; });
          }
          records[data[i][0]] = safe;
        } catch (e) {}
      }
    }
  }

  if (payload && payload.includeData) {
    const allStaff = JSON.parse(getStaff().getContent()).data || {};
    const staffRes = {};
    const publicFields = ['name','status','role','employeeNo','companyId','companyName','departmentId','manager','jobTitle','jobTitleId','gradeId','location','workBase','biometricId','joinedDate','confirmDate','resignDate','schedule','schedules','restDays','alEntitlement','mcEntitlement'];
    const payrollFields = ['basic','hourly','gender','icNo','socsoNo','epfNo','taxNo','bankNo','ageSource'];
    Object.keys(allStaff).filter(name => visibleNames[hrName_(name)]).forEach(name => {
      staffRes[name] = {};
      publicFields.concat(admin ? payrollFields : []).forEach(key => { if(allStaff[name][key] !== undefined)staffRes[name][key] = allStaff[name][key]; });
    });
    const holidayRes = JSON.parse(getHolidays().getContent()).data || [];
    const dataRes = JSON.parse(getData().getContent()).data || [];
    const attRes = JSON.parse(getAttendance().getContent()).data || [];
    const leaveRes = JSON.parse(getLeaveData({ role: 'Admin' }).getContent()).data || [];
    const schedules = hrRows_('workSchedules');
    return jsonResponse({
      status: 'success',
      data: {
        staff: staffRes,
        holidays: holidayRes,
        data: dataRes.filter(visible),
        attendance: hrAttendanceResponse_(attRes, actor),
        lockedMonths: records,
        leaves: leaveRes.filter(visible),
        workSchedules: schedules,
        currentApproval: month ? (records[approvalKey] || { month, approvalStatus: 'Draft' }) : null
      }
    });
  }

  if (month) {
    const rec = records[approvalKey] || {
      month: month,
      approvalStatus: 'Draft',
      status: 'Draft',
      hodApprover: '',
      hodApprovedAt: '',
      hrApprover: '',
      hrApprovedAt: ''
    };
    return jsonResponse({ status: 'success', data: rec });
  }

  return jsonResponse({ status: 'success', data: records });
}

function approveAttendanceHOD(payload, actor) {
  hrAssert_(actor, 'Sign in required.');
  const role = hrRole_(actor.role);
  hrAssert_(['Admin', 'HR', 'HOD', 'Supervisor'].indexOf(role) !== -1, 'Only HOD, HR or Admin can recommend/approve attendance at HOD stage.');
  const month = payload.month;
  hrAssert_(month && /^\d{4}-\d{2}$/.test(month), 'Valid month (YYYY-MM) is required.');
  const companyId = payrollCompanyScope_(payload.company).id;
  const monthKey = companyId ? payload.month + '__' + companyId : payload.month;

  const ss = getSpreadsheet_();
  let lockedSheet = ss.getSheetByName('LockedMonths');
  if (!lockedSheet) {
    lockedSheet = ss.insertSheet('LockedMonths');
    lockedSheet.appendRow(['Month', 'Data JSON']);
  }

  const rows = lockedSheet.getDataRange().getValues();
  let rowIndex = -1;
  let existingData = { rates: {}, savedAt: new Date().toISOString() };

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(monthKey)) {
      rowIndex = i + 1;
      try {
        existingData = JSON.parse(rows[i][1]);
      } catch (e) {}
      break;
    }
  }

  if (existingData.approvalStatus === 'Locked' || existingData.status === 'Locked') {
    return jsonResponse({ status: 'error', message: 'Month is already approved and locked for payroll.' });
  }

  existingData.month = month;
  existingData.company = companyId || 'ALL';
  existingData.approvalStatus = 'Pending HR';
  existingData.status = 'Pending HR';
  existingData.hodApprover = actor.name;
  existingData.hodApprovedAt = new Date().toISOString();
  existingData.hodComments = payload.comments || '';
  if (payload.rates) existingData.rates = payload.rates;

  const jsonStr = JSON.stringify(existingData);
  if (rowIndex > 0) {
    lockedSheet.getRange(rowIndex, 2).setValue(jsonStr);
  } else {
    lockedSheet.appendRow([monthKey, jsonStr]);
  }

  hrAudit_(actor, 'attendance', { id: 'ATT-' + monthKey, month: month, company: payload.company || '', status: 'Pending HR' }, 'HOD attendance approval recommendation');

  return jsonResponse({
    status: 'success',
    message: 'Attendance recommended by HOD. Forwarded to HR for final approval & autolock.',
    data: existingData
  });
}

function rejectAttendanceApproval(payload, actor) {
  hrAssert_(actor, 'Sign in required.');
  const role = hrRole_(actor.role);
  hrAssert_(['Admin', 'HR', 'HOD', 'Supervisor'].indexOf(role) !== -1, 'Permission denied.');
  const month = payload.month;
  hrAssert_(month && /^\d{4}-\d{2}$/.test(month), 'Valid month (YYYY-MM) is required.');
  const companyId = payrollCompanyScope_(payload.company).id;
  const monthKey = companyId ? payload.month + '__' + companyId : payload.month;

  const ss = getSpreadsheet_();
  let lockedSheet = ss.getSheetByName('LockedMonths');
  if (!lockedSheet) {
    lockedSheet = ss.insertSheet('LockedMonths');
    lockedSheet.appendRow(['Month', 'Data JSON']);
  }

  const rows = lockedSheet.getDataRange().getValues();
  let rowIndex = -1;
  let existingData = { rates: {}, month: month };

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(monthKey)) {
      rowIndex = i + 1;
      try {
        existingData = JSON.parse(rows[i][1]);
      } catch (e) {}
      break;
    }
  }

  existingData.month = month;
  existingData.company = companyId || 'ALL';
  existingData.approvalStatus = 'Rejected';
  existingData.status = 'Rejected';
  existingData.rejectedBy = actor.name;
  existingData.rejectedAt = new Date().toISOString();
  existingData.rejectionReason = payload.reason || payload.comments || '';

  const jsonStr = JSON.stringify(existingData);
  if (rowIndex > 0) {
    lockedSheet.getRange(rowIndex, 2).setValue(jsonStr);
  } else {
    lockedSheet.appendRow([monthKey, jsonStr]);
  }

  hrAudit_(actor, 'attendance', { id: 'ATT-' + monthKey, month: month, company: payload.company || '', status: 'Rejected' }, 'Attendance rejected: ' + (payload.reason || 'No reason provided'));

  return jsonResponse({
    status: 'success',
    message: 'Attendance rejected and sent back to Draft.',
    data: existingData
  });
}

function getActionCount(payload, actor) {
  let user = actor;
  if (!user && payload && (payload.staffName || payload.name || payload.username)) {
    const target = hrName_(payload.staffName || payload.name || payload.username);
    const directory = hrDirectory_();
    user = directory.find(d => d.name === target) || { name: target, role: 'Staff' };
  }
  if (!user) {
    user = { name: 'GUEST', role: 'Staff' };
  }

  const role = hrRole_(user.role);
  const isAdminOrHr = ['Admin', 'HR'].indexOf(role) !== -1;
  const isHod = ['HOD', 'Supervisor'].indexOf(role) !== -1;
  const userName = hrName_(user.name);

  let pendingLeaves = 0;
  let pendingClaims = 0;
  let pendingAttendance = 0;
  let pendingOther = 0;
  const recentPendingItems = [];

  // 1. Pending Leaves
  const leaveSheet = getSpreadsheet_().getSheetByName('Leave');
  if (leaveSheet) {
    const leaveData = readSheet_(leaveSheet, false);
    for (let i = 1; i < leaveData.length; i++) {
      const row = leaveData[i];
      if (!row[0]) continue;
      const status = String(row[8] || '').trim();
      const applicant = hrName_(row[1]);

      if (isAdminOrHr) {
        if (status === 'pending_admin' || status === 'Pending' || status === 'Withdrawal Requested' || status === 'withdrawal_pending_hr') {
          pendingLeaves++;
          recentPendingItems.push({
            type: 'leave',
            title: `Leave: ${row[2]} (${row[5]}d)`,
            employee: applicant,
            status: status
          });
        }
      } else if (isHod) {
        if (status === 'pending_hod' || status === 'Withdrawal Requested' || status === 'withdrawal_pending_hod') {
          const profile = hrProfiles_().find(p => p.employee === applicant);
          if (profile && (hrName_(profile.manager) === userName || hrTeam_(user, applicant))) {
            pendingLeaves++;
            recentPendingItems.push({
              type: 'leave',
              title: `Leave: ${row[2]} (${row[5]}d)`,
              employee: applicant,
              status: status
            });
          }
        }
      }
    }
  }

  // 2. Pending Claims
  const claimsSheet = hrSheet_('claims', false);
  if (claimsSheet) {
    const claimRows = hrRows_('claims');
    for (let i = 0; i < claimRows.length; i++) {
      const c = claimRows[i];
      if (isAdminOrHr) {
        if (c.status === 'Pending admin') {
          pendingClaims++;
          recentPendingItems.push({
            type: 'claim',
            title: `Claim: RM ${Number(c.amount || 0).toFixed(2)}`,
            employee: c.employee,
            status: c.status
          });
        }
      } else if (isHod) {
        if (c.status === 'Pending manager' && (hrName_(c.manager) === userName || hrTeam_(user, c.employee))) {
          pendingClaims++;
          recentPendingItems.push({
            type: 'claim',
            title: `Claim: RM ${Number(c.amount || 0).toFixed(2)}`,
            employee: c.employee,
            status: c.status
          });
        }
      }
    }
  }

  // 3. Pending Attendance Approvals
  const pendingAttendanceList = [];
  const lockedSheet = getSpreadsheet_().getSheetByName('LockedMonths');
  if (lockedSheet) {
    const lockedData = readSheet_(lockedSheet, true);
    for (let i = 1; i < lockedData.length; i++) {
      if (lockedData[i][0] && lockedData[i][1]) {
        try {
          const rec = JSON.parse(lockedData[i][1]);
          const m = String(lockedData[i][0]).trim();
          if (isAdminOrHr) {
            if (rec.approvalStatus === 'Pending HR' || rec.status === 'Pending HR') {
              pendingAttendance++;
              pendingAttendanceList.push({
                id: 'ATT-' + m,
                module: 'attendance',
                month: m,
                title: 'Attendance Approval · ' + m,
                employee: 'All Staff (' + m + ')',
                status: rec.approvalStatus || rec.status || 'Pending HR',
                isAttendance: true
              });
            }
          } else if (isHod) {
            if (rec.approvalStatus === 'Draft' || rec.approvalStatus === 'Rejected') {
              pendingAttendance++;
              pendingAttendanceList.push({
                id: 'ATT-' + m,
                module: 'attendance',
                month: m,
                title: 'Attendance Recommendation · ' + m,
                employee: 'All Staff (' + m + ')',
                status: rec.approvalStatus || 'Draft',
                isAttendance: true
              });
            }
          }
        } catch (e) {}
      }
    }
  }

  // 4. Pending Bookings / Loans (Other)
  const bookings = hrRows_('bookings');
  const loans = hrRows_('loans');
  if (isAdminOrHr) {
    bookings.filter(b => b.status === 'Pending admin').forEach(b => {
      pendingOther++;
      recentPendingItems.push({
        type: 'booking',
        title: `Resource: ${b.title || b.resourceId || 'Item'}`,
        employee: b.employee,
        status: b.status
      });
    });
    loans.filter(l => l.status === 'Pending admin').forEach(l => {
      pendingOther++;
      recentPendingItems.push({
        type: 'loan',
        title: `Loan: RM ${Number(l.amount || 0).toFixed(2)}`,
        employee: l.employee,
        status: l.status
      });
    });
  } else if (isHod) {
    bookings.filter(b => /pending/i.test(b.status) && (b.status === 'Pending manager' || b.status === 'Pending') && (hrName_(b.manager) === userName || hrTeam_(user, b.employee))).forEach(b => {
      pendingOther++;
      recentPendingItems.push({
        type: 'booking',
        title: `Resource: ${b.title || b.resourceId || 'Item'}`,
        employee: b.employee,
        status: b.status
      });
    });
    loans.filter(l => /pending/i.test(l.status) && (l.status === 'Pending manager' || l.status === 'Pending') && (hrName_(l.manager) === userName || hrTeam_(user, l.employee))).forEach(l => {
      pendingOther++;
      recentPendingItems.push({
        type: 'loan',
        title: `Loan: RM ${Number(l.amount || 0).toFixed(2)}`,
        employee: l.employee,
        status: l.status
      });
    });
  }

  const total = pendingLeaves + pendingClaims + pendingAttendance + pendingOther;

  return jsonResponse({
    status: 'success',
    data: {
      total,
      pendingLeaves,
      pendingClaims,
      pendingAttendance,
      pendingOther,
      pendingAttendanceList,
      recentPendingItems,
      role: role,
      user: userName
    }
  });
}

/* Mobile GPS clock-in extension for the consolidated GAS_payroll.js.
   Geolocation is captured only on staff-initiated punch, never continuously.
   Separate HR_ sheets protect legacy biometric / payroll structures.
   No automatic payroll/attendance merge: requires controlled HR reconciliation.
 */
const MOBILE_CLOCK_MODES_ = ['OFF','GEOFENCED','ANYWHERE'];
const MOBILE_CLOCK_MAX_ACCURACY_M_ = 100;
const MOBILE_CLOCK_MAX_LOCATION_AGE_MS_ = 90000;

const DEFAULT_CLOCK_LOCATIONS = [
  'ARCHITECT OFFICE',
  'BANK',
  'CLIENT/DEV OFFICE',
  'COUNCIL OFFICE',
  'CS ENGINEER OFFICE',
  'HARDWARE SHOP',
  'IWK OFFICE',
  'KWSP/SOCSO/INCOME TAX',
  'LAND OFFICE',
  'ME ENGINEER OFFICE',
  'OTHERS',
  'SITE',
  'TNB OFFICE',
  'VEHICLE MAINTENANCE'
];

function getClockLocationsData_() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('HR_clockLocations');
    if (!sheet) return DEFAULT_CLOCK_LOCATIONS.slice();
    const rows = readSheet_(sheet, false);
    if (!rows || rows.length <= 1) return DEFAULT_CLOCK_LOCATIONS.slice();
    const list = [];
    for (let i = 1; i < rows.length; i++) {
      const val = String(rows[i][0] || rows[i][4] || '').trim();
      if (val && !list.includes(val)) list.push(val);
    }
    return list.length ? list : DEFAULT_CLOCK_LOCATIONS.slice();
  } catch (_) {
    return DEFAULT_CLOCK_LOCATIONS.slice();
  }
}

function saveClockLocations_(payload, actor) {
  hrAssert_(actor && hrAdmin_(actor), 'Only HR administrators or Admin can save clock-in locations.');
  const list = Array.isArray(payload.locations) ? payload.locations.map(s => String(s || '').trim()).filter(Boolean) : [];
  hrAssert_(list.length > 0, 'Location list cannot be empty.');
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('HR_clockLocations');
  if (!sheet) {
    sheet = ss.insertSheet('HR_clockLocations');
    sheet.appendRow(['Location', 'Updated At', 'Updated By']);
    sheet.setFrozenRows(1);
  } else {
    sheet.clearContents();
    sheet.appendRow(['Location', 'Updated At', 'Updated By']);
  }
  const nowStr = new Date().toISOString();
  list.forEach(loc => {
    sheet.appendRow([loc, nowStr, actor.name]);
  });
  return jsonResponse({ status: 'success', data: { locations: list } });
}

function mobileClockTarget_(actor, name) {
  const targetName = hrName_(name || actor.name);
  hrAssert_(hrAdmin_(actor) || targetName === actor.name,'Not authorized to view this employee.');
  const target = hrStaffTarget_(targetName);
  hrAssert_(target.row[1] !== 'Resigned','Employee is inactive.');
  return {name:targetName, employeeNo:String(target.row[24] || targetName), companyId:String(target.row[25] || '')};
}
function mobileClockPolicy_(employeeNo) {
  return hrRows_('mobileClockPolicy').find(r => String(r.id) === String(employeeNo)) || null;
}
function mobileClockSites_() { return hrRows_('mobileClockSite'); }
function mobileClockPublic_(record) { return record ? hrPublic_(record) : null; }
// Personal read model only: saved corrections win over raw biometric imports
// for the same date. Identity conflicts fail closed rather than trusting a name
// or ID copied onto another employee's record.
function mobileClockAttendance_(target) {
  const profiles=hrProfiles_(), own=profiles.find(p => p.employee===target.name);
  const ownIds=new Set([target.employeeNo,own && own.biometricId].filter(Boolean).map(hrName_));
  const others=profiles.filter(p => p.employee!==target.name);
  const otherNames=new Set(others.map(p => p.employee));
  const otherIds=new Set(others.reduce((ids,p) => ids.concat([p.employeeNo,p.biometricId].filter(Boolean).map(hrName_)),[]));
  const owns=row => {
    const id=hrName_(row[0]),name=hrName_(row[1]);
    if((name && otherNames.has(name)) || (id && otherIds.has(id)))return false;
    return name===target.name || (!!id && ownIds.has(id));
  };
  const ss=getSpreadsheet_(), savedDates={}, attendance=[];
  ['Attendance','Data'].forEach(source => {
    const sheet=ss.getSheetByName(source);if(!sheet)return;
    readSheet_(sheet,true).slice(1).forEach(row => {
      if(!owns(row))return;
      const date=hrInductionDate_(row[2]);
      if(!date || (source==='Data' && savedDates[date]))return;
      if(source==='Attendance')savedDates[date]=true;
      attendance.push({id:target.employeeNo,name:target.name,date:date,Date:date,
        in:row[4] || '',out:row[5] || '',In:row[4] || '',Out:row[5] || '',
        ClockIn:row[4] || '',ClockOut:row[5] || '',totalHrs:row[6] || '',
        shift:source==='Attendance'?(row[7]||''):'',
        remark:source==='Attendance'?(row[13]||''):'',
        source:source==='Attendance'?'attendance':'biometric'});
    });
  });
  return attendance;
}
function mobileClockConfig_(payload,actor) {
  const target=mobileClockTarget_(actor,payload && payload.employee);
  const stored=mobileClockPolicy_(target.employeeNo);
  const policy=stored?mobileClockPublic_(stored):{id:target.employeeNo,employee:target.name,mode:'OFF',siteId:'',status:'Disabled',version:0};
  const allSites=mobileClockSites_();
  const assigned=policy.siteId?allSites.find(s=>s.id===policy.siteId&&s.active!==false):null;
  const sites=hrAdmin_(actor)?allSites.map(mobileClockPublic_):(assigned?[mobileClockPublic_(assigned)]:[]);
  const locations=getClockLocationsData_();
  const events=hrRows_('mobileClockEvent').filter(r=>r.employeeNo===target.employeeNo)
    .slice(-40).reverse().map(r=>({
      id:r.id,type:r.type,serverTime:r.serverTime,date:r.date,siteId:r.siteId,
      status:r.status||'Recorded',
      location:{latitude:r.latitude,longitude:r.longitude,accuracyM:r.accuracyM},
      distanceM:r.distanceM,mode:r.mode,photo:r.photolink||'',photolink:r.photolink||'',
      address:r.address||r.locationAddress||'',locationAddress:r.address||r.locationAddress||'',
      checkInLocation:r.checkInLocation||r.locationCategory||'',locationCategory:r.checkInLocation||r.locationCategory||'',
      remark:r.remark||''
    }));
  const lockedSheet = getSpreadsheet_().getSheetByName('LockedMonths');
  const lockedMonthsList = [];
  if (lockedSheet) {
    const lData = readSheet_(lockedSheet, true);
    for (let i = 1; i < lData.length; i++) {
      if (lData[i][0] && lData[i][1]) {
        try {
          const rec = JSON.parse(lData[i][1]);
          if (rec.approvalStatus === 'Locked' || rec.status === 'Locked') {
            lockedMonthsList.push(String(lData[i][0]).trim());
          }
        } catch (_) {}
      }
    }
  }
  return jsonResponse({status:'success',data:{employee:target.name,employeeNo:target.employeeNo,policy,sites,locations,events,attendance:mobileClockAttendance_(target),lockedMonths:lockedMonthsList,maxAccuracyM:MOBILE_CLOCK_MAX_ACCURACY_M_}});
}

function saveStaffAttendanceRemark(payload, actor) {
  hrAssert_(actor && actor.name, 'Sign in required.');
  const date = hrInductionDate_(payload && payload.date);
  hrAssert_(date && /^\d{4}-\d{2}-\d{2}$/.test(date), 'Valid attendance date (YYYY-MM-DD) is required.');
  const month = date.slice(0, 7);
  const remark = String((payload && payload.remark) || '').trim();

  const ss = getSpreadsheet_();
  const lockedSheet = ss.getSheetByName('LockedMonths');
  if (lockedSheet) {
    const lRows = readSheet_(lockedSheet, true);
    for (let i = 1; i < lRows.length; i++) {
      const mKey = String(lRows[i][0] || '').trim();
      if (mKey === month || mKey.startsWith(month + '__')) {
        try {
          const rec = JSON.parse(lRows[i][1]);
          if (rec.approvalStatus === 'Locked' || rec.status === 'Locked') {
            return jsonResponse({
              status: 'error',
              message: 'Attendance for ' + month + ' has been approved & locked by HR. Remarks can no longer be edited.'
            });
          }
        } catch (_) {}
      }
    }
  }

  const attSheet = ss.getSheetByName('Attendance');
  let updated = false;
  if (attSheet) {
    const data = readSheet_(attSheet, true);
    const targetName = hrName_(actor.name);
    for (let i = 1; i < data.length; i++) {
      const rowName = hrName_(data[i][1]);
      const rowDate = hrInductionDate_(data[i][2]);
      if (rowName === targetName && rowDate === date) {
        attSheet.getRange(i + 1, 14).setValue(remark);
        updated = true;
        break;
      }
    }
    if (!updated) {
      attSheet.appendRow([
        actor.employeeNo || Utilities.getUuid(),
        actor.name,
        date,
        'Full',
        (payload && payload.in) || '',
        (payload && payload.out) || '',
        (payload && payload.totalHrs) || '',
        (payload && payload.shift) || '',
        '',
        '',
        '',
        0,
        0,
        remark,
        ''
      ]);
      updated = true;
    }
  }

  try {
    const mSheet = hrSheet_('mobileClockEvent', false);
    if (mSheet) {
      const mData = readSheet_(mSheet, false);
      const targetName = hrName_(actor.name);
      for (let i = 1; i < mData.length; i++) {
        if (hrName_(mData[i][2]) === targetName) {
          try {
            const evt = JSON.parse(mData[i][4]);
            if (evt.date === date || (evt.serverTime && evt.serverTime.startsWith(date))) {
              evt.remark = remark;
              mSheet.getRange(i + 1, 5).setValue(JSON.stringify(evt));
              if (mData[i].length >= 10) {
                mSheet.getRange(i + 1, 10).setValue(remark);
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}

  SpreadsheetApp.flush();
  return jsonResponse({ status: 'success', message: 'Remark saved successfully.', data: { date: date, remark: remark } });
}
function mobileClockSiteSave_(payload,actor) {
  hrAssert_(hrAdmin_(actor),'Only HR or Superadmin may manage geofences.');
  const name=String(payload.name||'').trim();
  const latitude=Number(payload.latitude),longitude=Number(payload.longitude),radiusM=Number(payload.radiusM);
  hrAssert_(name.length>=3&&name.length<=100,'Enter a site name (3–100 characters).');
  hrAssert_(Number.isFinite(latitude)&&latitude>=-90&&latitude<=90,'Invalid site latitude.');
  hrAssert_(Number.isFinite(longitude)&&longitude>=-180&&longitude<=180,'Invalid site longitude.');
  hrAssert_(Number.isFinite(radiusM)&&radiusM>=50&&radiusM<=5000,'Site radius must be 50–5000 metres.');
  const existing=payload.id?mobileClockSites_().find(r=>r.id===payload.id):null;
  if(payload.id)hrAssert_(!!existing,'Site does not exist.');
  if(existing && payload.version!=null)hrAssert_(existing.version===Number(payload.version),'Site changed. Refresh and try again.');
  const next={id:existing?existing.id:Utilities.getUuid(),name,latitude,longitude,radiusM,
    companyId:String(payload.companyId||'').trim(),active:payload.active!==false};
  return hrWrite_('mobileClockSite',next,actor,existing,existing?'Geofence updated':'Geofence created');
}
function mobileClockPolicySave_(payload,actor) {
  hrAssert_(hrAdmin_(actor),'Only HR or Superadmin can enable staff mobile clock-in.');
  const target=mobileClockTarget_(actor,payload.employee);
  const mode=String(payload.mode||'OFF').toUpperCase();
  hrAssert_(MOBILE_CLOCK_MODES_.indexOf(mode)!==-1,'Invalid mobile clock mode.');
  const existing=mobileClockPolicy_(target.employeeNo);
  if(existing && payload.version!=null)hrAssert_(Number(existing.version)===Number(payload.version),'Policy changed. Refresh and try again.');
  const siteId=mode==='GEOFENCED'?String(payload.siteId||''):'';
  if(mode==='GEOFENCED') {
    const site=mobileClockSites_().find(s=>s.id===siteId&&s.active!==false);
    hrAssert_(!!site,'Choose an active geofence site.');
    hrAssert_(!site.companyId||!target.companyId||site.companyId===target.companyId,'Geofence site belongs to another company.');
  }
  const record={id:target.employeeNo,employee:target.name,employeeNo:target.employeeNo,mode,
    siteId,status:mode==='OFF'?'Disabled':'Enabled',consentNoticeVersion:'2026-10-v1'};
  return hrWrite_('mobileClockPolicy',record,actor,existing,mode==='OFF'?'Disabled mobile clock-in':'Mobile clock-in policy changed');
}
function mobileClockDistanceM_(aLat,aLng,bLat,bLng) {
  const toRad=Math.PI/180;
  const dLat=(bLat-aLat)*toRad,dLng=(bLng-aLng)*toRad;
  const q=Math.sin(dLat/2)**2+Math.cos(aLat*toRad)*Math.cos(bLat*toRad)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}

function mobileClockStaffFolder_(target) {
  if (typeof DriveApp === 'undefined') return null;
  // 1. Try hrEnsureStaffFolder_ if available (standard HR folder flow or test mock)
  try {
    if (typeof hrStaffTarget_ === 'function' && typeof hrEnsureStaffFolder_ === 'function') {
      const st = hrStaffTarget_(target.name);
      if (st) {
        const folder = hrEnsureStaffFolder_(st);
        if (folder) return folder;
      }
    }
  } catch (_) {}

  // 2. Direct Attachment folder lookup / creation under STAFF_FOLDER_PARENT_
  try {
    const parentId = (typeof STAFF_FOLDER_PARENT_ !== 'undefined' && STAFF_FOLDER_PARENT_) ? STAFF_FOLDER_PARENT_ : '1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf';
    let parent = null;
    try {
      parent = DriveApp.getFolderById(parentId);
    } catch (_) {
      parent = null;
    }
    if (!parent) {
      try { parent = DriveApp.getRootFolder(); } catch (_) { parent = null; }
    }
    if (!parent) return null;
    const cleanId = String(target.employeeNo || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    const cleanName = String(target.name || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    const folderName = (cleanId && cleanName) ? (cleanId + '_' + cleanName) : (cleanName || cleanId || 'Staff');
    const matches = parent.getFoldersByName(folderName);
    while (matches.hasNext()) {
      const f = matches.next();
      if (!f.isTrashed()) return f;
    }
    try {
      return parent.createFolder(folderName);
    } catch (_) {
      // Fallback to parent folder directly if subfolder creation is not permitted
      return parent;
    }
  } catch (err) {
    if (typeof Logger !== 'undefined') Logger.log('mobileClockStaffFolder_ error: ' + err);
    try { return DriveApp.getRootFolder(); } catch (_) { return null; }
  }
}

function mobileClockHasBiometricIn_(target, today) {
  // Existing biometric-imported Attendance sheet remains authoritative for its own punches.
  const sheet=getSpreadsheet_().getSheetByName('Attendance');
  if(!sheet) return false;
  const rows=readSheet_(sheet,false);
  const prior=new Date(today+'T00:00:00Z'); prior.setUTCDate(prior.getUTCDate()-1);
  const yesterday=prior.toISOString().slice(0,10);
  for(let i=rows.length-1;i>0;i--){
    const row=rows[i];
    const name=hrName_(row[1]);
    if(name!==target.name)continue;
    const raw=row[2];
    const day=raw instanceof Date?Utilities.formatDate(raw,'Asia/Kuala_Lumpur','yyyy-MM-dd'):String(raw||'').slice(0,10);
    if(day!==today&&day!==yesterday)continue;
    const entry=row[4];
    if(day===yesterday){
      const h=entry instanceof Date ? Number(Utilities.formatDate(entry,'Asia/Kuala_Lumpur','HH')) : Number(String(entry||'').slice(0,2));
      if(!Number.isFinite(h)||h<16)continue; // previous-day evening/night shifts only
    }
    if(entry!=null&&String(entry).trim()&&String(entry).trim()!=='—'&&String(entry).trim()!=='-')return true;
  }
  return false;
}

function mobileClockPunch_(payload,actor) {
  const target=mobileClockTarget_(actor,actor.name);
  const policy=mobileClockPolicy_(target.employeeNo);
  hrAssert_(policy&&policy.mode!=='OFF'&&MOBILE_CLOCK_MODES_.indexOf(policy.mode)!==-1,'Mobile clock-in is not enabled for your profile. Contact HR.');
  const kind=String(payload.type||'').toUpperCase();
  hrAssert_(kind==='IN'||kind==='OUT','Choose clock in or clock out.');
  const requestId=String(payload.requestId||'');
  hrAssert_(/^[a-zA-Z0-9-]{12,90}$/.test(requestId),'Invalid request reference.');
  // Idempotent retry must work even when the original GPS sample has expired.
  const existing=hrRows_('mobileClockEvent').filter(r=>r.employeeNo===target.employeeNo);
  const duplicate=existing.find(r=>r.id===requestId);
  if(duplicate){
    hrAssert_(!!duplicate.photolink,'Previous punch was recorded without a verified Drive photo. Contact HR to reconcile it; do not create a duplicate punch.');
    return jsonResponse({status:'success',data:mobileClockPublic_(duplicate),duplicate:true});
  }
  const latitude=Number(payload.latitude),longitude=Number(payload.longitude),accuracyM=Number(payload.accuracyM);
  hrAssert_(payload.latitude!==null&&payload.latitude!==''&&payload.longitude!==null&&payload.longitude!==''&&payload.accuracyM!==null&&payload.accuracyM!=='','A real GPS reading is required.');
  hrAssert_(Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180,'Valid GPS coordinates are required.');
  hrAssert_(Number.isFinite(accuracyM)&&accuracyM>0&&accuracyM<=MOBILE_CLOCK_MAX_ACCURACY_M_,'GPS accuracy too low. Move outdoors and retry.');
  const capturedMs=Date.parse(String(payload.capturedAt||''));
  const now=new Date(),nowMs=now.getTime();
  hrAssert_(Number.isFinite(capturedMs)&&Math.abs(nowMs-capturedMs)<=MOBILE_CLOCK_MAX_LOCATION_AGE_MS_,'GPS reading expired or device time is incorrect. Please retry.');
  let site=null,distanceM=null;
  if(policy.mode==='GEOFENCED') {
    site=mobileClockSites_().find(s=>s.id===policy.siteId&&s.active!==false);
    hrAssert_(!!site,'Assigned geofence site is unavailable. Contact HR.');
    distanceM=mobileClockDistanceM_(latitude,longitude,Number(site.latitude),Number(site.longitude));
    hrAssert_(distanceM<=Number(site.radiusM),'Outside the permitted clock-in geofence ('+Math.round(distanceM)+' m from site; limit '+site.radiusM+' m).');
  }
  const klDate=Utilities.formatDate(now,'Asia/Kuala_Lumpur','yyyy-MM-dd');
  const latest=existing[existing.length-1];
  const latestAge=latest?nowMs-Date.parse(latest.serverTime):Infinity;
  if(kind==='OUT')hrAssert_((latest&&latest.type==='IN'&&latestAge>=0&&latestAge<20*60*60*1000) || mobileClockHasBiometricIn_(target,klDate),'No clock-in found in mobile or biometric attendance for the current workday. Contact HR for a correction.');
  if(kind==='IN')hrAssert_(!latest||latest.type!=='IN'||latestAge>20*60*60*1000,'Already clocked in. Clock out first.');
  hrAssert_(!latest||latestAge>=15000,'Please wait 15 seconds between punches.');
  // Photo is compulsory for this deployment: validate and save to private Drive
  // BEFORE recording a successful punch. Do not silently swallow Drive errors.
  const photoStr=String(payload.photo||'');
  hrAssert_(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photoStr),'A valid camera JPEG is required. Please retake your selfie.');
  const encoded=photoStr.split(',')[1];
  hrAssert_(encoded.length<=1400000,'Photo exceeds 1 MB encoding limit. Retake the selfie.');
  let bytes;
  try { bytes=Utilities.base64Decode(encoded); }
  catch(e) { throw new Error('Photo encoding failed. Retake the selfie.'); }
  hrAssert_(bytes.length>0&&bytes.length<=1024*1024,'Photo exceeds 1 MB limit. Retake the selfie.');
  let savedFile=null,photolink='';
  try {
    let staffFolder=mobileClockStaffFolder_(target);
    if (!staffFolder) {
      try { staffFolder = DriveApp.getRootFolder(); } catch (_) {}
    }
    hrAssert_(!!staffFolder,'Employee Drive folder is unavailable. Ask HR to check Drive permissions.');
    const datePart=Utilities.formatDate(now,'Asia/Kuala_Lumpur','yyyy-MM-dd');
    const timePart=Utilities.formatDate(now,'Asia/Kuala_Lumpur','HH-mm-ss');
    const fileName = datePart + '_' + timePart + '.jpg';
    try {
      savedFile=staffFolder.createFile(Utilities.newBlob(bytes,'image/jpeg',fileName));
    } catch (saveErr) {
      try {
        const parentId = (typeof STAFF_FOLDER_PARENT_ !== 'undefined' && STAFF_FOLDER_PARENT_) ? STAFF_FOLDER_PARENT_ : '1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf';
        const fallbackParent = DriveApp.getFolderById(parentId);
        savedFile = fallbackParent.createFile(Utilities.newBlob(bytes,'image/jpeg',fileName));
      } catch (_) {
        try {
          savedFile = DriveApp.getRootFolder().createFile(Utilities.newBlob(bytes,'image/jpeg',fileName));
        } catch (_) {
          throw saveErr;
        }
      }
    }
    try {
      if (savedFile && typeof savedFile.setSharing === 'function' && typeof DriveApp !== 'undefined' && DriveApp.Access) {
        savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }
    } catch (_) {}
    photolink=savedFile.getUrl();
    hrAssert_(/^https:\/\//.test(String(photolink)),'Google Drive did not return a photo link.');
  } catch(e) {
    const msg = e.message || String(e);
    if (/Access denied: DriveApp/i.test(msg)) {
      throw new Error('Unable to save verification photo to Google Drive: Access denied: DriveApp. In Google Apps Script: Deploy > Manage deployments > Edit (Pencil) > Version: "New version" > Execute as: "Me" > Deploy.');
    }
    throw new Error('Unable to save verification photo to Google Drive: '+msg);
  }
  const address = String(payload.address || payload.locationAddress || '').trim();
  const checkInLocation = String(payload.checkInLocation || payload.locationCategory || '').trim();
  const remark = String(payload.remark || payload.notes || '').trim();

  const event={id:requestId,employee:target.name,employeeNo:target.employeeNo,type:kind,serverTime:now.toISOString(),date:klDate,
    latitude:Number(latitude.toFixed(7)),longitude:Number(longitude.toFixed(7)),accuracyM:Number(accuracyM.toFixed(1)),
    siteId:site?site.id:'',siteName:site?site.name:'',distanceM:distanceM==null?null:Number(distanceM.toFixed(1)),
    mode:policy.mode,clientCapturedAt:String(payload.capturedAt),photo:photolink,photolink:photolink,photoUrl:photolink,
    address:address,locationAddress:address,checkInLocation:checkInLocation,locationCategory:checkInLocation,remark:remark,
    source:'mobile-pwa',status:'Recorded'};
  const gpsLocValue = address || (latitude && longitude ? (latitude + ', ' + longitude) : '');
  const sheet=hrSheet_('mobileClockEvent',true);
  try {
    if (sheet && sheet.getLastColumn && sheet.getLastColumn() >= 7) {
      sheet.getRange(1, 7).setValue('GPS Loc');
      sheet.getRange(1, 8).setValue('photolink');
    }
  } catch (_) {}
  sheet.appendRow([event.id,1,event.employee,event.status,JSON.stringify(event),event.serverTime,gpsLocValue,photolink,checkInLocation,remark]);
  let documentWarning='';
  if(photolink) {
    try {
      const docSheet=hrSheet_('staffDocuments',true);
      const docId=Utilities.getUuid();
      const docRec={id:docId,employee:target.name,employeeNo:target.employeeNo,title:'Attendance Selfie ('+kind+') · '+klDate,
        category:'Attendance Photo',url:photolink,photolink:photolink,date:klDate,status:'Verified',punchId:requestId,punchType:kind,punchTime:event.serverTime,
        location:{latitude:event.latitude,longitude:event.longitude,accuracyM:event.accuracyM}};
      docSheet.appendRow([docId,1,target.name,'Verified',JSON.stringify(docRec),now.toISOString(),actor.name,photolink]);
    }catch(docErr){documentWarning='Attendance photo was stored in Drive and GPS events, but its document index could not be updated: '+(docErr.message||String(docErr));}
  }
  if(documentWarning)event.warning=documentWarning;
  // Attendance photos belong in HR_mobileClockEvent and HR_staffDocuments;
  // never append every selfie URL to the employee master attachment cell.
  return jsonResponse({status:'success',data:event});
}


// Insert-only BioTime import. Called only after doPost authentication and script lock.
function syncBioTimeAttendance_(payload, actor) {
  hrAssert_(hrAdmin_(actor), 'HR or Admin access is required.');
  const records = payload.records;
  hrAssert_(Array.isArray(records) && records.length <= 10000, 'Send at most 10000 records.');
  const clean = v => String(v == null ? '' : v).trim();
  const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v;
  const from = clean(payload.from), to = clean(payload.to);
  hrAssert_(validDate(from) && validDate(to) && from <= to, 'Invalid date range.');
  const time = (value, duration) => {
    const v = clean(value);
    if (!v || v === '-' || v === '—') return '';
    const m = /^(\d{1,3}):(\d{2})(?::00)?$/.exec(v);
    hrAssert_(m && Number(m[2]) < 60 && (duration || Number(m[1]) < 24), 'Invalid time value.');
    return m[1].padStart(2,'0')+':'+m[2];
  };
  const ss = getSpreadsheet_(), staff = ss.getSheetByName('Staff');
  const staffRows = staff.getDataRange().getDisplayValues();
  const bioCol = hrStaffCols_(staffRows[0]).bioCol;
  const byBio = new Map();
  staffRows.slice(1).forEach(r => {
    let bio = clean(r[bioCol]);
    if (!bio && r[23] && !String(r[23]).trim().startsWith('[')) bio = clean(r[23]);
    if (!bio && r[43]) bio = clean(r[43]);
    if (!bio) bio = defaultBiometrics_[clean(r[0]).toUpperCase()] || defaultBiometrics_[clean(r[0])] || '';
    if (!bio || !clean(r[0])) return;
    const profile = {bio, name:clean(r[0]), id:clean(r[24]) || clean(r[2]) || bio,
      company:clean(r[25]), username:clean(r[2])};
    if (!byBio.has(bio)) byBio.set(bio, []);
    byBio.get(bio).push(profile);
  });
  const dataSheet = ss.getSheetByName('Data');
  hrAssert_(dataSheet, 'Data sheet is missing.');
  const existing = [];
  ['Data','Attendance'].forEach(tab => {
    const sheet = ss.getSheetByName(tab);
    if (!sheet) return;
    sheet.getDataRange().getDisplayValues().slice(1).forEach(r => {
      if (!r.some(v=>clean(v))) return;
      const date = clean(r[2]);
      // Refuse ambiguous historic dates rather than silently introducing duplicates.
      hrAssert_(validDate(date), tab+' has a non-ISO date; standardize its date display to yyyy-MM-dd before syncing.');
      existing.push({id:clean(r[0]),name:clean(r[1]),date,
        in:clean(r[4]),out:clean(r[5]),total:clean(r[6]),tab});
    });
  });
  const lockSheet = ss.getSheetByName('LockedMonths');
  const locked = new Set(lockSheet ? lockSheet.getDataRange().getDisplayValues().slice(1).filter(r=>r[0]).map(r=>clean(r[0])) : []);
  const counts = {inserted:0,identical:0,conflicts:0,unmatched:0,ambiguous:0,locked:0,outOfRange:0};
  const issues = [], additions = [], batch = new Map(), blocked = new Set();
  const issue = (kind,bio,date) => { counts[kind]++; issues.push({kind,biometricId:bio,date}); };
  // Validate and group the whole request before any write.
  records.forEach(raw => {
    const bio = clean(raw.biometricId), date = clean(raw.date);
    hrAssert_(bio && validDate(date), 'Each row requires biometricId and ISO date.');
    const r = {bio,date,in:time(raw.in,false),out:time(raw.out,false),total:time(raw.totalHrs,true)};
    const key = bio+'|'+date;
    if (batch.has(key) && JSON.stringify(batch.get(key)) !== JSON.stringify(r)) blocked.add(key);
    else batch.set(key,r);
  });
  batch.forEach((r,key) => {
    if (blocked.has(key)) return issue('conflicts',r.bio,r.date);
    if (r.date < from || r.date > to) return issue('outOfRange',r.bio,r.date);
    const matches = byBio.get(r.bio) || [];
    if (!matches.length) return issue('unmatched',r.bio,r.date);
    if (matches.length !== 1) return issue('ambiguous',r.bio,r.date);
    const p = matches[0], month = r.date.slice(0,7);
    if (locked.has(month) || locked.has(month+'__'+p.company)) return issue('locked',r.bio,r.date);
    const old = existing.filter(e => e.date === r.date &&
      ([p.id,p.bio,p.username].filter(Boolean).includes(e.id) || e.name.toUpperCase() === p.name.toUpperCase()));
    if (old.length) {
      let same = false;
      try { same = old.every(e => time(e.in,false)===r.in && time(e.out,false)===r.out && time(e.total,true)===r.total); } catch (_) {}
      if (same) counts.identical++; else issue('conflicts',r.bio,r.date);
      return;
    }
    const weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(r.date+'T00:00:00Z').getUTCDay()];
    additions.push([p.id,p.name,r.date,weekday,r.in,r.out,r.total]);
  });
  counts.inserted = additions.length;
  const dryRun = payload.dryRun !== false;
  if (!dryRun && additions.length) {
    const first = dataSheet.getLastRow()+1;
    ensureRows_(dataSheet,first+additions.length-1);
    // Append only. Never call replaceRows_, clear(), or saveAttendance().
    const safe = additions.map(row=>row.map(v=>/^[=+@-]/.test(v) ? "'"+v : v));
    dataSheet.getRange(first,1,safe.length,7).setNumberFormat('@').setValues(safe);
  }
  return jsonResponse({status:'success',dryRun,counts,issues,
    message:dryRun?'Preview only; inserted is the number of proposed additions.':'Missing raw attendance appended. Existing records unchanged.'});
}

function testDrivePermissions() {
  Logger.log('=== TESTING GOOGLE DRIVE PERMISSIONS ===');
  let userEmail = '';
  try { userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (_) {}
  Logger.log('User Account: ' + (userEmail || 'unknown'));

  try {
    const root = DriveApp.getRootFolder();
    Logger.log('1. My Drive (Root) access: SUCCESS (' + root.getName() + ')');
  } catch (e) {
    Logger.log('1. My Drive (Root) access: FAILED -> ' + e.message);
  }

  const parentId = (typeof STAFF_FOLDER_PARENT_ !== 'undefined' && STAFF_FOLDER_PARENT_) ? STAFF_FOLDER_PARENT_ : '1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf';
  let parentFolder = null;
  try {
    parentFolder = DriveApp.getFolderById(parentId);
    Logger.log('2. Attachment folder (' + parentId + '): SUCCESS (' + parentFolder.getName() + ')');
  } catch (e) {
    Logger.log('2. Attachment folder (' + parentId + '): FAILED -> ' + e.message);
  }

  if (parentFolder) {
    try {
      const testBlob = Utilities.newBlob('PeopleOS Drive Test', 'text/plain', 'test_auth.txt');
      const testFile = parentFolder.createFile(testBlob);
      Logger.log('3. Write permission in Attachment folder: SUCCESS! File ID: ' + testFile.getId());
      testFile.setTrashed(true);
      Logger.log('4. Trashed test file: SUCCESS!');
    } catch (e) {
      Logger.log('3. Write permission in Attachment folder: FAILED -> ' + e.message);
      Logger.log('   >> WARNING: The Google account does NOT have Editor rights on this Attachment folder!');
    }
  }
  Logger.log('=== TEST COMPLETE ===');
}

