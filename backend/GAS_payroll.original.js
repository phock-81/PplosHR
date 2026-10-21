const SPREADSHEET_ID = '1xJYsg2qQzFzb-8v3f5IE_CJqRy_l-ZcrWHs2wHf-1Ng';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload;
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // --- ROUTING: Connect frontend actions to backend functions ---
    if (action === 'login') return handleLogin(payload);
    if (action === 'unlockMonth') return unlockMonth(payload);
    if (action === 'saveSingleStaff') return saveSingleStaff(payload);
    if (action === 'updateOwnProfile') return updateOwnProfile(payload); // New Route
    if (action === 'saveHolidays') return saveHolidays(payload);
    if (action === 'saveAttendance') return saveAttendance(payload);
    if (action === 'saveData') return saveData(payload);
    if (action === 'submitLeave') return submitLeave(payload);
    if (action === 'getLeaveData') return getLeaveData(payload);
    if (action === 'updateLeaveStatus') return updateLeaveStatus(payload);
    if (action === 'getPayroll') return getPayroll();
    if (action === 'resetPassword') return resetPassword(payload);

    // --- LOCK MONTH LOGIC ---
    if (action === 'lockMonth') {
      let lockedSheet = ss.getSheetByName("LockedMonths");
      if (!lockedSheet) {
        lockedSheet = ss.insertSheet("LockedMonths");
        lockedSheet.appendRow(["Month", "Data JSON"]);
      }
      
      const dataRange = lockedSheet.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < dataRange.length; i++) {
        if (dataRange[i][0] == payload.month) {
          lockedSheet.getRange(i + 1, 2).setValue(JSON.stringify(payload.data));
          found = true; break;
        }
      }
      if (!found) {
        lockedSheet.appendRow([payload.month, JSON.stringify(payload.data)]);
      }

      let payrollSheet = ss.getSheetByName("Payroll");
      if (!payrollSheet) {
        payrollSheet = ss.insertSheet("Payroll");
        payrollSheet.appendRow([
          "Month/Year", "Employee ID", "Employee Name", "Basic Salary (RM)", "Worked Days", 
          "Total OT Pay (RM)", "Gross Pay (RM)", "Employee Deduction - EPF (RM)", 
          "Employee Deduction - SOCSO (RM)", "Employee Deduction - EIS (RM)", 
          "Total Employee Deduction (RM)", "Employer Contribution - EPF (RM)", 
          "Employer Contribution - SOCSO (RM)", "Employer Contribution - EIS (RM)", 
          "Total Employer Contribution (RM)", "Nett Pay (RM)"
        ]);
        payrollSheet.getRange("1:1").setFontWeight("bold");
        payrollSheet.setFrozenRows(1);
      }

      if (payload.payrollData && payload.payrollData.length > 0) {
        let prData = payrollSheet.getDataRange().getValues();
        for (let i = prData.length - 1; i > 0; i--) {
          if (prData[i][0] == payload.month) {
            payrollSheet.deleteRow(i + 1);
          }
        }
        payrollSheet.getRange(payrollSheet.getLastRow() + 1, 1, payload.payrollData.length, payload.payrollData[0].length).setValues(payload.payrollData);
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown POST action: ' + action })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getStaff') return getStaff();
    if (action === 'getHolidays') return getHolidays();
    if (action === 'getData') return getData();
    if (action === 'getAttendance') return getAttendance();
    if (action === 'getLockedMonths') return getLockedMonths();
    return jsonResponse({ status: 'error', message: 'Unknown action.' });
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() });
  }
}

// --- STAFF MANAGEMENT ---
function getStaff() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Staff');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found' });
  
  const data = sheet.getDataRange().getDisplayValues();
  const staffSettings = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; 
    
    let parsedRestDays = [];
    try { parsedRestDays = row[23] ? JSON.parse(row[23]) : []; } catch(e) {}
    
    staffSettings[row[0].toUpperCase()] = {
      name: row[0].toUpperCase(),
      status: row[1] || "Active",
      username: row[2],
      password: row[3],
      role: row[4],
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
      restDays: parsedRestDays 
    };
  }
  return jsonResponse({ status: 'success', data: staffSettings });
}

function saveSingleStaff(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Staff');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found' });
  
  const data = sheet.getDataRange().getValues();
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
  
  let fileUrl = payload.existingAttachment || "";
  let uploadError = null;
  if (payload.fileName && payload.fileData) {
    try {
      const folder = DriveApp.getFolderById('1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf'); 
      const blob = Utilities.newBlob(Utilities.base64Decode(payload.fileData), payload.mimeType, payload.fileName);
      const file = folder.createFile(blob);
      fileUrl = fileUrl ? fileUrl + " | " + file.getUrl() : file.getUrl();
    } catch (e) { uploadError = e.message; }
  }
  
  let restDaysStr = payload.restDays ? JSON.stringify(payload.restDays) : "[]";
  
  // Quick Save (e.g. from Rest Days checkbox)
  if (payload.isQuickSave && rowIndex > 0) {
     sheet.getRange(rowIndex, 24).setValue(restDaysStr); // Col X
     return jsonResponse({ status: 'success' });
  }

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

  const rowData = [
    payload.name,                      // 0: A
    payload.status || "Active",        // 1: B
    payload.username || "",            // 2: C
    payload.password || "",            // 3: D
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
    restDaysStr                        // 23: X
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, 24).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
  
  return jsonResponse({ status: 'success', uploadError: uploadError });
}

function updateOwnProfile(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Staff');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toUpperCase() === payload.name.toUpperCase()) {
      const rowIndex = i + 1;
      
      sheet.getRange(rowIndex, 9).setValue(payload.contactNo || ""); // Col J
      sheet.getRange(rowIndex, 10).setValue(payload.address || "");  // Col K
      sheet.getRange(rowIndex, 11).setValue(payload.emergency || "");// Col L
      
      // History Log Update
      let oldHistory = data[i][13] || ""; // Col N (14)
      const now = new Date();
      const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "ddMMyy - HH:mm");
      const logEntry = `${dateStr} - Profile details (Contact/Address) updated by staff`;
      let newHistory = oldHistory ? oldHistory + "\n" + logEntry : logEntry;
      sheet.getRange(rowIndex, 14).setValue(newHistory);
      
      return jsonResponse({ status: 'success' });
    }
  }
  return jsonResponse({ status: 'error', message: 'Staff record not found.' });
}

function deleteSingleStaff(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Staff');
  const data = sheet.getDataRange().getValues();
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
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Holidays');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  sheet.getRange("A:A").setNumberFormat("@");
  const rows = holidaysArray.map(h => [h.date, h.name]);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return jsonResponse({ status: 'success', message: 'Holidays saved.' });
}

function saveAttendance(records) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Attendance');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  const rows = records.map(r => [
    r.id, r.name, r.date, r.payType, r.in, r.out, r.totalHrs, 
    r.shift, r.lateIn, r.earlyOut, r.payableHrs, r.overlapOT, r.extraOT, r.remark, r.manualOTPay || ''
  ]);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return jsonResponse({ status: 'success', message: 'Attendance saved.' });
}

function saveData(rawData) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  const rows = rawData.map(r => [r.id, r.name, r.date, r.weekday, r.in, r.out, r.totalHrs]);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return jsonResponse({ status: 'success', message: 'Raw data saved.' });
}

function getHolidays() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Holidays');
  if (!sheet) return jsonResponse({ status: 'success', data: [] });
  const data = sheet.getDataRange().getDisplayValues();
  const h = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) h.push({ date: data[i][0], name: data[i][1] });
  }
  return jsonResponse({ status: 'success', data: h });
}

function getData() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  const records = [];
  for(let i=1; i<data.length; i++) {
    if(data[i][0]) records.push({ id: data[i][0], name: data[i][1], date: data[i][2], weekday: data[i][3], in: data[i][4], out: data[i][5], totalHrs: data[i][6] });
  }
  return jsonResponse({ status: 'success', data: records });
}

function getAttendance() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Attendance');
  const data = sheet.getDataRange().getDisplayValues();
  const records = [];
  for(let i=1; i<data.length; i++) {
    if(data[i][0]) records.push({ 
        id: data[i][0], name: data[i][1], date: data[i][2], payType: data[i][3], 
        in: data[i][4], out: data[i][5], overlapOT: data[i][11], extraOT: data[i][12], remark: data[i][13], manualOTPay: data[i][14]
    });
  }
  return jsonResponse({ status: 'success', data: records });
}

function getLockedMonths() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('LockedMonths');
  if (!sheet) return jsonResponse({ status: 'success', data: {} }); 
  const data = sheet.getDataRange().getDisplayValues();
  const locked = {};
  for(let i=0; i<data.length; i++) {
    if(data[i][0] && data[i][1]) {
      try { locked[data[i][0]] = JSON.parse(data[i][1]); } catch(e) {}
    }
  }
  return jsonResponse({ status: 'success', data: locked });
}

function unlockMonth(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('LockedMonths');
  const data = sheet.getDataRange().getValues();
  for(let i=0; i<data.length; i++) {
    if(data[i][0] === payload.month) { 
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
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Staff');
  const data = sheet.getDataRange().getValues();
  
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
      
      const leaveSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Leave');
      const leaveData = leaveSheet ? leaveSheet.getDataRange().getValues() : [];
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
      
      return jsonResponse({ 
        status: 'success', 
        user: { 
          name: staffName, role: role, icNo: icNo, gender: gender,
          alEntitlement: alEntitlement, alBalance: alEntitlement - approvedAL,
          mcEntitlement: mlEntitlement, mcBalance: mlEntitlement - approvedML,
          socsoNo: data[i][17], epfNo: data[i][18], taxNo: data[i][19], bankNo: data[i][20]
        } 
      });
    }
  } 
  return jsonResponse({ status: 'error', message: 'Invalid credentials.' });
}

function submitLeave(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Leave');
  let fileUrl = "";
  
  // Handle File Upload to Google Drive
  if (payload.fileData && payload.fileName) {
    try {
      const folder = DriveApp.getFolderById('1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf'); 
      const blob = Utilities.newBlob(Utilities.base64Decode(payload.fileData), payload.mimeType, payload.fileName);
      const file = folder.createFile(blob);
      fileUrl = file.getUrl();
    } catch(e) { console.log("Drive Upload Failed: " + e); }
  }

  const reqId = "LV-" + new Date().getTime();
  const appliedDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
  
  // Save application to the Google Sheet
  sheet.appendRow([
    reqId, payload.staffName, payload.leaveType, payload.startDate, payload.endDate, 
    payload.totalDays, payload.reason, fileUrl, "Pending", appliedDate
  ]);
  
  // --- SEND EMAIL NOTIFICATION (NEW LEAVE) ---
  try {
    const adminEmail = "hock@metrio.com.my";
    const subject = `New Leave Application: ${payload.staffName}`;
    
    let body = `Hello Admin,\n\n`;
    body += `A new leave application has been submitted and is awaiting your approval.\n\n`;
    body += `--------------------------------------\n`;
    body += `Staff Name : ${payload.staffName}\n`;
    body += `Leave Type : ${payload.leaveType}\n`;
    body += `Start Date : ${payload.startDate}\n`;
    body += `End Date   : ${payload.endDate}\n`;
    body += `Total Days : ${payload.totalDays}\n`;
    body += `Reason     : ${payload.reason || '-'}\n`;
    
    if (fileUrl) {
      body += `Attachment : ${fileUrl}\n`;
    }
    
    body += `--------------------------------------\n\n`;
    body += `Please log in to the Metrio HR Portal to review and process this request.`;
    
    MailApp.sendEmail({
      to: adminEmail,
      subject: subject,
      body: body
    });
  } catch(e) {
    console.log("Email Notification Failed: " + e);
  }
  // -------------------------------------------
  
  return jsonResponse({ status: 'success', message: 'Leave submitted successfully.' });
}

function getLeaveData(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Leave');
  if(!sheet) return jsonResponse({status: 'success', data: []});
  
  const data = sheet.getDataRange().getValues();
  let results = [];
  
  for (let i = 1; i < data.length; i++) {
    let row = {
      id: data[i][0], name: data[i][1], type: data[i][2], start: data[i][3], end: data[i][4],
      days: data[i][5], reason: data[i][6], attachment: data[i][7], status: data[i][8], date: data[i][9], rowIndex: i + 1
    };
    
    if (payload.role === "Admin" || payload.role === "Supervisor") {
      results.push(row);
    } else {
      if (row.name === payload.staffName) results.push(row);
    }
  }
  return jsonResponse({ status: 'success', data: results });
}

function updateLeaveStatus(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Leave');
  
  // 1. Update the status and timestamp in the sheet
  sheet.getRange(payload.rowIndex, 9).setValue(payload.newStatus); 
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB') + ", " + now.toLocaleTimeString('en-GB'); 
  const approvalInfo = `${dateStr} by ${payload.approver || 'Admin'}`;
  sheet.getRange(payload.rowIndex, 11).setValue(approvalInfo); 
  
  // 2. Save the withdrawal remark if provided by the staff
  if (payload.withdrawRemark) {
    sheet.getRange(payload.rowIndex, 12).setValue(payload.withdrawRemark);
  }

  // --- 3. SEND EMAIL NOTIFICATION (CANCELLATION REQUEST) ---
  if (payload.newStatus === 'Withdrawal Requested') {
    try {
      // Fetch the leave details from the sheet to include in the email
      const rowData = sheet.getRange(payload.rowIndex, 1, 1, 7).getDisplayValues()[0];
      const staffName = rowData[1];
      const leaveType = rowData[2];
      const startDate = rowData[3];
      const endDate = rowData[4];
      const totalDays = rowData[5];

      const adminEmail = "hock@metrio.com.my";
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
    } catch(e) {
      console.log("Withdrawal Email Notification Failed: " + e);
    }
  }
  // ---------------------------------------------------------

  return jsonResponse({ status: 'success' });
}

function getPayroll() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Payroll');
  if (!sheet) return jsonResponse({ status: 'success', data: [] });
  const data = sheet.getDataRange().getDisplayValues();
  const records = [];
  for(let i=1; i<data.length; i++) {
    if(data[i][0]) {
      records.push({
        month: data[i][0], id: data[i][1], name: data[i][2], basic: data[i][3], 
        workedDays: data[i][4], otPay: data[i][5], gross: data[i][6],
        epfEmp: data[i][7], socsoEmp: data[i][8], eisEmp: data[i][9], totalEmpDed: data[i][10],
        epfEmpr: data[i][11], socsoEmpr: data[i][12], eisEmpr: data[i][13], totalEmprCont: data[i][14],
        nettPay: data[i][15]
      });
    }
  }
  return jsonResponse({ status: 'success', data: records });
}

function resetPassword(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Staff');
  if (!sheet) return jsonResponse({ status: 'error', message: 'Staff sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  
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