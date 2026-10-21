# SQHR — Unified Employee, Attendance, Payroll and HR System

Converted from Attendance Dashboard V12 Payroll.html. Vue single-file components mount the dashboard and bind the original static controls through Vue event directives. The original payroll calculations, Bootstrap layout, Excel reports, PDF payslips, staff management and leave workflows are retained.

This is an incremental Vue migration: `src/services/dashboard.js` still uses jQuery to populate dynamic tables and cards, and exposes an action bridge for their generated controls. It is not a complete rewrite of all screens into reactive Vue components.

## Unified employee master and roles

Read `DEPLOY_HR.md` first. Employee Management now combines staff, account, payroll and organisation details. Staff A:AF is the master record. User, HOD, HR and Admin roles are enforced server-side; HR modules are available directly in the main sidebar. The live workbook tabs have been prepared, but the Apps Script and Firebase deployment still need updating.

## Local development

Install Node.js 20.19+ or Node.js 22.12+.

```sh
npm ci
```

Copy `.env.example` to `.env` (Windows: `copy .env.example .env`; macOS/Linux: `cp .env.example .env`). The example contains your configured Google Apps Script web-app URL. Set `VITE_GAS_API_URL` to your deployed `/exec` endpoint if it changes.

```sh
npm run dev
npm run build
npm run preview
```

## Deploy to Firebase Hosting

Create or select your Firebase project in the Firebase console and enable Hosting. Run from this project folder:

```sh
npm install -g firebase-tools
firebase login
firebase use --add
npm run deploy
```

Select your Firebase project when prompted by `firebase use --add`, and use `default` for its alias. The included `firebase.json` publishes `dist` with a single-page application rewrite. No Firebase SDK configuration is required for Hosting alone. You do not need to run `firebase init`; the Hosting configuration is already provided.

Alternatively, deploy the included build directly:

```sh
firebase deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
```

After changing `.env` or source, rebuild before deployment. Vite variables are embedded in the public browser bundle; do not put secrets in them.

## Google Apps Script backend

`backend/GAS_payroll.js` is the optimized server script. `backend/GAS_payroll.original.js` is the original backup. Keep it in Google Apps Script, connected to the existing spreadsheet. Firebase Hosting does not execute Apps Script files. If you need a new deployment, deploy it as a web app with the access settings required by your existing browser login workflow, and update `VITE_GAS_API_URL`.

The HR expansion adds server-validated sessions, role/ownership checks and password redaction. Data access now uses authenticated POST requests. Deploy the included Apps Script before the frontend, then sign in again. It does not add Firebase Authentication or move records to Firestore. See `DEPLOY_HR.md` for setup and `HR_REVIEW.md` for coverage and remaining production work.

## Project files

- `src/components/PayrollDashboard.vue`: dashboard markup and Vue event bindings.
- `src/services/dashboard.js`: original calculations, API calls and compatibility layer.
- `src/styles/dashboard.css`: original visual styling.
- `backend/GAS_payroll.js`: optimized server script; excluded from Hosting.
- `firebase.json`: Hosting deployment configuration.
- `dist/`: tested production build, ready for Hosting.

## Verification

`npm ci` and `npm run build` completed successfully. See `VERIFICATION.md` for the browser checks and limits. Live backend operations must be checked with your own test account after deployment.

## Backend performance changes

Startup uses `getBootstrap` for one backend execution instead of six requests. The spreadsheet is opened once per request. Reads select only schema columns. Bulk writes overwrite rows once and clear only obsolete rows. Consecutive payroll rows are deleted as groups. Destructive writes have a short script lock; a busy result requires the user to retry. Staff deletion is now routed, profile contact fields write to J–L, and profile history writes to P without corrupting IC or confirmation dates.

Excel and PDF libraries load only when import/export or payslip printing is requested.

See `PERFORMANCE_REVIEW.md` for limitations and deployment checks.

## New HR workspace

Companies, departments, employee organisation, claim policies, claims, loans, resources/bookings, appraisal cycles/evaluations, tax declarations, letters, recruitment, lifecycle tasks, training, leave adjustments, reports and audit history share the graphite theme. New screens use reactive Vue. New HR data loads on entry to the HR workspace.

`backend/GAS_payroll.js` is the single server deployment file and includes the complete HR extension. `backend/HR_modules.source.txt` is a development reference and must not be pasted again.

Run `npm run test:backend`, `npm run test:hr` and `npm run test:ui` (the UI suite needs a local jsdom installation, supplied in this workspace but not a production dependency).
