<template>
  <div class="overview-insights">
    <!-- 1. USER COMPOSITION -->
    <template v-if="normalizedRole === 'User'">
      <div class="row g-3 mb-4">
        <!-- Leave Entitlement & Utilization Progress Bar -->
        <div class="col-12 col-lg-8">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <h6 class="fw-bold mb-0 text-dark"><i class="bi bi-pie-chart-fill text-primary me-2"></i>Annual Leave Entitlement & Utilization</h6>
              <span class="badge bg-light text-dark border">{{ currentYear }} Leave Year</span>
            </div>
            
            <div class="my-3">
              <div class="d-flex justify-content-between small text-muted mb-1">
                <span>Consumed: <strong>{{ userLeaveUsed == null ? '—' : userLeaveUsed + ' days' }}</strong></span>
                <span>Balance: <strong class="text-primary">{{ userLeaveBalance == null ? '—' : userLeaveBalance + ' days' }}</strong></span>
              </div>
              <div v-if="userLeavePercent != null" class="progress" style="height: 12px;">
                <div 
                  class="progress-bar bg-primary" 
                  role="progressbar" 
                  :style="{ width: userLeavePercent + '%' }" 
                  :aria-valuenow="userLeavePercent" 
                  aria-valuemin="0" 
                  aria-valuemax="100"
                ></div>
              </div>
              <div class="d-flex justify-content-between extra-small text-muted mt-2">
                <span>Total Entitlement: {{ userLeaveEntitlement == null ? '—' : userLeaveEntitlement + ' days' }}</span>
                <span v-if="userLeavePercent != null">{{ userLeavePercent }}% utilized</span>
              </div>
            </div>

            <p v-if="userLeave.error" class="small text-warning-emphasis" role="status">{{ userLeave.error }} {{ userLeaveBalance != null ? 'Showing the last loaded balance.' : '' }}</p>
            <p v-else-if="userLeaveBalance == null" class="small text-muted" role="status">{{ userLeave.loading ? 'Loading your leave balance…' : 'Leave balance is unavailable. Refresh to try again.' }}</p>
            <!-- Quick Action Shortcuts -->
            <div class="mt-4 pt-3 border-top">
              <div class="small fw-bold text-dark mb-2">Self-Service Quick Actions:</div>
              <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-primary btn-sm fw-semibold shadow-sm" @click="$emit('nav', 'applyLeave')">
                  <i class="bi bi-calendar-plus me-1"></i>Apply Leave
                </button>
                <button class="btn btn-outline-success btn-sm fw-semibold shadow-sm" @click="$emit('nav', 'submitClaim')">
                  <i class="bi bi-receipt me-1"></i>Submit Claim
                </button>
                <button class="btn btn-outline-dark btn-sm fw-semibold shadow-sm" @click="$emit('nav', 'myPayslips')">
                  <i class="bi bi-file-earmark-text me-1"></i>My Payslips
                </button>
                <button class="btn btn-outline-secondary btn-sm fw-semibold shadow-sm" @click="$emit('nav', 'myAttendance')">
                  <i class="bi bi-clock-history me-1"></i>My Attendance
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Upcoming Approved Leave -->
        <div class="col-12 col-lg-4">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <h6 class="fw-bold mb-3 text-dark"><i class="bi bi-calendar-event text-success me-2"></i>Upcoming Approved Leave</h6>
            <div v-if="!upcomingUserLeave.length" class="text-center py-4 text-muted">
              <i class="bi bi-sun fs-3 text-warning mb-2 d-block"></i>
              <div class="small">No upcoming approved leave</div>
            </div>
            <div v-else class="list-group list-group-flush">
              <div v-for="l in upcomingUserLeave" :key="l.id" class="list-group-item px-0 py-2 border-light-subtle">
                <div class="d-flex justify-content-between align-items-center">
                  <span class="badge bg-success-subtle text-success">{{ l.category || 'Leave' }}</span>
                  <span class="extra-small text-muted">{{ l.days }} day(s)</span>
                </div>
                <div class="small fw-semibold mt-1">{{ l.start }} to {{ l.end }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 2. HOD COMPOSITION -->
    <template v-else-if="normalizedRole === 'HOD'">
      <div class="row g-3 mb-4">
        <!-- Team Leave Calendar / Heatmap -->
        <div class="col-12 col-lg-8">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <h6 class="fw-bold mb-0 text-dark"><i class="bi bi-calendar3-range text-primary me-2"></i>Team Leave & Absence Radar (Next 14 Days)</h6>
              <span class="badge bg-primary-subtle text-primary">{{ teamLeaveUpcoming.length }} planned</span>
            </div>
            <div v-if="!teamLeaveUpcoming.length" class="text-center py-4 text-muted">
              <i class="bi bi-people fs-3 text-primary mb-2 d-block"></i>
              <div class="small">Full team present! No upcoming absences recorded for your subordinates.</div>
            </div>
            <div v-else class="table-responsive">
              <table class="table table-sm table-hover align-middle mb-0">
                <thead class="table-light extra-small text-uppercase">
                  <tr>
                    <th>Subordinate</th>
                    <th>Type</th>
                    <th>Period</th>
                    <th>Days</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody class="small">
                  <tr v-for="l in teamLeaveUpcoming.slice(0, 8)" :key="l.id">
                    <td class="fw-semibold">{{ l.name || l.employee }}</td>
                    <td><span class="badge bg-secondary-subtle text-secondary">{{ l.type || l.leaveType || l.category || 'Leave' }}</span></td>
                    <td class="text-nowrap">{{ formatPeriod(l.start, l.end) }}</td>
                    <td>{{ l.days || l.totalDays }}d</td>
                    <td><span :class="['badge', getLeaveStatusBadge(l.status).badgeClass]">{{ getLeaveStatusBadge(l.status).label }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Team Readiness & Coverage Today -->
        <div class="col-12 col-lg-4">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <h6 class="fw-bold mb-3 text-dark"><i class="bi bi-shield-check text-success me-2"></i>Today's Team Readiness</h6>
            <div class="p-3 bg-light rounded-3 text-center mb-3">
              <div class="display-6 fw-bold text-success">{{ teamAvailableToday }}</div>
              <div class="extra-small text-muted text-uppercase fw-semibold mt-1">Available Staff / {{ teamTotalCount }} Total</div>
            </div>
            <div class="small text-muted">
              <div class="d-flex justify-content-between py-1 border-bottom">
                <span>Active Subordinates:</span>
                <strong>{{ teamTotalCount }}</strong>
              </div>
              <div class="d-flex justify-content-between py-1 border-bottom">
                <span>On Approved Leave:</span>
                <strong class="text-danger">{{ teamOnLeaveTodayCount }}</strong>
              </div>
              <div class="d-flex justify-content-between py-1">
                <span>Estimated Coverage:</span>
                <strong class="text-primary">{{ teamCoveragePercent }}%</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 3. HR OPERATIONS COMPOSITION -->
    <template v-else-if="normalizedRole === 'HR'">
      <div class="row g-3 mb-4">
        <!-- Headcount Breakdown with Company / Department Toggle -->
        <div class="col-12 col-lg-6">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
              <div class="d-flex align-items-center gap-2">
                <h6 class="fw-bold mb-0 text-dark">
                  <i :class="headcountMode === 'company' ? 'bi bi-building' : 'bi bi-diagram-3'" class="text-primary me-2"></i>
                  Headcount by {{ headcountMode === 'company' ? 'Company' : 'Department' }}
                </h6>
              </div>
              <div class="d-flex align-items-center gap-2">
                <div class="btn-group btn-group-sm" role="group" aria-label="Toggle headcount grouping">
                  <button
                    type="button"
                    class="btn py-1 px-2 fw-semibold"
                    :class="headcountMode === 'company' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="headcountMode = 'company'"
                  >
                    Company
                  </button>
                  <button
                    type="button"
                    class="btn py-1 px-2 fw-semibold"
                    :class="headcountMode === 'department' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="headcountMode = 'department'"
                  >
                    Department
                  </button>
                </div>
                <span class="badge bg-light text-dark border">
                  {{ headcountMode === 'company' ? (Object.keys(workforce.byCompany || {}).length + ' companies') : (Object.keys(workforce.byDept || {}).length + ' depts') }}
                </span>
              </div>
            </div>
            <div class="dept-bars">
              <div
                v-for="(count, groupKey) in currentHeadcountGroups"
                :key="groupKey"
                class="mb-2 p-2 rounded headcount-item cursor-pointer"
                @click="openStaffListModal(groupKey)"
                :title="headcountMode === 'company' ? 'Click to view headcount summary by department for ' + groupKey : 'Click to view staff under ' + groupKey"
              >
                <div class="d-flex justify-content-between small mb-1">
                  <span class="fw-semibold text-truncate text-dark group-title" style="max-width: 250px;">
                    <i class="bi bi-chevron-right me-1 extra-small text-primary"></i>{{ groupKey }}
                  </span>
                  <span class="text-muted">{{ count }} staff ({{ Math.round((count / (workforce.total || 1)) * 100) }}%)</span>
                </div>
                <div class="progress" style="height: 6px;">
                  <div class="progress-bar bg-primary" :style="{ width: Math.round((count / (workforce.total || 1)) * 100) + '%' }"></div>
                </div>
              </div>
              <div v-if="!Object.keys(currentHeadcountGroups).length" class="text-muted small py-3 text-center">
                No staff records mapped yet.
              </div>
            </div>
            <div class="extra-small text-muted mt-2 pt-2 border-top d-flex align-items-center justify-content-between">
              <span><i class="bi bi-cursor-fill me-1 text-primary"></i>Click on any {{ headcountMode === 'company' ? 'company to view department headcount summary' : 'department to view staff list' }}</span>
              <span class="fw-bold">{{ workforce.total || 0 }} Total Staff</span>
            </div>
          </div>
        </div>

        <!-- Claims Financial Exposure by Workflow Status -->
        <div class="col-12 col-lg-6">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <h6 class="fw-bold mb-0 text-dark"><i class="bi bi-cash-stack text-success me-2"></i>Claims Financial Summary (YTD)</h6>
              <span class="badge bg-success-subtle text-success">RM {{ money(claimsSummary.totalRM) }} total</span>
            </div>
            <div class="row g-2 text-center my-3">
              <div class="col-4">
                <div class="p-2 border rounded-3 bg-light">
                  <div class="extra-small text-muted text-uppercase">Requested</div>
                  <div class="fw-bold text-warning fs-6 mt-1">RM {{ money(claimsSummary.requestedRM) }}</div>
                </div>
              </div>
              <div class="col-4">
                <div class="p-2 border rounded-3 bg-light">
                  <div class="extra-small text-muted text-uppercase">Approved</div>
                  <div class="fw-bold text-primary fs-6 mt-1">RM {{ money(claimsSummary.approvedRM) }}</div>
                </div>
              </div>
              <div class="col-4">
                <div class="p-2 border rounded-3 bg-light">
                  <div class="extra-small text-muted text-uppercase">Paid</div>
                  <div class="fw-bold text-success fs-6 mt-1">RM {{ money(claimsSummary.paidRM) }}</div>
                </div>
              </div>
            </div>
            <div class="extra-small text-muted border-top pt-2 mt-2">
              <i class="bi bi-info-circle me-1"></i>Approved claims are staged for payroll reimbursement up to the 20th of the month.
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 4. ENTERPRISE ADMIN COMPOSITION -->
    <template v-else-if="normalizedRole === 'Admin'">
      <div class="row g-3 mb-4">
        <!-- Multi-Entity Corporate Headcount Breakdown with Toggle -->
        <div class="col-12 col-lg-6">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
              <div class="d-flex align-items-center gap-2">
                <h6 class="fw-bold mb-0 text-dark">
                  <i :class="headcountMode === 'company' ? 'bi bi-building' : 'bi bi-diagram-3'" class="text-primary me-2"></i>
                  Corporate Headcount by {{ headcountMode === 'company' ? 'Company' : 'Department' }}
                </h6>
              </div>
              <div class="d-flex align-items-center gap-2">
                <div class="btn-group btn-group-sm" role="group" aria-label="Toggle headcount grouping">
                  <button
                    type="button"
                    class="btn py-1 px-2 fw-semibold"
                    :class="headcountMode === 'company' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="headcountMode = 'company'"
                  >
                    Company
                  </button>
                  <button
                    type="button"
                    class="btn py-1 px-2 fw-semibold"
                    :class="headcountMode === 'department' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="headcountMode = 'department'"
                  >
                    Department
                  </button>
                </div>
                <span class="badge bg-light text-dark border">
                  {{ headcountMode === 'company' ? (Object.keys(workforce.byCompany || {}).length + ' companies') : (Object.keys(workforce.byDept || {}).length + ' depts') }}
                </span>
              </div>
            </div>
            <div class="dept-bars">
              <div
                v-for="(count, groupKey) in currentHeadcountGroups"
                :key="groupKey"
                class="mb-2 p-2 rounded headcount-item cursor-pointer"
                @click="openStaffListModal(groupKey)"
                :title="headcountMode === 'company' ? 'Click to view headcount summary by department for ' + groupKey : 'Click to view staff under ' + groupKey"
              >
                <div class="d-flex justify-content-between small mb-1">
                  <span class="fw-semibold text-truncate text-dark group-title" style="max-width: 250px;">
                    <i class="bi bi-chevron-right me-1 extra-small text-primary"></i>{{ groupKey }}
                  </span>
                  <span class="text-muted">{{ count }} staff ({{ Math.round((count / (workforce.total || 1)) * 100) }}%)</span>
                </div>
                <div class="progress" style="height: 6px;">
                  <div class="progress-bar bg-primary" :style="{ width: Math.round((count / (workforce.total || 1)) * 100) + '%' }"></div>
                </div>
              </div>
              <div v-if="!Object.keys(currentHeadcountGroups).length" class="text-muted small py-3 text-center">
                No staff records mapped yet.
              </div>
            </div>
            <div class="extra-small text-muted mt-2 pt-2 border-top d-flex align-items-center justify-content-between">
              <span><i class="bi bi-cursor-fill me-1 text-primary"></i>Click on any {{ headcountMode === 'company' ? 'company to view department headcount summary' : 'department to view staff list' }}</span>
              <span class="fw-bold">{{ workforce.total || 0 }} Total Staff</span>
            </div>
          </div>
        </div>

        <!-- System Integrity & Staff Profile Quality Gaps -->
        <div class="col-12 col-lg-6">
          <div class="bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <h6 class="fw-bold mb-0 text-dark"><i class="bi bi-shield-check text-success me-2"></i>Data Quality & System Integrity</h6>
              <span class="badge" :class="dataGaps.hasGaps ? 'bg-warning-subtle text-warning-emphasis' : 'bg-success-subtle text-success'">
                {{ dataGaps.hasGaps ? 'Gaps Detected' : 'All Mapped' }}
              </span>
            </div>
            <div class="small">
              <div class="d-flex justify-content-between py-2 border-bottom">
                <span><i class="bi bi-diagram-2 me-2 text-muted"></i>Missing Department Assignment:</span>
                <span class="badge" :class="dataGaps.missingDeptCount ? 'bg-warning-subtle text-warning-emphasis' : 'bg-light text-muted'">{{ dataGaps.missingDeptCount }} staff</span>
              </div>
              <div class="d-flex justify-content-between py-2 border-bottom">
                <span><i class="bi bi-person-lines-fill me-2 text-muted"></i>Missing Reporting Manager:</span>
                <span class="badge" :class="dataGaps.missingManagerCount ? 'bg-warning-subtle text-warning-emphasis' : 'bg-light text-muted'">{{ dataGaps.missingManagerCount }} staff</span>
              </div>
              <div class="d-flex justify-content-between py-2 border-bottom">
                <span><i class="bi bi-award me-2 text-muted"></i>Missing Job Grade:</span>
                <span class="badge" :class="dataGaps.missingGradeCount ? 'bg-warning-subtle text-warning-emphasis' : 'bg-light text-muted'">{{ dataGaps.missingGradeCount }} staff</span>
              </div>
              <div class="d-flex justify-content-between py-2">
                <span><i class="bi bi-fingerprint me-2 text-muted"></i>Missing Biometric ID:</span>
                <span class="badge" :class="dataGaps.missingBiometricCount ? 'bg-warning-subtle text-warning-emphasis' : 'bg-light text-muted'">{{ dataGaps.missingBiometricCount }} staff</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Staff List / Headcount Summary Modal for Selected Department / Company -->
    <div v-if="selectedGroup" class="modal fade show d-block" tabindex="-1" style="background-color: rgba(0,0,0,0.5); z-index: 1060;">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content shadow-lg border-0 rounded-3">
          <div class="modal-header bg-light py-2 px-3 border-bottom">
            <h6 class="modal-title fw-bold text-dark d-flex align-items-center gap-2 mb-0">
              <i :class="selectedGroup.type === 'Company' ? 'bi bi-building' : 'bi bi-diagram-3'" class="text-primary"></i>
              <template v-if="selectedGroup.type === 'Company'">
                Headcount Summary by Department · {{ selectedGroup.title }}
              </template>
              <template v-else>
                Staff in {{ selectedGroup.title }}
              </template>
              <span class="badge bg-primary-subtle text-primary ms-1">{{ selectedGroup.staff.length }} Staff</span>
            </h6>
            <button type="button" class="btn-close btn-sm" @click="selectedGroup = null"></button>
          </div>
          <div class="modal-body p-3">
            <!-- Company Selection: Visual Headcount Summary by Department -->
            <div v-if="selectedGroup.type === 'Company'" class="mb-3 p-3 bg-light rounded-3 border">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <span class="small fw-bold text-dark text-uppercase d-flex align-items-center gap-1">
                  <i class="bi bi-diagram-3 text-primary"></i>Department Breakdown
                </span>
                <span class="badge bg-white text-muted border">
                  {{ Object.keys(selectedGroup.deptBreakdown || {}).length }} Departments · {{ selectedGroup.staff.length }} Total Staff
                </span>
              </div>
              <div class="row g-2 mb-2">
                <div
                  v-for="(count, dName) in selectedGroup.deptBreakdown"
                  :key="dName"
                  class="col-12 col-sm-6"
                >
                  <div
                    class="p-2 border rounded-2 bg-white d-flex flex-column justify-content-between cursor-pointer headcount-dept-card"
                    :class="{'border-primary bg-primary-subtle shadow-sm': selectedDeptFilter === dName}"
                    @click="selectedDeptFilter = selectedDeptFilter === dName ? 'all' : dName"
                    :title="'Click to filter staff under ' + dName"
                  >
                    <div class="d-flex justify-content-between align-items-center mb-1">
                      <span class="small fw-semibold text-truncate me-2" :class="selectedDeptFilter === dName ? 'text-primary' : 'text-dark'">{{ dName }}</span>
                      <span class="badge" :class="selectedDeptFilter === dName ? 'bg-primary text-white' : 'bg-secondary-subtle text-secondary'">{{ count }} staff</span>
                    </div>
                    <div class="progress" style="height: 5px;">
                      <div class="progress-bar bg-primary" :style="{ width: Math.round((count / (selectedGroup.staff.length || 1)) * 100) + '%' }"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="d-flex align-items-center justify-content-between pt-2 border-top flex-wrap gap-1">
                <div class="extra-small text-muted">
                  <i class="bi bi-funnel me-1"></i>Filter roster:
                </div>
                <div class="d-flex gap-1 flex-wrap">
                  <button
                    type="button"
                    class="btn btn-sm py-0 px-2 extra-small rounded-pill"
                    :class="selectedDeptFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="selectedDeptFilter = 'all'"
                  >
                    All ({{ selectedGroup.staff.length }})
                  </button>
                  <button
                    v-for="(count, dName) in selectedGroup.deptBreakdown"
                    :key="'btn-' + dName"
                    type="button"
                    class="btn btn-sm py-0 px-2 extra-small rounded-pill"
                    :class="selectedDeptFilter === dName ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="selectedDeptFilter = dName"
                  >
                    {{ dName }} ({{ count }})
                  </button>
                </div>
              </div>
            </div>

            <div class="mb-3">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white"><i class="bi bi-search text-muted"></i></span>
                <input v-model="staffSearch" type="text" class="form-control" placeholder="Search staff by name, ID, job title..." />
                <button v-if="staffSearch" class="btn btn-outline-secondary" type="button" @click="staffSearch = ''"><i class="bi bi-x"></i></button>
              </div>
            </div>
            <div class="table-responsive" style="max-height: 380px;">
              <table class="table table-hover table-sm align-middle mb-0">
                <thead class="table-light sticky-top">
                  <tr>
                    <th>Staff Name</th>
                    <th>ID / Biometric</th>
                    <th>Job Title</th>
                    <th>Company</th>
                    <th>Department</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in filteredModalStaff" :key="s.name || s.id">
                    <td class="fw-semibold text-dark">{{ s.name }}</td>
                    <td class="small text-muted">{{ s.employeeNo || s.biometricId || '—' }}</td>
                    <td class="small">{{ s.jobTitle || 'Unassigned' }}</td>
                    <td class="small"><span class="badge bg-light text-dark border">{{ getStaffCompanyLabel(s) }}</span></td>
                    <td class="small"><span class="badge bg-light text-dark border">{{ getStaffDeptLabel(s) }}</span></td>
                    <td><span class="badge bg-success-subtle text-success border">Active</span></td>
                  </tr>
                  <tr v-if="filteredModalStaff.length === 0">
                    <td colspan="6" class="text-center py-4 text-muted">No staff found matching search.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer py-2 px-3 bg-light border-top">
            <span class="small text-muted me-auto">
              Showing {{ filteredModalStaff.length }} of {{ selectedGroup.staff.length }} staff
              <span v-if="selectedGroup.type === 'Company' && selectedDeptFilter !== 'all'" class="badge bg-primary-subtle text-primary ms-1">Filtered by {{ selectedDeptFilter }}</span>
            </span>
            <button type="button" class="btn btn-secondary btn-sm" @click="selectedGroup = null">Close</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { normalizeRole, getMytToday } from './OverviewMetricService';
import { formatDateDMY } from '../../utils/dateUtils';

const props = defineProps({
  role: { type: String, default: 'User' },
  user: { type: Object, default: () => ({}) },
  employees: { type: Array, default: () => [] },
  companies: { type: Array, default: () => [] },
  departments: { type: Array, default: () => [] },
  teamLeave: { type: Array, default: () => [] },
  userLeave: { type: Object, default: () => ({}) },
  workforce: { type: Object, default: () => ({ byDept: {}, byCompany: {}, total: 0 }) },
  claimsSummary: { type: Object, default: () => ({ requestedRM: 0, approvedRM: 0, paidRM: 0, totalRM: 0 }) },
  dataGaps: { type: Object, default: () => ({ missingDeptCount: 0, missingManagerCount: 0, missingGradeCount: 0, missingBiometricCount: 0, hasGaps: false }) }
});

defineEmits(['nav']);

const currentYear = computed(() => getMytToday().slice(0, 4));
const normalizedRole = computed(() => normalizeRole(props.role));

const money = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Headcount Breakdown Mode (Company by default or Department)
const headcountMode = ref('company');
const selectedGroup = ref(null);
const selectedDeptFilter = ref('all');
const staffSearch = ref('');

const currentHeadcountGroups = computed(() => {
  if (headcountMode.value === 'company') {
    return props.workforce.byCompany || {};
  }
  return props.workforce.byDept || {};
});

const getStaffDeptLabel = (s) => {
  const raw = s.departmentId || s.department || s.departmentName || '';
  const d = (props.departments || []).find(x => x.id === raw || x.code === raw || x.title === raw);
  if (d) return d.code && d.title && d.code !== d.title ? `${d.title} (${d.code})` : (d.title || d.code);
  return s.department && !/^[0-9a-f-]{10,}$/i.test(s.department) ? s.department : (raw || '—');
};

const getStaffCompanyLabel = (s) => {
  const raw = s.companyId || s.company || s.companyName || '';
  const c = (props.companies || []).find(x => x.id === raw || x.code === raw || x.title === raw);
  if (c) return c.title || c.name || c.code;
  return s.company && !/^[0-9a-f-]{10,}$/i.test(s.company) ? s.company : (raw || '—');
};

const openStaffListModal = (groupKey) => {
  let list = [];
  let deptBreakdown = {};
  if (headcountMode.value === 'company') {
    list = (props.workforce.staffByCompany && props.workforce.staffByCompany[groupKey]) || [];
    deptBreakdown = (props.workforce.deptBreakdownByCompany && props.workforce.deptBreakdownByCompany[groupKey]) || {};
  } else {
    list = (props.workforce.staffByDept && props.workforce.staffByDept[groupKey]) || [];
  }
  selectedGroup.value = {
    title: groupKey,
    type: headcountMode.value === 'company' ? 'Company' : 'Department',
    staff: list,
    deptBreakdown
  };
  selectedDeptFilter.value = 'all';
  staffSearch.value = '';
};

const filteredModalStaff = computed(() => {
  if (!selectedGroup.value) return [];
  let list = selectedGroup.value.staff;
  if (selectedGroup.value.type === 'Company' && selectedDeptFilter.value && selectedDeptFilter.value !== 'all') {
    list = list.filter(s => getStaffDeptLabel(s) === selectedDeptFilter.value);
  }
  const q = String(staffSearch.value || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(s => {
    return (s.name || '').toLowerCase().includes(q) ||
           (s.employeeNo || '').toLowerCase().includes(q) ||
           (s.jobTitle || '').toLowerCase().includes(q) ||
           (s.biometricId || '').toLowerCase().includes(q);
  });
});

// User calculations
const userLeaveEntitlement = computed(() => props.userLeave?.alEntitlement ?? null);
const userLeaveBalance = computed(() => props.userLeave?.alBalance ?? null);
const userLeaveUsed = computed(() => props.userLeave?.alUsed ?? null);
const userLeavePercent = computed(() => {
  if (userLeaveEntitlement.value == null || userLeaveUsed.value == null) return null;
  if (userLeaveEntitlement.value <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((userLeaveUsed.value / userLeaveEntitlement.value) * 100)));
});

const upcomingUserLeave = computed(() => {
  const today = getMytToday();
  return (props.userLeave?.applications || [])
    .filter(a => a.start >= today && ['approved', 'Approved'].includes(a.status))
    .slice(0, 5);
});

// HOD calculations
const teamSubordinates = computed(() => {
  const mName = String(props.user?.name || '').toUpperCase();
  return (props.employees || []).filter(e => String(e.manager || '').toUpperCase() === mName && e.status !== 'Resigned');
});

const formatPeriod = (start, end) => {
  const s = formatDateDMY(start);
  const e = formatDateDMY(end);
  if (s && e) return `${s} - ${e}`;
  return s || e || '—';
};

const getLeaveStatusBadge = (status) => {
  const s = String(status || '').trim().toLowerCase();
  if (['approved'].includes(s)) {
    return { label: 'Approved', badgeClass: 'bg-success-subtle text-success border border-success-subtle' };
  }
  if (['pending_hod', 'pending_admin', 'pending', 'pending approval', 'awaiting hod approval', 'awaiting hr approval'].includes(s) || !s) {
    return { label: 'Pending Approval', badgeClass: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle' };
  }
  if (['withdrawal requested', 'withdrawal_requested'].includes(s)) {
    return { label: 'Withdrawal Requested', badgeClass: 'bg-warning-subtle text-dark border border-warning-subtle' };
  }
  if (['rejected'].includes(s)) {
    return { label: 'Rejected', badgeClass: 'bg-danger-subtle text-danger border border-danger-subtle' };
  }
  if (['withdrawn'].includes(s)) {
    return { label: 'Withdrawn', badgeClass: 'bg-secondary-subtle text-secondary border border-secondary-subtle' };
  }
  return { label: status || 'Pending Approval', badgeClass: 'bg-light text-dark border' };
};

const teamTotalCount = computed(() => teamSubordinates.value.length);

const teamLeaveUpcoming = computed(() => {
  const teamNames = new Set(teamSubordinates.value.map(e => String(e.name || '').toUpperCase()));
  const today = getMytToday();
  return (props.teamLeave || [])
    .filter(l => teamNames.has(String(l.name || l.employee || '').toUpperCase()) &&
                 l.end >= today &&
                 !['rejected', 'withdrawn'].includes(String(l.status || '').toLowerCase()))
    .sort((a, b) => a.start.localeCompare(b.start));
});

const teamOnLeaveTodayCount = computed(() => {
  const teamNames = new Set(teamSubordinates.value.map(e => String(e.name || '').toUpperCase()));
  const today = getMytToday();
  return (props.teamLeave || [])
    .filter(l => teamNames.has(String(l.name || l.employee || '').toUpperCase()) &&
                 String(l.status || '').toLowerCase() === 'approved' &&
                 l.start <= today &&
                 l.end >= today)
    .length;
});

const teamAvailableToday = computed(() => Math.max(0, teamTotalCount.value - teamOnLeaveTodayCount.value));
const teamCoveragePercent = computed(() => {
  if (!teamTotalCount.value) return 100;
  return Math.round((teamAvailableToday.value / teamTotalCount.value) * 100);
});
</script>

<style scoped>
.extra-small {
  font-size: 0.75rem;
}
.dept-bars {
  max-height: 250px;
  overflow-y: auto;
}
.headcount-item {
  transition: background-color 0.15s ease-in-out;
}
.headcount-item:hover {
  background-color: #f1f5f9;
}
.headcount-item:hover .group-title {
  color: #0d6efd !important;
}
.cursor-pointer {
  cursor: pointer;
}
.headcount-dept-card {
  transition: all 0.15s ease-in-out;
}
.headcount-dept-card:hover {
  border-color: #0d6efd !important;
  background-color: #f8faff !important;
}
</style>
