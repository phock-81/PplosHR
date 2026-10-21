# Deploy the unified HR system

The live Attendance_LIVE workbook has been extended: Staff is the employee master (A:AF), eighteen HR transaction/audit/configuration tabs are ready, and HR Setup Guide documents the layout. Nine existing employees received stable IDs. Existing role values, payroll and attendance records were preserved. Companies, departments and reporting lines are intentionally unassigned until your HR administrator configures them.

## 1. Apps Script backend — deploy first

1. Back up the current Apps Script project.
2. Replace its application code with the complete `backend/GAS_payroll.js` (or the identical `backend/GAS_payroll.txt` if easier to open). Paste only ONE copy. All extension source is already included.
3. Select `setupHrBackend` in the Apps Script editor and Run. Authorize it under the workbook owner's account. It preserves existing rows and IDs and creates any missing HR registers. It does not assign account roles.
4. In Staff column E, the workbook owner must select the intended initial administrator's role as `Admin`. No current account was promoted automatically. Avoid renaming employees because historic payroll and attendance use names as their legacy join key.
5. Deploy → Manage deployments → Edit existing web-app deployment → New version → Deploy. Retain the existing `/exec` URL and required execution/access settings.
6. If the URL changes, update `VITE_GAS_API_URL` in `.env` before building the frontend. Users must sign out and sign in after the upgrade.

## 2. Firebase Hosting — PowerShell

Run inside the extracted `attendance-payroll-vue` folder:

```powershell
npm ci
# Only if .env does not already exist:
Copy-Item .env.example .env
npm run build
firebase deploy --only hosting --project workpluse
```

Preserve an existing correct `.env` file. Firebase authentication must be available on your computer. The code package is prepared; no Apps Script or Firebase deployment was performed by this update.

## 3. Role controls

| Role | Access |
| --- | --- |
| User | Own profile, payslips, leave and HR requests |
| HOD | User access plus approvals assigned through Reporting Manager; team leave only; no other payroll or employee account access |
| HR | Employee management, attendance/payroll and HR operations; create User accounts; edit User/HOD details; cannot assign/change roles or edit HR/Admin accounts |
| Admin | Full management including assigning roles and maintaining HR/Admin accounts |

Legacy Staff is interpreted as User. Legacy Supervisor is interpreted as HOD, so it no longer grants unrestricted payroll administration. Roles are read from Staff on every authenticated request: changing a role affects existing sessions immediately. Keep at least one active Admin. Set Resigned to disable an account; permanent deletion is blocked to preserve history.

App roles do not restrict people who can directly edit the Google Sheet. Keep the workbook restricted to trusted administrators: the original credential column and payroll data remain sensitive. Passwords are never returned by authenticated staff APIs. Existing credential storage has not been migrated to Firebase Auth or password hashing.

## 4. Initial configuration and checks

1. Sign in as Admin, create companies and departments from the main navigation.
2. Open Employee Management → Update Profile. Assign company, department, reporting manager, job title and work location in the same form as login, payroll and personal details. Employee IDs stay fixed; blank organisation fields are allowed until setup is complete.
3. Use roles User, HOD, HR and Admin. Choose a different approver for your own requests. HOD scope uses the explicit Reporting Manager field, not merely the department label.
4. Create claim policies, resources and appraisal cycles as needed.
5. Verify User claim → assigned HOD recommendation → HR approval → external payment reference. HR registers do not initiate banking, file statutory returns or automatically deduct employee loans from payroll.
6. Verify Employee Management updates Staff Y:AE; there is no separate writable employee-organisation table. HR_profiles is not used.
7. Check sign-in as each role, denied payroll reads for HOD/User, team leave decisions and blocked self-approval. Confirm records survive refresh and sign-in.

Use the app to edit HR_* records: their Record JSON column is authoritative. Staff Z/AA store IDs selected through company/department dropdowns; AB stores the exact reporting manager name. Do not manually rename/reorder required columns or edit Record Version.


## Navigation, leave and resource update

- Every role lands on Overview. The top-right account menu displays the signed-in name and role, with My Profile and Logout.
- My Workspace groups personal services. My Team contains assigned approvals for HOD/HR/Admin. HR-only management groups are hidden from User/HOD. Admin is displayed as Superadmin and keeps all existing management controls.
- HR can create companies and departments in People & Organisation, then assign them in Employee Management.
- HR Administration → Claim Types creates/edits/deactivates categories. The five existing categories have been seeded in HR_claimTypes. Claims and policy forms use active configured categories. An already-used category cannot be renamed: deactivate it and add the replacement to retain historical links.
- HR Operations → Resource Catalogue creates assets. Resource Assignments records an employee handover (employee, resource, date, condition, notes) or return. Active assignments cannot overlap or conflict with bookings. Employee ID is stored with the assignment; Staff AF displays the current assigned resource codes/names. Employees see their own handovers in My Resources. No assets were assigned automatically.
- My Leave refreshes balances from the server, shows pending requests and the next approved leave, and offers search/status filtering. Failed submissions retain the draft. Approval decisions use a review dialog with saved notes; rejection requires a reason. Stale decisions are rejected when a request has changed.
- The sheet structures and claim-type defaults are live. Deploy the new complete backend and frontend together to activate these behaviours. Run setupHrBackend once; do not paste the source reference files as additional Apps Script files.

Application permissions apply to the app/API. Direct workbook editors retain the access granted through Google Drive.

## Navigation and branding cleanup

All navigation groups start collapsed. My Workspace contains Profile & Documents, Leave & Bookings, Pay & Claims, Resources and Development subgroups. Branding is HR Portal. Task screens, task overview metrics and the lifecycle task API are removed. Existing HR_lifecycle rows are left untouched for historical retention, but are not read into the application or included in current reports. Deploy the updated backend and frontend together.

## Job grades, job titles and limits

Deploy the updated combined `backend/GAS_payroll.js`, run `setupHrBackend`, deploy a new Apps Script version, then rebuild/deploy the frontend. Staff now uses A:AH, with Job Title ID in AG and derived Job Grade ID in AH.

1. In People & Organisation, create Job Grades and Job Title Library entries linked to grades.
2. In Employee Management, select a library job title. The backend derives the grade; existing free-text titles remain until linked. Job grade does not grant an access role.
3. In HR Administration, configure Claim Limits by Grade for company, claim type and year, with per-receipt and annual limits. Pending, approved and paid claims count toward annual totals. Zero disallows positive claims.
4. Configure Resource Limits by company, category and grade: maximum active assignments and optional combined asset-value cap. A value cap of zero means no value cap. When a value cap applies, all allocated assets need positive catalogue values.

An exact grade policy takes priority over a blank-grade company default. If no policies exist for a category, existing uncapped behavior remains. If policies exist but neither the employee grade nor a default matches, allocation is denied. Configure defaults before rolling out restrictions.

Title library changes synchronize employee title/grade and record versions. Historical records are retained; existing assignments are not automatically revoked. New assignments and claim approvals validate current limits. New libraries are intentionally blank for HR configuration.
