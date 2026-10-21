# UI/UX update — understated professional workspace

Apple-inspired visual direction: white and soft grey surfaces, charcoal typography, restrained blue accents, generous spacing, pill buttons and fine borders. Existing SQHR / Setar Quay branding is retained.

## Changes

- Split sign-in layout on desktop, compact sign-in on mobile; password visibility and autocomplete.
- Consistent dashboard cards, forms, tables and modals.
- Mobile header with upload, refresh and logout; slide-out navigation exposes attendance, staff, holidays and reports.
- Drawer close button, Escape support, keyboard focus handling and focus indicators.
- Staff keyword search, employment status filter, result count and no-match feedback.
- Visible error/retry feedback for failed dashboard loads; refresh button disables while loading.
- Associated field labels and announced status/error messages.
- Attendance staff selector now triggers rendering when its selection changes.
- Payroll templates and calculation logic retained.

## Verification

Production build and backend regression checks pass. DOM interaction checks pass for sign-in, password visibility, staff search/status/no matches, generated navigation, drawer focus/open/close, staff modal and network-failure feedback.

No browser visual QA was available in this environment. Confirm desktop and phone layout, chart drawing and PDF/Excel exports in a browser after deployment. The project retains the previously documented jQuery compatibility layer and backend authentication limitations.

## Update Firebase from PowerShell

Extract the project folder, open PowerShell there, then run:

```powershell
npm ci
Copy-Item .env.example .env
npm run build
firebase deploy --only hosting --project workpluse
```

The package contains the updated Apps Script URL and workpluse project configuration. It includes the built dist folder; source changes require rebuilding. The live Firebase site has not been changed by this UI update.

## Theme consistency
Graphite actions, links, navigation and focus states. Muted slate, taupe and sage chart colours, including drill-down charts. Neutral logout outline. Status colours retained.

System-wide consistency: Bootstrap navigation pills/tabs, links, subtle primary surfaces, borders, dropdowns, pagination, lists, progress, accordions, checkbox focus and secondary controls inherit shared neutral tokens. Legacy blue table highlights replaced. Export action follows the primary action style. Semantic approval/error/warning colours remain recognisable.
