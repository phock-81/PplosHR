# PplosHR Beta Release & Audit Remediation Report: Dedicated Mobile App Shell & Advanced HR Operations

**Date**: 2026-10-15  
**Target Channel**: Firebase project `peopleoshr` / Hosting channel `beta` only (`https://peopleoshr--beta-qlz5ndcb.web.app`)  
**Production Channel**: `https://peopleoshr.web.app` (**STRICTLY UNTOUCHED**, last released 2026-10-15 07:20:16 MYT)  
**Deployed Release Version**: `625bb6bd19d45248` (deployed 2026-10-15 11:00 MYT)  

---

## 1. Executive Summary & Audit Remediation
Following the audit handoff (`PplosHR_Beta_Audit_Mobile_App_Remediation.md`), the mobile experience was elevated from simple responsive desktop hiding to a **first-class dedicated mobile application package** (`MobileAppShell.vue` and modular sub-screens), resolving all critical audit gaps:

1. **Dedicated Mobile Application Shell (`src/components/mobile/`)**:
   - Replaced jQuery-based `.tab-section` toggle on mobile with a standalone mobile app shell (`MobileAppShell.vue`).
   - Phone-native header, persistent 5-tab bottom navigation with safe-area padding (`calc(62px + env(safe-area-inset-bottom))`), 44–48px touch targets, zero horizontal scrolling (`hasHorizontalScroll: false` at 390x844px).
2. **Dedicated Mobile 5-Tab Screens**:
   - **Home (`MobileHome.vue`)**: Personalized welcome greeting, today's shift card (09:00 - 18:00 Normal Office), quick metrics (AL balance, pending requests, payslip status), 4 large touch action buttons (Apply Leave, Submit Claim, Book Room, My Attendance), and HOD team-on-leave overview.
   - **Attendance (`MobileAttendance.vue`)**: Native timeline of punch records, today's shift card, biometric sync indicator, and an interactive "Request Time Correction / OT Claim" bottom sheet.
   - **Requests (`MobileRequests.vue`)**: Requests hub with pill sub-tabs (Leave, Claims, Bookings, Loans), status timelines, and prominent "+ New Request" action sheet. Features real phone camera receipt capture (`<input type="file" accept="image/*" capture="environment">`) with image preview, and localStorage draft preservation (`LEAVE_DRAFT_KEY`, `CLAIM_DRAFT_KEY`) so incomplete entries are never lost.
   - **Inbox (`MobileInbox.vue`)**: Scoped by user identity. Staff see their own status updates and announcements (never manager approval queues); HOD/HR managers see actionable approval cards with 1-tap Approve and Reject (with mandatory reason note).
   - **Me (`MobileMe.vue`)**: Personal profile avatar, job title, department, interactive "My Payslips" breakdown sheet, documents & letters register, assigned assets, Add to Home Screen PWA guidance for iPhone/Android, and Sign Out with cache purge.
3. **Action Center User Isolation**:
   - Fixed account collision on shared devices by replacing role-based localStorage keys with user-isolated keys: `pploshr.ac.seen.${encodeURIComponent(userIdentifier)}`.
4. **Report Center XLSX Export**:
   - Added native Excel workbook export using `xlsx-js-style` (`exportXlsx`) alongside CSV and print-to-PDF, ensuring 100% data parity across all three output formats.
5. **HrAnalytics List-Level Record Drilldowns**:
   - Upgraded chart interactions from label selection to an in-context record drill-down drawer (`pa-drilldown-panel`) with matching IDs, targets, categories, dates, and status badges.
   - Reconciled units: computes both application counts and real units (total leave days for leave mix, and RM monetary amounts for claims).
6. **Role Normalization Fix**:
   - Corrected `switchMobileTab` to normalize role before role-checking (`normaliseRole(currentUser?.role)`), preventing user routing mismatches.

---

## 2. Verification & Test Evidence

### 2.1 Automated Test Suite (`npm run test:all`)
- **Suites Executed**: 24 distinct test suites.
- **Pass Rate**: 100% Green (Exit Code 0).
- **Extended Test Suite (`tests/pwa-overview-ops.test.cjs`)**:
  - Part 1: Manifest, PNG icons, and HTML viewport wiring.
  - Part 2: Service worker security sandbox (zero caching of API/POST/PDF/personal data).
  - Part 3: Sensitive feature flags frozen and disabled (`false`).
  - Part 4: Component wiring and data integrity.
  - Part 5: Firebase hosting cache-control headers (`sw.js` and manifest are `no-cache`).
  - Part 6: ResourceCalendar & ReportCenter parity and conflict detection.
  - Part 7: Mobile PWA 2.0 5-tab responsive navigation.
  - Part 8: Dedicated Mobile App Shell and 5 native screens with camera capture and draft preservation.
  - Part 9: ReportCenter XLSX export and ActionCenter user-isolated localStorage key.
  - Part 10: HrAnalytics list-level record drilldowns and dual units (days & RM).

### 2.2 Production Build (`npm run build`)
- Successfully transformed 365 modules and generated production bundle in 13.63s without missing dependencies or broken CSS.

### 2.3 Live Preview Browser Verification (Playwright)
- Target Deployed URL: `https://peopleoshr--beta-qlz5ndcb.web.app/?cachebust=625bb6bd19d45248`
- **Mobile Viewport (390 x 844 px)**:
  - `hasMobileAppShell`: `true`
  - `mobileHeaderTitle`: "PplosHR"
  - `bottomTabs`: `["Home", "Attendance", "Requests", "Inbox", "Me"]`
  - `hasHeroCard`: `true`
  - `hasQuickActions`: `true`
  - `hasHorizontalScroll`: `false` (No horizontal scrolling on phone)
  - Interactive tab switches and bottom sheets (Leave Wizard, Claim Wizard with Camera Capture, Action Sheets) verified live.
- **Desktop Viewport (1280 x 800 px)**:
  - `isMobileShellVisible`: `false`
  - `isDesktopWrapperVisible`: `true`
  - `hasSidebar`: `true`
  - `hasMainHeader`: `true`
  - Desktop multi-column layout, sidebar, and Action Center preserved cleanly.

---

## 3. Policy-Gated Features (Frozen / Disabled)
The 8 advanced/sensitive modules remain strictly disabled in `src/hr/featureFlags.js` per specification:
1. `geofenceClockIn`: Disabled (Awaits GPS privacy policy & polygon coordinates).
2. `facialBiometrics`: Disabled (Awaits PDPA biometric consent sign-off).
3. `receiptOcr`: Disabled (Awaits cloud vision API quota & key provisioning).
4. `predictiveStaffing`: Disabled (Awaits predictive model validation).
5. `automatedSalaryChanges`: Disabled (Requires manual HR/Finance payroll sign-off).
6. `pushNotifications`: Disabled (Awaits Web Push VAPID key setup).
7. `offlineSubmission`: Disabled (Awaits conflict-resolution auditing).
8. `payrollBankExport`: Disabled (Awaits bank-specific encrypted layout specs).

---

## 4. Rollback Instructions
- **Firebase Hosting Channel Rollback**:
  - In Firebase Console (`peopleoshr` $\rightarrow$ Hosting $\rightarrow$ Channels $\rightarrow$ `beta`), select previous verified release `ef63c72e0ae48de7` or `f7df483affa8ae86` and click **Rollback**.
- **Local Rollback**:
  - Redeploy previous verified build:
    ```powershell
    npx firebase hosting:channel:deploy beta --project peopleoshr
    ```
- **Data Safety**:
  - Zero database or Google Sheets schema changes were executed. Rollback carries zero risk of data corruption or orphaned records.
