// Sensitive capabilities are GATED OFF. They need documented policy / privacy / provider approval before enabling.
// These are constants (not user-togglable) so a beta tester cannot switch them on from the browser.
export const FEATURE_FLAGS = Object.freeze({
  geofenceClockIn: false,        // GPS clock-in: needs HR policy + privacy review
  facialBiometrics: false,       // excluded from automatic activation
  receiptOcr: false,             // needs approved provider + privacy assessment + cost authorisation
  predictiveStaffing: false,     // needs reliable historical data; never presented as fact
  automatedSalaryChanges: false, // never automatic
  pushNotifications: false,      // needs service-worker permission flow + server credentials
  offlineSubmission: false,      // needs encrypted queue + idempotency + security sign-off
  payrollBankExport: false       // needs jurisdictional validation + dedicated tests
});
export const isEnabled = (name) => FEATURE_FLAGS[name] === true;
export const gatedFeatures = () => Object.entries(FEATURE_FLAGS).filter(([, v]) => !v).map(([k]) => k);
