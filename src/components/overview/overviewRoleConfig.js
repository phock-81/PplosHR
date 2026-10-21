/**
 * overviewRoleConfig.js
 * 
 * Master configuration defining the 4 distinct role dashboard compositions:
 * 1. User / Employee (My Overview)
 * 2. HOD / Manager (My Team Overview)
 * 3. HR (HR Operations Overview)
 * 4. Admin / Superadmin (Enterprise & System Overview)
 */

export const OVERVIEW_ROLES = {
  USER: 'User',
  HOD: 'HOD',
  HR: 'HR',
  ADMIN: 'Admin'
};

export const ROLE_CONFIGS = {
  User: {
    role: 'User',
    title: 'My Overview',
    subtitle: 'Personal workspace, leave balances, attendance & claims',
    badge: 'Employee Self-Service',
    kpis: [
      { id: 'M01', key: 'alBalance', label: 'Annual Leave Balance', unit: 'days', icon: 'calendar-check', drilldown: 'myLeave' },
      { id: 'M02', key: 'attendanceState', label: 'Today Attendance', unit: 'status', icon: 'clock', drilldown: 'myAttendance' },
      { id: 'M03', key: 'pendingRequests', label: 'My Pending Requests', unit: 'requests', icon: 'inbox', drilldown: 'myRequests' },
      { id: 'M04', key: 'claimRemaining', label: 'Flexi-Wellness Balance', unit: 'RM', icon: 'heart-pulse', drilldown: 'myClaims' }
    ],
    quickActions: [
      { id: 'applyLeave', label: 'Apply Leave', icon: 'calendar-plus', action: 'openApplyLeave' },
      { id: 'submitClaim', label: 'Submit Claim', icon: 'receipt', action: 'openSubmitClaim' },
      { id: 'myPayslips', label: 'My Payslips', icon: 'file-earmark-ruled', action: 'navPayslips' },
      { id: 'mySchedule', label: 'My Schedule', icon: 'calendar3', action: 'navSchedule' }
    ],
    widgets: ['personalKpis', 'quickActions', 'leaveProgress', 'attendanceTrend', 'upcomingLeave', 'recentRequests']
  },

  HOD: {
    role: 'HOD',
    title: 'My Team Overview',
    subtitle: 'Supervised team readiness, shift coverage & pending approvals',
    badge: 'Team Management',
    kpis: [
      { id: 'M07', key: 'teamHeadcount', label: 'Supervised Team', unit: 'people', icon: 'people', drilldown: 'teamDirectory' },
      { id: 'M08', key: 'onLeaveToday', label: 'On Leave Today', unit: 'people', icon: 'person-dash', drilldown: 'teamLeave' },
      { id: 'M09', key: 'upcomingLeave7d', label: 'Upcoming Leave (7d)', unit: 'people', icon: 'calendar-week', drilldown: 'teamLeave' },
      { id: 'M10', key: 'actionableApprovals', label: 'Actionable Approvals', unit: 'requests', icon: 'check2-square', drilldown: 'actionInbox' },
      { id: 'M11', key: 'attendanceExceptions', label: 'Attendance Exceptions', unit: 'records', icon: 'exclamation-diamond', drilldown: 'attendanceExceptions' }
    ],
    widgets: ['teamKpis', 'actionInbox', 'teamLeaveHeatmap', 'coverageGauge', 'pendingByAge', 'teamRenewals']
  },

  HR: {
    role: 'HR',
    title: 'HR Operations Overview',
    subtitle: 'Workforce movement, policy adherence, recruitment & operations',
    badge: 'People Operations',
    kpis: [
      { id: 'M13', key: 'activeHeadcount', label: 'Active Headcount', unit: 'people', icon: 'buildings', drilldown: 'directory' },
      { id: 'M14', key: 'joinersLeavers', label: 'Joiners / Leavers (YTD)', unit: 'net change', icon: 'arrow-left-right', drilldown: 'directory' },
      { id: 'M16', key: 'claimsApprovedRM', label: 'Approved Claims (YTD)', unit: 'RM', icon: 'cash-stack', drilldown: 'claims' },
      { id: 'M18', key: 'trainingExpiring', label: 'Certificates Expiring', unit: 'certificates', icon: 'award', drilldown: 'training' },
      { id: 'M19', key: 'recruitmentPipeline', label: 'Active Candidates', unit: 'candidates', icon: 'person-plus', drilldown: 'recruitment' }
    ],
    widgets: ['hrKpis', 'actionInbox', 'headcountByDept', 'claimsByState', 'recruitmentFunnel', 'leaveByDept']
  },

  Admin: {
    role: 'Admin',
    title: 'Enterprise & System Overview',
    subtitle: 'Multi-entity corporate governance, payroll locks & system integrity',
    badge: 'Superadmin Console',
    kpis: [
      { id: 'M21', key: 'companyCount', label: 'Operating Companies', unit: 'companies', icon: 'building', drilldown: 'companies' },
      { id: 'M13', key: 'totalHeadcount', label: 'Enterprise Headcount', unit: 'people', icon: 'people-fill', drilldown: 'directory' },
      { id: 'M22', key: 'payrollReadiness', label: 'Payroll Lock Status', unit: 'status', icon: 'lock', drilldown: 'payroll' },
      { id: 'M24', key: 'dataGaps', label: 'Staff Profile Gaps', unit: 'people', icon: 'shield-exclamation', drilldown: 'dataGaps' },
      { id: 'M23', key: 'syncFreshness', label: 'Data Freshness (MYT)', unit: 'timestamp', icon: 'cloud-check', drilldown: 'syncDetails' }
    ],
    widgets: ['adminKpis', 'actionInbox', 'multiCompanyBreakdown', 'payrollLockSummary', 'dataQualityAudit', 'systemHealth']
  }
};

/**
 * Returns role-appropriate config.
 */
export function getOverviewConfigForRole(rawRole) {
  const norm = rawRole === 'Supervisor' ? 'HOD' : rawRole === 'Staff' ? 'User' : rawRole || 'User';
  return ROLE_CONFIGS[norm] || ROLE_CONFIGS.User;
}
