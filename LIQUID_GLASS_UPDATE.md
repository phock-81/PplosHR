# PeopleOSHR Liquid Glass — Stage 1

This is a presentation-only change built from the available `Attendance_Payroll_Vue_Firebase.zip` source snapshot. The current Google Drive folder may contain newer edits; merge changes carefully before replacing files.

## Modified files
- `src/main.js`: imports the new theme after existing styles.
- `src/styles/liquid-glass.css`: premium copper/peach palette, frosted-glass sidebar/cards, login, controls, responsive/print/reduced-motion handling.

## Not changed
Backend, HR calculations, authentication, role permissions, dashboard actions, navigation definitions and employee data remain untouched.

## Outstanding work
The advanced moving shared pill, liquid-split animation, expandable widgets and dock are not implemented yet. Existing active navigation and native filters received the matching visual treatment.

## Verification
Dependencies are absent in the source ZIP. The attempted `npm ci` did not finish in this environment, and the UI tests require `jsdom`; no passing test result is claimed. Run `npm ci`, `npm run build`, `npm run test:ui`, `npm run test:navigation`, `npm run test:roles`, `npm run test:hr` in the project environment. Review the UI at mobile and desktop widths before deployment.

## Deploy (after validation)
`npm run build` then `firebase deploy --only hosting` from the correct configured Firebase project. This package has not been deployed.
