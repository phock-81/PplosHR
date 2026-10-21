<script setup>
import { ref, computed, onMounted, onActivated, watch } from 'vue';
import { dashboardActions } from '../../services/dashboard';
import { getMobileCached } from '../../services/mobileSessionCache';

const props = defineProps({
  user: { type: Object, required: true },
  records: { type: Object, default: () => ({}) },
  employees: { type: Array, default: () => [] },
  meSelection: { type: Object, default: () => ({ section: 'leave', sequence: 0 }) }
});

const emit = defineEmits(['logout', 'open-dossier']);

const activeTab = ref('leave');
watch(() => props.meSelection?.sequence, () => { if (props.meSelection?.section) activeTab.value = props.meSelection.section; }, { immediate: true });
const showInstallGuidance = ref(false);
const viewLetterModal = ref(null);
const activePayslipDetail = ref(null);

const userInitials = computed(() => {
  const parts = String(props.user?.name || '').trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || 'U').toUpperCase();
});

const photoUrl = ref(props.user?.photo || props.user?.photoUrl || '');
const uploadingPhoto = ref(false);
const mobileFileInput = ref(null);

watch(() => [props.user?.photo, props.user?.photoUrl], () => {
  if (props.user?.photo || props.user?.photoUrl) {
    photoUrl.value = props.user?.photo || props.user?.photoUrl;
  }
});

function triggerPhotoUpload() {
  if (uploadingPhoto.value) return;
  mobileFileInput.value?.click();
}

function compressImageFile(file, maxDimension = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleMobilePhotoUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  if (!file.type.startsWith('image/')) {
    alert('Please select an image file (JPG, PNG).');
    return;
  }

  uploadingPhoto.value = true;
  try {
    const compressed = await compressImageFile(file, 800, 0.85);
    photoUrl.value = compressed;

    const res = await dashboardActions.apiPost('uploadProfilePhoto', {
      name: props.user.name,
      fileData: compressed,
      fileName: file.name || 'profile.jpg',
      mimeType: 'image/jpeg'
    });

    if (res && res.status === 'success' && res.photoUrl) {
      photoUrl.value = res.photoUrl;
      props.user.photo = res.photoUrl;
      props.user.photoUrl = res.photoUrl;
      try {
        const cached = JSON.parse(localStorage.getItem('hrPortalUser') || '{}');
        cached.photo = res.photoUrl;
        cached.photoUrl = res.photoUrl;
        localStorage.setItem('hrPortalUser', JSON.stringify(cached));
      } catch (_) {}
      if (typeof window !== 'undefined') {
        if (window.staffSettings && window.staffSettings[props.user.name]) {
          window.staffSettings[props.user.name].photo = res.photoUrl;
          window.staffSettings[props.user.name].photoUrl = res.photoUrl;
        }
        window.dispatchEvent(new CustomEvent('hr-session', { detail: props.user }));
      }
      alert('Profile photo saved successfully to your Google Drive!');
    } else {
      throw new Error(res?.message || 'Failed to upload photo');
    }
  } catch (err) {
    alert('Failed to save profile photo: ' + (err.message || err));
  } finally {
    uploadingPhoto.value = false;
  }
}

// Full dossier details fetched from backend
const dossierData = ref(null);
const loadingDossier = ref(false);

// Format currency
const money = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Compute user profile info from props or staff settings
const employeeMeta = computed(() => {
  const name = props.user?.name;
  let s = {};
  if (typeof window !== 'undefined' && window.staffSettings) {
    s = window.staffSettings[name] || {};
  }
  const empFromList = (props.employees || []).find((e) => e.name === name || e.employee === name) || {};
  const dossierProfile = dossierData.value?.profile || {};
  return {
    ...empFromList,
    ...s,
    ...dossierProfile,
    ...props.user,
    employeeNo: props.user?.employeeNo || s.employeeNo || empFromList.employeeNo || dossierProfile.employeeNo || props.user?.id || '—',
    biometricId: props.user?.biometricId || s.biometricId || empFromList.biometricId || dossierProfile.biometricId || '',
    grade: props.user?.gradeId || props.user?.grade || s.gradeId || s.gradeCode || empFromList.gradeId || dossierProfile.gradeCode || 'Grade E',
    tenure: s.lengthOfServiceYears != null ? Number(s.lengthOfServiceYears).toFixed(1) + ' yrs' : (props.user?.tenure || dossierProfile.tenureString || '1+ yr'),
    status: props.user?.status || s.status || dossierProfile.status || 'Active',
    icNo: props.user?.icNo || s.icNo || empFromList.icNo || dossierProfile.icNo || '—',
    epfNo: props.user?.epfNo || s.epfNo || empFromList.epfNo || dossierProfile.epfNo || '—',
    socsoNo: props.user?.socsoNo || s.socsoNo || empFromList.socsoNo || dossierProfile.socsoNo || '—',
    taxNo: props.user?.taxNo || s.taxNo || empFromList.taxNo || dossierProfile.taxNo || '—',
    bankNo: props.user?.bankNo || s.bankNo || empFromList.bankNo || dossierProfile.bankNo || '—',
    department: props.user?.department || s.department || empFromList.department || dossierProfile.departmentName || 'PETROL STATION',
    company: props.user?.company || s.company || empFromList.company || dossierProfile.companyName || 'PeopleOS HR'
  };
});

// Real payslips fetched from backend
const myPayslips = ref([]);
const loadingPayslips = ref(false);

const selectedPayslipYear = ref(new Date().getFullYear().toString());
const showYtdDetail = ref(false);
const sharingPayslip = ref(false);
const currentSharingMonth = ref('');
const shareStatusMsg = ref('');

const availableYears = computed(() => {
  const years = new Set();
  myPayslips.value.forEach((p) => {
    if (p.month && p.month.length >= 4) {
      years.add(p.month.slice(0, 4));
    }
  });
  if (years.size === 0) {
    years.add(new Date().getFullYear().toString());
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a));
});

watch(availableYears, (newYears) => {
  if (newYears.length && !newYears.includes(selectedPayslipYear.value)) {
    selectedPayslipYear.value = newYears[0];
  }
}, { immediate: true });

const filteredPayslips = computed(() => {
  const yr = selectedPayslipYear.value;
  return myPayslips.value.filter((p) => p.month && p.month.startsWith(yr));
});

const ytdSummary = computed(() => {
  const slips = filteredPayslips.value;
  return slips.reduce((acc, p) => {
    acc.gross += Number(p.gross || 0);
    acc.nett += Number(p.nett || 0);
    acc.basic += Number(p.basic || 0);
    acc.otPay += Number(p.otPay || 0);
    acc.deductions += Number(p.deductions || 0);
    acc.epf += Number(p.epf || 0);
    acc.socso += Number(p.socso || 0);
    acc.eis += Number(p.eis || 0);
    acc.pcb += Number(p.pcb || 0);
    acc.epfEmpr += Number(p.epfEmpr || 0);
    acc.socsoEmpr += Number(p.socsoEmpr || 0);
    acc.eisEmpr += Number(p.eisEmpr || 0);
    acc.count += 1;
    return acc;
  }, {
    gross: 0,
    nett: 0,
    basic: 0,
    otPay: 0,
    deductions: 0,
    epf: 0,
    socso: 0,
    eis: 0,
    pcb: 0,
    epfEmpr: 0,
    socsoEmpr: 0,
    eisEmpr: 0,
    count: 0
  });
});

let loadSequence = 0;
async function loadDossierAndPayslips(strict = false) {
  const sequence = ++loadSequence;
  if (!props.user?.name) return;
  const identity = props.user?.employeeNo || props.user?.name;
  const name = String(props.user.name).trim().toUpperCase();
  loadingPayslips.value = true;
  loadingDossier.value = true;
  try {
    // In-memory, per-employee, session-bound cache. Never persist salaries or documents to localStorage/SW.
    const result = await getMobileCached(identity, 'my-payslips-dossier', async () => {
      const [payrollRes, dosRes] = await Promise.all([
        dashboardActions.apiPost('getPayroll', {}),
        dashboardActions.apiPost('getStaffDossier', { employee: props.user.name })
      ]);
      const dossier = dosRes?.status === 'success' ? dosRes.data : null;
      const fromPayroll = payrollRes?.status === 'success' && Array.isArray(payrollRes.data)
        ? payrollRes.data.filter(r => String(r.name || '').trim().toUpperCase() === name)
        : [];
      const fromDossier = Array.isArray(dossier?.payroll) ? dossier.payroll :
        (dossier?.payroll?.history || dossier?.payroll?.records || []);
      if (payrollRes?.status !== 'success' || dosRes?.status !== 'success') throw Error('Payslip and dossier services unavailable.');
      const own = (fromPayroll.length ? fromPayroll : fromDossier)
        .filter(p => !p.name || String(p.name).trim().toUpperCase() === name)
        .sort((a,b) => String(b.month || '').localeCompare(String(a.month || '')))
        .map(p => ({
          month: p.month,
          label: dashboardActions.formatMonthStr ? dashboardActions.formatMonthStr(p.month) : p.month,
          nett: Number(p.nettPay || p.netPay || p.nett || 0),
          gross: Number(p.gross || p.grossWage || 0),
          deductions: Number(p.totalEmpDed || p.totalDeductions || p.deductions || 0),
          basic: Number(p.basic || 0),
          otPay: Number(p.otPay || 0),
          workedDays: Number(p.workedDays || 0),
          epf: Number(p.epfEmp || p.epf || 0),
          socso: Number(p.socsoEmp || p.socso || 0),
          eis: Number(p.eisEmp || p.eis || 0),
          pcb: Number(p.pcb || 0),
          epfEmpr: Number(p.epfEmpr || 0),
          socsoEmpr: Number(p.socsoEmpr || 0),
          eisEmpr: Number(p.eisEmpr || 0),
          totalEmprCont: Number(p.totalEmprCont || (Number(p.epfEmpr || 0) + Number(p.socsoEmpr || 0) + Number(p.eisEmpr || 0))),
          claims: Number(p.claims || 0),
          zeroMcAward: Number(p.zeroMcAward || 0),
          nplDeduction: Number(p.nplDeduction || 0),
          id: p.id || props.user?.employeeNo || '',
          name: p.name || props.user?.name || ''
        }));
      return { dossier, payslips: own };
    }, 5 * 60 * 1000);
    if (sequence !== loadSequence || identity !== (props.user?.employeeNo || props.user?.name)) return;
    myPayslips.value = result.payslips;
    dossierData.value = result.dossier;
  } catch (error) { if (strict === true) throw error; }
  finally { if (sequence === loadSequence) { loadingPayslips.value = false; loadingDossier.value = false; } }
}

onMounted(() => {
  loadDossierAndPayslips();
});

onActivated(loadDossierAndPayslips);
watch(() => props.user?.name, () => {
  myPayslips.value = [];
  dossierData.value = null;
  loadDossierAndPayslips();
});

// Leave balances
const alBalance = computed(() => {
  if (dossierData.value?.leave?.balances) {
    const al = dossierData.value.leave.balances.find((b) => b.category === 'Annual');
    if (al && al.balance != null) return al.balance;
  }
  if (dossierData.value?.leave?.alBalance != null) return dossierData.value.leave.alBalance;
  if (props.user?.alBalance != null && props.user.alBalance !== '—') return props.user.alBalance;
  if (employeeMeta.value?.alBalance != null && employeeMeta.value.alBalance !== '—') return employeeMeta.value.alBalance;
  if (employeeMeta.value?.alEntitlement != null && employeeMeta.value.alEntitlement !== '—') return employeeMeta.value.alEntitlement;
  if (props.user?.alEntitlement != null && props.user.alEntitlement !== '—') return props.user.alEntitlement;
  return '—';
});

const mcBalance = computed(() => {
  if (dossierData.value?.leave?.balances) {
    const mc = dossierData.value.leave.balances.find((b) => b.category === 'Medical');
    if (mc && mc.balance != null) return mc.balance;
  }
  if (dossierData.value?.leave?.mcBalance != null) return dossierData.value.leave.mcBalance;
  if (props.user?.mcBalance != null && props.user.mcBalance !== '—') return props.user.mcBalance;
  if (employeeMeta.value?.mcBalance != null && employeeMeta.value.mcBalance !== '—') return employeeMeta.value.mcBalance;
  if (employeeMeta.value?.mcEntitlement != null && employeeMeta.value.mcEntitlement !== '—') return employeeMeta.value.mcEntitlement;
  if (props.user?.mcEntitlement != null && props.user.mcEntitlement !== '—') return props.user.mcEntitlement;
  return '—';
});

const leaveHistory = computed(() => {
  if (dossierData.value?.leave?.history) return dossierData.value.leave.history;
  return (props.records?.leaves || []).filter((l) => l.employee === props.user?.name || l.name === props.user?.name);
});

// Flexi Wellness and Claims
const myClaims = computed(() => {
  if (dossierData.value?.claims?.history) return dossierData.value.claims.history;
  const uName = String(props.user?.name || '').toUpperCase();
  return (props.records?.claims || []).filter((c) => String(c.employee || '').toUpperCase() === uName);
});

const flexiBenefits = computed(() => {
  if (dossierData.value?.claims?.flexiBenefit) {
    return dossierData.value.claims.flexiBenefit;
  }
  const grade = String(employeeMeta.value.grade || 'E').toUpperCase().replace(/GRADE\s*/i, '').trim();
  const caps = { S: 1500, M: 1000, E: 600, C: 600, W: 600 };
  const cap = caps[grade] !== undefined ? caps[grade] : 600;
  const curYear = new Date().getFullYear().toString();
  const spent = myClaims.value
    .filter((c) => String(c.date || '').slice(0, 4) === curYear && ['Approved', 'Paid', 'Pending manager', 'Pending admin'].includes(c.status) && ['Medical', 'Dental', 'Optical'].includes(c.category))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const remaining = Math.max(0, cap - spent);
  return { cap, spent, remaining };
});

// User-scoped resources and assets
const myAssets = computed(() => {
  if (dossierData.value?.assets) return dossierData.value.assets;
  const uName = String(props.user?.name || '').toUpperCase();
  return (props.records?.resourceAssignments || []).filter(
    (a) => String(a.employee || '').toUpperCase() === uName
  );
});

// User-scoped letters
const myLetters = computed(() => {
  if (dossierData.value?.letters) return dossierData.value.letters;
  const uName = String(props.user?.name || '').toUpperCase();
  return (props.records?.letters || []).filter(
    (l) => String(l.employee || '').toUpperCase() === uName
  );
});

function getLeaveBalanceStats() {
  let alTaken = '—';
  let alBal = '—';
  let mcTaken = '—';
  let mcBal = '—';

  const balances = dossierData.value?.leave?.balances || props.user?.leaveBalances;
  if (Array.isArray(balances)) {
    const al = balances.find((b) => b.category === 'Annual');
    if (al && al.balance != null && al.openingBalance != null) {
      alTaken = Number(al.used || 0).toFixed(2);
      alBal = Number(al.balance).toFixed(2);
    }
    const mc = balances.find((b) => b.category === 'Medical');
    if (mc && mc.balance != null && mc.openingBalance != null) {
      mcTaken = Number(mc.used || 0).toFixed(2);
      mcBal = Number(mc.balance).toFixed(2);
    }
  }

  if (alBal === '—' && alBalance.value !== '—') alBal = String(alBalance.value);
  if (mcBal === '—' && mcBalance.value !== '—') mcBal = String(mcBalance.value);

  return { alTaken, alBal, mcTaken, mcBal };
}

function calculateYtdUpToMonth(targetMonth) {
  const yr = String(targetMonth || '').slice(0, 4);
  const ytd = { epfEmp: 0, socsoEmp: 0, eisEmp: 0, pcb: 0, epfEmpr: 0, socsoEmpr: 0, eisEmpr: 0 };

  myPayslips.value.forEach((p) => {
    if (p.month && p.month.startsWith(yr) && p.month <= targetMonth) {
      ytd.epfEmp += Number(p.epf || 0);
      ytd.socsoEmp += Number(p.socso || 0);
      ytd.eisEmp += Number(p.eis || 0);
      ytd.pcb += Number(p.pcb || 0);
      ytd.epfEmpr += Number(p.epfEmpr || 0);
      ytd.socsoEmpr += Number(p.socsoEmpr || 0);
      ytd.eisEmpr += Number(p.eisEmpr || 0);
    }
  });

  return ytd;
}

function createPayslipPrintElement(ps) {
  const container = document.createElement('div');
  container.className = 'm-full-payslip-print';
  container.style.fontFamily = 'monospace, "Courier New", Courier';
  container.style.fontSize = '12px';
  container.style.color = '#000000';
  container.style.backgroundColor = '#ffffff';
  container.style.width = '850px';
  container.style.padding = '25px 30px';
  container.style.boxSizing = 'border-box';

  const meta = employeeMeta.value;
  const leaves = getLeaveBalanceStats();
  const ytd = calculateYtdUpToMonth(ps.month);
  const fmt = (val) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  container.innerHTML = `
    <div style="border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <strong style="font-size: 14px; letter-spacing: 1px;">EMPLOYEE PAYSLIP</strong><br>
        NAME &nbsp;&nbsp;&nbsp;: <span style="font-weight: bold; text-transform: uppercase;">${ps.name || meta.name}</span><br>
        DEPT &nbsp;&nbsp;&nbsp;: <span style="text-transform: uppercase;">${meta.department || 'PETROL STATION'}</span>
      </div>
      <div>
        PAY PERIOD : <span>END-${ps.label || ps.month}</span><br>
        STAFF# &nbsp;&nbsp;&nbsp;: <span>${meta.employeeNo || ps.id || '—'}</span><br>
        I/C# &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>${meta.icNo || '—'}</span>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 5px; font-weight: bold;">
      <div style="display: flex; justify-content: space-between;">
        <div style="text-align: center; width: 100%;">--- EARNINGS ---</div>
        <div style="min-width: 100px; text-align: right;">--- RM ---</div>
      </div>
      <div style="display: flex; justify-content: space-between; border-left: 1px dashed #000; padding-left: 20px; margin-left: 20px;">
        <div style="text-align: center; width: 100%;">--- DEDUCTIONS ---</div>
        <div style="min-width: 100px; text-align: right;">--- RM ---</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr;">
      <div>
        <div style="display: flex; justify-content: space-between;">
          <div>BASIC PAY</div><div>${fmt(ps.basic)}</div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
          <div>TOTAL OVERTIME</div><div>${fmt(ps.otPay)}</div>
        </div>
        ${ps.claims > 0 ? `<div style="display: flex; justify-content: space-between; margin-top: 4px;"><div>ALLOWANCE / CLAIMS</div><div>${fmt(ps.claims)}</div></div>` : ''}
        ${ps.zeroMcAward > 0 ? `<div style="display: flex; justify-content: space-between; margin-top: 4px;"><div>ZERO MC AWARD</div><div>${fmt(ps.zeroMcAward)}</div></div>` : ''}
        <div style="height: ${ps.claims > 0 || ps.zeroMcAward > 0 ? '70px' : '100px'};"></div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 4px; font-weight: bold;">
          <div>TOTAL :</div><div>${fmt(ps.gross)}</div>
        </div>
      </div>
      <div style="border-left: 1px dashed #000; padding-left: 20px; margin-left: 20px;">
        <div style="display: flex; justify-content: space-between;">
          <div>EMPLOYEE EPF (KWSP)</div><div>${fmt(ps.epf)}</div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
          <div>EMPLOYEE SOCSO (PERKESO)</div><div>${fmt(ps.socso)}</div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
          <div>EMPLOYEE EIS</div><div>${fmt(ps.eis)}</div>
        </div>
        ${ps.pcb > 0 ? `<div style="display: flex; justify-content: space-between; margin-top: 4px;"><div>INCOME TAX (PCB)</div><div>${fmt(ps.pcb)}</div></div>` : ''}
        <div style="height: ${ps.pcb > 0 ? '55px' : '85px'};"></div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 4px; font-weight: bold;">
          <div>TOTAL :</div><div>${fmt(ps.deductions)}</div>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; border-top: 2px solid #000; margin-top: 8px; padding-top: 6px;">
      <div style="font-size: 11px;">
        ANNUAL USED SINCE OPENING : <span>${leaves.alTaken}</span> &nbsp;&nbsp;&nbsp; BALANCE : <span>${leaves.alBal}</span><br>
        MEDICAL USED SINCE OPENING : <span>${leaves.mcTaken}</span> &nbsp;&nbsp;&nbsp; BALANCE : <span>${leaves.mcBal}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; border-left: 1px dashed #000; padding-left: 20px; margin-left: 20px;">
        <div style="font-weight: bold; font-size: 13px;">NETT PAY :</div>
        <div style="font-weight: bold; font-size: 14px; border-bottom: 3px double #000; padding-bottom: 2px;">RM ${fmt(ps.nett)}</div>
      </div>
    </div>

    <div style="border-top: 2px solid #000; margin-top: 10px; padding-top: 6px; font-size: 11px;">
      <div style="display: flex; gap: 40px;">
        <div>EPF#&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>${meta.epfNo || '—'}</span></div>
        <div>TAX#&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>${meta.taxNo || '—'}</span></div>
      </div>
      <div style="display: flex; gap: 40px; margin-top: 3px;">
        <div>SOCSO/EIS#: <span>${meta.socsoNo || '—'}</span></div>
        <div>BANK#&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>${meta.bankNo || '—'}</span></div>
      </div>
    </div>

    <div style="border-top: 2px solid #000; margin-top: 8px; padding-top: 6px; display: grid; grid-template-columns: 1fr 1fr;">
      <div>
        <div style="text-align: center; margin-bottom: 4px; font-weight: bold;">--- CURRENT-MONTH ---</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <tr><th style="text-align: left; padding: 2px;"></th><th style="text-align: right; padding: 2px;">E.P.F.</th><th style="text-align: right; padding: 2px;">SOCSO</th><th style="text-align: right; padding: 2px;">EIS</th><th style="text-align: right; padding: 2px;">TAX</th></tr>
          <tr><td style="text-align: left; padding: 2px;">EMP'EE:</td><td style="text-align: right; padding: 2px;">${fmt(ps.epf)}</td><td style="text-align: right; padding: 2px;">${fmt(ps.socso)}</td><td style="text-align: right; padding: 2px;">${fmt(ps.eis)}</td><td style="text-align: right; padding: 2px;">${fmt(ps.pcb)}</td></tr>
          <tr><td style="text-align: left; padding: 2px;">EMP'ER:</td><td style="text-align: right; padding: 2px;">${fmt(ps.epfEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ps.socsoEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ps.eisEmpr)}</td><td style="text-align: right; padding: 2px;">—</td></tr>
          <tr style="border-top: 1px dashed #666; font-weight: bold;"><td style="text-align: left; padding: 2px;">TOTAL :</td><td style="text-align: right; padding: 2px;">${fmt(Number(ps.epf) + Number(ps.epfEmpr))}</td><td style="text-align: right; padding: 2px;">${fmt(Number(ps.socso) + Number(ps.socsoEmpr))}</td><td style="text-align: right; padding: 2px;">${fmt(Number(ps.eis) + Number(ps.eisEmpr))}</td><td style="text-align: right; padding: 2px;">${fmt(ps.pcb)}</td></tr>
        </table>
      </div>
      <div style="border-left: 1px dashed #000; padding-left: 20px; margin-left: 20px;">
        <div style="text-align: center; margin-bottom: 4px; font-weight: bold;">--- YEAR-TO-DATE ---</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <tr><th style="text-align: left; padding: 2px;"></th><th style="text-align: right; padding: 2px;">E.P.F.</th><th style="text-align: right; padding: 2px;">SOCSO</th><th style="text-align: right; padding: 2px;">EIS</th><th style="text-align: right; padding: 2px;">TAX</th></tr>
          <tr><td style="text-align: left; padding: 2px;">EMP'EE:</td><td style="text-align: right; padding: 2px;">${fmt(ytd.epfEmp)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.socsoEmp)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.eisEmp)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.pcb)}</td></tr>
          <tr><td style="text-align: left; padding: 2px;">EMP'ER:</td><td style="text-align: right; padding: 2px;">${fmt(ytd.epfEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.socsoEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.eisEmpr)}</td><td style="text-align: right; padding: 2px;">—</td></tr>
          <tr style="border-top: 1px dashed #666; font-weight: bold;"><td style="text-align: left; padding: 2px;">TOTAL :</td><td style="text-align: right; padding: 2px;">${fmt(ytd.epfEmp + ytd.epfEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.socsoEmp + ytd.socsoEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.eisEmp + ytd.eisEmpr)}</td><td style="text-align: right; padding: 2px;">${fmt(ytd.pcb)}</td></tr>
        </table>
      </div>
    </div>
  `;

  return container;
}

function createYtdStatementPrintElement(year) {
  const container = document.createElement('div');
  container.className = 'm-ytd-statement-print';
  container.style.fontFamily = 'monospace, "Courier New", Courier';
  container.style.fontSize = '12px';
  container.style.color = '#000000';
  container.style.backgroundColor = '#ffffff';
  container.style.width = '850px';
  container.style.padding = '25px 30px';
  container.style.boxSizing = 'border-box';

  const meta = employeeMeta.value;
  const slips = [...filteredPayslips.value].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const ytd = ytdSummary.value;
  const fmt = (val) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rowsHtml = slips.map((p) => `
    <tr>
      <td style="padding: 5px; text-align: left; border-bottom: 1px solid #ddd;">${p.label || p.month}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd;">${fmt(p.basic)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd;">${fmt(p.otPay)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd; font-weight: bold;">${fmt(p.gross)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd;">${fmt(p.epf)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd;">${fmt(p.socso)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd;">${fmt(p.eis)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd;">${fmt(p.pcb)}</td>
      <td style="padding: 5px; text-align: right; border-bottom: 1px solid #ddd; color: #0d6efd; font-weight: bold;">${fmt(p.nett)}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <strong style="font-size: 15px; letter-spacing: 1px;">ANNUAL EARNINGS &amp; STATUTORY STATEMENT (${year})</strong><br>
        NAME &nbsp;&nbsp;&nbsp;: <span style="font-weight: bold; text-transform: uppercase;">${meta.name}</span><br>
        DEPT &nbsp;&nbsp;&nbsp;: <span style="text-transform: uppercase;">${meta.department || 'PETROL STATION'}</span>
      </div>
      <div>
        YEAR &nbsp;&nbsp;&nbsp;: <span>${year}</span><br>
        STAFF# &nbsp;: <span>${meta.employeeNo || '—'}</span><br>
        I/C# &nbsp;&nbsp;&nbsp;: <span>${meta.icNo || '—'}</span>
      </div>
    </div>

    <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px;">
      <thead>
        <tr style="border-bottom: 2px solid #000; background: #f4f4f4;">
          <th style="padding: 6px 4px; text-align: left;">PERIOD</th>
          <th style="padding: 6px 4px; text-align: right;">BASIC</th>
          <th style="padding: 6px 4px; text-align: right;">OVERTIME</th>
          <th style="padding: 6px 4px; text-align: right;">GROSS</th>
          <th style="padding: 6px 4px; text-align: right;">EPF (EMP)</th>
          <th style="padding: 6px 4px; text-align: right;">SOCSO</th>
          <th style="padding: 6px 4px; text-align: right;">EIS</th>
          <th style="padding: 6px 4px; text-align: right;">TAX (PCB)</th>
          <th style="padding: 6px 4px; text-align: right;">NETT PAY</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr style="border-top: 2px solid #000; border-bottom: 3px double #000; font-weight: bold; background: #eef2ff;">
          <td style="padding: 6px 4px; text-align: left;">YTD TOTAL:</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.basic)}</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.otPay)}</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.gross)}</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.epf)}</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.socso)}</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.eis)}</td>
          <td style="padding: 6px 4px; text-align: right;">${fmt(ytd.pcb)}</td>
          <td style="padding: 6px 4px; text-align: right; color: #198754;">${fmt(ytd.nett)}</td>
        </tr>
      </tbody>
    </table>

    <div style="border-top: 1px solid #000; padding-top: 8px; display: grid; grid-template-columns: 1fr 1fr; font-size: 11px;">
      <div>
        <strong>EMPLOYER STATUTORY TOTALS (${year}):</strong><br>
        EPF EMPLOYER &nbsp;&nbsp;: RM ${fmt(ytd.epfEmpr)}<br>
        SOCSO EMPLOYER : RM ${fmt(ytd.socsoEmpr)}<br>
        EIS EMPLOYER &nbsp;&nbsp;: RM ${fmt(ytd.eisEmpr)}
      </div>
      <div style="text-align: right;">
        EPF#: <span>${meta.epfNo || '—'}</span> &nbsp;|&nbsp; TAX#: <span>${meta.taxNo || '—'}</span><br>
        SOCSO/EIS#: <span>${meta.socsoNo || '—'}</span> &nbsp;|&nbsp; BANK#: <span>${meta.bankNo || '—'}</span><br>
        <span style="font-style: italic; color: #555;">Generated from PplosHR Official Records</span>
      </div>
    </div>
  `;

  return container;
}

async function loadHtml2PdfModule() {
  if (typeof window !== 'undefined' && window.html2pdf) {
    return window.html2pdf;
  }
  try {
    const mod = await import('html2pdf.js');
    return mod.default || mod;
  } catch (dynamicImportErr) {
    console.warn('Dynamic import of html2pdf failed, falling back to script loader:', dynamicImportErr);
    if (typeof window !== 'undefined') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/html2pdf.bundle.min.js';
        s.onload = () => resolve();
        s.onerror = () => {
          const cdn = document.createElement('script');
          cdn.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
          cdn.onload = () => resolve();
          cdn.onerror = (e) => reject(dynamicImportErr);
          document.head.appendChild(cdn);
        };
        document.head.appendChild(s);
      });
      if (window.html2pdf) return window.html2pdf;
    }
    throw dynamicImportErr;
  }
}

async function sharePayslipPdf(ps, downloadOnly = false) {
  if (sharingPayslip.value) return;
  sharingPayslip.value = true;
  currentSharingMonth.value = ps.month;
  shareStatusMsg.value = 'Generating payslip PDF…';

  let wrapper = null;
  try {
    const html2pdfModule = await loadHtml2PdfModule();
    const printElement = createPayslipPrintElement(ps);

    wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.top = '-9999px';
    wrapper.style.left = '0';
    wrapper.style.width = '1200px';
    wrapper.appendChild(printElement);
    document.body.appendChild(wrapper);

    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const parts = String(ps.month || '').split('-');
    const mthStr = parts.length === 2 ? (monthNames[parseInt(parts[1], 10) - 1] || parts[1]) : ps.month;
    const yrStr = parts[0] || selectedPayslipYear.value;
    const safeName = String(ps.name || props.user?.name || 'Staff').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const fileName = `${mthStr}_${yrStr}_${safeName}.pdf`;

    const opt = {
      margin: [0.6, 1.4, 0.2, 1.4],
      filename: fileName,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: 'avoid-all' }
    };

    const worker = html2pdfModule().set(opt).from(printElement);

    if (downloadOnly) {
      if (typeof worker.save === 'function') {
        await worker.save();
      } else {
        const blob = await worker.outputPdf('blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      }
      shareStatusMsg.value = 'Payslip downloaded successfully.';
      setTimeout(() => { shareStatusMsg.value = ''; }, 3000);
      return;
    }

    const blob = await worker.outputPdf('blob');
    let shared = false;

    if (typeof File !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
      try {
        const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare({ files: [pdfFile] })) {
          shareStatusMsg.value = 'Opening share menu…';
          await navigator.share({
            files: [pdfFile],
            title: `Payslip · ${ps.label}`,
            text: `Official payslip for ${ps.name || props.user?.name} (${ps.label})`
          });
          shared = true;
          shareStatusMsg.value = '';
        }
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') {
          shared = true;
          shareStatusMsg.value = '';
        }
      }
    }

    if (!shared) {
      if (typeof worker.save === 'function') {
        await worker.save();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      }
      shareStatusMsg.value = 'Payslip saved to device.';
      setTimeout(() => { shareStatusMsg.value = ''; }, 3000);
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      alert('Could not generate payslip PDF: ' + (error?.message || error));
    }
    shareStatusMsg.value = '';
  } finally {
    if (wrapper) wrapper.remove();
    sharingPayslip.value = false;
    currentSharingMonth.value = '';
  }
}

function downloadPayslipPdf(ps) {
  return sharePayslipPdf(ps, true);
}

async function shareYtdStatementPdf() {
  if (sharingPayslip.value) return;
  sharingPayslip.value = true;
  currentSharingMonth.value = 'YTD';
  shareStatusMsg.value = 'Generating YTD Statement PDF…';

  let wrapper = null;
  try {
    const html2pdfModule = await loadHtml2PdfModule();
    const printElement = createYtdStatementPrintElement(selectedPayslipYear.value);

    wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.top = '-9999px';
    wrapper.style.left = '0';
    wrapper.style.width = '1200px';
    wrapper.appendChild(printElement);
    document.body.appendChild(wrapper);

    const safeName = String(employeeMeta.value.name || props.user?.name || 'Staff').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const fileName = `YTD_${selectedPayslipYear.value}_${safeName}.pdf`;

    const opt = {
      margin: [0.6, 1.4, 0.2, 1.4],
      filename: fileName,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: 'avoid-all' }
    };

    const worker = html2pdfModule().set(opt).from(printElement);
    const blob = await worker.outputPdf('blob');
    let shared = false;

    if (typeof File !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
      try {
        const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: `YTD Statement ${selectedPayslipYear.value}`,
            text: `Annual earnings & statutory statement for ${safeName} (${selectedPayslipYear.value})`
          });
          shared = true;
        }
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') shared = true;
      }
    }

    if (!shared) {
      if (typeof worker.save === 'function') {
        await worker.save();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      }
      shareStatusMsg.value = 'YTD statement saved to device.';
      setTimeout(() => { shareStatusMsg.value = ''; }, 3000);
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      alert('Could not share YTD Statement PDF: ' + (error?.message || error));
    }
    shareStatusMsg.value = '';
  } finally {
    if (wrapper) wrapper.remove();
    sharingPayslip.value = false;
    currentSharingMonth.value = '';
  }
}

const isIos = computed(() => {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
});
defineExpose({ refresh: () => loadDossierAndPayslips(true) });
</script>

<template>
  <div class="m-me-root">
    <!-- 360 PROFILE DOSSIER HERO CARD -->
    <section class="m-dossier-hero">
      <div class="m-hero-top">
        <div class="m-avatar-container position-relative" @click="triggerPhotoUpload" style="cursor: pointer;" title="Tap to upload profile photo to Google Drive">
          <img v-if="photoUrl" :src="photoUrl" class="m-avatar-lg m-avatar-photo" alt="Profile Photo" />
          <div v-else class="m-avatar-lg">{{ userInitials }}</div>
          <span class="m-status-dot" :title="employeeMeta.status"></span>
          <span class="m-avatar-cam-badge"><i class="bi bi-camera-fill"></i></span>
          <div v-if="uploadingPhoto" class="m-avatar-uploading-overlay">
            <span class="spinner-border spinner-border-sm text-light"></span>
          </div>
          <input type="file" ref="mobileFileInput" accept="image/*" capture="user" style="display:none;" @change="handleMobilePhotoUpload" />
        </div>
        <div class="m-hero-info">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h3 class="m-hero-name mb-0">{{ user.name }}</h3>
          </div>
          <p class="m-hero-title mb-1">{{ user.jobTitle || 'Team Member' }}</p>
          <div class="m-hero-tags">
            <span class="m-tag m-tag-id"><i class="bi bi-badge-ad me-1"></i>{{ employeeMeta.employeeNo }}</span>
            <span v-if="employeeMeta.biometricId" class="m-tag m-tag-bio"><i class="bi bi-fingerprint me-1"></i>Bio: {{ employeeMeta.biometricId }}</span>
            <span class="m-tag"><i class="bi bi-building me-1"></i>{{ user.department || 'Department' }}</span>
            <span class="m-tag"><i class="bi bi-shield-check me-1"></i>{{ employeeMeta.grade }}</span>
            <span class="m-tag"><i class="bi bi-clock-history me-1"></i>{{ employeeMeta.tenure }}</span>
          </div>
        </div>
      </div>

      <!-- Quick 360 Dossier KPI Grid -->
      <div class="m-hero-kpi-row">
        <div class="m-kpi-box" @click="activeTab = 'leave'">
          <span class="m-kpi-val text-success">{{ alBalance }}</span>
          <span class="m-kpi-lbl">AL Balance (d)</span>
        </div>
        <div class="m-kpi-box" @click="activeTab = 'leave'">
          <span class="m-kpi-val text-info">{{ mcBalance }}</span>
          <span class="m-kpi-lbl">MC Balance (d)</span>
        </div>
        <div class="m-kpi-box" @click="activeTab = 'claims'">
          <span class="m-kpi-val text-primary">RM {{ flexiBenefits.remaining }}</span>
          <span class="m-kpi-lbl">Flexi Health Left</span>
        </div>
        <div class="m-kpi-box" @click="activeTab = 'payslips'">
          <span class="m-kpi-val text-warning">{{ myPayslips.length }}</span>
          <span class="m-kpi-lbl">Payslips</span>
        </div>
      </div>
    </section>

    <!-- 360 SEGMENTED TAB SWITCHER -->
    <div class="m-segmented-tabs">
      <button
        type="button"
        class="m-seg-tab"
        :class="{ active: activeTab === 'leave' }"
        @click="activeTab = 'leave'"
      >
        <i class="bi bi-sun me-1"></i>Leave
      </button>
      <button
        type="button"
        class="m-seg-tab"
        :class="{ active: activeTab === 'payslips' }"
        @click="activeTab = 'payslips'"
      >
        <i class="bi bi-receipt me-1"></i>Payslips
      </button>
      <button
        type="button"
        class="m-seg-tab"
        :class="{ active: activeTab === 'claims' }"
        @click="activeTab = 'claims'"
      >
        <i class="bi bi-heart-pulse me-1"></i>Flexi &amp; Claims
      </button>
      <button
        type="button"
        class="m-seg-tab"
        :class="{ active: activeTab === 'assets' }"
        @click="activeTab = 'assets'"
      >
        <i class="bi bi-laptop me-1"></i>Assets ({{ myAssets.length }})
      </button>
      <button
        type="button"
        class="m-seg-tab"
        :class="{ active: activeTab === 'letters' }"
        @click="activeTab = 'letters'"
      >
        <i class="bi bi-envelope-paper me-1"></i>Letters ({{ myLetters.length }})
      </button>
    </div>

    <!-- TAB PANEL 1: PAYSLIPS -->
    <div v-if="activeTab === 'payslips'" class="m-tab-panel">
      <div v-if="loadingPayslips" class="text-center py-4 text-muted">
        <div class="spinner-border spinner-border-sm me-2"></div>
        <span>Loading payslip history…</span>
      </div>
      <div v-else-if="!myPayslips.length" class="m-empty-card">
        <i class="bi bi-receipt fs-2 mb-2 d-block text-muted"></i>
        <h6 class="fw-bold mb-1">No Finalized Payslips</h6>
        <p class="small text-muted mb-0">Monthly payslips will appear here once finalized by HR.</p>
      </div>
      <div v-else class="d-flex flex-column gap-2">
        <!-- YEAR SELECTOR ON TOP -->
        <div class="m-payslip-header d-flex justify-content-between align-items-center px-1">
          <div class="d-flex align-items-center gap-2">
            <span class="m-payslip-filter-title text-muted fw-bold small text-uppercase">
              <i class="bi bi-calendar3 me-1 text-primary"></i>Year
            </span>
            <div v-if="availableYears.length <= 4" class="m-year-pills d-flex gap-1">
              <button
                v-for="yr in availableYears"
                :key="yr"
                type="button"
                class="m-year-pill-btn"
                :class="{ active: selectedPayslipYear === yr }"
                @click="selectedPayslipYear = yr"
              >
                {{ yr }}
              </button>
            </div>
            <select
              v-else
              v-model="selectedPayslipYear"
              class="form-select form-select-sm m-year-select"
              aria-label="Select Payslip Year"
            >
              <option v-for="yr in availableYears" :key="yr" :value="yr">{{ yr }}</option>
            </select>
          </div>
          <span class="badge bg-light text-secondary border">
            {{ filteredPayslips.length }} Payslip{{ filteredPayslips.length === 1 ? '' : 's' }}
          </span>
        </div>

        <!-- YTD SUMMARY CARD -->
        <article
          v-if="filteredPayslips.length > 0"
          class="m-card-item m-ytd-summary-card"
          :class="{ 'm-card-expanded': showYtdDetail }"
          @click="showYtdDetail = !showYtdDetail"
        >
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="d-flex align-items-center gap-2 mb-1">
                <span class="badge bg-primary text-white fw-bold"><i class="bi bi-graph-up-arrow me-1"></i>YTD {{ selectedPayslipYear }}</span>
                <span class="small text-muted fw-semibold">{{ filteredPayslips.length }} month{{ filteredPayslips.length === 1 ? '' : 's' }}</span>
              </div>
              <small class="text-muted d-block">Gross Wages: <strong class="text-dark">RM {{ money(ytdSummary.gross) }}</strong></small>
            </div>
            <div class="text-end">
              <strong class="d-block fs-6 text-success">RM {{ money(ytdSummary.nett) }}</strong>
              <span class="badge bg-success-subtle text-success border border-success-subtle">Take Home</span>
            </div>
          </div>

          <!-- YTD Itemized Breakdown Accordion -->
          <div v-if="showYtdDetail" class="m-ps-breakdown mt-3 pt-2 border-top" @click.stop>
            <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
              <span class="fw-bold small text-primary text-uppercase"><i class="bi bi-pie-chart-fill me-1"></i>Year-To-Date Summary ({{ selectedPayslipYear }})</span>
              <span class="badge bg-light text-muted border">{{ filteredPayslips[filteredPayslips.length - 1]?.label }} – {{ filteredPayslips[0]?.label }}</span>
            </div>

            <div class="d-flex justify-content-between small py-1">
              <span class="text-muted">Total Basic Salary:</span>
              <strong>RM {{ money(ytdSummary.basic) }}</strong>
            </div>
            <div v-if="ytdSummary.otPay > 0" class="d-flex justify-content-between small py-1">
              <span class="text-muted">Total Overtime (OT):</span>
              <strong>RM {{ money(ytdSummary.otPay) }}</strong>
            </div>
            <div class="d-flex justify-content-between small py-1">
              <span class="text-muted">Total Gross Wages:</span>
              <strong class="text-primary">RM {{ money(ytdSummary.gross) }}</strong>
            </div>

            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Total Employee EPF (KWSP):</span>
              <span>- RM {{ money(ytdSummary.epf) }}</span>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Total Employee SOCSO (PERKESO):</span>
              <span>- RM {{ money(ytdSummary.socso) }}</span>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Total Employee EIS (SIP):</span>
              <span>- RM {{ money(ytdSummary.eis) }}</span>
            </div>
            <div v-if="ytdSummary.pcb > 0" class="d-flex justify-content-between small py-1 text-danger">
              <span>Total Income Tax (PCB / MTD):</span>
              <span>- RM {{ money(ytdSummary.pcb) }}</span>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Total Employee Deductions:</span>
              <strong class="text-danger">- RM {{ money(ytdSummary.deductions) }}</strong>
            </div>

            <div class="bg-light rounded p-2 my-2 border">
              <div class="small fw-semibold text-secondary mb-1">Total Employer Contribution (YTD):</div>
              <div class="d-flex justify-content-between small text-muted">
                <span>EPF: RM {{ money(ytdSummary.epfEmpr) }}</span>
                <span>SOCSO: RM {{ money(ytdSummary.socsoEmpr) }}</span>
                <span>EIS: RM {{ money(ytdSummary.eisEmpr) }}</span>
              </div>
            </div>

            <div class="d-flex justify-content-between small py-2 mt-1 border-top fw-bold text-success fs-6">
              <span>Total Nett Take-Home (YTD):</span>
              <span>RM {{ money(ytdSummary.nett) }}</span>
            </div>

            <div class="m-ps-actions mt-3 pt-2 border-top d-flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-sm flex-fill d-flex align-items-center justify-content-center gap-2 py-2"
                :disabled="sharingPayslip"
                @click="shareYtdStatementPdf()"
              >
                <span v-if="sharingPayslip && currentSharingMonth === 'YTD'" class="spinner-border spinner-border-sm"></span>
                <i v-else class="bi bi-share-fill"></i>
                <span class="fw-semibold">Share YTD Statement (PDF)</span>
              </button>
            </div>
            <div v-if="shareStatusMsg && currentSharingMonth === 'YTD'" class="small text-muted text-center mt-2">
              {{ shareStatusMsg }}
            </div>
          </div>
        </article>

        <!-- EMPTY STATE FOR SELECTED YEAR IF NO PAYSLIPS IN THAT YEAR -->
        <div v-if="!filteredPayslips.length" class="m-empty-card py-3">
          <i class="bi bi-calendar-x fs-3 mb-1 d-block text-muted"></i>
          <p class="small text-muted mb-0">No payslips found for year {{ selectedPayslipYear }}.</p>
        </div>

        <!-- MONTHLY PAYSLIPS LISTING -->
        <article
          v-for="ps in filteredPayslips"
          :key="ps.month"
          class="m-card-item m-monthly-card"
          :class="{ 'm-card-expanded': activePayslipDetail?.month === ps.month }"
          @click="activePayslipDetail = activePayslipDetail?.month === ps.month ? null : ps"
        >
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <strong class="d-block fs-6 text-dark">{{ ps.label }}</strong>
              <small class="text-muted">Gross Wages: RM {{ money(ps.gross) }}</small>
            </div>
            <div class="text-end">
              <strong class="d-block fs-6 text-success">RM {{ money(ps.nett) }}</strong>
              <span class="badge bg-success-subtle text-success border border-success-subtle">Take Home</span>
            </div>
          </div>

          <!-- Itemized Breakdown Accordion -->
          <div v-if="activePayslipDetail?.month === ps.month" class="m-ps-breakdown mt-3 pt-2 border-top" @click.stop>
            <div class="d-flex justify-content-between small py-1">
              <span class="text-muted">Basic Salary:</span>
              <strong>RM {{ money(ps.basic) }}</strong>
            </div>
            <div v-if="ps.otPay > 0" class="d-flex justify-content-between small py-1">
              <span class="text-muted">Total Overtime:</span>
              <strong>RM {{ money(ps.otPay) }}</strong>
            </div>
            <div v-if="ps.claims > 0" class="d-flex justify-content-between small py-1">
              <span class="text-muted">Claims / Allowances:</span>
              <strong>RM {{ money(ps.claims) }}</strong>
            </div>
            <div v-if="ps.zeroMcAward > 0" class="d-flex justify-content-between small py-1 text-success">
              <span class="text-success"><i class="bi bi-award me-1"></i>Zero MC Award:</span>
              <strong>RM {{ money(ps.zeroMcAward) }}</strong>
            </div>
            <div class="d-flex justify-content-between small py-1">
              <span class="text-muted">Total Gross:</span>
              <strong class="text-primary">RM {{ money(ps.gross) }}</strong>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Employee EPF (KWSP):</span>
              <span>- RM {{ money(ps.epf) }}</span>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Employee SOCSO (PERKESO):</span>
              <span>- RM {{ money(ps.socso) }}</span>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Employee EIS (SIP):</span>
              <span>- RM {{ money(ps.eis) }}</span>
            </div>
            <div v-if="ps.pcb > 0" class="d-flex justify-content-between small py-1 text-danger">
              <span>Income Tax (PCB / MTD):</span>
              <span>- RM {{ money(ps.pcb) }}</span>
            </div>
            <div class="d-flex justify-content-between small py-1 text-danger">
              <span>Total Deductions:</span>
              <strong class="text-danger">- RM {{ money(ps.deductions) }}</strong>
            </div>

            <!-- Employer Contribution -->
            <div class="bg-light rounded p-2 my-2 border">
              <div class="small fw-semibold text-secondary mb-1">Employer Contribution:</div>
              <div class="d-flex justify-content-between small text-muted">
                <span>EPF: RM {{ money(ps.epfEmpr) }}</span>
                <span>SOCSO: RM {{ money(ps.socsoEmpr) }}</span>
                <span>EIS: RM {{ money(ps.eisEmpr) }}</span>
              </div>
            </div>

            <div class="d-flex justify-content-between small py-2 mt-1 border-top fw-bold text-success fs-6">
              <span>Nett Take-Home:</span>
              <span>RM {{ money(ps.nett) }}</span>
            </div>

            <!-- SHARE & DOWNLOAD FULL PAYSLIP (PDF) -->
            <div class="m-ps-actions mt-3 pt-2 border-top d-flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-sm flex-fill d-flex align-items-center justify-content-center gap-2 py-2"
                :disabled="sharingPayslip"
                @click="sharePayslipPdf(ps)"
              >
                <span v-if="sharingPayslip && currentSharingMonth === ps.month" class="spinner-border spinner-border-sm"></span>
                <i v-else class="bi bi-share-fill"></i>
                <span class="fw-semibold">Share Full Payslip (PDF)</span>
              </button>
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm d-flex align-items-center justify-content-center px-3"
                :disabled="sharingPayslip"
                title="Download PDF directly"
                @click="downloadPayslipPdf(ps)"
              >
                <i class="bi bi-download"></i>
              </button>
            </div>
            <div v-if="shareStatusMsg && currentSharingMonth === ps.month" class="small text-muted text-center mt-2">
              {{ shareStatusMsg }}
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- TAB PANEL 2: CLAIMS & FLEXI WELLNESS -->
    <div v-else-if="activeTab === 'claims'" class="m-tab-panel">
      <!-- Flexi Wellness Tracker Card -->
      <div class="m-wellness-card p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h6 class="fw-bold mb-0 text-dark"><i class="bi bi-heart-pulse-fill text-danger me-1"></i>Flexi-Wellness Benefit</h6>
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle">FAM-23/G Cap: RM {{ money(flexiBenefits.cap) }}</span>
        </div>
        <div class="progress mb-2" style="height: 8px;">
          <div
            class="progress-bar bg-success"
            role="progressbar"
            :style="{ width: Math.min(100, Math.round((flexiBenefits.spent / (flexiBenefits.cap || 1)) * 100)) + '%' }"
            :aria-valuenow="flexiBenefits.spent"
            aria-valuemin="0"
            :aria-valuemax="flexiBenefits.cap"
          ></div>
        </div>
        <div class="d-flex justify-content-between small text-muted">
          <span>Spent: RM {{ money(flexiBenefits.spent) }}</span>
          <strong class="text-success">Remaining: RM {{ money(flexiBenefits.remaining) }}</strong>
        </div>
        <small class="text-muted d-block mt-2 fst-italic">Shared annual pool for Medical, Dental &amp; Optical claims.</small>
      </div>

      <!-- Recent Claims History -->
      <h6 class="fw-bold text-muted small px-1 mb-2">My Claim Records</h6>
      <div v-if="!myClaims.length" class="m-empty-card">
        <i class="bi bi-receipt-cutoff fs-2 mb-2 d-block text-muted"></i>
        <p class="small text-muted mb-0">No claims submitted yet.</p>
      </div>
      <div v-else class="d-flex flex-column gap-2">
        <article v-for="c in myClaims" :key="c.id" class="m-card-item">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <span class="badge bg-light text-primary border me-1">{{ c.category }}</span>
              <strong class="d-block mt-1 text-dark">{{ c.title || c.receiptNo || 'Reimbursement' }}</strong>
              <small class="text-muted">{{ c.date }}</small>
            </div>
            <div class="text-end">
              <strong class="d-block text-dark">RM {{ money(c.amount) }}</strong>
              <span
                class="badge"
                :class="{
                  'bg-success': c.status === 'Paid' || c.status === 'Approved',
                  'bg-warning text-dark': /pending/i.test(c.status),
                  'bg-danger': c.status === 'Rejected'
                }"
              >{{ c.status }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- TAB PANEL 3: LEAVE -->
    <div v-else-if="activeTab === 'leave'" class="m-tab-panel">
      <!-- Leave Balance Summary Grid -->
      <div class="row g-2 mb-3">
        <div class="col-6">
          <div class="p-3 bg-white border rounded-3 text-center shadow-sm">
            <span class="small text-muted d-block mb-1"><i class="bi bi-sun text-warning me-1"></i>Annual Leave</span>
            <strong class="fs-4 text-dark">{{ alBalance }}</strong>
            <small class="text-muted d-block">days available</small>
          </div>
        </div>
        <div class="col-6">
          <div class="p-3 bg-white border rounded-3 text-center shadow-sm">
            <span class="small text-muted d-block mb-1"><i class="bi bi-heart-pulse text-danger me-1"></i>Medical Leave</span>
            <strong class="fs-4 text-dark">{{ mcBalance }}</strong>
            <small class="text-muted d-block">days available</small>
          </div>
        </div>
      </div>

      <!-- Leave History List -->
      <h6 class="fw-bold text-muted small px-1 mb-2">Leave History</h6>
      <div v-if="!leaveHistory.length" class="m-empty-card">
        <i class="bi bi-calendar-check fs-2 mb-2 d-block text-muted"></i>
        <p class="small text-muted mb-0">No leave records recorded.</p>
      </div>
      <div v-else class="d-flex flex-column gap-2">
        <article v-for="(l, idx) in leaveHistory" :key="idx" class="m-card-item">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <span class="badge bg-light text-dark border">{{ l.type || 'Annual Leave' }}</span>
              <strong class="d-block mt-1">{{ l.days || 1 }} Day{{ (l.days || 1) > 1 ? 's' : '' }}</strong>
              <small class="text-muted">{{ l.start }} <span v-if="l.end && l.end !== l.start">to {{ l.end }}</span></small>
            </div>
            <span
              class="badge"
              :class="{
                'bg-success': l.status === 'Approved',
                'bg-warning text-dark': /pending/i.test(l.status),
                'bg-danger': l.status === 'Rejected'
              }"
            >{{ l.status || 'Approved' }}</span>
          </div>
        </article>
      </div>
    </div>

    <!-- TAB PANEL 4: ASSIGNED ASSETS -->
    <div v-else-if="activeTab === 'assets'" class="m-tab-panel">
      <div v-if="!myAssets.length" class="m-empty-card">
        <i class="bi bi-laptop fs-2 mb-2 d-block text-muted"></i>
        <h6 class="fw-bold mb-1">No Company Assets Assigned</h6>
        <p class="small text-muted mb-0">Equipment, devices, or access cards issued by HR will show here.</p>
      </div>
      <div v-else class="d-flex flex-column gap-2">
        <article v-for="a in myAssets" :key="a.id" class="m-card-item">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <span class="badge bg-secondary-subtle text-secondary border me-1">{{ a.code || 'ASSET' }}</span>
              <strong class="d-block mt-1 text-dark">{{ a.title || a.resourceId }}</strong>
              <small class="text-muted">Assigned on: {{ a.date }}</small>
            </div>
            <span class="badge bg-success-subtle text-success border border-success-subtle">Assigned</span>
          </div>
          <p v-if="a.notes" class="small text-muted mt-2 mb-0 border-top pt-1">{{ a.notes }}</p>
        </article>
      </div>
    </div>

    <!-- TAB PANEL 5: LETTERS & CORRESPONDENCE -->
    <div v-else-if="activeTab === 'letters'" class="m-tab-panel">
      <div v-if="!myLetters.length" class="m-empty-card">
        <i class="bi bi-envelope-paper fs-2 mb-2 d-block text-muted"></i>
        <h6 class="fw-bold mb-1">No Letters Issued</h6>
        <p class="small text-muted mb-0">Official confirmation, increment, and transfer letters will appear here.</p>
      </div>
      <div v-else class="d-flex flex-column gap-2">
        <article
          v-for="ltr in myLetters"
          :key="ltr.id"
          class="m-card-item"
          @click="viewLetterModal = ltr"
        >
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <span class="badge bg-primary-subtle text-primary border me-1">{{ ltr.category }}</span>
              <span v-if="ltr.refNo" class="badge bg-light text-dark border">{{ ltr.refNo }}</span>
              <strong class="d-block mt-1 text-dark">{{ ltr.title }}</strong>
              <small class="text-muted">{{ ltr.date }}</small>
            </div>
            <button type="button" class="btn btn-outline-primary btn-sm py-1 px-2">
              <i class="bi bi-eye me-1"></i>View
            </button>
          </div>
        </article>
      </div>
    </div>

    <!-- QUICK LAUNCH & APP CONTROLS -->
    <section class="m-actions-panel mt-3">
      <button
        type="button"
        class="btn btn-outline-secondary w-100 py-2 fw-semibold mb-2"
        @click="emit('open-dossier', user.name)"
      >
        <i class="bi bi-person-vcard me-2"></i>Open Full 360° Dossier View
      </button>

      <button
        type="button"
        class="btn btn-light border w-100 py-2 mb-2 text-start d-flex justify-content-between align-items-center"
        @click="showInstallGuidance = true"
      >
        <span><i class="bi bi-phone text-primary me-2"></i>Install Mobile App (PWA)</span>
        <i class="bi bi-chevron-right text-muted small"></i>
      </button>

      <button
        type="button"
        class="btn btn-outline-danger w-100 py-2 fw-bold mt-2"
        @click="emit('logout')"
      >
        <i class="bi bi-box-arrow-right me-2"></i>Sign Out of PplosHR
      </button>
    </section>

    <!-- LETTER DETAIL MODAL -->
    <div v-if="viewLetterModal" class="m-sheet-backdrop" @click.self="viewLetterModal = null">
      <div class="m-sheet-card">
        <div class="m-sheet-header">
          <div>
            <span class="badge bg-primary me-1">{{ viewLetterModal.category }}</span>
            <strong class="fs-6 d-block mt-1">{{ viewLetterModal.title }}</strong>
          </div>
          <button type="button" class="btn-close" @click="viewLetterModal = null"></button>
        </div>
        <div class="letter-body p-3 bg-light rounded border mb-3" style="white-space: pre-wrap; font-family: Georgia, serif; line-height: 1.6; font-size: 0.9rem;">
          {{ viewLetterModal.notes }}
        </div>
        <button type="button" class="btn btn-secondary w-100" @click="viewLetterModal = null">Close</button>
      </div>
    </div>

    <!-- INSTALL PWA GUIDANCE SHEET -->
    <div v-if="showInstallGuidance" class="m-sheet-backdrop" @click.self="showInstallGuidance = false">
      <div class="m-sheet-card">
        <div class="m-sheet-header">
          <h5 class="mb-0 fw-bold">Add PplosHR to Home Screen</h5>
          <button type="button" class="btn-close" @click="showInstallGuidance = false"></button>
        </div>
        <div v-if="isIos" class="p-2">
          <h6 class="fw-bold mb-2"><i class="bi bi-apple me-1"></i>iPhone / iPad Safari:</h6>
          <ol class="small text-muted ps-3 mb-3">
            <li class="mb-2">Tap the <strong>Share</strong> button <i class="bi bi-box-arrow-up text-primary"></i> in the Safari toolbar.</li>
            <li class="mb-2">Scroll down and tap <strong>"Add to Home Screen"</strong> <i class="bi bi-plus-square"></i>.</li>
            <li>Tap <strong>"Add"</strong> in the top-right corner. The app icon will appear on your home screen.</li>
          </ol>
        </div>
        <div v-else class="p-2">
          <h6 class="fw-bold mb-2"><i class="bi bi-android2 me-1"></i>Android Chrome:</h6>
          <ol class="small text-muted ps-3 mb-3">
            <li class="mb-2">Tap the three dots menu <i class="bi bi-three-dots-vertical"></i> in Chrome.</li>
            <li class="mb-2">Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</li>
            <li>Follow the on-screen prompt to finish installing.</li>
          </ol>
        </div>
        <button type="button" class="btn btn-primary w-100 py-2 fw-bold" @click="showInstallGuidance = false">Got it</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-me-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 24px;
}

/* 360 DOSSIER HERO CARD */
.m-dossier-hero {
  background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
  color: #fff;
  border-radius: 20px;
  padding: 20px 16px 16px;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.25);
}

.m-hero-top {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.m-avatar-lg {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: #fff;
  font-size: 1.5rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.m-avatar-photo {
  object-fit: cover;
}

.m-avatar-cam-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 22px;
  height: 22px;
  background: #2563eb;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  border: 2px solid #0f172a;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  z-index: 2;
  transition: transform 0.15s ease;
}

.m-avatar-container:active .m-avatar-cam-badge {
  transform: scale(1.15);
}

.m-avatar-uploading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}

.m-status-dot {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #10b981;
  border: 2px solid #0f172a;
}

.m-hero-info {
  flex: 1;
}

.m-hero-name {
  font-size: 1.15rem;
  font-weight: 700;
  color: #ffffff;
}

.m-hero-title {
  font-size: 0.82rem;
  color: #cbd5e1;
}

.m-hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.m-tag {
  font-size: 0.7rem;
  padding: 2px 7px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #f1f5f9;
}

.m-tag-id {
  background: #3b82f6;
  font-weight: 600;
}

.m-tag-bio {
  background: #0ea5e9;
  font-weight: 600;
}

/* KPI ROW */
.m-hero-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.m-kpi-box {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 8px 4px;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s ease;
}

.m-kpi-box:active {
  background: rgba(255, 255, 255, 0.18);
}

.m-kpi-val {
  display: block;
  font-size: 0.95rem;
  font-weight: 700;
}

.m-kpi-lbl {
  display: block;
  font-size: 0.65rem;
  color: #94a3b8;
  margin-top: 2px;
}

/* SEGMENTED TABS */
.m-segmented-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 6px;
  scrollbar-width: none;
}

.m-segmented-tabs::-webkit-scrollbar {
  display: none;
}

.m-seg-tab {
  white-space: nowrap;
  padding: 8px 14px;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 20px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.m-seg-tab.active {
  background: #1e3a8a;
  color: #ffffff;
  border-color: #1e3a8a;
  box-shadow: 0 2px 6px rgba(30, 58, 138, 0.2);
}

/* CARDS */
.m-card-item {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
  cursor: pointer;
}

/* YEAR SELECTOR & PILLS */
.m-payslip-header {
  padding: 4px 2px 4px;
}

.m-year-pills {
  display: flex;
  gap: 4px;
}

.m-year-pill-btn {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  border-radius: 8px;
  padding: 2px 10px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.m-year-pill-btn.active {
  background: #1e3a8a;
  color: #ffffff;
  border-color: #1e3a8a;
  box-shadow: 0 2px 6px rgba(30, 58, 138, 0.25);
}

.m-year-select {
  width: auto;
  min-width: 90px;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: 8px;
  border-color: #cbd5e1;
  padding: 3px 24px 3px 8px;
}

/* YTD SUMMARY CARD */
.m-ytd-summary-card {
  background: linear-gradient(145deg, #f8fafc 0%, #eef2ff 100%);
  border: 1.5px solid #c7d2fe;
  position: relative;
  overflow: hidden;
  transition: all 0.2s ease;
}

.m-ytd-summary-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: #3b82f6;
}

.m-ytd-summary-card:active {
  background: linear-gradient(145deg, #f1f5f9 0%, #e0e7ff 100%);
}

.m-card-expanded {
  border-color: #3b82f6 !important;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.12) !important;
}

.m-monthly-card {
  transition: all 0.15s ease;
}

.m-monthly-card:active {
  background: #f8fafc;
}

.m-empty-card {
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  padding: 24px 16px;
  text-align: center;
}

.m-wellness-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
}

/* SHEETS */
.m-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  align-items: flex-end;
}

.m-sheet-card {
  width: 100%;
  background: #fff;
  border-radius: 20px 20px 0 0;
  padding: 20px;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  max-height: 85vh;
  overflow-y: auto;
}

.m-sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e5ea;
  padding-bottom: 12px;
}
</style>
