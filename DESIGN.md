# PeopleOSHR interface

Adapted from the Apple and Linear design analyses in https://github.com/voltagent/awesome-design-MD (design-md/apple/DESIGN.md and design-md/linear.app/DESIGN.md). These are reference design systems, not dependencies or copied brand assets.

## Visual system

Use white operational surfaces on #f7f7f8; text #242429; secondary text #66666f; border #e5e5e9. Retain the PeopleOSHR copper accent #92502e with #f7ede6 selected surfaces. Semantic danger, warning and success remain distinct and always include text. Use system/Inter fonts, 4px spacing increments, 8px controls and 12px panels. Keep operational screens compact and readable; avoid gradients, floating decorative docks and blur over data tables.

## Desktop

Keep existing role-specific modules, collapsed navigation groups, filters and data scope. Show a role-specific introduction, clearly labelled filters, compact real-data KPIs, request review queue and adjacent insights when space permits. Request list buttons open details; final actions remain inside the existing workflow. Collapse columns below 1200px. Tables retain all operational columns and contained scrolling where necessary.

## PWA

Use the existing Home / Attendance / Requests / Inbox / Me navigation and clock/request workflows. Keep safe-area padding. Display refresh progress and the time of the last successful explicit refresh; never describe cached data as synced without evidence. No sample employee or KPI values. Maintain 44px touch targets and 16px editable controls. Support narrow phones and reduced motion.

## Delivery

This change targets the existing Firebase `peopleoshr` beta channel. No production deployment or Apps Script change is part of this release. The design proposal's illustrative role switcher and fabricated statistics must never enter the live app. Preserve server-side role checks and the service worker's static-only caching policy.
