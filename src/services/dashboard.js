import {navigationFor,normaliseRole,allNavigationItems} from '../hr/navigation';
import { calculateEpf, calculateSocso, calculateEis, calculatePcb, DEFAULT_STATUTORY_CONFIG, DEFAULT_ALLOWANCE_TYPES, calculateStatutoryWages } from './statutory';
import $ from 'jquery';
import * as bootstrap from 'bootstrap';
import Chart from 'chart.js/auto';
import { CacheManager } from './cacheManager';
import { formatDateDMY, parseDateDMYToISO } from '../utils/dateUtils';

const API_URL = import.meta.env.VITE_GAS_API_URL;

    let globalData = [], staffList = [], isAdmin = false;
    let staffSettings = {}; 
    let holidays = [];
    let lockedMonthsData = {};
    let globalLeaves = [];
    let currentProcessedRows = []; 
    let staffPayslips = [];
    let payslipRequest = 0;
    let payslipPrinting = false;
    
    let wagePieChartObj = null;
    let otBarChartObj = null;
    let chartDataMain = {}, chartDataBasic = {}, chartDataOT = {};
    let chartDataEmpr = {}, chartDataOTStaff = {}; 

    let currentUser = null;
    let leaveFileBase64 = null, leaveFileName = null, leaveFileMime = null;
    let currentFullProfile = {};
    let selectedFileBase64 = null, selectedFileName = null, selectedFileMime = null;

    let cachedCompanies = [];
    let cachedDepartments = [];
    let cachedJobGrades = [];
    let cachedJobTitles = [];
    let cachedHrBootstrapData = null;
    let currentStaffViewMode = 'table';
    let currentStaffScope = 'all';

    function getSubordinateNames(managerName) {
        const subNames = new Set();
        if (!managerName) return subNames;
        const norm = (s) => String(s || '').trim().toUpperCase();
        const mgrTarget = norm(managerName);

        const queue = [mgrTarget];
        const visited = new Set([mgrTarget]);

        while (queue.length > 0) {
            const currentMgr = queue.shift();
            Object.keys(staffSettings).forEach(key => {
                const emp = staffSettings[key];
                if (!emp) return;
                const empMgr = norm(emp.manager);
                const empName = norm(emp.name || key);
                if (empMgr && empMgr === currentMgr && !visited.has(empName)) {
                    visited.add(empName);
                    subNames.add(empName);
                    queue.push(empName);
                }
            });
        }
        return subNames;
    }

    function normalizeDateStr(dateVal) {
        if (!dateVal) return '';
        if (dateVal instanceof Date) {
            if (isNaN(dateVal.getTime())) return '';
            try {
                return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dateVal);
            } catch (_) {
                return `${dateVal.getFullYear()}-${String(dateVal.getMonth() + 1).padStart(2, '0')}-${String(dateVal.getDate()).padStart(2, '0')}`;
            }
        }
        const str = String(dateVal).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        if (/^\d{4}-\d{2}-\d{2}T/i.test(str)) {
            const dt = new Date(str);
            if (!isNaN(dt.getTime())) {
                try {
                    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
                } catch (_) {
                    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                }
            }
        }
        if (/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.test(str)) {
            const parts = str.split(/[-/]/);
            return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
        }
        if (/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.test(str)) {
            const parts = str.split(/[-/]/);
            return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
        }
        try {
            const dt = new Date(str);
            if (!isNaN(dt.getTime())) {
                try {
                    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
                } catch (_) {
                    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                }
            }
        } catch (e) {}
        return str;
    }

    const DEFAULT_2026_HOLIDAYS = [
        { date: '2026-01-01', name: 'New Year', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-01-14', name: "Yang di-Pertuan Besar Negeri Sembilan's Birthday", company: 'All', workBase: 'SITE', location: 'NS', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 1 } },
        { date: '2026-01-17', name: 'Israk dan Mikraj', company: 'All', workBase: 'SITE', location: 'NS', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 1 } },
        { date: '2026-02-01', name: 'Thaipusam (Replacement on 02-Feb-26 Monday)', company: 'All', workBase: 'SITE', location: 'All', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-02-01', name: 'Federal Territory Day (Replacement on 03-Feb-26 Tuesday)', company: 'All', workBase: 'SITE', location: 'KL', matrix: { OFFICE_PG: 0, OFFICE_SEL: 0, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 1, SITE_NS: 0 } },
        { date: '2026-02-16', name: 'Replacement Thaipusam (Office staff only)', company: 'All', workBase: 'OFFICE', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 0, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 0 } },
        { date: '2026-02-17', name: 'Chinese New Year (1st Day)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-02-18', name: 'Chinese New Year (2nd Day)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-03-07', name: 'Nuzul Al-Quran', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 0 } },
        { date: '2026-03-21', name: 'Hari Raya Puasa (1st Day)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-03-22', name: 'Hari Raya Puasa (2nd Day) (Replacement on 23-Mar-26 Monday)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-05-01', name: 'Labour Day', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-05-27', name: 'Hari Raya Haji', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-05-31', name: 'Wesak Day (Replacement on 1-Jun-26 Monday)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-06-01', name: "Agong's Birthday (Replacement on 2-Jun-26 Tuesday)", company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-06-17', name: 'Awal Muharam', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-07-07', name: 'George Town World Heritage Day', company: 'All', workBase: 'All', location: 'PG', matrix: { OFFICE_PG: 1, OFFICE_SEL: 0, SITE_PG: 1, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 0 } },
        { date: '2026-07-11', name: "Penang Governor's Birthday", company: 'All', workBase: 'All', location: 'PG', matrix: { OFFICE_PG: 1, OFFICE_SEL: 0, SITE_PG: 1, SITE_SEL: 0, SITE_KL: 0, SITE_NS: 0 } },
        { date: '2026-08-25', name: "Prophet Muhammad's Birthday", company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-08-31', name: 'National Day', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-09-16', name: 'Malaysia Day', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-11-08', name: 'Deepavali (Replacement on 09-Nov-26 Monday)', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
        { date: '2026-12-11', name: "Sultan of Selangor's Birthday", company: 'All', workBase: 'All', location: 'SEL', matrix: { OFFICE_PG: 0, OFFICE_SEL: 1, SITE_PG: 0, SITE_SEL: 1, SITE_KL: 0, SITE_NS: 0 } },
        { date: '2026-12-25', name: 'Christmas', company: 'All', workBase: 'All', location: 'All', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } }
    ];
    holidays = JSON.parse(JSON.stringify(DEFAULT_2026_HOLIDAYS));

    function getPublicHolidayForStaff(dateStr, staffInfo) {
        if (!dateStr || !Array.isArray(holidays) || !holidays.length) return null;
        let s = {};
        if (typeof staffInfo === 'string') {
            s = staffSettings[staffInfo] || (typeof globalStaffMap !== 'undefined' && globalStaffMap ? globalStaffMap.get(staffInfo) : null) || {};
        } else if (staffInfo && typeof staffInfo === 'object') s = staffInfo;

        const companyValues = [s.company, s.companyName, s.companyId].filter(Boolean).map(x=>String(x).trim().toUpperCase());
        const companyList = (typeof cachedCompanies !== 'undefined' && Array.isArray(cachedCompanies)) ? cachedCompanies : ((typeof window !== 'undefined' && window.hrCompanies) || []);
        const companyMatch = companyList.find(c => [c.id,c.code,c.title,c.name].some(v=>v && companyValues.includes(String(v).trim().toUpperCase())));
        if (companyMatch) [companyMatch.id,companyMatch.code,companyMatch.title,companyMatch.name].filter(Boolean).forEach(v=>companyValues.push(String(v).trim().toUpperCase()));
        const baseRaw=String(s.workBase||'').trim().toUpperCase();
        const staffBase=baseRaw==='OFFICE'||baseRaw==='SITE'?baseRaw:'';
        const locationRaw=String(s.location||'').trim().toUpperCase();
        const staffLoc=['PG','SEL','KL','NS'].includes(locationRaw)?locationRaw:'';
        const validKeys=['OFFICE_PG','OFFICE_SEL','SITE_PG','SITE_SEL','SITE_KL','SITE_NS'];
        const target=normalizeDateStr(dateStr);

        function isHolidayApplicable(h) {
            if (!h || !h.date) return false;
            const company=String(h.company||'All').trim().toUpperCase();
            if(company!=='ALL' && companyValues.length && !companyValues.includes(company)) return false;
            const hBase=String(h.workBase||'All').trim().toUpperCase();
            const hLocation=String(h.location||'All').trim().toUpperCase();
            if(hBase!=='ALL' && staffBase && hBase!==staffBase) return false;
            if(hLocation!=='ALL' && staffLoc && hLocation!==staffLoc) return false;
            const hasMatrix=h.matrix && typeof h.matrix==='object' && Object.keys(h.matrix).length>0;
            if(hasMatrix){
                if(staffBase && staffLoc){
                    const key=staffBase+'_'+staffLoc;
                    if(!validKeys.includes(key) || !(h.matrix[key]===1 || h.matrix[key]===true)) return false;
                } else {
                    if(company!=='ALL'||hBase!=='ALL'||hLocation!=='ALL') return false;
                    if(!validKeys.every(k=>h.matrix[k]===1||h.matrix[k]===true)) return false;
                }
            } else if (!staffBase || !staffLoc) {
                if(company!=='ALL'||hBase!=='ALL'||hLocation!=='ALL') return false;
            }
            return true;
        }

        // Direct calendar match
        for (const h of holidays) {
            if (normalizeDateStr(h.date) === target && isHolidayApplicable(h)) {
                return h;
            }
        }

        // Subsequent replacement day match if holiday fell on Sunday or collided with an earlier holiday
        const applicable = holidays.filter(isHolidayApplicable);
        const sorted = applicable.slice().sort((a, b) => (normalizeDateStr(a.date) || '').localeCompare(normalizeDateStr(b.date) || ''));
        const originalDates = new Set();
        const replacementMap = new Map();

        // Check if Sunday is a working day for this staff member:
        // Rule: if sunday is the working day then no replacement if sunday is holiday
        const effectiveRestDays = (typeof getStaffEffectiveRestDays === 'function') 
            ? getStaffEffectiveRestDays(s) 
            : (Array.isArray(s.restDays) ? s.restDays : null);

        let isSundayWorkingDay = false;
        if (s.isSundayWorkingDay !== undefined) {
            isSundayWorkingDay = Boolean(s.isSundayWorkingDay);
        } else if (s.workOnSunday !== undefined) {
            isSundayWorkingDay = Boolean(s.workOnSunday);
        } else if (Array.isArray(s.workingDays) && s.workingDays.length > 0) {
            isSundayWorkingDay = s.workingDays.includes('Sun') || s.workingDays.includes(0);
        } else if (Array.isArray(effectiveRestDays) && effectiveRestDays.length > 0) {
            isSundayWorkingDay = !effectiveRestDays.includes(0);
        }

        for (const h of sorted) {
            const hDate = normalizeDateStr(h.date);
            if (!hDate) continue;
            const d = new Date(hDate + 'T00:00:00Z');
            const isSunday = d.getUTCDay() === 0;
            const isCollision = originalDates.has(hDate) || replacementMap.has(hDate);

            // If Sunday is a working day, NO replacement if holiday falls on Sunday!
            const needsSundayReplacement = isSunday && !isSundayWorkingDay;

            if (needsSundayReplacement || isCollision) {
                let cur = new Date(d);
                while (true) {
                    cur.setUTCDate(cur.getUTCDate() + 1);
                    const iso = cur.toISOString().slice(0, 10);
                    const dayOfWeek = cur.getUTCDay();
                    const isStaffRest = isSundayWorkingDay ? ((effectiveRestDays || []).includes(dayOfWeek)) : (dayOfWeek === 0 || (effectiveRestDays || []).includes(dayOfWeek));
                    if (!isStaffRest && !originalDates.has(iso) && !replacementMap.has(iso)) {
                        replacementMap.set(iso, Object.assign({}, h, {
                            date: iso,
                            originalDate: hDate,
                            isReplacement: true,
                            name: String(h.name || '').includes('Replacement') ? h.name : (h.name + ' (Replacement)')
                        }));
                        break;
                    }
                }
            } else {
                originalDates.add(hDate);
            }
        }

        if (replacementMap.has(target)) {
            return replacementMap.get(target);
        }

        return null;
    }
    if (typeof window !== 'undefined') window.getPublicHolidayForStaff = getPublicHolidayForStaff;

    function pickFirstInTime(t1, t2) {
        const s1 = String(t1 || '').trim();
        const s2 = String(t2 || '').trim();
        if (!s1 || s1 === '-' || s1 === '—') return s2;
        if (!s2 || s2 === '-' || s2 === '—') return s1;
        return s1.localeCompare(s2) <= 0 ? s1 : s2;
    }

    function pickLastOutTime(t1, t2) {
        const s1 = String(t1 || '').trim();
        const s2 = String(t2 || '').trim();
        if (!s1 || s1 === '-' || s1 === '—') return s2;
        if (!s2 || s2 === '-' || s2 === '—') return s1;
        return s1.localeCompare(s2) >= 0 ? s1 : s2;
    }

    function getStaffCompany(s) {
        if (!s) return '';
        if (cachedCompanies && cachedCompanies.length) {
            const comp = cachedCompanies.find(c => 
                (s.companyId && (c.id === s.companyId || c.code === s.companyId || c.title === s.companyId || c.name === s.companyId)) ||
                (s.companyName && (c.id === s.companyName || c.code === s.companyName || c.title === s.companyName || c.name === s.companyName)) ||
                (s.company && (c.id === s.company || c.code === s.company || c.title === s.company || c.name === s.company))
            );
            if (comp) return comp.title || comp.name || comp.code;
        }
        return s.companyName || s.company || s.companyId || '';
    }

    function getAllDepartments() {
        if (cachedDepartments && cachedDepartments.length) return cachedDepartments;
        if (typeof window !== 'undefined' && window.hrDepartments && window.hrDepartments.length) {
            cachedDepartments = window.hrDepartments;
            return cachedDepartments;
        }
        if (cachedHrBootstrapData?.records?.departments?.length) {
            cachedDepartments = cachedHrBootstrapData.records.departments;
            return cachedDepartments;
        }
        const cachedHr = CacheManager.getHrRecords();
        if (cachedHr) {
            for (const sc of ['all', 'overview', 'team', 'personal']) {
                if (cachedHr[sc]?.records?.departments?.length) {
                    cachedDepartments = cachedHr[sc].records.departments;
                    return cachedDepartments;
                }
            }
        }
        const boot = CacheManager.getBootstrap();
        if (boot?.cachedDepartments?.length) {
            cachedDepartments = boot.cachedDepartments;
            return cachedDepartments;
        }
        return [];
    }

    function getStaffDepartment(s) {
        if (!s) return '';
        const depts = getAllDepartments();
        const target = String(s.departmentId || s.department || s.departmentName || '').trim().toLowerCase();
        if (target && depts.length) {
            const dept = depts.find(d => 
                (d.id && String(d.id).trim().toLowerCase() === target) ||
                (d.code && String(d.code).trim().toLowerCase() === target) ||
                (d.title && String(d.title).trim().toLowerCase() === target) ||
                (d.name && String(d.name).trim().toLowerCase() === target)
            );
            if (dept) return dept.title || dept.name || dept.code;
        }
        const fallback = s.departmentName || s.department || s.departmentId || '';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(fallback).trim())) {
            if (s.jobTitle && /hr|human resource/i.test(s.jobTitle)) return 'HUMAN RESOURCES';
            return 'General Department';
        }
        return fallback;
    }

    function getStaffGrade(s) {
        if (!s) return '';
        if (s.gradeId && cachedJobGrades.length) {
            const g = cachedJobGrades.find(gr => gr.id === s.gradeId || gr.code === s.gradeId);
            if (g) return g.code;
        }
        return s.gradeId || '';
    }

    function getStaffEffectiveRestDays(s, settings = null, customSchedules = null) {
        let hrSchedules = customSchedules || window.workSchedules || [];
        if (!hrSchedules.length) {
            try {
                const raw = localStorage.getItem('hr_workSchedules') || localStorage.getItem('hr_custom_workSchedules');
                if (raw) hrSchedules = JSON.parse(raw);
            } catch (_) {}
        }

        const assignedCodes = (s?.schedules && s.schedules.length) 
            ? s.schedules 
            : (s?.schedule ? String(s.schedule).split(',').map(x => x.trim()).filter(Boolean) : 
               (settings?.schedules && settings.schedules.length ? settings.schedules : 
               (settings?.schedule ? String(settings.schedule).split(',').map(x => x.trim()).filter(Boolean) : [])));

        if (assignedCodes.length > 0 && hrSchedules.length > 0) {
            const matched = hrSchedules.filter(sch => {
                const c = String(sch.code || sch.title || sch.name || '').trim().toUpperCase();
                return assignedCodes.some(ac => String(ac).trim().toUpperCase() === c);
            });

            if (matched.length > 0) {
                const rdSet = new Set();
                matched.forEach(sch => {
                    if (Array.isArray(sch.restDays) && sch.restDays.length) {
                        sch.restDays.forEach(d => rdSet.add(Number(d)));
                    } else if (sch.daySchedules) {
                        try {
                            const blocks = typeof sch.daySchedules === 'string' ? JSON.parse(sch.daySchedules) : sch.daySchedules;
                            const workDays = new Set(blocks.flatMap(b => b.days || []));
                            const dayNumMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
                            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => {
                                if (!workDays.has(d)) rdSet.add(dayNumMap[d]);
                            });
                        } catch (_) {}
                    }
                });
                return Array.from(rdSet).sort((a, b) => a - b);
            }
        }

        // Only fallback to s.restDays if it is not just the legacy default Sunday [0]
        if (s && Array.isArray(s.restDays) && s.restDays.length > 0) {
            if (!(s.restDays.length === 1 && s.restDays[0] === 0)) {
                return s.restDays;
            }
        }
        if (Array.isArray(settings?.restDays) && settings.restDays.length > 0) {
            if (!(settings.restDays.length === 1 && settings.restDays[0] === 0)) {
                return settings.restDays;
            }
        }

        // Sunday is NOT rest day by default!
        return [];
    }

    function findStaffSetting(id, name) {
        if (!staffSettings || typeof staffSettings !== 'object') return null;
        const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
        const cleanName = name !== undefined && name !== null ? String(name).trim() : '';

        // 1. Direct key match (by name or id in staffSettings)
        if (cleanName) {
            if (staffSettings[cleanName]) return staffSettings[cleanName];
            if (staffSettings[cleanName.toUpperCase()]) return staffSettings[cleanName.toUpperCase()];
            if (staffSettings[cleanName.toLowerCase()]) return staffSettings[cleanName.toLowerCase()];
        }
        if (cleanId) {
            if (staffSettings[cleanId]) return staffSettings[cleanId];
            if (staffSettings[cleanId.toUpperCase()]) return staffSettings[cleanId.toUpperCase()];
        }

        const staffArr = Object.values(staffSettings);

        // 2. Authoritative Biometric ID match (strictly links clock-in machine punches)
        if (cleanId) {
            const cleanIdNum = Number(cleanId);
            const byBio = staffArr.find(st => {
                if (!st.biometricId) return false;
                const bStr = String(st.biometricId).trim();
                if (bStr === cleanId) return true;
                const bNum = Number(bStr);
                return !isNaN(cleanIdNum) && !isNaN(bNum) && cleanIdNum > 0 && cleanIdNum === bNum;
            });
            if (byBio) return byBio;
        }

        // 3. Match by Employee No / Username
        if (cleanId) {
            const cleanIdLower = cleanId.toLowerCase();
            const byEmpOrUser = staffArr.find(st => 
                (st.employeeNo && String(st.employeeNo).trim().toLowerCase() === cleanIdLower) ||
                (st.username && String(st.username).trim().toLowerCase() === cleanIdLower)
            );
            if (byEmpOrUser) return byEmpOrUser;
        }

        // 4. Exact Name match
        if (cleanName) {
            const cleanLower = cleanName.toLowerCase();
            const byName = staffArr.find(st => st.name && st.name.trim().toLowerCase() === cleanLower);
            if (byName) return byName;

            // 5. Word token match
            const rawWords = cleanLower.split(/\s+/).filter(Boolean);
            if (rawWords.length > 0) {
                const byWords = staffArr.find(st => {
                    if (!st.name) return false;
                    const sWords = st.name.trim().toLowerCase().split(/\s+/).filter(Boolean);
                    return rawWords.every(w => sWords.includes(w));
                });
                if (byWords) return byWords;
            }
        }

        return null;
    }

    function isRecordForStaff(record, id, name, staffObj) {
        if (!record) return false;
        const s = staffObj || findStaffSetting(id, name);

        // 1. Authoritative Biometric ID match (strictly links clock-in machine punches)
        if (s && s.biometricId) {
            const bio = String(s.biometricId).trim();
            const bioNum = Number(bio);
            const matchesBio = val => {
                if (!val) return false;
                const vStr = String(val).trim();
                if (vStr === bio) return true;
                const vNum = Number(vStr);
                return !isNaN(bioNum) && !isNaN(vNum) && bioNum > 0 && bioNum === vNum;
            };
            if (matchesBio(record.biometricId)) return true;
            if (matchesBio(record.id)) return true;
            if (matchesBio(record.rawId)) return true;
        }

        // 2. Direct ID / Raw ID match
        const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
        if (cleanId) {
            if (record.id && String(record.id).trim() === cleanId) return true;
            if (record.rawId && String(record.rawId).trim() === cleanId) return true;
        }

        // 3. Employee No / Username match
        if (s) {
            const empNo = s.employeeNo ? String(s.employeeNo).trim().toLowerCase() : '';
            const uname = s.username ? String(s.username).trim().toLowerCase() : '';
            const recId = record.id ? String(record.id).trim().toLowerCase() : '';
            const recEmpNo = record.employeeNo ? String(record.employeeNo).trim().toLowerCase() : '';
            const recRawId = record.rawId ? String(record.rawId).trim().toLowerCase() : '';

            if (empNo && (recId === empNo || recEmpNo === empNo || recRawId === empNo)) return true;
            if (uname && (recId === uname || recRawId === uname)) return true;
        }

        // 4. Name match
        const targetName = (name || (s && s.name) || '').trim().toLowerCase();
        const recName = (record.name || '').trim().toLowerCase();
        if (targetName && recName && targetName === recName) return true;
        if (s && s.name && recName && s.name.trim().toLowerCase() === recName) return true;

        return false;
    }

    // Index candidate identities once per data version, then retain the canonical
    // matcher and original row order (including last-row-wins date overrides).
    let attendanceIndexSource = null, attendanceIndexLength = -1;
    let attendanceIdentityIndex = new Map();
    function attendanceRowsForStaff(month, id, name, staffObj) {
        const norm = value => String(value || '').trim().toLowerCase();
        const normNum = val => {
            const num = Number(val);
            return (!isNaN(num) && num > 0) ? String(num) : null;
        };
        if (attendanceIndexSource !== globalData || attendanceIndexLength !== globalData.length) {
            attendanceIdentityIndex = new Map();
            globalData.forEach((row, position) => {
                const normD = row.date ? normalizeDateStr(row.date) : '';
                const rowMonth = (row.month && /^\d{4}-\d{2}/.test(row.month)) 
                    ? row.month.substring(0, 7) 
                    : (normD && /^\d{4}-\d{2}/.test(normD) ? normD.substring(0, 7) : (row.month || ''));
                const rawVals = [row.id, row.rawId, row.biometricId, row.employeeNo, row.name];
                const keys = new Set([...rawVals.map(norm), ...rawVals.map(normNum)].filter(Boolean));
                keys.forEach(key => {
                    const indexKey = JSON.stringify([rowMonth, key]);
                    if (!attendanceIdentityIndex.has(indexKey)) attendanceIdentityIndex.set(indexKey, []);
                    attendanceIdentityIndex.get(indexKey).push(position);
                });
            });
            attendanceIndexSource = globalData;
            attendanceIndexLength = globalData.length;
        }
        const staff = staffObj || findStaffSetting(id, name);
        const staffVals = [id, name, staff?.biometricId, staff?.employeeNo, staff?.username, staff?.name];
        const keys = new Set([...staffVals.map(norm), ...staffVals.map(normNum)].filter(Boolean));
        const positions = new Set();
        keys.forEach(key => (attendanceIdentityIndex.get(JSON.stringify([month, key])) || []).forEach(position => positions.add(position)));
        let resultRows = [...positions].sort((a, b) => a - b).map(position => {
            const row = globalData[position];
            if (row && row.date) {
                const normD = normalizeDateStr(row.date);
                if (normD && normD !== row.date) return { ...row, date: normD };
            }
            return row;
        }).filter(row => isRecordForStaff(row, id, name, staff));

        if (resultRows.length === 0 && globalData.length > 0) {
            resultRows = globalData.filter(r => {
                if (!isRecordForStaff(r, id, name, staff)) return false;
                const dStr = normalizeDateStr(r.date);
                const rMonth = (r.month && /^\d{4}-\d{2}/.test(r.month)) ? r.month.substring(0, 7) : (dStr ? dStr.substring(0, 7) : '');
                return rMonth === month;
            }).map(row => {
                const normD = normalizeDateStr(row.date);
                return (normD && normD !== row.date) ? { ...row, date: normD } : row;
            });
        }
        return resultRows;
    }

    let leaveIndexSource = null;
    let leaveIdentityIndex = new Map();
    function leavesForStaff(name, employeeNo) {
        const nameKey = value => 'name:' + String(value || '').trim().toLowerCase();
        if (leaveIndexSource !== globalLeaves) {
            leaveIdentityIndex = new Map();
            globalLeaves.forEach((leave, position) => {
                const keys = [nameKey(leave.name)];
                if (leave.employeeNo) keys.push('employee:' + leave.employeeNo);
                keys.forEach(key => {
                    if (!leaveIdentityIndex.has(key)) leaveIdentityIndex.set(key, []);
                    leaveIdentityIndex.get(key).push(position);
                });
            });
            leaveIndexSource = globalLeaves;
        }
        const positions = new Set(leaveIdentityIndex.get(nameKey(name)) || []);
        if (employeeNo) (leaveIdentityIndex.get('employee:' + employeeNo) || []).forEach(position => positions.add(position));
        return [...positions].sort((a, b) => a - b).map(position => globalLeaves[position]);
    }

    function populateAttendanceFilters() {
        const companySelect = $('#attendanceCompanySelect');
        const deptSelect = $('#attendanceDepartmentSelect');
        const staffSel = $('#staffSelect');
        if (!companySelect.length) return;

        const currentCompany = companySelect.val() || 'ALL';
        companySelect.empty().append(new Option('All Companies', 'ALL'));

        const uniqueCompanies = new Set();
        if (cachedCompanies.length) {
            cachedCompanies.forEach(c => {
                const name = c.title || c.name || c.code;
                if (name) uniqueCompanies.add(name);
            });
        }
        Object.values(staffSettings).forEach(s => {
            const cName = getStaffCompany(s);
            if (cName) uniqueCompanies.add(cName);
        });
        Array.from(uniqueCompanies).sort().forEach(cName => {
            companySelect.append(new Option(cName, cName));
        });
        if (currentCompany && companySelect.find(`option[value="${currentCompany}"]`).length) {
            companySelect.val(currentCompany);
        } else {
            companySelect.val('ALL');
        }

        populateAttendanceDepartments(companySelect.val());
        populateAttendanceStaff(companySelect.val(), deptSelect.val());
    }

    function populateAttendanceDepartments(selectedCompany = 'ALL') {
        const deptSelect = $('#attendanceDepartmentSelect');
        if (!deptSelect.length) return;
        const currentDept = deptSelect.val() || 'ALL';
        deptSelect.empty().append(new Option('All Projects / Depts', 'ALL'));

        const uniqueDepts = new Set();
        if (cachedDepartments.length) {
            let depts = cachedDepartments;
            if (selectedCompany !== 'ALL') {
                const compObj = cachedCompanies.find(c => (c.title || c.name || c.code) === selectedCompany || c.id === selectedCompany);
                const targetCId = compObj?.id || selectedCompany;
                depts = depts.filter(d => {
                    if (!d.companyId || String(d.companyId).toUpperCase() === 'ALL') return true;
                    const cos = String(d.companyId).split(',').map(s => s.trim().toUpperCase());
                    return cos.includes(String(targetCId).toUpperCase()) || (compObj && (cos.includes(String(compObj.code || '').toUpperCase()) || cos.includes(String(compObj.title || '').toUpperCase())));
                });
            }
            depts.forEach(d => {
                const name = d.title || d.name || d.code;
                if (name) uniqueDepts.add(name);
            });
        }

        Object.values(staffSettings).forEach(s => {
            const sComp = getStaffCompany(s);
            if (selectedCompany === 'ALL' || sComp === selectedCompany) {
                const sDept = getStaffDepartment(s);
                if (sDept) uniqueDepts.add(sDept);
            }
        });

        Array.from(uniqueDepts).sort().forEach(dName => {
            deptSelect.append(new Option(dName, dName));
        });

        if (currentDept && deptSelect.find(`option[value="${currentDept}"]`).length) {
            deptSelect.val(currentDept);
        } else {
            deptSelect.val('ALL');
        }
    }

    function populateAttendanceStaff(selectedCompany = 'ALL', selectedDept = 'ALL') {
        const staffSel = $('#staffSelect');
        if (!staffSel.length) return;
        const currentStaff = staffSel.val() || 'ALL';
        staffSel.empty().append(new Option('All Staff', 'ALL'));

        let filteredStaff = staffList.filter(([id, name]) => {
            const s = findStaffSetting(id, name);
            const jDate = normalizeDateStr(s?.joinedDate || s?.joined);
            // Requirement: without joined date also should not appear
            if (!jDate) return false;
            const currentMonth = $('#monthSelect').val() || '';
            if (currentMonth) {
                const rDate = normalizeDateStr(s?.resignDate || s?.resignationDate);
                if (rDate && rDate < currentMonth + '-01') return false;
            }
            if (selectedCompany === 'ALL' && selectedDept === 'ALL') return true;
            if (!s) return false;
            const sComp = getStaffCompany(s) || '';
            const sDept = getStaffDepartment(s) || '';
            const compMatch = (selectedCompany === 'ALL') || 
                sComp.trim().toLowerCase() === selectedCompany.trim().toLowerCase() ||
                (s.companyId && s.companyId.trim().toLowerCase() === selectedCompany.trim().toLowerCase()) ||
                (s.companyName && s.companyName.trim().toLowerCase() === selectedCompany.trim().toLowerCase());
            const deptMatch = (selectedDept === 'ALL') || 
                sDept.trim().toLowerCase() === selectedDept.trim().toLowerCase() ||
                (s.departmentId && s.departmentId.trim().toLowerCase() === selectedDept.trim().toLowerCase()) ||
                (s.department && s.department.trim().toLowerCase() === selectedDept.trim().toLowerCase());
            return compMatch && deptMatch;
        });

        filteredStaff.forEach(([id, n]) => staffSel.append(new Option(n, id)));

        if (currentStaff && staffSel.find(`option[value="${currentStaff}"]`).length) {
            staffSel.val(currentStaff);
        } else {
            staffSel.val('ALL');
        }
    }

    function handleAttendanceCompanyChange() {
        const selComp = $('#attendanceCompanySelect').val() || 'ALL';
        populateAttendanceDepartments(selComp);
        const selDept = $('#attendanceDepartmentSelect').val() || 'ALL';
        populateAttendanceStaff(selComp, selDept);
        renderDashboard();
    }

    function handleAttendanceDepartmentChange() {
        const selComp = $('#attendanceCompanySelect').val() || 'ALL';
        const selDept = $('#attendanceDepartmentSelect').val() || 'ALL';
        populateAttendanceStaff(selComp, selDept);
        renderDashboard();
    }

    function populateSummaryFilters() {
        const compSelect = $('#summaryCompanySelect');
        const deptSelect = $('#summaryDepartmentSelect');
        if (!compSelect.length) return;

        const currentComp = compSelect.val() || 'ALL';
        compSelect.empty().append(new Option('All Companies', 'ALL'));

        const uniqueCompanies = new Set();
        if (cachedCompanies && cachedCompanies.length) {
            cachedCompanies.forEach(c => {
                const name = c.title || c.name || c.code;
                if (name) uniqueCompanies.add(name);
            });
        }
        Object.values(staffSettings).forEach(s => {
            const cName = getStaffCompany(s);
            if (cName) uniqueCompanies.add(cName);
        });
        Array.from(uniqueCompanies).sort().forEach(cName => {
            compSelect.append(new Option(cName, cName));
        });
        if (currentComp && compSelect.find(`option[value="${currentComp}"]`).length) {
            compSelect.val(currentComp);
        } else {
            compSelect.val('ALL');
        }

        populateSummaryDepartments(compSelect.val());
    }

    function populateSummaryDepartments(selectedCompany = 'ALL') {
        const deptSelect = $('#summaryDepartmentSelect');
        if (!deptSelect.length) return;
        const currentDept = deptSelect.val() || 'ALL';
        deptSelect.empty().append(new Option('All Projects / Depts', 'ALL'));

        const uniqueDepts = new Set();
        if (cachedDepartments && cachedDepartments.length) {
            cachedDepartments.forEach(d => {
                let matchesComp = (selectedCompany === 'ALL');
                if (!matchesComp) {
                    if (!d.companyId || String(d.companyId).toUpperCase() === 'ALL') matchesComp = true;
                    else {
                        const compObj = (cachedCompanies || []).find(c => (c.title || c.name || c.code) === selectedCompany || c.id === selectedCompany);
                        const targetCId = compObj?.id || selectedCompany;
                        const cos = String(d.companyId).split(',').map(s => s.trim().toUpperCase());
                        matchesComp = cos.includes(String(targetCId).toUpperCase()) || (compObj && (cos.includes(String(compObj.code || '').toUpperCase()) || cos.includes(String(compObj.title || '').toUpperCase())));
                    }
                }
                if (matchesComp) {
                    const name = d.title || d.name || d.code;
                    if (name) uniqueDepts.add(name);
                }
            });
        }
        Object.values(staffSettings).forEach(s => {
            const cName = getStaffCompany(s);
            if (selectedCompany === 'ALL' || cName === selectedCompany) {
                const dName = getStaffDepartment(s);
                if (dName) uniqueDepts.add(dName);
            }
        });
        Array.from(uniqueDepts).sort().forEach(dName => {
            deptSelect.append(new Option(dName, dName));
        });
        if (currentDept && deptSelect.find(`option[value="${currentDept}"]`).length) {
            deptSelect.val(currentDept);
        } else {
            deptSelect.val('ALL');
        }
    }

    function handleSummaryCompanyChange() {
        populateSummaryDepartments($('#summaryCompanySelect').val());
        renderSummaryDashboard();
    }

    function populateStaffFilters() {
        const compFilter = $('#staffCompanyFilter');
        const deptFilter = $('#staffDepartmentFilter');
        if (!compFilter.length) return;

        const curComp = compFilter.val() || 'all';
        compFilter.empty().append(new Option('All Companies', 'all'));

        const uniqueComps = new Set();
        if (cachedCompanies.length) {
            cachedCompanies.forEach(c => {
                const name = c.title || c.name || c.code;
                if (name) uniqueComps.add(name);
            });
        }
        Object.values(staffSettings).forEach(s => {
            const name = getStaffCompany(s);
            if (name) uniqueComps.add(name);
        });
        Array.from(uniqueComps).sort().forEach(c => compFilter.append(new Option(c, c)));
        if (curComp && compFilter.find(`option[value="${curComp}"]`).length) compFilter.val(curComp);
        else compFilter.val('all');

        populateStaffDepartmentFilter(compFilter.val());
    }

    function populateStaffDepartmentFilter(selectedComp = 'all') {
        const deptFilter = $('#staffDepartmentFilter');
        if (!deptFilter.length) return;
        const curDept = deptFilter.val() || 'all';
        deptFilter.empty().append(new Option('All Projects / Depts', 'all'));

        const uniqueDepts = new Set();
        if (cachedDepartments.length) {
            let depts = cachedDepartments;
            if (selectedComp !== 'all') {
                const compObj = cachedCompanies.find(c => (c.title || c.name || c.code) === selectedComp || c.id === selectedComp);
                const targetCId = compObj?.id || selectedComp;
                depts = depts.filter(d => {
                    if (!d.companyId || String(d.companyId).toUpperCase() === 'ALL') return true;
                    const cos = String(d.companyId).split(',').map(s => s.trim().toUpperCase());
                    return cos.includes(String(targetCId).toUpperCase()) || (compObj && (cos.includes(String(compObj.code || '').toUpperCase()) || cos.includes(String(compObj.title || '').toUpperCase())));
                });
            }
            depts.forEach(d => {
                const name = d.title || d.name || d.code;
                if (name) uniqueDepts.add(name);
            });
        }
        Object.values(staffSettings).forEach(s => {
            const sComp = getStaffCompany(s);
            if (selectedComp === 'all' || sComp === selectedComp) {
                const sDept = getStaffDepartment(s);
                if (sDept) uniqueDepts.add(sDept);
            }
        });
        Array.from(uniqueDepts).sort().forEach(d => deptFilter.append(new Option(d, d)));
        if (curDept && deptFilter.find(`option[value="${curDept}"]`).length) deptFilter.val(curDept);
        else deptFilter.val('all');
    }

    function handleStaffCompanyFilterChange() {
        const selComp = $('#staffCompanyFilter').val() || 'all';
        populateStaffDepartmentFilter(selComp);
        filterStaffCards();
    }

    function setStaffViewMode(mode) {
        currentStaffViewMode = mode;
        $('#staffViewTableBtn').toggleClass('active', mode === 'table');
        $('#staffViewCardsBtn').toggleClass('active', mode === 'cards');
        renderStaffMgmt();
    }

    // --- CHARTS & DASHBOARD ---
    function renderSummaryDashboard() {
        const viewType = $('#summaryViewType').val() || 'monthly';
        let monthsToProcess = [];

        if (viewType === 'monthly') {
            const m = $('#sumDashMonth').val();
            if (!m) return;
            monthsToProcess = [m];
        } else {
            const allMonths = new Set();
            $('#sumDashMonth option').each(function() {
                const val = $(this).val();
                if (val && val.includes('-')) allMonths.add(val);
            });
            globalData.forEach(d => {
                if (d.month && d.month !== 'Unknown' && d.month.includes('-')) allMonths.add(d.month);
            });
            Object.keys(lockedMonthsData || {}).forEach(k => {
                const baseM = k.includes('__') ? k.split('__')[0] : k;
                if (baseM && baseM.includes('-')) allMonths.add(baseM);
            });
            monthsToProcess = Array.from(allMonths).sort();
        }

        if (monthsToProcess.length === 0) {
            $('#kpiTotalPayroll').text('RM 0.00');
            $('#kpiEmpStatutory').text('RM 0.00');
            $('#kpiEmprStatutory').text('RM 0.00');
            $('#kpiOtIntensity').text('0.0%');
            $('#kpiAvgOt').text('0.0 Hrs');
            $('#kpiTotalPayrollVs, #kpiEmpStatutoryVs, #kpiEmprStatutoryVs, #kpiOtIntensityVs, #kpiAvgOtVs').hide();
            return;
        }

        const data = calculatePeriodDataRange(monthsToProcess);
        if (!data || data.activeStaffCount === 0) {
            $('#kpiTotalPayroll').text('RM 0.00');
            $('#kpiEmpStatutory').text('RM 0.00');
            $('#kpiEmprStatutory').text('RM 0.00');
            $('#kpiOtIntensity').text('0.0%');
            $('#kpiAvgOt').text('0.0 Hrs');
            $('#kpiTotalPayrollVs, #kpiEmpStatutoryVs, #kpiEmprStatutoryVs, #kpiOtIntensityVs, #kpiAvgOtVs').hide();
            if (otBarChartObj) { otBarChartObj.destroy(); otBarChartObj = null; }
            if (wagePieChartObj) { wagePieChartObj.destroy(); wagePieChartObj = null; }
            return;
        }

        // 1. Update Main KPI Text
        $('#kpiTotalPayroll').text('RM ' + data.totalPayroll.toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        $('#kpiEmpStatutory').text('RM ' + (data.totalEmpDed || 0).toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        $('#kpiEmprStatutory').text('RM ' + (data.totalEmprCont || 0).toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        const otIntensity = data.totalPayroll > 0 ? (data.totalOTPay / data.totalPayroll) * 100 : 0;
        $('#kpiOtIntensity').text(otIntensity.toFixed(1) + '%');
        const avgOt = data.activeStaffCount > 0 ? (data.totalOTHrs / data.activeStaffCount) : 0;
        $('#kpiAvgOt').text(avgOt.toFixed(1) + ' Hrs');

        // 2. NEW: Calculate "% " (Only applies to Monthly View)
        if (viewType === 'monthly' && monthsToProcess.length === 1) {
            let [y, mo] = monthsToProcess[0].split('-').map(Number);
            mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
            let prevMonthStr = `${y}-${String(mo).padStart(2, '0')}`;

            let prevData = calculatePeriodDataRange([prevMonthStr]);

            if (prevData && prevData.activeStaffCount > 0) {
                let formatVs = (diff) => {
                    let absVal = Math.abs(diff).toFixed(1);
                    if (diff > 0) return `<i class="bi bi-arrow-up-right fw-bold"></i> +${absVal}%`;
                    if (diff < 0) return `<i class="bi bi-arrow-down-right fw-bold"></i> -${absVal}%`;
                    return `<i class="bi bi-dash fw-bold"></i> 0.0%`;
                };

                let curPayroll = data.totalPayroll;
                let prevPayroll = prevData.totalPayroll;
                let diffPayroll = prevPayroll > 0 ? ((curPayroll - prevPayroll) / prevPayroll) * 100 : (curPayroll > 0 ? 100 : 0);
                $('#kpiTotalPayrollVs').html(`${formatVs(diffPayroll)} `).show();

                let curEmpDed = data.totalEmpDed || 0;
                let prevEmpDed = prevData.totalEmpDed || 0;
                let diffEmpDed = prevEmpDed > 0 ? ((curEmpDed - prevEmpDed) / prevEmpDed) * 100 : (curEmpDed > 0 ? 100 : 0);
                $('#kpiEmpStatutoryVs').html(`${formatVs(diffEmpDed)} `).show();

                let curEmprCont = data.totalEmprCont || 0;
                let prevEmprCont = prevData.totalEmprCont || 0;
                let diffEmprCont = prevEmprCont > 0 ? ((curEmprCont - prevEmprCont) / prevEmprCont) * 100 : (curEmprCont > 0 ? 100 : 0);
                $('#kpiEmprStatutoryVs').html(`${formatVs(diffEmprCont)} `).show();

                let prevOtInt = prevData.totalPayroll > 0 ? (prevData.totalOTPay / prevData.totalPayroll) * 100 : 0;
                let diffOtInt = otIntensity - prevOtInt; // Absolute percentage points difference
                $('#kpiOtIntensityVs').html(`${formatVs(diffOtInt)} `).show();

                let prevAvgOt = prevData.activeStaffCount > 0 ? (prevData.totalOTHrs / prevData.activeStaffCount) : 0;
                let diffAvgOt = prevAvgOt > 0 ? ((avgOt - prevAvgOt) / prevAvgOt) * 100 : (avgOt > 0 ? 100 : 0);
                $('#kpiAvgOtVs').html(`${formatVs(diffAvgOt)} `).show();
            } else {
                // If there is no previous month data yet
                $('#kpiTotalPayrollVs').html('<i class="bi bi-dash"></i> No prior month data').show();
                $('#kpiEmpStatutoryVs').html('<i class="bi bi-dash"></i> No prior month data').show();
                $('#kpiEmprStatutoryVs').html('<i class="bi bi-dash"></i> No prior month data').show();
                $('#kpiOtIntensityVs').html('<i class="bi bi-dash"></i> No prior month data').show();
                $('#kpiAvgOtVs').html('<i class="bi bi-dash"></i> No prior month data').show();
            }
        } else {
            // Hide comparisons if user is viewing Accumulated YTD
            $('#kpiTotalPayrollVs, #kpiEmpStatutoryVs, #kpiEmprStatutoryVs, #kpiOtIntensityVs, #kpiAvgOtVs').hide();
        }

        let totalMain = data.totalOTPay + data.totalNetBasic + data.totalEmprCont;
        let pOT = totalMain > 0 ? ((data.totalOTPay / totalMain) * 100).toFixed(1) : 0;
        let pBasic = totalMain > 0 ? ((data.totalNetBasic / totalMain) * 100).toFixed(1) : 0;
        let pEmpr = totalMain > 0 ? ((data.totalEmprCont / totalMain) * 100).toFixed(1) : 0;

        chartDataMain = {
            labels: [`Overtime Pay (${pOT}%)`, `Net Basic (${pBasic}%)`, `Employer Statutory (${pEmpr}%)`],
            data: [data.totalOTPay, data.totalNetBasic, data.totalEmprCont],
            colors: ['#b49871', '#5c6b80', '#839c8a'] 
        };

        let basicLabels = [], basicData = [];
        data.staffArr.filter(s => s.netBasic > 0).sort((a,b)=>b.netBasic - a.netBasic).forEach(s => {
            let pct = data.totalNetBasic > 0 ? ((s.netBasic / data.totalNetBasic) * 100).toFixed(1) : 0;
            basicLabels.push(`${s.name.substring(0,12)} (${pct}%)`);
            basicData.push(s.netBasic);
        });
        chartDataBasic = { labels: basicLabels, data: basicData, colors: generateColors(basicData.length) };

        let emprLabels = [], emprData = [], emprColors = [];
        if(data.totalEpfEmpr > 0) { emprLabels.push(`EPF (${((data.totalEpfEmpr/data.totalEmprCont)*100).toFixed(1)}%)`); emprData.push(data.totalEpfEmpr); emprColors.push('#8e879f'); }
        if(data.totalSocsoEmpr > 0) { emprLabels.push(`SOCSO (${((data.totalSocsoEmpr/data.totalEmprCont)*100).toFixed(1)}%)`); emprData.push(data.totalSocsoEmpr); emprColors.push('#ae8894'); }
        if(data.totalEisEmpr > 0) { emprLabels.push(`EIS (${((data.totalEisEmpr/data.totalEmprCont)*100).toFixed(1)}%)`); emprData.push(data.totalEisEmpr); emprColors.push('#b48a6c'); }
        chartDataEmpr = { labels: emprLabels, data: emprData, colors: emprColors };

        let otLabels = [], otData = [], otColors = [];
        if (data.totalNmOT > 0) { otLabels.push(`Normal 1.5 (${((data.totalNmOT/data.totalOTPay)*100).toFixed(1)}%)`); otData.push(data.totalNmOT); otColors.push('#627c6c'); }
        if (data.totalRdOT > 0) { otLabels.push(`RD 2.0 (${((data.totalRdOT/data.totalOTPay)*100).toFixed(1)}%)`); otData.push(data.totalRdOT); otColors.push('#839c8a'); }
        if (data.totalPh3 > 0) { otLabels.push(`PH 3.0 (${((data.totalPh3/data.totalOTPay)*100).toFixed(1)}%)`); otData.push(data.totalPh3); otColors.push('#809ca5'); }
        chartDataOT = { labels: otLabels, data: otData, colors: otColors };

        chartDataOTStaff = { NM: {labels:[], data:[]}, RD: {labels:[], data:[]}, PH3: {labels:[], data:[]} };
        
        let nmStaff = data.staffArr.filter(s => s.nmOTPay > 0).sort((a,b)=>b.nmOTPay - a.nmOTPay);
        chartDataOTStaff.NM.labels = nmStaff.map(s => `${s.name.substring(0,12)} (${((s.nmOTPay/data.totalNmOT)*100).toFixed(1)}%)`);
        chartDataOTStaff.NM.data = nmStaff.map(s => s.nmOTPay);
        chartDataOTStaff.NM.colors = generateColors(nmStaff.length);

        let rdStaff = data.staffArr.filter(s => s.rdOTPay > 0).sort((a,b)=>b.rdOTPay - a.rdOTPay);
        chartDataOTStaff.RD.labels = rdStaff.map(s => `${s.name.substring(0,12)} (${((s.rdOTPay/data.totalRdOT)*100).toFixed(1)}%)`);
        chartDataOTStaff.RD.data = rdStaff.map(s => s.rdOTPay);
        chartDataOTStaff.RD.colors = generateColors(rdStaff.length);

        let ph3Staff = data.staffArr.filter(s => s.ph3Pay > 0).sort((a,b)=>b.ph3Pay - a.ph3Pay);
        chartDataOTStaff.PH3.labels = ph3Staff.map(s => `${s.name.substring(0,12)} (${((s.ph3Pay/data.totalPh3)*100).toFixed(1)}%)`);
        chartDataOTStaff.PH3.data = ph3Staff.map(s => s.ph3Pay);
        chartDataOTStaff.PH3.colors = generateColors(ph3Staff.length);

        renderPie('main');
        
        const topStaff = [...data.staffArr].filter(s => s.otHrs > 0).sort((a,b) => b.otHrs - a.otHrs).slice(0, 5);
        const ctxBar = document.getElementById('otBarChart').getContext('2d');
        if (otBarChartObj) otBarChartObj.destroy();
        
        otBarChartObj = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: topStaff.map(s => s.name.substring(0,12) + (s.name.length > 12 ? '...' : '')),
                datasets: [{ 
                    label: 'Total OT Hours', 
                    data: topStaff.map(s => s.otHrs), 
                    backgroundColor: '#5c6b80', 
                    borderRadius: 6 
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                scales: { 
                    y: { beginAtZero: true, grid: { display: true, color: '#f1f3f5' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    function renderPie(level, subLevel = null) {
        let configData;
        if (level === 'main') {
            configData = chartDataMain;
            $('#btnBackPie').hide();
            $('#pieChartInst').text('Click on a slice to view detailed breakdown');
        } else if (level === 'basic') {
            configData = chartDataBasic;
            $('#btnBackPie').show().attr('onclick', "renderPie('main')");
            $('#pieChartInst').text('Net Basic Breakdown by Staff');
        } else if (level === 'empr') {
            configData = chartDataEmpr;
            $('#btnBackPie').show().attr('onclick', "renderPie('main')");
            $('#pieChartInst').text('Employer Statutory Contribution Breakdown');
        } else if (level === 'ot_types') {
            configData = chartDataOT;
            $('#btnBackPie').show().attr('onclick', "renderPie('main')");
            $('#pieChartInst').text('Overtime Breakdown by Multiplier. Click a slice for Staff details.');
        } else if (level === 'ot_staff') {
            configData = chartDataOTStaff[subLevel];
            $('#btnBackPie').show().attr('onclick', "renderPie('ot_types')");
            $('#pieChartInst').text(`Overtime (${subLevel}) Breakdown by Staff`);
        }

        const ctxPie = document.getElementById('wagePieChart').getContext('2d');
        if (wagePieChartObj) wagePieChartObj.destroy();
        
        const isMobile = window.innerWidth <= 768; 

        wagePieChartObj = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: configData.labels,
                datasets: [{
                    data: configData.data,
                    backgroundColor: configData.colors || generateColors(configData.data.length),
                    borderWidth: 1
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { 
                    legend: { 
                        position: isMobile ? 'bottom' : 'right', 
                        labels: { boxWidth: 12, font: { size: 11 } } 
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) { label = label.split(' (')[0] + ': '; }
                                let value = context.parsed;
                                return label + 'RM ' + value.toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                            }
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        if (level === 'main') {
                            const labelClicked = configData.labels[index];
                            if (labelClicked.includes('Net Basic')) renderPie('basic');
                            else if (labelClicked.includes('Overtime')) renderPie('ot_types');
                            else if (labelClicked.includes('Employer Statutory')) renderPie('empr');
                        } else if (level === 'ot_types') {
                            const labelClicked = configData.labels[index];
                            if (labelClicked.includes('Normal')) renderPie('ot_staff', 'NM');
                            else if (labelClicked.includes('RD')) renderPie('ot_staff', 'RD');
                            else if (labelClicked.includes('PH 3.0')) renderPie('ot_staff', 'PH3');
                        }
                    }
                }
            }
        });
    }

    function resetPie() {
        renderPie('main');
    }
    
    function getTieredWage(wage) {
        if (wage <= 30) return 20; 
        if (wage <= 50) return 40;
        if (wage <= 70) return 60;
        if (wage <= 100) return 90;
        if (wage <= 140) return 120;
        if (wage <= 200) return 170;
        
        let ceil = Math.ceil(wage / 100) * 100;
        if (ceil > 6000) ceil = 6000; 
        return ceil - 50; 
    }
    
    function calcStatutory(grossPayOrWages, age = 30, tp1Relief = 0, config = DEFAULT_STATUTORY_CONFIG) {
        let epfWage = 0, socsoWage = 0, eisWage = 0, pcbWage = 0;
        if (typeof grossPayOrWages === 'object' && grossPayOrWages !== null) {
            const types = config?.allowanceTypes || getAvailableAllowanceTypes();
            const w = calculateStatutoryWages(
                grossPayOrWages.basic !== undefined ? grossPayOrWages.basic : (grossPayOrWages.grossPay || 0),
                grossPayOrWages.fixedAllowances || [],
                types
            );
            const extraOT = Math.max(0, (parseFloat(grossPayOrWages.grossPay) || 0) - w.grossWage);
            epfWage = w.epfWages;
            socsoWage = w.socsoWages;
            eisWage = w.eisWages;
            pcbWage = w.pcbWages + extraOT;
        } else {
            const g = parseFloat(grossPayOrWages) || 0;
            epfWage = g;
            socsoWage = g;
            eisWage = g;
            pcbWage = g;
        }

        if (epfWage <= 0 && socsoWage <= 0 && eisWage <= 0 && pcbWage <= 0) {
            return { epfEmp: 0, epfEmpr: 0, socsoEmp: 0, socsoEmpr: 0, eisEmp: 0, eisEmpr: 0, pcb: 0 };
        }
        
        const epf = calculateEpf(epfWage, age, false, config);
        const socso = calculateSocso(socsoWage, age, config);
        const eis = calculateEis(eisWage, age, config);
        const pcb = calculatePcb(pcbWage, epf.employee, tp1Relief, age, config);

        return {
            epfEmp: epf.employee,
            epfEmpr: epf.employer,
            socsoEmp: socso.employee,
            socsoEmpr: socso.employer,
            eisEmp: eis.employee,
            eisEmpr: eis.employer,
            pcb: pcb
        };
    }

    function calculatePeriodDataRange(monthsToProcess) {
        let totalOTPay = 0, totalBasic = 0, totalOTHrs = 0;
        let totalNmOT = 0, totalRdOT = 0, totalPh3 = 0, totalPh2 = 0;
        let totalEmprCont = 0, totalEpfEmpr = 0, totalSocsoEmpr = 0, totalEisEmpr = 0;
        let totalEmpDed = 0;
        let totalNettPay = 0, totalNetBasic = 0;
        let staffMap = {};

        const compFilter = $('#summaryCompanySelect').val() || 'ALL';
        const deptFilter = $('#summaryDepartmentSelect').val() || 'ALL';

        monthsToProcess.forEach(m => {
            const isLocked = !!(lockedMonthsData[`${m}__${compFilter}`] || lockedMonthsData[m]);
            const effectiveSettings = isLocked ? (lockedMonthsData[`${m}__${compFilter}`]?.rates || lockedMonthsData[m]?.rates) : staffSettings;

            const [year, month] = m.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const fullDates = Array.from({length: daysInMonth}, (_, i) => {
                const dStr = `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
                const obj = new Date(dStr); return { date: dStr, dayIdx: obj.getDay() };
            });

            staffList.forEach(([id, name]) => {
                const sObj = findStaffSetting(id, name);
                if (compFilter !== 'ALL') {
                    const cName = getStaffCompany(sObj);
                    if (cName !== compFilter) return;
                }
                if (deptFilter !== 'ALL') {
                    const dName = getStaffDepartment(sObj);
                    if (dName !== deptFilter) return;
                }
                const settings = effectiveSettings[id] || effectiveSettings[name] || { basic: 0, restDays: [] };
                const basicSalary = parseFloat(settings.basic) || parseFloat(sObj?.basic) || 0;
                const hourlyRate = basicSalary > 0 ? parseFloat((basicSalary / 26 / 8).toFixed(2)) : 0;

                const staffDataMap = new Map();
                attendanceRowsForStaff(m, id, name, sObj).forEach(d => staffDataMap.set(d.date, d));
                if (basicSalary <= 0 && staffDataMap.size === 0) return;

                if (!staffMap[id]) staffMap[id] = { 
                    id, name, basic: 0, otHrs: 0, otPay: 0, total: 0, 
                    netBasic: 0, emprCont: 0, nmOTPay: 0, rdOTPay: 0, ph3Pay: 0 
                };
                
                staffMap[id].basic += basicSalary;

                let monthOTHrs = 0; let monthOTPay = 0;
                let mNmOT = 0, mRdOT = 0, mPh3 = 0;

                fullDates.forEach(fd => {
                    const d = staffDataMap.get(fd.date) || {};
                    const isPH = getPublicHolidayForStaff(fd.date, sObj);
                    const restDays = getStaffEffectiveRestDays(sObj, settings);
                    const isRD = restDays.includes(fd.dayIdx);
                    let payType = "NM"; if (isPH) payType = "PH"; else if (isRD) payType = "RD";
                    if (d.manualPayType && d.manualPayType !== "AUTO") payType = d.manualPayType;

                    const totalTimeHrs = (d.totalMins || 0) / 60;
                    
                    let overlapOT = parseFloat(d.manualOverlap);
                    if (isNaN(overlapOT)) overlapOT = parseFloat(d.overlapOT);
                    if (isNaN(overlapOT)) overlapOT = 0;

                    let extraOT = parseFloat(d.manualExtra);
                    if (isNaN(extraOT)) extraOT = parseFloat(d.extraOT);
                    if (isNaN(extraOT)) extraOT = 0;

                    let totalOTRow = overlapOT + extraOT;
                    let rowPay = 0; let rowOTHrs = 0;

                    if (d.manualOTPay !== null && d.manualOTPay !== undefined && String(d.manualOTPay).trim() !== '') {
                        rowPay = parseFloat(d.manualOTPay) || 0;
                        rowOTHrs = totalOTRow;
                        if (payType === "PH") { mPh3 += rowPay; }
                        else if (payType === "RD") { mRdOT += rowPay; }
                        else { mNmOT += rowPay; }
                    } else {
                        if (payType === "PH" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                            let parsedPayable = parseFloat(d.payableHrs);
                            if (isNaN(parsedPayable)) parsedPayable = 0;
                            let ph2 = parsedPayable + totalOTRow; 
                            rowPay = ph2 * hourlyRate * 3.0;
                            rowOTHrs = ph2;
                            mPh3 += rowPay;
                        } else if (payType === "RD" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                            let rdBase = Math.min(8, totalTimeHrs || 0);
                            rowPay = (rdBase * hourlyRate * 2.0) + (totalOTRow * hourlyRate * 2.0);
                            rowOTHrs = rdBase + totalOTRow;
                            mRdOT += rowPay;
                        } else if (totalTimeHrs > 0 || totalOTRow > 0) {
                            rowPay = totalOTRow * hourlyRate * 1.5;
                            rowOTHrs = totalOTRow;
                            mNmOT += rowPay;
                        }
                    }
                    
                    if (isNaN(rowPay)) rowPay = 0;
                    if (isNaN(rowOTHrs)) rowOTHrs = 0;
                    
                    monthOTHrs += rowOTHrs; 
                    monthOTPay += rowPay;
                });
                
                monthOTPay = Number(monthOTPay.toFixed(2));
                mNmOT = Number(mNmOT.toFixed(2));
                mRdOT = Number(mRdOT.toFixed(2));
                mPh3 = Number(mPh3.toFixed(2));

                let monthTotalPayout = Number((basicSalary + monthOTPay).toFixed(2));
                let stat = calcStatutory(monthTotalPayout);
                let empDed = stat.epfEmp + stat.socsoEmp + stat.eisEmp;
                let emprCont = stat.epfEmpr + stat.socsoEmpr + stat.eisEmpr;
                
                let monthNettPay = Number((monthTotalPayout - empDed).toFixed(2));
                let monthNetBasic = Number((monthNettPay - monthOTPay).toFixed(2));
                
                staffMap[id].otHrs += monthOTHrs; 
                staffMap[id].otPay += monthOTPay; 
                staffMap[id].total += monthTotalPayout;
                staffMap[id].netBasic += monthNetBasic;
                staffMap[id].emprCont += emprCont;
                staffMap[id].nmOTPay += mNmOT;
                staffMap[id].rdOTPay += mRdOT;
                staffMap[id].ph3Pay += mPh3;

                totalEpfEmpr += stat.epfEmpr;
                totalSocsoEmpr += stat.socsoEmpr;
                totalEisEmpr += stat.eisEmpr;
                totalEmprCont += emprCont;
                totalEmpDed += empDed;
                totalNettPay += monthNettPay;
                totalNetBasic += monthNetBasic;
                totalNmOT += mNmOT;
                totalRdOT += mRdOT;
                totalPh3 += mPh3;
            });
        });

        const validStaffArr = Object.values(staffMap).filter(s => s.basic > 0);

        validStaffArr.forEach(s => {
            totalBasic += s.basic;
            totalOTHrs += s.otHrs;
            totalOTPay += s.otPay;
        });

        totalOTPay = Number(totalOTPay.toFixed(2));
        totalNetBasic = Number(totalNetBasic.toFixed(2));
        totalEmprCont = Number(totalEmprCont.toFixed(2));
        totalEmpDed = Number(totalEmpDed.toFixed(2));
        
        let totalPayroll = Number((totalNettPay + totalEmprCont).toFixed(2));

        return { 
            totalPayroll, totalOTPay, totalOTHrs, totalBasic, 
            totalNmOT, totalRdOT, totalPh3, totalPh2,
            totalEmprCont, totalEpfEmpr, totalSocsoEmpr, totalEisEmpr,
            totalEmpDed,
            totalNettPay, totalNetBasic,
            activeStaffCount: validStaffArr.length, 
            staffArr: validStaffArr, 
            monthCount: monthsToProcess.length 
        };
    }

    function initializeDashboard() {
        $('.wrapper').hide(); 

        $('#content').append($('#dashboard'), $('#staff-mgmt'), $('#holidays'), $('#payslips-portal'));
        const fileInputEl = document.getElementById('fileInput');
        if (fileInputEl) fileInputEl.addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });
        const attUploadEl = document.getElementById('attendanceFileUpload');
        if (attUploadEl) attUploadEl.addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });
        $(document).on('change', '#attendanceFileUpload, #fileInput, #hrAttendanceFileUpload', function(e) {
            if (this.files && this.files.length) handleFile(this.files[0]);
        });
        $('#monthSelect').change(renderDashboard);
        $(document).on('change', '#sumDashMonth, #summaryDepartmentSelect', renderSummaryDashboard);
        $(document).on('change', '#summaryViewType', toggleSummaryView);
        $(document).on('change', '#summaryCompanySelect', handleSummaryCompanyChange);
        $(document).on('input', '#attendanceStaffSearch', renderDashboard);
        if (typeof window !== 'undefined') {
            window.addEventListener('peopleos-cache-sync', (e) => {
                if (e.detail?.type === 'attendance' || e.detail?.type === 'lockedMonths') {
                    syncMonthSelectDropdowns();
                    if ($('#summary-dashboard').hasClass('active')) renderSummaryDashboard();
                    if ($('#dashboard').hasClass('active')) renderDashboard();
                } else if (e.detail?.type === 'bootstrap') {
                    if ($('#staff-mgmt').hasClass('active')) renderStaffMgmt();
                    if ($('#holidays').hasClass('active')) renderHolidayMgmt();
                }
            });
        }
        toggleReportType(); toggleSummaryView();
        
        // --- NEW: Global Anti-Popup Fix for Google Sites ---
        $(document).on('click', 'button', function(e) {
            if(!$(this).attr('type')) { $(this).attr('type', 'button'); }
        });
        $(document).on('click', 'a[href="#"]', function(e) {
            e.preventDefault();
        });
        // ---------------------------------------------------
        
        $('#loginUser, #loginPass').keypress(function(e) {
            if (e.which == 13) processLogin();
        });
        
        function getHrPortalToken() {
            return localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken') || '';
        }
        function setHrPortalToken(token) {
            if (token) {
                localStorage.setItem('hrPortalToken', token);
                sessionStorage.setItem('hrPortalToken', token);
            }
        }
        function removeHrPortalToken() {
            localStorage.removeItem('hrPortalToken');
            sessionStorage.removeItem('hrPortalToken');
        }
        
        const savedUser = getHrPortalToken() ? localStorage.getItem('hrPortalUser') : null;
        if (savedUser) {
            try { 
                currentUser = JSON.parse(savedUser); 
                if (typeof window !== 'undefined') window.currentUser = currentUser;
            } catch { 
                localStorage.removeItem('hrPortalUser'); 
                removeHrPortalToken();
                $('#loginScreen').show(); 
                return; 
            }
            $('#loginScreen').hide();
            $('.wrapper').fadeIn();
            apiPost('whoami',{}).then(res=>{
                if(res.staleSession)return;
                if(res.status==='success'&&res.user){
                    currentUser={...currentUser,...res.user};
                    if (typeof window !== 'undefined') window.currentUser = currentUser;
                    applyUserRoleUI();
                } else logout();
            });
        } else {
            $('#loginScreen').show();
        }
    }

    async function processLogin() {
        const user = $('#loginUser').val(); const pass = $('#loginPass').val();
        if(!user || !pass) return $('#loginError').text("Enter credentials").show();
        
        $('#btnLogin').html('<span class="spinner-border spinner-border-sm"></span>').prop('disabled', true);
        
        const res = await apiPost('login', { username: user, password: pass });
        if(res.status === 'success') {
            currentUser = res.user;
            if (typeof window !== 'undefined') window.currentUser = currentUser;
            if (res.sessionToken) {
                localStorage.setItem('hrPortalToken', res.sessionToken);
                sessionStorage.setItem('hrPortalToken', res.sessionToken);
            }
            localStorage.setItem('hrPortalUser', JSON.stringify(currentUser)); 
            
            $('#loginScreen').fadeOut();
            $('.wrapper').fadeIn();
            applyUserRoleUI();
        } else {
            $('#loginError').text(res.message || 'Unable to sign in. Check your details and try again.').show();
            $('#btnLogin').text('Sign in').prop('disabled', false);
        }
    }

    let dashboardSessionKey = '';
    function clearDashboardSessionData() {
        initializationRequest++;
        payslipRequest++;
        pendingReads.clear();
        $('#refreshSystemBtn').prop('disabled', false).attr('aria-busy', 'false');
        $('#refreshPayslips').prop('disabled', false);
        globalData = []; staffList = []; staffSettings = {};
        globalLeaves = []; lockedMonthsData = {}; currentProcessedRows = [];
        staffPayslips = []; currentFullProfile = {};
        holidays = [];
        leaveFileBase64 = null; leaveFileName = null; leaveFileMime = null;
        selectedFileBase64 = null; selectedFileName = null; selectedFileMime = null;
        cachedCompanies = []; cachedDepartments = []; cachedJobGrades = []; cachedJobTitles = [];
        attendanceIndexSource = null; leaveIndexSource = null;
        attendanceIdentityIndex.clear(); leaveIdentityIndex.clear();
        chartDataMain = {}; chartDataBasic = {}; chartDataOT = {}; chartDataEmpr = {}; chartDataOTStaff = {};
        if (wagePieChartObj) { wagePieChartObj.destroy(); wagePieChartObj = null; }
        if (otBarChartObj) { otBarChartObj.destroy(); otBarChartObj = null; }
        if (typeof window !== 'undefined') {
            window.staffSettings = {};
            window.hrCompanies = [];
            window.workBases = []; window.workLocations = []; window.workSchedules = [];
        }
        $('#payslip-print-section').hide();
        $('#payslip-detail-toolbar').addClass('d-none');
        $('#reportContainer, #staffCardsContainer, #payslip-list-body, #myLeaveTableBody, #myLeaveCardsMobile, #approvalTableBody, #onLeaveTableBody, #mobileApprovalCardsContainer, #mobileOnLeaveCardsContainer').empty();
    }

    function applyUserRoleUI() {
        if (!currentUser && typeof window !== 'undefined' && window.currentUser) {
            currentUser = window.currentUser;
        }
        if(!currentUser) return;
        currentUser.role=normaliseRole(currentUser.role);
        const sessionKey = JSON.stringify([localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken'), currentUser.name, currentUser.role]);
        if (dashboardSessionKey !== sessionKey) {
            clearDashboardSessionData();
            dashboardSessionKey = sessionKey;
        }
        if (typeof window !== 'undefined') window.currentUser = currentUser;
        window.dispatchEvent(new CustomEvent('hr-session', { detail: currentUser }));
        const isHrDeptHod = ['HOD', 'Supervisor'].includes(currentUser.role) && (
            String(currentUser.departmentId || '').toUpperCase() === 'HR' ||
            /human resource|hr/i.test(currentUser.departmentTitle || currentUser.department || '')
        );
        isAdmin = ['Admin', 'HR'].includes(currentUser.role) || isHrDeptHod;
        const isManagerOrAdmin = isAdmin || ['HOD', 'Supervisor'].includes(currentUser.role);
        $('.admin-only-element').toggle(isAdmin);
        $('#editOTPay').prop('disabled', !isAdmin).parent().toggle(isAdmin);
        $('.staff-only-element').toggle(!isAdmin);
        $('#adminBottomNav').toggle(isManagerOrAdmin);
        $('#userBottomNav').toggle(!isManagerOrAdmin);
        $('#initialLoader,#emptyStateMsg').hide();
        const menu=$('#sidebarMenu').empty();
        menu.append('<li><a href="#" data-hr-module="overview" data-scope="overview"><i class="bi bi-grid"></i> Overview</a></li>');
        navigationFor(currentUser.role).forEach(group=>{
            const li=$('<li class="navigation-group">'),details=$('<details>');
            const summary=$('<summary>').append($('<i>').addClass('bi bi-'+group.icon),document.createTextNode(group.label));
            details.append(summary);
            const children=$('<ul class="list-unstyled navigation-children">');
            const appendItem=(item,target)=>{
                if (item.items && Array.isArray(item.items) && item.items.length) {
                    const subLi = $('<li class="navigation-subgroup">');
                    const subDetails = $('<details class="navigation-subdetails">');
                    const subSummary = $('<summary class="navigation-subsummary">').append(
                        $('<i>').addClass('bi bi-' + (item.icon || 'folder')),
                        document.createTextNode(item.label)
                    );
                    subDetails.append(subSummary);
                    const subChildren = $('<ul class="list-unstyled navigation-subchildren">');
                    item.items.forEach(child => appendItem(child, subChildren));
                    subDetails.append(subChildren);
                    subLi.append(subDetails);
                    target.append(subLi);
                    return;
                }
                const link=$('<a href="#">').append($('<i>').addClass('bi bi-'+item.icon),document.createTextNode(item.label));
                if(item.module)link.attr({'data-hr-module':item.module,'data-scope':item.scope});
                else link.attr({'data-page':item.page,'data-scope':item.scope || 'all'});
                target.append($('<li>').append(link));
            };
            group.items.forEach(item=>appendItem(item,children));
            details.append(children);li.append(details);menu.append(li);
        });
        menu.find('> li.navigation-group > details > summary').on('click', function() {
            const thisDetails = $(this).parent('details');
            menu.find('> li.navigation-group > details').not(thisDetails).removeAttr('open');
        });
        menu.find('.navigation-subdetails > summary').on('click', function() {
            const thisSub = $(this).parent('details');
            thisSub.closest('.navigation-children').find('.navigation-subdetails').not(thisSub).removeAttr('open');
        });
        menu.find('a').on('click',function(event){
            event.preventDefault();
            menu.find('li').removeClass('active');
            menu.find('a').removeAttr('aria-current');
            menu.find('.navigation-subgroup, .navigation-group').removeClass('has-active');
            $(this).parent().addClass('active');
            $(this).attr('aria-current', 'page');
            $(this).closest('.navigation-subgroup').addClass('has-active');
            $(this).closest('.navigation-group').addClass('has-active');

            // Auto collapse the side tab to parent after a tab is selected for all user role by default
            menu.find('details').removeAttr('open');

            if(this.dataset.hrModule)openHrPage(this.dataset.hrModule,this.dataset.scope,this);
            else switchTab(this.dataset.page,this,this.dataset.scope);
        });
        $('#staff-mgmt > .main-card button').filter(function(){return $(this).text().includes('Add Staff');}).toggle(isAdmin);
        openHrPage('overview','overview',menu.find('[data-hr-module="overview"]')[0]);
        // Auto preload personal profile, leave, and team data in background
        setTimeout(() => {
            if (currentUser) {
                try { void loadMyProfile(); } catch(_) {}
                try { void fetchMyLeave(); } catch(_) {}
                if (['HOD', 'Supervisor', 'HR', 'Admin'].includes(currentUser.role)) {
                    try { void fetchLeaveManagementData(); } catch(_) {}
                }
            }
        }, 700);
        if ((isAdmin || ['HOD','Supervisor'].includes(currentUser?.role)) && window.innerWidth > 768) initializeApp();
    }

    function openHrPage(module,scope,element) {
        if(!currentUser && typeof window !== 'undefined') {
            const s = localStorage.getItem('hrPortalUser');
            if (s) {
                try { currentUser = JSON.parse(s); } catch(_) {}
            }
            if (!currentUser && window.currentUser) currentUser = window.currentUser;
        }
        const entry=module==='overview'?{label:'Overview'}:allNavigationItems(currentUser?.role).find(i=>i.module===module&&i.scope===scope);
        const label = entry?.label || (element ? $(element).text().trim() : '') || module;
        switchTab('hr-workspace',element);
        $('#pageTitle').text(label);
        window.dispatchEvent(new CustomEvent('hr-module',{detail:{module,scope,label}}));
    }

    function logout() {
        apiPost('logout', {});
        localStorage.removeItem('hrPortalToken');
        sessionStorage.removeItem('hrPortalToken');
        clearDashboardSessionData();
        dashboardSessionKey = '';
        if (typeof window !== 'undefined') window.currentUser = null;
        window.dispatchEvent(new CustomEvent('hr-session', { detail: null }));
        localStorage.removeItem('hrPortalUser');
        currentUser = null;
        isAdmin = false;
        
        // --- NEW: Reset Login Button State ---
        $('#btnLogin').html('Sign in').prop('disabled', false);
        
        // Soft UI Reset to prevent iframe breakout
        $('.wrapper').fadeOut(() => {
            $('#loginUser').val('');
            $('#loginPass').val('');
            $('#loginScreen').fadeIn();
        });
    }

    function switchTab(t, e, scope) {
        if (!currentUser && typeof window !== 'undefined') {
            const s = localStorage.getItem('hrPortalUser');
            if (s) {
                try { currentUser = JSON.parse(s); } catch(_) {}
            }
            if (!currentUser && window.currentUser) currentUser = window.currentUser;
        }
        if(!currentUser)return;
        const allowed=allNavigationItems(currentUser.role).some(i=>i.page===t);
        if(t!=='hr-workspace'&&!allowed&&!(t==='reports'&&isAdmin))return;

        if (scope) currentStaffScope = scope;
        else if (e && e.dataset && e.dataset.scope) currentStaffScope = e.dataset.scope;
        else if (t === 'staff-mgmt' && !scope) currentStaffScope = 'all';

        const titles = { 
            'summary-dashboard': 'Payroll Overview', 
            'dashboard': ['HOD', 'Supervisor'].includes(currentUser?.role) ? 'Attendance Approvals' : 'Attendance Dashboard', 
            'staff-mgmt': currentStaffScope === 'team' ? 'Team Directory' : 'Employee Management', 
            'holidays': 'Public Holidays', 
            'reports': 'Report Generator',
            'staff-portal': 'My Leave',
            'my-attendance': 'My Attendance',
            'leave-management': 'Leave Management',
            'payslips-portal': 'My Payslips',
            'my-profile': 'My Profile',
            'hr-workspace': 'HR overview'
        };
        
        $('#pageTitle').text(titles[t] || 'HR Portal');

        $('.tab-section').stop(true, true).hide().removeClass('active');
        $('#'+t).show().addClass('active');
        $('#sidebar li').removeClass('active'); $('#sidebar a').removeAttr('aria-current'); 
        if(e) { $(e).parent().addClass('active'); $(e).attr('aria-current', 'page'); }
        
        $('#emptyStateMsg').hide();
        if(!e){
            const link=$('#sidebarMenu [data-page="'+t+'"][data-scope="'+currentStaffScope+'"]').length 
                ? $('#sidebarMenu [data-page="'+t+'"][data-scope="'+currentStaffScope+'"]') 
                : $('#sidebarMenu [data-page="'+t+'"]');
            link.parent().addClass('active');link.attr('aria-current','page');
            link.closest('.navigation-subgroup').addClass('has-active');
            link.closest('.navigation-group').addClass('has-active');
            $('#sidebarMenu details').removeAttr('open');
        }
        if(t === 'staff-mgmt') renderStaffMgmt(); 
        if(t === 'holidays') renderHolidayMgmt(); 
        if(t === 'dashboard') {
            $('#controlPanel').show();
            if (!globalData || globalData.length === 0) {
                const cachedAtt = CacheManager.getAttendanceHistory();
                if (cachedAtt && cachedAtt.length) globalData = cachedAtt;
            }
            if (!lockedMonthsData || Object.keys(lockedMonthsData).length === 0) {
                const cachedLocked = CacheManager.getLockedMonths();
                if (cachedLocked && Object.keys(cachedLocked).length) lockedMonthsData = cachedLocked;
            }
            if ($('#monthSelect option').filter((_, el) => el.value && el.value.includes('-')).length === 0) {
                const availableMonths = new Set();
                if (globalData && globalData.length) {
                    globalData.forEach(d => { if (d.month && d.month.includes('-')) availableMonths.add(d.month); });
                }
                if (lockedMonthsData) {
                    Object.keys(lockedMonthsData).forEach(km => { if (km && km.includes('-')) availableMonths.add(km); });
                }
                const now = new Date();
                availableMonths.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
                const sortedMonths = Array.from(availableMonths).sort().reverse();
                sortedMonths.forEach(km => {
                    if (!$(`#monthSelect option[value="${km}"]`).length) {
                        $('#monthSelect').append(`<option value="${km}">${formatMonthStr(km)}</option>`);
                    }
                });
                if (!$('#monthSelect').val() && sortedMonths.length) {
                    $('#monthSelect').val(sortedMonths[0]);
                }
            }
            renderDashboard(); 
        }
        if(t === 'summary-dashboard') renderSummaryDashboard();
        if(t === 'staff-portal') loadStaffPortal();
        if(t === 'leave-management') fetchLeaveManagementData();
        if(t === 'payslips-portal') fetchPayslips();
        if(t === 'my-profile') loadMyProfile();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('hr-switch-tab', { detail: { tab: t } }));
    }

    function switchMobileTab(tabId, element) {
        if (!currentUser && typeof window !== 'undefined' && window.currentUser) {
            currentUser = window.currentUser;
        }
        const normRole = normaliseRole(currentUser?.role);
        if (tabId === 'dashboard' && normRole === 'User') {
            tabId = 'my-profile';
            setTimeout(() => {
                $('#myprofile-tab-schedule-btn').trigger('click');
            }, 60);
        }
        $('.tab-section').stop(true, true).hide().removeClass('active');
        $('#' + tabId).show().addClass('active');
        
        $('.mobile-bottom-nav .nav-item').removeClass('active');
        if (element) $(element).addClass('active');
        const titles = {
            'summary-dashboard':'Payroll Overview',
            'dashboard': ['HOD', 'Supervisor'].includes(currentUser?.role) ? 'Attendance Approvals' : 'Attendance Dashboard',
            'staff-portal':'My Leave & Requests',
            'my-profile':'My Profile',
            'payslips-portal':'My Payslips',
            'mobile-staff-on-leave':'Staff on Leave',
            'mobile-leave-approval':'Approvals & Inbox'
        };
        $('#pageTitle').text(titles[tabId] || 'Dashboard');
        
        if(tabId === 'summary-dashboard') renderSummaryDashboard();
        if(tabId === 'dashboard') renderDashboard();
        if(tabId === 'staff-portal') loadStaffPortal();
        if(tabId === 'mobile-staff-on-leave' || tabId === 'mobile-leave-approval') fetchLeaveManagementData();
        if(tabId === 'payslips-portal') fetchPayslips();
        if(tabId === 'my-profile') loadMyProfile();
    }

    /* --- PAYSLIPS (STAFF) --- */
    async function fetchPayslips() {
        if (payslipPrinting) return;
        const request = ++payslipRequest;
        const user = currentUser;
        staffPayslips = [];
        closePayslip();
        $('#payslip-list, #no-payslip-msg, #payslip-error').hide();
        $('#payslip-list-body').empty();
        $('#payslip-status').text('Loading payslips…');
        $('#refreshPayslips').prop('disabled', true);
        try {
            const res = await apiPost('getPayroll', {});
            if (request !== payslipRequest || user !== currentUser) return;
            if (!res || res.status !== 'success' || !Array.isArray(res.data)) throw new Error('Fetch failed');
            staffPayslips = res.data.filter(r => r.name === user.name).sort((a, b) => b.month.localeCompare(a.month));
            $('#payslip-status').text(staffPayslips.length ? `${staffPayslips.length} payslip${staffPayslips.length === 1 ? '' : 's'}` : '');
            if (!staffPayslips.length) { $('#no-payslip-msg').show(); return; }
            staffPayslips.forEach(ps => {
                const label = formatMonthStr(ps.month);
                const row = $('<tr>');
                row.append($('<th scope="row" class="fw-semibold">').html(`<span class="badge bg-light text-dark border"><i class="bi bi-calendar3 me-1"></i>${label}</span>`));
                row.append($('<td class="text-end">').text(Number(ps.basic || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})));
                const additions = Number(ps.otPay || 0) + Number(ps.claims || 0) + Number(ps.zeroMcAward || 0);
                row.append($('<td class="text-end">').text(additions > 0 ? Number(additions).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'));
                row.append($('<td class="text-end fw-semibold">').text(Number(ps.gross || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})));
                row.append($('<td class="text-end text-danger">').text(Number(ps.epfEmp || 0) > 0 ? `-${Number(ps.epfEmp).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'));
                const socsoEis = Number(ps.socsoEmp || 0) + Number(ps.eisEmp || 0);
                row.append($('<td class="text-end text-danger">').text(socsoEis > 0 ? `-${Number(socsoEis).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'));
                row.append($('<td class="text-end text-danger">').text(Number(ps.pcb || 0) > 0 ? `-${Number(ps.pcb).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'));
                const totDed = Number(ps.totalEmpDed || 0) + (Number(ps.nplDeduction) || 0);
                row.append($('<td class="text-end fw-semibold text-danger">').text(totDed > 0 ? `-${Number(totDed).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'));
                row.append($('<td class="text-end fw-bold text-success fs-6">').text(`RM ${Number(ps.nettPay || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`));
                row.append($('<td class="text-center">').html('<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-lock-fill me-1"></i>Finalized</span>'));
                const actions = $('<div class="d-flex flex-wrap gap-2 justify-content-end">');
                $('<button type="button" class="btn btn-outline-primary btn-sm">').html('<i class="bi bi-eye me-1"></i>View').attr('aria-label', `View payslip for ${label}`).on('click', () => {
                    renderSelectedPayslip(ps.month);
                    $('#payslip-detail-toolbar').removeClass('d-none');
                    $('#payslip-print-section').show();
                    $('#payslip-detail-title').text(`Payslip · ${label}`).trigger('focus');
                }).appendTo(actions);
                $('<button type="button" class="btn btn-primary btn-sm">').html('<i class="bi bi-file-earmark-pdf me-1"></i>PDF').attr('aria-label', `Download / Print PDF for ${label}`).on('click', function() { printPayslip(ps.month, this); }).appendTo(actions);
                row.append($('<td>').append(actions));
                $('#payslip-list-body').append(row);
            });
            $('#payslip-list').show();
        } catch (_) {
            if (request !== payslipRequest || user !== currentUser) return;
            $('#payslip-status').text('');
            $('#payslip-error').text('Could not load your payslips. Please refresh to try again.').show();
        } finally {
            if (request === payslipRequest) $('#refreshPayslips').prop('disabled', false);
        }
    }

    function closePayslip() {
        $('#payslip-print-section').hide();
        $('#payslip-detail-toolbar').addClass('d-none');
    }

    function formatMonthStr(mStr) {
        if(!mStr) return "";
        const mNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const parts = mStr.split('-');
        if(parts.length !== 2) return mStr;
        return `${mNames[parseInt(parts[1])-1]}-${parts[0]}`;
    }

    function renderSelectedPayslip(selectedMonth, records = staffPayslips, profile = currentUser) {
        const ps = records.find(r => r.month === selectedMonth);
        if(!ps) return;

        $('#ps-name').text(ps.name);
        $('#ps-period').text(`END-${formatMonthStr(ps.month)}`);
        $('#ps-staff-id').text(ps.id);
        $('#ps-ic').text(profile.icNo || '-');

        // MAP REAL BANK & STATUTORY DATA FROM LOGIN
        $('#ps-epf-no').text(profile.epfNo || '-');
        $('#ps-socso-no').text(profile.socsoNo || '-');
        $('#ps-tax-no').text(profile.taxNo || '-');
        $('#ps-bank-no').text(profile.bankNo || '-');

        const fmt = (val) => Number(val).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // Earnings
        $('#ps-basic').text(fmt(ps.basic));
        $('#ps-ot').text(fmt(ps.otPay));
        $('#ps-gross').text(fmt(ps.gross));

        // Deductions
        $('#ps-epf-emp').text(fmt(ps.epfEmp));
        $('#ps-socso-emp').text(fmt(ps.socsoEmp));
        $('#ps-eis-emp').text(fmt(ps.eisEmp));
        $('#ps-deductions').text(fmt(ps.totalEmpDed));
        $('#ps-nett').text(fmt(ps.nettPay));

        // Leave Balances
        for (const [category, prefix] of [['Annual', 'al'], ['Medical', 'mc']]) {
            const balance = (profile.leaveBalances || []).find(item => item.category === category);
            const verified = balance && balance.balance != null && balance.openingBalance != null;
            $(`#ps-${prefix}-taken`).text(verified ? fmt(balance.used || 0) : '—');
            $(`#ps-${prefix}-bal`).text(verified ? fmt(balance.balance) : '—');
        }

        // Current Month Statutory
        $('#ps-cm-epf-emp').text(fmt(ps.epfEmp));
        $('#ps-cm-socso-emp').text(fmt(ps.socsoEmp));
        $('#ps-cm-eis-emp').text(fmt(ps.eisEmp));
        
        $('#ps-cm-epf-empr').text(fmt(ps.epfEmpr));
        $('#ps-cm-socso-empr').text(fmt(ps.socsoEmpr));
        $('#ps-cm-eis-empr').text(fmt(ps.eisEmpr));

        $('#ps-cm-epf-tot').text(fmt(Number(ps.epfEmp) + Number(ps.epfEmpr)));
        $('#ps-cm-socso-tot').text(fmt(Number(ps.socsoEmp) + Number(ps.socsoEmpr)));
        $('#ps-cm-eis-tot').text(fmt(Number(ps.eisEmp) + Number(ps.eisEmpr)));

        // Year to Date Calculation
        const year = selectedMonth.split('-')[0];
        let ytd = { epfEmp: 0, socsoEmp: 0, eisEmp: 0, epfEmpr: 0, socsoEmpr: 0, eisEmpr: 0 };

        records.forEach(record => {
            if (record.month.startsWith(year) && record.month <= selectedMonth) {
                ytd.epfEmp += Number(record.epfEmp);
                ytd.socsoEmp += Number(record.socsoEmp);
                ytd.eisEmp += Number(record.eisEmp);
                ytd.epfEmpr += Number(record.epfEmpr);
                ytd.socsoEmpr += Number(record.socsoEmpr);
                ytd.eisEmpr += Number(record.eisEmpr);
            }
        });

        $('#ps-ytd-epf-emp').text(fmt(ytd.epfEmp));
        $('#ps-ytd-socso-emp').text(fmt(ytd.socsoEmp));
        $('#ps-ytd-eis-emp').text(fmt(ytd.eisEmp));
        
        $('#ps-ytd-epf-empr').text(fmt(ytd.epfEmpr));
        $('#ps-ytd-socso-empr').text(fmt(ytd.socsoEmpr));
        $('#ps-ytd-eis-empr').text(fmt(ytd.eisEmpr));

        $('#ps-ytd-epf-tot').text(fmt(ytd.epfEmp + ytd.epfEmpr));
        $('#ps-ytd-socso-tot').text(fmt(ytd.socsoEmp + ytd.socsoEmpr));
        $('#ps-ytd-eis-tot').text(fmt(ytd.eisEmp + ytd.eisEmpr));
    }

    async function printPayslip(selectedMonth, button, archiveContext) {
        if (payslipPrinting) return;

        const ps = (archiveContext?.records || staffPayslips).find(r => r.month === selectedMonth);
        if (!ps) return;

        payslipPrinting = true;
        const printBtn = $(button);
        const originalContent = printBtn.html();
        let wrapper;
        $('#payslip-list button, #refreshPayslips').prop('disabled', true);
        printBtn.text('Generating PDF…');
        $('#payslip-error').hide();
        try {
        const html2pdf = (await import('html2pdf.js')).default;
        renderSelectedPayslip(selectedMonth, archiveContext?.records || staffPayslips, archiveContext?.profile || currentUser);
        $('#payslip-detail-title').text(`Payslip · ${formatMonthStr(selectedMonth)}`);
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const parts = selectedMonth.split('-');

        if (parts.length === 2) {
            const mthStr = monthNames[parseInt(parts[1]) - 1];
            const yrStr = parts[0];
            
            // Format name: Replace spaces with underscores and remove special characters
            const safeName = ps.name.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
            const fileName = `${mthStr}_${yrStr}_${safeName}.pdf`;

            // 1. Grab the original element
            const originalElement = document.getElementById('payslip-print-section');
            
            // 2. Create a clean clone
            const printClone = originalElement.cloneNode(true);
            
            // 3. Force exact dimensions and hide any invisible overflow that causes page 2
            printClone.style.display = 'block';
            printClone.style.position = 'relative';
            printClone.style.transform = 'none';
            printClone.style.left = '0';
            printClone.style.top = '0';
            printClone.style.width = '850px'; 
            printClone.style.height = 'max-content'; // Forces the box to tightly wrap the content
            printClone.style.margin = '0 auto';
            printClone.style.padding = '30px';
            printClone.style.background = 'white';
            printClone.style.overflow = 'hidden'; // Snips off invisible trailing whitespace

            // 4. Put the clone in a temporary hidden wrapper far off-screen
            wrapper = document.createElement('div');
            wrapper.style.position = 'absolute';
            wrapper.style.top = '-9999px';
            wrapper.style.left = '0';
            wrapper.style.width = '1200px'; 
            wrapper.appendChild(printClone);
            document.body.appendChild(wrapper);

            // 5. Configure PDF settings 
            // Margins set to [Top, Right, Bottom, Left]. 
            // Reduced Top to 0.6 and Bottom to 0.2 so it easily fits on exactly 1 page.
            const opt = {
                margin:       [0.6, 1.4, 0.2, 1.4], 
                filename:     fileName,
                image:        { type: 'jpeg', quality: 1.0 },
                html2canvas:  { scale: 2, useCORS: true, logging: false }, 
                jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' },
                pagebreak:    { mode: 'avoid-all' } // Extra safety lock to prevent page splitting
            };

            const worker = html2pdf().set(opt).from(printClone);
            if (archiveContext) {
                const blob = await worker.outputPdf('blob');
                if (blob.size > 3 * 1024 * 1024) throw Error('Generated PDF exceeds the 3 MB upload limit.');
                const fileData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('Unable to read PDF')); reader.readAsDataURL(blob); });
                const result = await apiPost('staffDocumentUpload', {name: ps.name, category: 'payslip', fileName, mimeType: 'application/pdf', fileData});
                if (result.status !== 'success') throw Error(result.message || 'Unable to save PDF');
                if (staffSettings[ps.name]) Object.assign(staffSettings[ps.name], {version: result.version, attachment: result.attachment, staffFolderId: result.staffFolderId, staffFolderUrl: result.staffFolderUrl});
                renderStaffFolder(result.staffFolderUrl);
                $('#staffDocumentStatus').text('Salary slip saved to the staff folder.');
            } else await worker.save();
        }
        } catch (error) {
            if (archiveContext) $('#staffDocumentStatus').text('Could not save salary slip: ' + error.message);
            $('#payslip-error').text('Could not generate the PDF. Please try downloading this payslip again.').show();
        } finally {
            printBtn.html(originalContent);
            $('#payslip-list button, #refreshPayslips').prop('disabled', false);
            if (wrapper) wrapper.remove();
            payslipPrinting = false;
        }
    }

    function handleLeaveTypeChange() {
        const type = $('#leaveType').val();
        const now = new Date();
        const localTodayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        
        // Types that legally require documentary evidence (Updated to 4 specific types)
        const requiresProof = ['CPL', 'HPL', 'ML', 'MRL', 'MTL', 'PL'];
        $('#leaveDocumentHint').text(requiresProof.includes(type)?'A supporting document is required for this leave type. Maximum size: 3 MB.':'Supporting documents are optional for this leave type. Maximum size: 3 MB.');
        
        if (requiresProof.includes(type)) {
            $('#mcReqText').text('*(Proof Required)').show();
            $('#leaveFile').addClass('border-danger');
        } else {
            $('#mcReqText').hide();
            $('#leaveFile').removeClass('border-danger');
        }
        
        // Only Medical/Hospitalisation can be backdated up to 14 days
        if (['ML', 'HPL'].includes(type)) {
            const past = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
            const pastStr = new Date(past.getTime() - (past.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            $('#leaveStart').attr('min', pastStr);
            $('#leaveEnd').attr('min', pastStr);
        } else {
            $('#leaveStart').attr('min', localTodayStr);
            $('#leaveEnd').attr('min', localTodayStr);
        }
        
        $('#leaveStart').val(''); $('#leaveEnd').val(''); $('#leaveDays').val('');
        $('#halfDaySelect').hide(); $('#leaveCalcNote').text('');
        if (type === 'fractional_split') {
            $('#splitLeaveNotice').hide();
            $('#splitLeaveSection').show();
            updateSplitAllocations(0, (currentUser && currentUser.alBalance != null) ? Number(currentUser.alBalance) : 0);
        } else {
            $('#splitLeaveSection').hide();
            checkSplitLeaveOffer();
        }
    }

    function renderLeaveBalances(overview) {
        const balances = overview.leaveBalances || [];
        const summary = item => item.balance == null ? ('HR opening balance required') : `${item.openingBalance} opening days · ${item.used || 0} used · ${item.adjustments || 0} adjusted${item.effectiveDate ? ' · from ' + item.effectiveDate : ''}`;
        for (const [category, prefix, legacy] of [['Annual','al','al'],['Medical','mc','mc']]) {
            const item = balances.find(b => b.category === category);
            const value = item ? item.balance : overview[legacy + 'Balance'];
            $(`#${prefix}BalanceDisplay`).text(value == null ? '—' : value);
            $(`#${prefix}EntitlementDisplay`).text(item ? summary(item) : value == null ? 'HR opening balance required' : `${overview[legacy + 'Entitlement'] || 0} days entitlement · approved leave deducted`);
        }
        $('#leave-other-balances').empty();
        balances.filter(b => !['Annual','Medical','Hospitalisation','Hospitalization'].includes(b.category)).forEach(item => {
            const card = $('<article class="leave-balance">');
            card.append($('<span>').text(`${item.category} leave available`));
            card.append($('<div>').append($('<strong>').text(item.balance == null ? '—' : item.balance), $('<small>').text('days')));
            card.append($('<p>').text(summary(item)));
            $('#leave-other-balances').append(card);
        });
        $('#leave-event-list').empty();
        $('#leave-event-guidance').hide();
        if (events.length) {
            const table = $('<table class="table table-sm mb-0"><thead><tr><th scope="col">Leave type</th><th scope="col">Duration</th><th scope="col">Eligibility</th></tr></thead></table>');
            const body = $('<tbody>');
            events.forEach(event => body.append($('<tr>').append($('<th scope="row">').text(event.category), $('<td>').text(event.daysPerEvent == null ? 'HR approval required' : `${event.daysPerEvent} consecutive calendar days per event`), $('<td>').text(event.conditions))));
            table.append(body); $('#leave-event-list').append(table);
        }
    }

    async function loadStaffPortal() {
        $('#leaveFeedback').hide();
        const history = fetchMyLeave();
        const balance=await apiPost('leaveOverview',{});
        if(balance.staleSession)return;
        if(balance.status==='success')currentUser={...currentUser,...balance.data};
        else leaveNotice(balance.message||'Balances could not be refreshed. Showing the last known values.',true);
        // --- NEW: Populate Staff Profile Card with Masked IC & dynamic status ---
        $('#sp-name').text(currentUser.name);
        $('#sp-ic').text('XXXXXX-XX-XXXX'); 
        
        let status = currentUser.status || 'Active';
        let statusClass = status === 'Resigned' ? 'bg-danger-subtle text-danger border-danger-subtle' : 'bg-primary-subtle text-primary border-primary-subtle';
        $('#sp-status').text(status).removeClass().addClass(`badge border px-2 py-1 ${statusClass}`);

        renderLeaveBalances(currentUser);

        // Reset both options first (in case of switching users)
        $('#leaveType option[value="MTL"]').prop('disabled', false).removeClass('d-none');
        $('#leaveType option[value="PL"]').prop('disabled', false).removeClass('d-none');
        
        // Hide based on gender (using d-none for better mobile compatibility)
        if (currentUser.gender === 'Male') {
            $('#leaveType option[value="MTL"]').prop('disabled', true).addClass('d-none').hide();
        } else if (currentUser.gender === 'Female') {
            $('#leaveType option[value="PL"]').prop('disabled', true).addClass('d-none').hide();
        }
        
        // Force the dropdown to select the first valid option if the current one is now hidden
        if ($('#leaveType option:selected').is(':disabled')) {
            $('#leaveType').val('AL');
        }
        
        handleLeaveTypeChange(); 
        await history;
    }

    

    function compressImageToDataUrl(file, maxDimension = 800, quality = 0.85) {
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

    async function loadMyProfile() {
        const firstProfileTab = document.getElementById('myprofile-tab-personal-btn');
        if (firstProfileTab && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
            bootstrap.Tab.getOrCreateInstance(firstProfileTab).show();
        }
        // Step 1: Pre-fill known basic details immediately
        $('#myProfileName').val(currentUser.name);
        $('#myProfileHeroName').text(currentUser.name || 'My Profile');
        const initials = (currentUser.name || 'U').trim().split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
        $('#myProfileAvatarInitials').text(initials);
        
        const initialPhoto = currentUser.photo || currentUser.photoUrl;
        if (initialPhoto) {
            $('#myProfileAvatarImg').attr('src', initialPhoto).show();
            $('#myProfileAvatarInitials').hide();
        } else {
            $('#myProfileAvatarImg').hide();
            $('#myProfileAvatarInitials').show();
        }

        $('#myProfileIcNo').val(currentUser.icNo || '-');
        $('#myProfileEpfNo').val(currentUser.epfNo || '-');
        $('#myProfileSocsoNo').val(currentUser.socsoNo || '-');
        $('#myProfileTaxNo').val(currentUser.taxNo || '-');
        $('#myProfileBankNo').val(currentUser.bankNo || '-');
        $('#myProfileAl').val(currentUser.alEntitlement ?? '—');
        $('#myProfileMc').val(currentUser.mcEntitlement ?? '—');

        // Wire profile photo upload events
        $('#myProfileAvatarContainer, #btnUploadProfilePhoto').off('click').on('click', function(e) {
            e.stopPropagation();
            $('#myProfilePhotoFileInput').trigger('click');
        });

        $('#myProfilePhotoFileInput').off('change').on('change', async function() {
            const file = this.files && this.files[0];
            if (!file) return;
            this.value = '';
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file (JPG, PNG).');
                return;
            }
            $('#myProfilePhotoSpinner').show();
            try {
                const dataUrl = await compressImageToDataUrl(file, 800, 0.85);
                $('#myProfileAvatarImg').attr('src', dataUrl).show();
                $('#myProfileAvatarInitials').hide();

                const res = await apiPost('uploadProfilePhoto', {
                    name: currentUser.name,
                    fileData: dataUrl,
                    fileName: file.name || 'profile.jpg',
                    mimeType: 'image/jpeg'
                });
                if (res && res.status === 'success' && res.photoUrl) {
                    currentUser.photo = res.photoUrl;
                    currentUser.photoUrl = res.photoUrl;
                    if (currentFullProfile) {
                        currentFullProfile.photo = res.photoUrl;
                        currentFullProfile.photoUrl = res.photoUrl;
                    }
                    localStorage.setItem('hrPortalUser', JSON.stringify(currentUser));
                    if (window.staffSettings && window.staffSettings[currentUser.name]) {
                        window.staffSettings[currentUser.name].photo = res.photoUrl;
                        window.staffSettings[currentUser.name].photoUrl = res.photoUrl;
                    }
                    window.dispatchEvent(new CustomEvent('hr-session', { detail: currentUser }));
                    alert('Profile photo uploaded and saved to your staff Google Drive folder!');
                } else {
                    throw new Error(res?.message || 'Upload failed');
                }
            } catch (err) {
                alert('Failed to save profile photo: ' + (err.message || err));
            } finally {
                $('#myProfilePhotoSpinner').hide();
            }
        });

        // Step 2: Fetch full details silently so we don't wipe out uneditable fields on save
        const res = await apiPost('getStaff', {});
        if (res.status === 'success' && res.data) {
            currentFullProfile = res.data[currentUser.name];
            
            if (currentFullProfile) {
                // Update photo if available from full profile
                const pPhoto = currentFullProfile.photo || currentFullProfile.photoUrl || currentUser.photo || currentUser.photoUrl;
                if (pPhoto) {
                    $('#myProfileAvatarImg').attr('src', pPhoto).show();
                    $('#myProfileAvatarInitials').hide();
                    currentUser.photo = pPhoto;
                    currentUser.photoUrl = pPhoto;
                }

                // Resolve Department & Grade using cached HR bootstrap data or fetch
                let hrRecords = cachedHrBootstrapData?.records;
                if (!hrRecords || !hrRecords.departments) {
                    try {
                        const hrBootRes = await apiPost('hrBootstrap', {});
                        if (hrBootRes && hrBootRes.status === 'success' && hrBootRes.data) {
                            cachedHrBootstrapData = hrBootRes.data;
                            hrRecords = hrBootRes.data.records;
                        }
                    } catch (_) {}
                }
                const allDepts = hrRecords?.departments || cachedDepartments || [];
                const allGrades = hrRecords?.jobGrades || cachedJobGrades || [];
                const allCos = hrRecords?.companies || cachedCompanies || [];

                let deptNameDisplay = '';
                const rawDept = currentFullProfile.departmentId || currentFullProfile.department || '';
                if (rawDept) {
                    const foundDept = allDepts.find(d => String(d.id) === String(rawDept) || String(d.code) === String(rawDept) || String(d.title) === String(rawDept));
                    if (foundDept) {
                        deptNameDisplay = (foundDept.code && foundDept.title && foundDept.code !== foundDept.title)
                            ? `${foundDept.title} (${foundDept.code})`
                            : (foundDept.title || foundDept.code || foundDept.id);
                    }
                }
                if (!deptNameDisplay) {
                    deptNameDisplay = currentFullProfile.departmentName || currentFullProfile.department || (rawDept ? String(rawDept) : '-');
                }

                let gradeNameDisplay = '';
                const rawGrade = currentFullProfile.gradeId || currentFullProfile.gradeCode || '';
                if (rawGrade) {
                    const foundGrade = allGrades.find(g => String(g.id) === String(rawGrade) || String(g.code).toUpperCase() === String(rawGrade).toUpperCase() || String(g.title) === String(rawGrade));
                    if (foundGrade) {
                        gradeNameDisplay = `${foundGrade.code} — Grade ${foundGrade.code} - ${foundGrade.title}`;
                    }
                }
                if (!gradeNameDisplay) {
                    if (currentFullProfile.gradeCode) gradeNameDisplay = `Grade ${currentFullProfile.gradeCode}`;
                    else if (rawGrade) {
                        const m = String(rawGrade).match(/grade[-_\s]?([a-z0-9]+)/i);
                        if (m) gradeNameDisplay = `Grade ${m[1].toUpperCase()}`;
                        else gradeNameDisplay = String(rawGrade);
                    } else {
                        gradeNameDisplay = '-';
                    }
                }

                let coNameDisplay = currentFullProfile.companyName || '';
                const rawCo = currentFullProfile.companyId || currentFullProfile.company || '';
                if (!coNameDisplay && rawCo) {
                    const foundCo = allCos.find(c => String(c.id) === String(rawCo) || String(c.code) === String(rawCo) || String(c.title) === String(rawCo));
                    if (foundCo) coNameDisplay = foundCo.title || foundCo.code || foundCo.id;
                    else coNameDisplay = String(rawCo);
                }

                $('#myProfileHeroName').text(currentUser.name || '-');
                $('#myProfileHeroJobTitle').text(currentFullProfile.jobTitle || 'Team Member');
                $('#myProfileHeroDepartment').text(deptNameDisplay || '-');
                $('#myProfileHeroCompany').text(coNameDisplay || '-');
                $('#myProfileHeroEmpNo').text('ID: ' + (currentFullProfile.employeeNo || '-'));
                $('#myProfileHeroRole').text(currentFullProfile.role || 'Staff');
                $('#myProfileHeroStatus').html(`<i class="bi bi-circle-fill me-1" style="font-size: 0.5rem; vertical-align: middle;"></i>${currentFullProfile.status || 'Active'}`);
                $('#myProfileHeroLocation').text(currentFullProfile.location || 'Office');
                $('#myProfileHeroWorkBase').text(currentFullProfile.workBase || 'Office');

                $('#myProfileGender').val(currentFullProfile.gender || '-');
                $('#myProfileUsername').val(currentFullProfile.username || '-');
                $('#myProfileRole').val(currentFullProfile.role || 'Staff');
                
                $('#myProfileContact').val(currentFullProfile.contactNo || '');
                $('#myProfileEmergency').val(currentFullProfile.emergency || '');
                $('#myProfileAddress').val(currentFullProfile.address || '');
                
                $('#myProfileBasic').val(currentFullProfile.basic ? 'RM ' + currentFullProfile.basic.toFixed(2) : 'RM 0.00');

                // Populate Fixed Allowance in My Profile
                const totalFixedAllowance = parseFloat(currentFullProfile.fixedAllowance) || 0;
                $('#myProfileFixedAllowance').val('RM ' + totalFixedAllowance.toFixed(2));
                
                let myAllowances = [];
                if (currentFullProfile.fixedAllowances && Array.isArray(currentFullProfile.fixedAllowances) && currentFullProfile.fixedAllowances.length) {
                    myAllowances = currentFullProfile.fixedAllowances;
                } else if (currentFullProfile.allowances && Array.isArray(currentFullProfile.allowances) && currentFullProfile.allowances.length) {
                    myAllowances = currentFullProfile.allowances;
                } else if (typeof currentFullProfile.allowances === 'string' && currentFullProfile.allowances.trim()) {
                    try { myAllowances = JSON.parse(currentFullProfile.allowances); } catch(_) {}
                } else if (totalFixedAllowance > 0) {
                    myAllowances = [{ category: 'Other Allowance', amount: totalFixedAllowance, remarks: 'Monthly fixed' }];
                }
                
                if (myAllowances && myAllowances.length > 0) {
                    const allowRows = myAllowances.map(a => `
                        <tr>
                            <td class="fw-semibold text-dark"><i class="bi bi-tag-fill me-1 text-primary"></i>${a.category || a.name || 'Allowance'}</td>
                            <td class="fw-bold text-primary">RM ${parseFloat(a.amount || 0).toFixed(2)}</td>
                            <td class="text-muted small">${a.remarks || '-'}</td>
                        </tr>
                    `).join('');
                    $('#myProfileAllowanceTableBody').html(allowRows);
                } else {
                    $('#myProfileAllowanceTableBody').html('<tr><td colspan="3" class="text-muted text-center py-2 small">No fixed allowances allocated</td></tr>');
                }
                
                const formatInputDate = (dStr) => {
                    if (!dStr) return 'N/A';
                    let d = new Date(dStr);
                    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                    return dStr.substring(0, 10);
                };

                $('#myProfileJoined').val(formatInputDate(currentFullProfile.joinedDate));
                $('#myProfileConfirm').val(formatInputDate(currentFullProfile.confirmDate));

                $('#myProfileRace').val(currentFullProfile.race || '-');
                $('#myProfileAge').val(currentFullProfile.ageSource ? `${currentFullProfile.ageSource} years` : '-');
                $('#myProfileAcademicLevel').val(currentFullProfile.academicLevel || '-');

                $('#myProfileEmployeeNo').val(currentFullProfile.employeeNo || '-');
                $('#myProfileBiometricId').val(currentFullProfile.biometricId || '-');
                $('#myProfileCompany').val(coNameDisplay || '-');
                $('#myProfileDepartment').val(deptNameDisplay || '-');
                $('#myProfileManager').val(currentFullProfile.manager || 'None (Direct Report)');
                $('#myProfileJobTitle').val(currentFullProfile.jobTitle || 'Team Member');
                $('#myProfileJobGrade').val(gradeNameDisplay || '-');
                $('#myProfileEmail').val(currentFullProfile.email || '-');
                $('#myProfileWorkBase').val(currentFullProfile.workBase || '-');
                $('#myProfileLocation').val(currentFullProfile.location || '-');
                $('#myProfileAssignedResources').val(currentFullProfile.assignedResources || 'No resources assigned');

                // Populate Resources holding table in My Profile
                let myResources = [];
                if (currentFullProfile.resources && Array.isArray(currentFullProfile.resources) && currentFullProfile.resources.length) {
                    myResources = currentFullProfile.resources;
                } else if (typeof currentFullProfile.resources === 'string' && currentFullProfile.resources.trim()) {
                    try { myResources = JSON.parse(currentFullProfile.resources); } catch(_) {}
                } else if (currentFullProfile.assignedResources && currentFullProfile.assignedResources !== 'No resources assigned') {
                    myResources = [{ name: currentFullProfile.assignedResources, serialNo: '-', issueDate: '-', returned: false, remarks: '-' }];
                }
                
                if (myResources && myResources.length > 0) {
                    const resRows = myResources.map(r => `
                        <tr>
                            <td class="fw-semibold text-primary"><i class="bi bi-tag-fill me-1 text-primary"></i>${r.type || 'Equipment'}</td>
                            <td class="fw-bold text-dark">${r.model || r.name || 'Item'}</td>
                            <td class="font-monospace small">${r.serialNo || '-'}</td>
                            <td class="small">${r.issueDate || '-'}</td>
                            <td class="text-center">
                                ${r.returned
                                    ? `<span class="badge bg-secondary-subtle text-secondary border">Returned (${r.returnedDate || ''})</span>`
                                    : '<span class="badge bg-success-subtle text-success border">Holding / Active</span>'
                                }
                            </td>
                            <td class="small text-muted">${r.remarks || '-'}</td>
                        </tr>
                    `).join('');
                    $('#myProfileResourcesTableBody').html(resRows);
                } else {
                    $('#myProfileResourcesTableBody').html('<tr><td colspan="5" class="text-muted text-center py-3">No company resources currently assigned.</td></tr>');
                }

                $('#myProfileStatus').val(currentFullProfile.status || 'Active');
                if (currentFullProfile.status === 'Resigned') {
                    $('#divMyProfileResignDate').show();
                    $('#myProfileResignDate').val(formatInputDate(currentFullProfile.resignDate));
                } else {
                    $('#divMyProfileResignDate').hide();
                }

                const restDaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const rds = Array.isArray(currentFullProfile.restDays) ? currentFullProfile.restDays : [];
                const restBadges = rds.map(d => `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1"><i class="bi bi-moon-stars me-1"></i>${restDaysList[d] || d} (Rest Day)</span>`).join(' ');
                $('#myProfileRestDaysBadges').html(restBadges || '<span class="text-muted small">Standard schedule</span>');

                // Documents & Folder Link
                if (currentFullProfile.staffFolderUrl) {
                    $('#myProfileFolderLink').html(`
                        <a href="${currentFullProfile.staffFolderUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-outline-primary btn-sm fw-bold">
                            <i class="bi bi-folder-symlink me-1"></i>Open Google Drive Folder
                        </a>
                    `);
                } else {
                    $('#myProfileFolderLink').html('<span class="text-muted small"><i class="bi bi-info-circle me-1"></i>No staff folder generated yet. HR can link or generate one upon document upload.</span>');
                }

                const attStr = currentFullProfile.attachment || currentFullProfile.existingAttachment || '';
                const attList = attStr ? attStr.split('|').map(s => s.trim()).filter(Boolean) : [];
                if (attList.length) {
                    const links = attList.map((url, idx) => {
                        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-light border me-2 mb-2"><i class="bi bi-file-earmark-arrow-down me-1 text-primary"></i>Document ${idx + 1}</a>`;
                    }).join('');
                    $('#myProfileAttachmentList').html(links);
                } else {
                    $('#myProfileAttachmentList').html('<span class="text-muted small">No profile documents attached yet.</span>');
                }
            }
        }
    }

    async function updateMyProfile() {
        if(!currentFullProfile || !currentFullProfile.name) {
            alert("Profile data not fully loaded yet. Please wait a moment.");
            return;
        }
        
        const btn = $('#btnUpdateMyProfile, #btnUpdateMyProfileTop');
        btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        // Map only the editable fields back to the full dataset
        currentFullProfile.contactNo = $('#myProfileContact').val();
        currentFullProfile.emergency = $('#myProfileEmergency').val();
        currentFullProfile.address = $('#myProfileAddress').val();
        
        const newPass = $('#myProfilePassword').val();
        if (newPass && newPass.trim()) {
            currentFullProfile.password = newPass.trim();
        }

        // Ensure any existing attachment is protected when saving
        currentFullProfile.existingAttachment = currentFullProfile.attachment || "";

        // Push via existing Staff management API route
        const res = await apiPost('saveSingleStaff', currentFullProfile);
        if(res.status === 'success') {
            $('#myProfilePassword').val('');
            alert("Profile updated successfully!");
        } else {
            alert("Error updating profile.");
        }
        
        btn.html('<i class="bi bi-check-circle me-2"></i>Save Changes').prop('disabled', false);
    }

    function calculateLeaveDays() {
        const startStr = $('#leaveStart').val();
        let endStr = $('#leaveEnd').val();
        
        if (!startStr) return;
        if (!endStr || endStr < startStr) {
            $('#leaveEnd').val(startStr);
            endStr = startStr;
        }
        
        if (['HPL', 'CPL', 'MRL', 'MTL', 'PL'].includes($('#leaveType').val())) {
            const days = Math.round((Date.parse(endStr) - Date.parse(startStr)) / 86400000) + 1;
            $('#leaveDays').val(days);
            $('#halfDaySelect').hide().val('1');
            $('#leaveCalcNote').text('Calendar days, including rest days and public holidays');
            return;
        }

        const start = new Date(startStr);
        const end = new Date(endStr);
        let daysCount = 0; 
        let phCount = 0;
        let restCount = 0;

        // Retrieve rest days and staff profile for the current user
        let restDays = [];
        let staffObj = null;
        if (currentUser && (currentUser.name || currentUser.username)) {
            staffObj = (typeof findStaffSetting === 'function' ? findStaffSetting(currentUser.username, currentUser.name) : null) || 
                       (typeof staffSettings !== 'undefined' && (staffSettings[currentUser.name] || staffSettings[currentUser.username])) || currentUser;
            restDays = getStaffEffectiveRestDays(staffObj || currentUser);
        }

        let currentDate = new Date(start);
        while (currentDate <= end) {
            const y = currentDate.getFullYear();
            const m = String(currentDate.getMonth() + 1).padStart(2, '0');
            const d = String(currentDate.getDate()).padStart(2, '0');
            const fmtDate = `${y}-${m}-${d}`;
            const dayIdx = currentDate.getDay();

            const isPH = !!getPublicHolidayForStaff(fmtDate, staffObj || currentUser);
            const isRest = restDays.includes(dayIdx);

            if (isPH) {
                phCount++;
            } else if (isRest) {
                restCount++;
            } else {
                daysCount++;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        if (startStr === endStr && daysCount === 1) {
            $('#leaveDays').val(1);
            $('#halfDaySelect').show().val('1');
            $('#leaveCalcNote').text('');
        } else {
            $('#halfDaySelect').hide();
            $('#leaveDays').val(daysCount);
            const deductions = [];
            if (phCount > 0) deductions.push(`-${phCount} Public Holiday${phCount > 1 ? 's' : ''}`);
            if (restCount > 0) deductions.push(`-${restCount} Non-working day${restCount > 1 ? 's' : ''}`);
            if (deductions.length) $('#leaveCalcNote').text(`(${deductions.join(', ')})`);
            else $('#leaveCalcNote').text('');
        }
        checkSplitLeaveOffer();
    }

    function checkSplitLeaveOffer() {
        const type = $('#leaveType').val();
        const days = parseFloat($('#leaveDays').val()) || 0;
        const alBal = (currentUser && currentUser.alBalance != null) ? Number(currentUser.alBalance) : 0;
        
        if (type === 'fractional_split') {
            $('#splitLeaveNotice').hide();
            $('#splitLeaveSection').show();
            updateSplitAllocations(days, alBal);
            return;
        }

        if ((type === 'AL' || type === 'EL') && days > alBal && days > 0) {
            $('#splitLeaveNotice').show();
            $('#alBalanceExceededText').text(`You have ${alBal} AL days remaining, but requested ${days} days.`);
            $('#splitLeaveSection').hide();
        } else {
            $('#splitLeaveNotice').hide();
            $('#splitLeaveSection').hide();
        }
    }

    function enableSplitLeave() {
        $('#leaveType').val('fractional_split');
        $('#splitLeaveNotice').hide();
        $('#splitLeaveSection').show();
        const days = parseFloat($('#leaveDays').val()) || 0;
        const alBal = (currentUser && currentUser.alBalance != null) ? Number(currentUser.alBalance) : 0;
        updateSplitAllocations(days, alBal);
    }

    function updateSplitAllocations(totalDays, alBal) {
        const ann = Math.min(Math.max(0, alBal), totalDays);
        const unp = Math.max(0, Number((totalDays - ann).toFixed(2)));
        $('#splitAnnualDays').val(ann.toFixed(2)).attr('max', alBal);
        $('#splitUnpaidDays').val(unp.toFixed(2));
        $('#splitTotalBadge').text(`Total: ${totalDays.toFixed(2)} Days`);
        $('#splitAnnualMaxHint').text(`Max available AL: ${alBal} days`);
    }

    function handleSplitDaysInput(changedField) {
        const totalDays = parseFloat($('#leaveDays').val()) || 0;
        const alBal = (currentUser && currentUser.alBalance != null) ? Number(currentUser.alBalance) : 0;
        if (changedField === 'annual') {
            let ann = parseFloat($('#splitAnnualDays').val());
            if (isNaN(ann) || ann < 0) ann = 0;
            if (ann > totalDays) ann = totalDays;
            if (ann > alBal) ann = alBal;
            const unp = Math.max(0, Number((totalDays - ann).toFixed(2)));
            $('#splitUnpaidDays').val(unp.toFixed(2));
        } else if (changedField === 'unpaid') {
            let unp = parseFloat($('#splitUnpaidDays').val());
            if (isNaN(unp) || unp < 0) unp = 0;
            if (unp > totalDays) unp = totalDays;
            let ann = Math.max(0, Number((totalDays - unp).toFixed(2)));
            if (ann > alBal) {
                ann = alBal;
                unp = Number((totalDays - ann).toFixed(2));
                $('#splitUnpaidDays').val(unp.toFixed(2));
            }
            $('#splitAnnualDays').val(ann.toFixed(2));
        }
    }

    function handleLeaveFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        leaveFileBase64=null;leaveFileName=null;
        if (file.size > 3 * 1024 * 1024){e.target.value='';return alert('File too large (Max 3MB)');}
        leaveFileName = file.name; leaveFileMime = file.type;
        const reader = new FileReader();
        reader.onload = function(ev) { leaveFileBase64 = ev.target.result.split(',')[1]; };
        reader.readAsDataURL(file);
    }

    function handleHalfDayChange() {
        let val = $('#halfDaySelect').val();
        if (val === "1") $('#leaveDays').val(1);
        else $('#leaveDays').val(0.5);
    }

    async function submitLeaveApp() {
        let type = $('#leaveType').val();
        const days = parseFloat($('#leaveDays').val());
        const startStr = $('#leaveStart').val();
        const endStr = $('#leaveEnd').val(); 
        
        if(!startStr || !endStr || !Number.isFinite(days) || days <= 0) return alert("Please complete valid dates and total days.");
        
        if ($('#halfDaySelect').is(':visible') && days === 0.5) {
            let slot = $('#halfDaySelect').val();
            if (slot === '0.5_AM') type += ' (AM)';
            if (slot === '0.5_PM') type += ' (PM)';
        }

        const now = new Date();
        const localTodayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        
        if (!['ML', 'HPL'].includes(type.split(' ')[0]) && startStr < localTodayStr) {
            return alert("Error: Only Medical (ML) or Hospitalisation (HPL) leaves can be backdated.");
        }

        if (type.startsWith('AL')) {
            const startDate = new Date(startStr);
            const today = new Date(localTodayStr);
            const diffDays = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));
            
            if (diffDays < 3) {
                alert("Notice: Annual Leave (AL) applied less than 3 days in advance will automatically be recorded as Emergency Leave (EL).");
                type = type.replace('AL', 'EL'); 
            }
        }

        const requiresProof = ['ML', 'HPL', 'MTL', 'CPL', 'MRL', 'PL'];
        if(requiresProof.includes(type.split(' ')[0]) && !leaveFileBase64) {
            return alert(`Error: ${type} strictly requires a supporting document (Medical Cert, Death Cert, Birth Cert, etc).`);
        }

        const isSplit = (type === 'fractional_split');
        let annualDays = 0, unpaidDays = 0;
        if (isSplit) {
            annualDays = parseFloat($('#splitAnnualDays').val());
            unpaidDays = parseFloat($('#splitUnpaidDays').val());
            if (isNaN(annualDays) || annualDays < 0 || isNaN(unpaidDays) || unpaidDays < 0) {
                return alert("Please enter valid positive numbers for the split leave portions.");
            }
            if (Math.abs((annualDays + unpaidDays) - days) > 0.01) {
                return alert(`Split error: Annual (${annualDays}) + Unpaid (${unpaidDays}) must equal total requested days (${days}).`);
            }
            const alBal = (currentUser && currentUser.alBalance != null) ? Number(currentUser.alBalance) : 0;
            if (annualDays > alBal) {
                return alert(`Annual leave portion (${annualDays}) exceeds your remaining balance (${alBal}).`);
            }
        } else {
            if((type.startsWith('AL') || type.startsWith('EL')) && days > currentUser.alBalance) {
                if(!confirm(`Warning: You only have ${currentUser.alBalance} AL/EL days left. Proceed anyway? (Excess days may convert to unpaid NPL)`)) return;
            }
        }
        
        $('#btnSubmitLeave').html('<span class="spinner-border spinner-border-sm"></span> Validating...').prop('disabled', true);
        
        const checkRes = await apiPost('getLeaveData', { scope:'personal' });
        if(checkRes.status!=='success'){leaveNotice('Could not check overlapping requests. Please retry.',true);$('#btnSubmitLeave').text('Submit Application').prop('disabled',false);return;}
        if (checkRes.status === 'success') {
            const isOverlap = checkRes.data.some(l => {
                if (l.isTestHistory || l.status === 'Rejected' || l.status === 'Withdrawn') return false;
                const existingStart = formatLocalDate(l.start);
                const existingEnd = formatLocalDate(l.end);
                return (startStr <= existingEnd && endStr >= existingStart);
            });

            if (isOverlap) {
                alert("Error: Overlapping dates! You already have a Pending or Approved leave application during this period.");
                $('#btnSubmitLeave').html('<i class="bi bi-send-fill me-2"></i>Submit Application').prop('disabled', false);
                return; 
            }
        }

        $('#btnSubmitLeave').html('<span class="spinner-border spinner-border-sm"></span> Submitting...');

        const payload = {
            staffName: currentUser.name, 
            leaveType: type, 
            type: type,
            startDate: startStr, 
            endDate: endStr,
            totalDays: days, 
            annualDays: isSplit ? annualDays : (type.startsWith('AL') ? days : 0),
            unpaidDays: isSplit ? unpaidDays : (type.startsWith('NPL') ? days : 0),
            reason: $('#leaveReason').val(), 
            fileName: leaveFileName, 
            mimeType: leaveFileMime, 
            fileData: leaveFileBase64
        };
        
        const result=await apiPost('submitLeave',payload);
        if(result.status!=='success'){leaveNotice(result.message||'Submission failed. Your form has been kept so you can retry.',true);$('#btnSubmitLeave').text('Submit Application').prop('disabled',false);return;}
        leaveNotice('Request submitted. You can track the approval in My requests.');
        
        $('#leaveStart, #leaveEnd, #leaveDays, #leaveReason, #leaveFile, #splitAnnualDays, #splitUnpaidDays').val('');
        $('#halfDaySelect, #splitLeaveNotice, #splitLeaveSection').hide(); $('#leaveCalcNote').text('');
        leaveFileBase64 = null; leaveFileName = null;
        $('#btnSubmitLeave').html('<i class="bi bi-send-fill me-2"></i>Submit Application').prop('disabled', false);
        fetchMyLeave();
    }

    // Keep server status values intact for expectedStatus and workflow transitions.
    function leaveStatusView(value) {
        const raw=String(value || '').trim(), key=raw.toLowerCase();
        const labels={pending_hod:'Awaiting HOD approval',pending_admin:'Awaiting HR approval',pending:'Pending',approved:'Approved',rejected:'Rejected',withdrawn:'Withdrawn','withdrawal requested':'Withdrawal Requested'};
        return {key,label:labels[key] || raw,pending:['pending','pending_hod','pending_admin','withdrawal requested'].includes(key),approved:key==='approved',withdrawal:key==='withdrawal requested'};
    }
    function leaveMatchesStatus(value, filter) {
        const key=leaveStatusView(value).key, selected=String(filter || '').toLowerCase();
        return !selected || (selected==='pending' ? ['pending','pending_hod','pending_admin'].includes(key) : key===selected);
    }
    function leaveCanDecide(record,user,staff,teamScoped) {
        const name=value=>String(value || '').trim().toUpperCase();
        if(!user || name(record.name)===name(user.name))return false;
        const role=user.role, admin=['Admin','HR'].includes(role), manager=['HOD','Supervisor'].includes(role);
        if(!admin&&!manager)return false;
        const profile=Object.entries(staff || {}).find(([key,value])=>name(key)===name(record.name)||name(value.name)===name(record.name))?.[1];
        const direct=name(profile?.manager)===name(user.name) || (manager&&teamScoped);
        const status=leaveStatusView(record.status).key;
        if(status==='pending_hod')return direct;
        if(status==='pending_admin')return admin&&!direct;
        return ['pending','withdrawal requested'].includes(status)&&(admin||direct);
    }
    let myLeaveRecords=[];
    const leaveEscape=value=>$('<div>').text(String(value??'')).html();
    function leaveNotice(message,error=false,target='#leaveFeedback'){$(target).removeClass('alert-danger alert-success').addClass(error?'alert-danger':'alert-success').text(message).show();}
    function renderMyLeaveHistory(){
        const safeDMY = typeof formatDateDMY === 'function' ? formatDateDMY : (v => {
            if (!v) return '';
            const str = String(v).trim();
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
            const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
            if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
            return str;
        });
        const query=String($('#leaveSearch').val()||'').toLowerCase(),status=$('#leaveStatusFilter').val();
        const rows=myLeaveRecords.filter(r=>leaveMatchesStatus(r.status,status)&&(!query||[r.type,r.start,r.end,safeDMY(r.start),safeDMY(r.end),r.reason].join(' ').toLowerCase().includes(query)));
        const tbody=$('#myLeaveTableBody').empty(),mobile=$('#myLeaveCardsMobile').empty();
        $('#leaveHistoryCount').text(`${rows.length} of ${myLeaveRecords.length} requests`);
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
        rows.forEach(r=>{
            const start=formatLocalDate(r.start),end=formatLocalDate(r.end),view=leaveStatusView(r.status),pending=view.pending;
            const dmyStart=safeDMY(r.start),dmyEnd=safeDMY(r.end);
            const dateRange=(dmyStart&&dmyEnd)?`${dmyStart} - ${dmyEnd}`:(dmyStart||dmyEnd||'—');
            const badgeClass=view.approved?'leave-approved':pending?'leave-pending':view.key==='rejected'?'leave-rejected':'leave-neutral';
            const badge=`<span class="leave-status ${badgeClass}">${leaveEscape(view.label)}</span>`;
            const fileUrl=String(r.attachment||'').trim();
            const isLink=/^(https?:\/\/|data:|\/)/i.test(fileUrl);
            const docHtml=isLink
                ? `<a class="leave-document fw-semibold text-decoration-none" href="${leaveEscape(fileUrl)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-paperclip me-1"></i>View Document</a>`
                : (fileUrl ? `<span class="small text-muted">${leaveEscape(fileUrl)}</span>` : '<span class="text-muted">—</span>');
            const action=()=>{const b=$('<button type="button" class="btn btn-sm btn-outline-secondary mt-2">Request withdrawal</button>');b.on('click',()=>withdrawLeave(r.id,r.rowIndex));return b;};
            const tUpper=String(r.type||'').toUpperCase().trim();
            const isAL=tUpper==='AL'||tUpper==='ANNUAL'||tUpper==='ANNUAL LEAVE'||tUpper.startsWith('AL ')||tUpper.startsWith('AL-');
            const allowed=isAL&&start>today&&(['pending','pending_hod','pending_admin'].includes(view.key)||view.approved);
            const hasDecisionRemark=r.decisionRemark && String(r.decisionRemark).trim() !== String(r.reason || '').trim();
            const decisionHtml=r.decision?`<small class="d-block text-muted mt-1">${leaveEscape(r.decision)}${hasDecisionRemark?' · '+leaveEscape(r.decisionRemark):''}</small>`:'';
            const tr=$(`<tr><td><strong>${leaveEscape(r.type)}</strong></td><td class="text-nowrap">${leaveEscape(dateRange)}</td><td>${leaveEscape(r.days)} days</td><td><span class="leave-reason">${leaveEscape(r.reason||'—')}</span>${decisionHtml}</td><td>${docHtml}</td><td>${badge}</td></tr>`);
            if(allowed)tr.find('td').last().append(action());tbody.append(tr);
            const cardDoc=isLink?`<div class="mt-2"><a class="leave-document fw-semibold text-decoration-none" href="${leaveEscape(fileUrl)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-paperclip me-1"></i>View Document</a></div>`:'';
            const card=$(`<article class="leave-history-card"><div class="leave-section-heading"><strong>${leaveEscape(r.type)}</strong>${badge}</div><p class="mb-1"><strong>${leaveEscape(dateRange)}</strong> · ${leaveEscape(r.days)} days</p><p class="text-muted mb-0">${leaveEscape(r.reason||'No reason provided')}</p>${decisionHtml}${cardDoc}</article>`);if(allowed)card.append(action());mobile.append(card);
        });
        if(!rows.length){const text=myLeaveRecords.length?'No requests match your search.':'No leave requests yet. Your submitted requests will appear here.';tbody.append($('<tr>').append($('<td colspan="6" class="leave-empty">').text(text)));mobile.append($('<p class="leave-empty">').text(text));}
    }
    async function fetchMyLeave() {
        $('#myLeaveTableBody').html('<tr><td colspan="6" class="leave-empty">Loading requests…</td></tr>');
        const res=await apiPost('getLeaveData',{scope:'personal'});
        if(res.staleSession)return;
        if(res.status!=='success'){leaveNotice(res.message||'Unable to load leave requests. Please retry.',true);$('#myLeaveTableBody').empty();return;}
        myLeaveRecords=(res.data||[]).filter(r=>!r.isTestHistory&&r.name?.toUpperCase()===currentUser.name.toUpperCase()).sort((a,b)=>String(b.start).localeCompare(String(a.start)));
        $('#myLeavePending').text(myLeaveRecords.filter(r=>leaveStatusView(r.status).pending).length);
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
        const upcoming=myLeaveRecords.filter(r=>leaveStatusView(r.status).approved&&formatLocalDate(r.start)>=today).sort((a,b)=>String(a.start).localeCompare(String(b.start)))[0];
        $('#myNextLeave').text(upcoming?formatLocalDate(upcoming.start):'—');$('#myNextLeaveType').text(upcoming?`${upcoming.type} · ${upcoming.days} days`:'No upcoming approved leave');
        renderMyLeaveHistory();
    }

    async function withdrawLeave(reqId, rowIndex) {
        let remark = prompt("Please enter your reason for withdrawing this leave application:");
        if (remark === null) return; 
        
        const record=myLeaveRecords.find(r=>r.rowIndex===rowIndex&&String(r.id)===String(reqId));
        if(!record){leaveNotice('Request changed. Refresh and try again.',true);return;}
        const res=await apiPost('updateLeaveStatus', { rowIndex: rowIndex, requestId:record.id, expectedStatus:record.status, newStatus: 'Withdrawal Requested', approver: currentUser.name, withdrawRemark: remark });
        if(res.status!=='success'){leaveNotice(res.message||'Withdrawal failed. Please retry.',true);return;}
        leaveNotice('Withdrawal requested. The leave remains subject to an approver decision.');
        fetchMyLeave();
    }

    let teamLeaveRecords=[],leaveDecisionPending=null;

    function renderLeaveManagementTables(records) {
        if (!Array.isArray(records)) return;
        if ($.fn.DataTable && $.fn.DataTable.isDataTable('#approvalTable')) {
            $('#approvalTable').DataTable().destroy();
        }
        const tbodyApproval = $('#approvalTableBody').empty();

        if ($.fn.DataTable && $.fn.DataTable.isDataTable('#onLeaveTable')) {
            $('#onLeaveTable').DataTable().destroy();
        }
        const tbodyOnLeave = $('#onLeaveTableBody').empty();
        
        const mobileApproval = $('#mobileApprovalCardsContainer').empty();
        const mobileOnLeave = $('#mobileOnLeaveCardsContainer').empty();
        let pendingCount = 0;

        const now = new Date();
        const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        const formatLocal = (dStr) => {
            if (!dStr) return '';
            let d = new Date(dStr);
            if (isNaN(d.getTime())) return dStr.split('T')[0]; 
            return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        };

        records.forEach(r => {
            const startStr = formatLocal(r.start);
            const endStr = formatLocal(r.end);

            if (leaveCanDecide(r,currentUser,staffSettings,true)) {
                pendingCount++;
                let isWithdrawal = leaveStatusView(r.status).withdrawal;
                let typeBadge = isWithdrawal ? `<span class="badge bg-warning text-dark"><i class="bi bi-exclamation-triangle-fill"></i> Withdrawal</span>` : `<span class="badge bg-secondary">${r.type}</span>`;
                
                let btnHtml = isWithdrawal ? 
                    `<button class="btn btn-sm btn-danger me-1 fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Withdrawn')"><i class="bi bi-check-lg"></i> Approve</button>
                     <button class="btn btn-sm btn-secondary fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Approved')"><i class="bi bi-x-lg"></i> Reject</button>`
                    :
                    `<button class="btn btn-sm btn-success me-1 fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Approved')"><i class="bi bi-check-lg"></i> Approve</button>
                     <button class="btn btn-sm btn-danger fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Rejected')"><i class="bi bi-x-lg"></i> Reject</button>`;
                
                let btnHtmlMobile = isWithdrawal ? 
                    `<button class="btn btn-danger flex-fill fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Withdrawn', true)"><i class="bi bi-check-lg"></i> Approve</button>
                     <button class="btn btn-secondary flex-fill fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Approved', true)"><i class="bi bi-x-lg"></i> Reject</button>`
                    :
                    `<button class="btn btn-success flex-fill fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Approved', true)"><i class="bi bi-check-lg"></i> Approve</button>
                     <button class="btn btn-danger flex-fill fw-bold shadow-sm" onclick="processLeave('${r.id}', ${r.rowIndex}, 'Rejected', true)"><i class="bi bi-x-lg"></i> Reject</button>`;

                let fileLink = r.attachment ? `<a href="${r.attachment}" target="_blank" class="badge bg-info text-decoration-none py-2 px-3"><i class="bi bi-paperclip"></i> View MC</a>` : '-';
                
                tbodyApproval.append(`<tr>
                    <td class="fw-bold text-primary">${r.name}</td><td>${typeBadge}</td><td>${startStr} to ${endStr}</td>
                    <td class="fw-bold">${r.days}</td><td class="small text-muted">${r.reason || '-'}</td><td>${fileLink}</td><td>${btnHtml}</td>
                </tr>`);

                mobileApproval.append(`
                <div class="card mb-3 shadow-sm border-0 rounded-4">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="fw-bold text-primary mb-0">${r.name}</h6>
                            <span class="fw-bold small bg-light px-2 py-1 rounded border">${r.days} Days</span>
                        </div>
                        <div class="mb-3">${typeBadge}</div>
                        <div class="small text-muted mb-2"><i class="bi bi-calendar3 me-2"></i>${startStr} to ${endStr}</div>
                        <div class="small mb-3"><strong>Reason:</strong> ${r.reason || '-'}</div>
                        <div class="mb-3">${r.attachment ? `<a href="${r.attachment}" target="_blank" class="btn btn-sm btn-outline-info w-100"><i class="bi bi-paperclip"></i> View Attachment</a>` : ''}</div>
                        <input type="text" class="form-control form-control-sm mb-3 bg-light" id="mobile-remark-${r.id}" placeholder="Add remark (Optional)">
                        <div class="d-flex gap-2">${btnHtmlMobile}</div>
                    </div>
                </div>`);
            }

            if (leaveStatusView(r.status).approved && endStr >= todayStr) {
                let isToday = (todayStr >= startStr && todayStr <= endStr);
                let statusBadge = isToday ? '<span class="badge bg-success shadow-sm">On Leave Today</span>' : '<span class="badge bg-primary shadow-sm opacity-75">Upcoming Leave</span>';

                tbodyOnLeave.append(`<tr>
                    <td class="fw-bold text-dark text-uppercase">${r.name}</td><td><span class="badge bg-secondary">${r.type}</span></td>
                    <td>${startStr} to ${endStr}</td><td class="fw-bold">${r.days} Days</td><td>${statusBadge}</td>
                </tr>`);

                mobileOnLeave.append(`
                <div class="card mb-3 shadow-sm border-0 rounded-4 border-start border-4 ${isToday ? 'border-success' : 'border-primary'}">
                    <div class="card-body p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="fw-bold text-dark text-uppercase mb-0">${r.name}</h6>
                            ${statusBadge}
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-3">
                            <span class="badge bg-light text-dark border">${r.type}</span>
                            <div class="small text-muted fw-bold"><i class="bi bi-calendar-event me-1"></i>${startStr} to ${endStr}</div>
                        </div>
                    </div>
                </div>`);
            }
        });
        
        $('#pendingCount,#teamPending').text(pendingCount);
        $('#teamToday').text(records.filter(r=>leaveStatusView(r.status).approved&&formatLocalDate(r.start)<=todayStr&&formatLocalDate(r.end)>=todayStr).length);
        $('#teamUpcoming').text(records.filter(r=>leaveStatusView(r.status).approved&&formatLocalDate(r.start)>todayStr).length); 
        
        if(pendingCount === 0) {
            tbodyApproval.append('<tr><td colspan="7" class="text-center text-muted py-4">No pending leave requests.</td></tr>');
            mobileApproval.append('<div class="text-center text-muted py-5"><i class="bi bi-check-circle fs-1"></i><p class="mt-2">All caught up!</p></div>');
        }
        if(tbodyOnLeave.children().length === 0) {
            tbodyOnLeave.append('<tr><td colspan="5" class="text-center text-muted py-4">No staff on leave today or upcoming.</td></tr>');
            mobileOnLeave.append('<div class="text-center text-muted py-5"><i class="bi bi-calendar-x fs-1"></i><p class="mt-2">No one is on leave.</p></div>');
        }
    }

    async function fetchLeaveManagementData() {
        $('#leaveTeamScope').text(isAdmin?'HR view · all employees within the system.':'HOD view · employees assigned to you as reporting manager.');
        
        // 1. Instant hydration from in-memory or CacheManager
        if (!teamLeaveRecords || teamLeaveRecords.length === 0) {
            const cached = CacheManager.getTeamLeave();
            if (cached && cached.length) teamLeaveRecords = cached;
        }
        if (teamLeaveRecords && teamLeaveRecords.length > 0) {
            renderLeaveManagementTables(teamLeaveRecords);
        } else {
            $('#leaveTeamFeedback').html('<div class="p-3 text-muted text-center"><span class="spinner-border spinner-border-sm me-2"></span>Loading team leave records...</div>').show();
        }

        // 2. Silent background sync
        try {
            const res = await apiPost('getLeaveData', { role: 'Admin' });
            $('#leaveTeamFeedback').hide();
            if(res && res.status === 'success' && res.data) {
                const clean = (res.data || []).filter(r => !r.isTestHistory);
                teamLeaveRecords = clean;
                CacheManager.saveTeamLeave(clean);
                renderLeaveManagementTables(teamLeaveRecords);
            }
        } catch (_) {}
    }

    function processLeave(reqId,rowIndex,newStatus) {
        const record=teamLeaveRecords.find(r=>r.rowIndex===rowIndex&&String(r.id)===String(reqId));if(!record)return;
        leaveDecisionPending={record,newStatus};
        $('#leaveDecisionTitle').text(newStatus==='Approved'?'Approve leave':newStatus==='Rejected'?'Reject leave':'Approve withdrawal');
        $('#leaveDecisionSummary').text(`${record.name} · ${record.type} · ${formatLocalDate(record.start)} to ${formatLocalDate(record.end)} · ${record.days} days`);
        $('#leaveDecisionReason').text(record.reason||'No reason supplied.');$('#leaveDecisionNote').val('').prop('required',newStatus==='Rejected'||(newStatus==='Approved'&&['CPL','MRL','MTL','PL'].includes(record.type.split(' ')[0])));
        $('#leaveDecisionError').hide();$('#leaveDecisionConfirm').prop('disabled',false).text('Confirm decision');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('leaveDecisionModal')).show();
    }
    async function confirmLeaveDecision(){
        if(!leaveDecisionPending)return;
        const {record,newStatus}=leaveDecisionPending,remark=$('#leaveDecisionNote').val().trim();
        if(!remark&&(newStatus==='Rejected'||(newStatus==='Approved'&&['CPL','MRL','MTL','PL'].includes(record.type.split(' ')[0])))){$('#leaveDecisionError').text(newStatus==='Rejected'?'Add a reason for rejecting this request.':'Record the eligibility and supporting evidence reviewed before approving event leave.').show();return;}
        $('#leaveDecisionConfirm').prop('disabled',true).text('Saving…');
        const res=await apiPost('updateLeaveStatus',{rowIndex:record.rowIndex,requestId:record.id,expectedStatus:record.status,newStatus,approverRemark:remark});
        $('#leaveDecisionConfirm').prop('disabled',false).text('Confirm decision');
        if(res.status!=='success'){$('#leaveDecisionError').text(res.message||'Decision could not be saved.').show();return;}
        bootstrap.Modal.getInstance(document.getElementById('leaveDecisionModal')).hide();leaveDecisionPending=null;
        leaveNotice('Decision recorded: '+newStatus,false,'#leaveTeamFeedback');fetchLeaveManagementData();
    }

    function toggleSummaryView() {
        if ($('#summaryViewType').val() === 'monthly') {
            $('#summaryMonthDiv').show();
        } else {
            $('#summaryMonthDiv').hide();
        }
        renderSummaryDashboard();
    }

    function toggleReportType() {
        const type = $('#reportTypeSelect').val();
        if (type === 'monthly' || type === 'ot_claim') {
            $('#lblMonthStart').text('Select Month');
            $('#exportMonthEnd').parent().hide();
        } else {
            $('#lblMonthStart').text('Start Month');
            $('#exportMonthEnd').parent().show();
        }
    }

    function formatTimeForInput(tStr) {
        if (!tStr || tStr === '-' || tStr.toString().trim() === '') return '';
        let t = tStr.toString().trim();
        let m = t.match(/(\d{1,2})[:.](\d{2})(?:\s*(AM|PM|am|pm))?/i);
        if (m) {
            let hr = parseInt(m[1], 10);
            let min = parseInt(m[2], 10);
            let ampm = m[3] ? m[3].toUpperCase() : '';
            if (ampm === 'PM' && hr < 12) hr += 12;
            if (ampm === 'AM' && hr === 12) hr = 0;
            return hr.toString().padStart(2, '0') + ':' + min.toString().padStart(2, '0');
        }
        return '';
    }

    function generateColors(count) {
        const colors = ['#5c6b80', '#89829c', '#8e879f', '#ae8894', '#ae7777', '#b48a6c', '#b49871', '#627c6c', '#839c8a', '#809ca5'];
        let res = [];
        for(let i=0; i<count; i++) res.push(colors[i % colors.length]);
        return res;
    }

    // Share only requests currently in flight. Completed responses are never cached:
    // balances, permissions and optimistic record versions must remain authoritative.
    const pendingReads = new Map();
    const readActions = new Set(['whoami', 'getBootstrap', 'getAttendanceApproval', 'hrBootstrap', 'getStaff', 'getHolidays', 'getData', 'getAttendance', 'getLockedMonths', 'getLeaveData', 'getPayroll', 'leaveOverview', 'mobileClockConfig']);
    function requestKey(value) {
        if (Array.isArray(value)) return value.map(requestKey);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, requestKey(value[key])]));
        return value;
    }
    async function apiPost(action, payload) {
        const sessionToken = localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken');
        const isRead = readActions.has(action);
        const key = JSON.stringify([sessionToken, action, requestKey(payload)]);
        // Invalidate on both sides of a write, including reads begun while it ran.
        if (!isRead) pendingReads.clear();
        let pending = isRead && pendingReads.get(key);
        if (!pending) {
            pending = (async () => {
                const controller = isRead ? new AbortController() : null;
                const timeout = controller ? setTimeout(() => controller.abort(), 30000) : null;
                try {
                    if (!API_URL) return { status: 'error', message: 'VITE_GAS_API_URL is not configured. Contact your administrator.' };
                    const res = await fetch(API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        redirect: 'follow',
                        ...(controller ? { signal: controller.signal } : {}),
                        body: JSON.stringify({ action, payload, sessionToken })
                    });
                    if (!res.ok) return { status: 'error', message: `Apps Script HTTP ${res.status}. Check backend deployment, permissions and execution logs.` };
                    const raw = await res.text();
                    try { return JSON.parse(raw); }
                    catch (_) { return { status: 'error', message: 'Apps Script returned a non-JSON response. Verify the deployed web-app URL and access permissions.' }; }
                } catch (e) {
                    if (e?.name === 'AbortError') return { status: 'error', message: 'The request timed out. Please refresh to try again.' };
                    console.error('API POST Error:', action, e);
                    return { status: 'error', message: 'Could not reach Apps Script: ' + (e?.message || 'network or CORS failure') + '. Check deployment access and endpoint.' };
                } finally {
                    if (timeout !== null) clearTimeout(timeout);
                }
            })();
            if (isRead) pendingReads.set(key, pending);
        }
        try {
            const result = await pending;
            const currentToken = localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken');
            if (currentToken !== sessionToken) return { status: 'error', staleSession: true, message: 'Session changed. Please reload.' };
            // Each consumer may enrich its copy without mutating another caller's data.
            return JSON.parse(JSON.stringify(result));
        } finally {
            if (!isRead) pendingReads.clear();
            else if (pendingReads.get(key) === pending) pendingReads.delete(key);
        }
    }

    function formatLocalDate(dStr) {
        if (!dStr) return '';
        let d = new Date(dStr);
        if (isNaN(d.getTime())) return dStr.split('T')[0]; 
        return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    }

    function syncMonthSelectDropdowns() {
        const curSumMonth = $('#sumDashMonth').val();
        const curMonth = $('#monthSelect').val();

        const monthsSet = new Set(globalData.map(d => d.month).filter(m => m && m !== "Unknown" && m.includes('-')));
        Object.keys(lockedMonthsData || {}).forEach(m => {
            const baseM = m && m.includes('__') ? m.split('__')[0] : m;
            if (baseM && baseM.includes('-')) monthsSet.add(baseM);
        });
        const now = new Date();
        const currMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        monthsSet.add(currMonthStr);
        const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
        monthsSet.add(prevMonthStr);

        const months = Array.from(monthsSet).sort().reverse();
        
        $('#monthSelect, #sumDashMonth, #exportMonthStart, #exportMonthEnd').each(function() {
            const el = $(this);
            const currentVal = el.val();
            el.empty();
            months.forEach(m => {
                el.append(new Option(m, m));
            });
            if (currentVal && months.includes(currentVal)) {
                el.val(currentVal);
            }
        });
        if (curSumMonth && months.includes(curSumMonth)) {
            $('#sumDashMonth').val(curSumMonth);
        }
        if (curMonth && months.includes(curMonth)) {
            $('#monthSelect').val(curMonth);
        }
    }

    function hydrateFromLocalCache() {
        const cachedBoot = CacheManager.getBootstrap();
        const cachedLocked = CacheManager.getLockedMonths();
        const cachedAtt = CacheManager.getAttendanceHistory();

        let hydrated = false;
        if (cachedBoot && typeof cachedBoot === 'object') {
            if (cachedBoot.staffSettings && Object.keys(cachedBoot.staffSettings).length) {
                staffSettings = cachedBoot.staffSettings;
                if (typeof window !== 'undefined') window.staffSettings = staffSettings;
                hydrated = true;
            }
            if (cachedBoot.holidays && Array.isArray(cachedBoot.holidays) && cachedBoot.holidays.length) {
                holidays = cachedBoot.holidays;
                hydrated = true;
            }
            if (cachedBoot.globalLeaves && Array.isArray(cachedBoot.globalLeaves) && cachedBoot.globalLeaves.length) {
                globalLeaves = cachedBoot.globalLeaves;
                hydrated = true;
            }
            if (Array.isArray(cachedBoot.cachedCompanies)) cachedCompanies = cachedBoot.cachedCompanies;
            if (Array.isArray(cachedBoot.cachedDepartments)) cachedDepartments = cachedBoot.cachedDepartments;
            if (Array.isArray(cachedBoot.cachedJobGrades)) cachedJobGrades = cachedBoot.cachedJobGrades;
            if (Array.isArray(cachedBoot.cachedJobTitles)) cachedJobTitles = cachedBoot.cachedJobTitles;
        }

        if (cachedLocked && typeof cachedLocked === 'object' && Object.keys(cachedLocked).length > 0) {
            lockedMonthsData = cachedLocked;
            hydrated = true;
        }

        if (Array.isArray(cachedAtt) && cachedAtt.length > 0) {
            globalData = cachedAtt;
            hydrated = true;
        }

        if (hydrated) {
            const staffMap = new Map();
            if (Object.keys(staffSettings).length > 0) {
                Object.keys(staffSettings).forEach(name => {
                    const id = staffSettings[name].employeeNo || staffSettings[name].username || name;
                    staffMap.set(id, name);
                });
            }
            if (globalData.length > 0) {
                globalData.forEach(d => {
                    if (d.id && d.name && !staffMap.has(d.id)) staffMap.set(d.id, d.name);
                });
            }
            staffList = Array.from(staffMap.entries()).sort((a,b)=>a[1].localeCompare(b[1]));

            syncMonthSelectDropdowns();
            populateAttendanceFilters();
            populateSummaryFilters();
        }
        return hydrated;
    }

    let initializationRequest = 0;
    async function initializeApp() {
        const requestId = ++initializationRequest;
        const sessionToken = localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken');
        $('#loadError').hide();
        $('#refreshSystemBtn').prop('disabled', true).attr('aria-busy', 'true');

        // Instant Hydration from persistent cache for fast loading without waiting for network
        const hasCached = hydrateFromLocalCache();
        if (hasCached) {
            $('#initialLoader').hide();
            $('#controlPanel').show();
            if ($('#summary-dashboard').hasClass('active')) {
                $('#summary-dashboard').show();
                renderSummaryDashboard();
            }
            if ($('#dashboard').hasClass('active')) renderDashboard();
        }

        try {
            const [staffRes, holidayRes, dataRes, attRes, lockRes, leaveRes] = await loadBootstrapData();
            const currentToken = localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken');
            if (currentToken !== sessionToken || requestId !== initializationRequest) return;

            const allRes = [staffRes, holidayRes, dataRes, attRes, lockRes, leaveRes];
            const hasStaleOrExpired = allRes.some(r => r && (r.staleSession || String(r.message || '').toLowerCase().includes('session expired') || String(r.message || '').toLowerCase().includes('sign in again')));
            if (hasStaleOrExpired) {
                localStorage.removeItem('hrPortalToken');
                sessionStorage.removeItem('hrPortalToken');
                $('#initialLoader').hide();
                $('#loadError').hide();
                $('#loginScreen').fadeIn();
                $('.wrapper').hide();
                $('#loginError').text("Session expired. Please sign in again.").show();
                return;
            }

            const failedResponse = allRes.find(r => !r || r.status !== 'success');
            if (allRes.some(r => !r || r.status !== 'success')) throw new Error(failedResponse?.message || 'Records unavailable. Check your connection and try again.');
            if (!Array.isArray(dataRes.data) || !Array.isArray(attRes.data) || !Array.isArray(leaveRes.data)) {
                throw new Error('Attendance response is incomplete. Please refresh to try again.');
            }

            if (staffRes.status === 'success') {
                staffSettings = staffRes.data || {};
                if (typeof window !== 'undefined') window.staffSettings = staffSettings;
                CacheManager.saveBootstrap({ staffSettings });
            }
            if (holidayRes && holidayRes.status === 'success' && Array.isArray(holidayRes.data) && holidayRes.data.length > 0) {
                holidays = holidayRes.data;
            } else if (!holidays || !holidays.length) {
                holidays = JSON.parse(JSON.stringify(DEFAULT_2026_HOLIDAYS));
            }
            if (Array.isArray(holidays)) {
                holidays.sort((a, b) => {
                    const da = parseDateDMYToISO(a && a.date);
                    const db = parseDateDMYToISO(b && b.date);
                    return da.localeCompare(db);
                });
            }
            if (lockRes && lockRes.status === 'success') {
                lockedMonthsData = lockRes.data || {};
                CacheManager.saveLockedMonths(lockedMonthsData, true);
            }
            
            if (leaveRes && leaveRes.status === 'success' && Array.isArray(leaveRes.data)) {
                const cleanLeaves = (leaveRes.data || []).filter(r => !r.isTestHistory);
                CacheManager.saveTeamLeave(cleanLeaves);
                globalLeaves = cleanLeaves.filter(l => l.status === 'Approved').map(l => ({
                    ...l,
                    start: formatLocalDate(l.start),
                    end: formatLocalDate(l.end)
                }));
            }

            $('#initialLoader').hide();
            
            const overrideMap = new Map();
            if (attRes && attRes.status === 'success' && attRes.data) {
                attRes.data.forEach(att => {
                    const normAttDate = normalizeDateStr(att.date);
                    const val = { 
                        payType: att.payType, remark: att.remark, in: att.in, out: att.out,
                        overlapOT: att.overlapOT, extraOT: att.extraOT, manualOTPay: att.manualOTPay,
                        manualShift: att.manualShift || 'AUTO'
                    };
                    overrideMap.set(`${att.id}_${att.date}`, val);
                    if (normAttDate) overrideMap.set(`${att.id}_${normAttDate}`, val);

                    const s = findStaffSetting(att.id, att.name);
                    if (s) {
                        if (s.biometricId) {
                            overrideMap.set(`${s.biometricId}_${att.date}`, val);
                            if (normAttDate) overrideMap.set(`${s.biometricId}_${normAttDate}`, val);
                        }
                        if (s.employeeNo) {
                            overrideMap.set(`${s.employeeNo}_${att.date}`, val);
                            if (normAttDate) overrideMap.set(`${s.employeeNo}_${normAttDate}`, val);
                        }
                        if (s.name) {
                            overrideMap.set(`${s.name}_${att.date}`, val);
                            if (normAttDate) overrideMap.set(`${s.name}_${normAttDate}`, val);
                        }
                    }
                });
            }

            if (dataRes && dataRes.status === 'success' && Array.isArray(dataRes.data) && dataRes.data.length > 0) {
                globalData = dataRes.data.map(d => {
                    const normDate = normalizeDateStr(d.date);
                    const month = normDate.length >= 7 ? normDate.substring(0, 7) : "Unknown";

                    // Priority resolution: Biometric ID first, then employeeNo/username, then Name
                    const sObj = findStaffSetting(d.id, d.name);
                    const resolvedId = sObj ? (sObj.employeeNo || sObj.username || sObj.name) : d.id;
                    const resolvedName = sObj ? sObj.name : d.name;
                    const biometricId = (sObj && sObj.biometricId) ? String(sObj.biometricId).trim() : (d.id || '');

                    const override = (sObj && overrideMap.get(`${resolvedId}_${normDate}`)) ||
                                     overrideMap.get(`${d.id}_${normDate}`) ||
                                     (sObj && overrideMap.get(`${resolvedName}_${normDate}`)) ||
                                     (sObj && overrideMap.get(`${resolvedId}_${d.date}`)) ||
                                     overrideMap.get(`${d.id}_${d.date}`) ||
                                     (sObj && overrideMap.get(`${resolvedName}_${d.date}`));
                    const finalIn = override && override.in ? override.in : d.in;
                    const finalOut = override && override.out ? override.out : d.out;
                    const manualShift = override && override.manualShift ? override.manualShift : "AUTO";
                    
                    const sComp = getStaffCompany(sObj);
                    const calc = calculateStats(finalIn, finalOut, manualShift, sComp, sObj);

                    return {
                        id: resolvedId, 
                        name: resolvedName, 
                        rawId: d.id, 
                        rawName: d.name, 
                        rawMachineName: d.name,
                        biometricId: biometricId,
                        employeeNo: sObj ? (sObj.employeeNo || '') : '',
                        date: normDate, 
                        month: month, 
                        weekday: d.weekday,
                        in: finalIn, 
                        out: finalOut, 
                        manualPayType: override && override.payType ? override.payType : "AUTO",
                        manualShift: manualShift, 
                        dbRemark: override && override.remark ? override.remark : "",
                        autoRemark: calc.remark,
                        manualOverlap: override && override.overlapOT !== undefined && String(override.overlapOT).trim() !== '' ? override.overlapOT : '',
                        manualExtra: override && override.extraOT !== undefined && String(override.extraOT).trim() !== '' ? override.extraOT : '',
                        manualOTPay: override && override.manualOTPay !== undefined && String(override.manualOTPay).trim() !== '' ? override.manualOTPay : '',
                        ...calc
                    };
                });

            } else {
                globalData = [];
            }

            if (attRes && attRes.status === 'success' && Array.isArray(attRes.data) && attRes.data.length > 0) {
                const existingKeys = new Set(globalData.map(r => `${r.id}_${r.date}`));
                globalData.forEach(r => {
                    if (r.biometricId) existingKeys.add(`${r.biometricId}_${r.date}`);
                    if (r.employeeNo) existingKeys.add(`${r.employeeNo}_${r.date}`);
                    if (r.rawId) existingKeys.add(`${r.rawId}_${r.date}`);
                    if (r.name) existingKeys.add(`${r.name}_${r.date}`);
                });

                attRes.data.forEach(att => {
                    const normAttDate = normalizeDateStr(att.date);
                    if (!normAttDate) return;
                    const sObj = findStaffSetting(att.id, att.name);
                    const resolvedId = sObj ? (sObj.employeeNo || sObj.username || sObj.name) : att.id;
                    const resolvedName = sObj ? sObj.name : att.name;
                    const bioId = (sObj && sObj.biometricId) ? String(sObj.biometricId).trim() : (att.id || '');
                    const empNo = sObj ? (sObj.employeeNo || '') : '';

                    const isPresent = existingKeys.has(`${resolvedId}_${normAttDate}`) ||
                                      existingKeys.has(`${att.id}_${normAttDate}`) ||
                                      (bioId && existingKeys.has(`${bioId}_${normAttDate}`)) ||
                                      (empNo && existingKeys.has(`${empNo}_${normAttDate}`)) ||
                                      (resolvedName && existingKeys.has(`${resolvedName}_${normAttDate}`));
                    if (!isPresent) {
                        const finalIn = att.in || '-';
                        const finalOut = att.out || '-';
                        const manualShift = att.manualShift || 'AUTO';
                        const sComp = getStaffCompany(sObj);
                        const calc = (finalIn !== '-' && finalOut !== '-') 
                            ? calculateStats(finalIn, finalOut, manualShift, sComp, sObj)
                            : { shift: '-', totalHrs: '-', totalMins: 0, lateIn: '-', earlyOut: '-', payableHrs: '-', overlapOT: 0, extraOT: 0, totalOT: 0, remark: '' };
                        
                        globalData.push({
                            id: resolvedId,
                            name: resolvedName,
                            rawId: att.id,
                            rawName: att.name,
                            rawMachineName: att.name,
                            biometricId: bioId,
                            employeeNo: empNo,
                            date: normAttDate,
                            month: normAttDate.length >= 7 ? normAttDate.substring(0, 7) : 'Unknown',
                            weekday: att.weekday || '',
                            in: finalIn,
                            out: finalOut,
                            manualPayType: att.payType || 'AUTO',
                            manualShift: manualShift,
                            dbRemark: att.remark || '',
                            autoRemark: calc.remark || '',
                            manualOverlap: att.overlapOT !== undefined && String(att.overlapOT).trim() !== '' ? att.overlapOT : '',
                            manualExtra: att.extraOT !== undefined && String(att.extraOT).trim() !== '' ? att.extraOT : '',
                            manualOTPay: att.manualOTPay !== undefined && String(att.manualOTPay).trim() !== '' ? att.manualOTPay : '',
                            ...calc
                        });
                        existingKeys.add(`${resolvedId}_${normAttDate}`);
                        if (bioId) existingKeys.add(`${bioId}_${normAttDate}`);
                        if (empNo) existingKeys.add(`${empNo}_${normAttDate}`);
                    }
                });
            }

            const staffMap = new Map();
            if (Object.keys(staffSettings).length > 0) {
                Object.keys(staffSettings).forEach(name => {
                    const id = staffSettings[name].employeeNo || staffSettings[name].username || name;
                    staffMap.set(id, name);
                });
            }
            if (Object.keys(staffSettings).length === 0 && globalData.length > 0) {
                globalData.forEach(d => {
                    if (d.id && d.name && !staffMap.has(d.id)) {
                        staffMap.set(d.id, d.name);
                    }
                });
            }
            staffList = Array.from(staffMap.entries()).sort((a,b)=>a[1].localeCompare(b[1]));

            try {
                const hrBoot = await mastersPromise;
                const latestToken = localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken');
                if (latestToken !== sessionToken || requestId !== initializationRequest) return;
                if (hrBoot && hrBoot.status === 'success' && hrBoot.data && hrBoot.data.records) {
                    cachedHrBootstrapData = hrBoot.data;
                    cachedCompanies = hrBoot.data.records.companies || [];
                    cachedDepartments = hrBoot.data.records.departments || [];
                    cachedJobGrades = hrBoot.data.records.jobGrades || [];
                    cachedJobTitles = hrBoot.data.records.jobTitles || [];
                }
            } catch (e) {
                // Fallback gracefully
            }

            // Merge newly fetched data with cached historical attendance so previous/locked months remain in globalData!
            const cachedHistory = CacheManager.getAttendanceHistory();
            if (Array.isArray(cachedHistory) && cachedHistory.length > 0) {
                const existingKeys = new Set(globalData.map(d => `${d.id || d.rawId || d.name}_${d.date}`));
                cachedHistory.forEach(ch => {
                    const k = `${ch.id || ch.rawId || ch.name}_${ch.date}`;
                    if (!existingKeys.has(k)) {
                        globalData.push(ch);
                        existingKeys.add(k);
                    }
                });
            }
            CacheManager.saveAttendanceRows(globalData);
            CacheManager.saveBootstrap({
                staffSettings,
                holidays,
                globalLeaves,
                cachedCompanies,
                cachedDepartments,
                cachedJobGrades,
                cachedJobTitles
            });
            CacheManager.saveLockedMonths(lockedMonthsData);

            syncMonthSelectDropdowns();
            populateAttendanceFilters();
            populateSummaryFilters();

            if($('#summary-dashboard').hasClass('active'))$('#summary-dashboard').show();
            $('#kpiPanelSum').css('display', 'flex'); 
            $('#chartPanelSum').css('display', 'flex');
            $('#exportPanelSum').show();
            $('#controlPanel').show(); 
            
            if ($('#summary-dashboard').hasClass('active')) renderSummaryDashboard();
            if ($('#dashboard').hasClass('active')) renderDashboard();

        } catch (error) { 
            if (requestId !== initializationRequest) return;
            console.error("Failed to load DB.", error); 
            $('#initialLoader').hide(); $('#loadError').show(); $('#emptyStateMsg').hide();
        }
        $('#refreshSystemBtn').prop('disabled', false).attr('aria-busy', 'false');
        if ($('#staff-mgmt').hasClass('active')) renderStaffMgmt();
        if ($('#holidays').hasClass('active')) renderHolidayMgmt();
        fetchActionCount();
    }

    function calculateStats(tIn, tOut, manualShift = "AUTO", staffCompany = "", staffProfile = null) {
        if(!tIn || !tOut || tIn.toString().toLowerCase().includes('undefined') || tOut.toString().toLowerCase().includes('undefined') || tIn.trim() === '' || tOut.trim() === '') {
            return { shift: '-', totalHrs: '-', totalMins: 0, lateIn: '-', earlyOut: '-', payableHrs: '-', overlapOT: 0, extraOT: 0, totalOT: 0, remark: '' };
        }
        
        const toMin = (t) => { 
            let fmt = formatTimeForInput(t);
            if (!fmt) return 0;
            let p = fmt.split(':');
            return parseInt(p[0]) * 60 + parseInt(p[1]);
        };
        const toHM = (m) => {
            if (m <= 0) return "00:00";
            m = Math.round(m); 
            return `${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`;
        };
        
        const minIn = toMin(tIn); let minOut = toMin(tOut);
        if (minOut < minIn) minOut += 1440; 

        const totalWorkedMins = minOut - minIn; const totalWorkedHours = totalWorkedMins / 60;
        const shifts = [
            // SQ Working Schedules
            { company: "SQ", code: "S1", name: "S1 (05:30-14:30)", start: 330, end: 870, breakHours: 1.0, netHours: 8.0 },
            { company: "SQ", code: "S2", name: "S2 (08:30-17:30)", start: 510, end: 1050, breakHours: 1.0, netHours: 8.0 },
            { company: "SQ", code: "S3", name: "S3 (14:30-23:30)", start: 870, end: 1410, breakHours: 1.0, netHours: 8.0 },
            { company: "SQ", code: "S4", name: "S4 (23:00-08:00)", start: 1380, end: 1920, breakHours: 1.0, netHours: 8.0 },
            { company: "SQ", code: "F1", name: "F1 (05:30-17:30)", start: 330, end: 1050, breakHours: 1.5, netHours: 10.5 },
            { company: "SQ", code: "F2", name: "F2 (11:30-23:30)", start: 690, end: 1410, breakHours: 1.5, netHours: 10.5 },
            // MS Working Schedules
            { company: "MS", code: "M", name: "M (07:00-15:30)", start: 420, end: 930, breakHours: 1.0, netHours: 7.5 },
            { company: "MS", code: "M1", name: "M1 (06:00-15:00)", start: 360, end: 900, breakHours: 1.0, netHours: 8.0 },
            { company: "MS", code: "M2", name: "M2 (08:00-17:00)", start: 480, end: 1020, breakHours: 1.0, netHours: 8.0 },
            { company: "MS", code: "M3", name: "M3 (14:00-23:00)", start: 840, end: 1380, breakHours: 1.0, netHours: 8.0 },
            { company: "MS", code: "M4", name: "M4 (23:00-08:00)", start: 1380, end: 1920, breakHours: 1.0, netHours: 8.0 },
            { company: "MS", code: "A", name: "A (15:00-23:30)", start: 900, end: 1410, breakHours: 1.0, netHours: 7.5 },
            { company: "MS", code: "N", name: "N (11:00-19:30)", start: 660, end: 1170, breakHours: 1.0, netHours: 7.5 },
            { company: "MS", code: "A1", name: "A1 (13:00-23:30)", start: 780, end: 1410, breakHours: 1.0, netHours: 9.5 }
        ];

        let allShifts = [...shifts];
        let customList = [];
        try {
            if (typeof records !== 'undefined' && records?.workSchedules?.length) {
                customList = records.workSchedules;
            } else if (typeof window !== 'undefined' && window.workSchedules?.length) {
                customList = window.workSchedules;
            } else if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('hr_workSchedules') || localStorage.getItem('hr_custom_workSchedules');
                if (raw) customList = JSON.parse(raw);
            }
        } catch (_) {}

        if (Array.isArray(customList) && customList.length > 0) {
            customList.forEach(cs => {
                if (!cs || cs.availability === 'Inactive') return;
                const cCode = String(cs.code || '').trim();
                if (!cCode) return;
                const existingIdx = allShifts.findIndex(s => s.code.toUpperCase() === cCode.toUpperCase());
                const cStart = cs.start ? toMin(cs.start) : 0;
                let cEnd = cs.end ? toMin(cs.end) : 0;
                if (cEnd < cStart) cEnd += 1440;
                const cBreak = cs.breakHours != null ? parseFloat(cs.breakHours) : 1.0;
                const cNet = cs.netHours != null ? parseFloat(cs.netHours) : ((cEnd - cStart) / 60 - cBreak);
                const shiftObj = {
                    company: (cs.company || cs.companyId || (cCode.startsWith('S') || cCode.startsWith('F') ? 'SQ' : 'MS')).toUpperCase(),
                    code: cCode,
                    name: `${cCode} (${cs.start || '00:00'}-${cs.end || '00:00'})`,
                    start: cStart,
                    end: cEnd,
                    breakHours: cBreak,
                    netHours: cNet
                };
                if (existingIdx !== -1) {
                    allShifts[existingIdx] = shiftObj;
                } else {
                    allShifts.push(shiftObj);
                }
            });
        }

        let assignedCodes = [];
        let pObj = staffProfile;
        if (typeof pObj === 'string' && pObj.trim()) {
            if (typeof findStaffSetting === 'function') {
                pObj = findStaffSetting(null, pObj) || findStaffSetting(pObj, null);
            }
            if (!pObj && typeof staffSettings !== 'undefined' && staffSettings) {
                pObj = staffSettings[staffProfile];
            }
        }
        if (pObj && typeof pObj === 'object') {
            if (Array.isArray(pObj.schedules) && pObj.schedules.length > 0) {
                assignedCodes = pObj.schedules.map(s => String(s).trim().toUpperCase());
            } else if (pObj.schedule) {
                assignedCodes = String(pObj.schedule).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            }
            if (!staffCompany && pObj.company) {
                staffCompany = pObj.company;
            }
        } else if (Array.isArray(staffProfile)) {
            assignedCodes = staffProfile.map(s => String(s).trim().toUpperCase()).filter(Boolean);
        }

        let candidateShifts = allShifts;
        if (assignedCodes.length > 0) {
            const matched = allShifts.filter(s => {
                const codeU = String(s.code || '').toUpperCase();
                const nameU = String(s.name || '').toUpperCase();
                return assignedCodes.some(ac => ac === codeU || nameU.includes(ac) || ac.includes(codeU));
            });
            if (matched.length > 0) {
                candidateShifts = matched;
            }
        }
        if (candidateShifts === allShifts && staffCompany) {
            const isMS = /MS|Milan/i.test(staffCompany);
            const isSQ = /SQ|Suria|Setar/i.test(staffCompany);
            if (isMS) candidateShifts = allShifts.filter(s => s.company === 'MS');
            else if (isSQ) candidateShifts = allShifts.filter(s => s.company === 'SQ');
        }

        let bestShift = candidateShifts[0], minScore = Infinity;
        
        if (manualShift && manualShift !== "AUTO") {
            const cleanManual = String(manualShift).trim();
            bestShift = allShifts.find(s => s.name === cleanManual || s.code === cleanManual || cleanManual.startsWith(s.code + ' ') || cleanManual.includes(s.name) || cleanManual.startsWith(s.name)) || allShifts[0];
        } else {
            candidateShifts.forEach(s => {
                let effectiveIn = minIn;
                let effectiveOut = minOut;
                if (s.end > 1440 && effectiveIn < 720 && effectiveOut <= 1440) {
                    effectiveIn += 1440;
                    effectiveOut += 1440;
                }
                const overlap = Math.max(0, Math.min(effectiveOut, s.end) - Math.max(effectiveIn, s.start));
                
                const diffIn = Math.abs((minIn % 1440) - (s.start % 1440));
                const circIn = Math.min(diffIn, 1440 - diffIn);
                const diffOut = Math.abs((minOut % 1440) - (s.end % 1440));
                const circOut = Math.min(diffOut, 1440 - diffOut);
                
                // Clock in deviation is weighted 2x, clock out 1x; penalize zero overlap
                const overlapPenalty = overlap > 0 ? 0 : 1000;
                const score = (circIn * 2) + circOut + overlapPenalty;
                
                if (score < minScore) {
                    minScore = score;
                    bestShift = s;
                }
            });
        }

        const sName = bestShift.name; let remarks = [];
        if (sName.includes("S3")) {
            if (minIn < 870) remarks.push("Early OT (S3)");
            if (minOut > 1410) remarks.push("Late OT (S3)");
        }
        if (sName.includes("S4")) {
            if (minIn < 1380 && minIn > 720) remarks.push("Early OT (S4)");
            if (minOut > 1920) remarks.push("Late OT (S4)");
        }
        if (sName.startsWith("A ") || sName.startsWith("A1 ")) {
            if (minOut > 1410) remarks.push("Late OT (" + bestShift.code + ")");
        }

        let shiftStart = bestShift.start;
        let shiftEnd = bestShift.end;
        let compIn = minIn;
        let compOut = minOut;
        if (shiftEnd > 1440 && compIn < 720) {
            compIn += 1440;
            compOut += 1440;
        }

        const lateIn = compIn > shiftStart ? toHM(compIn - shiftStart) : "-";
        const earlyOut = compOut < shiftEnd ? toHM(shiftEnd - compOut) : "-";

        let otThresholdHours = bestShift.company === 'SQ' ? (totalWorkedHours >= 12.0 ? 9.0 : 8.5) : (bestShift.netHours + (bestShift.breakHours || 1.0));
        let totalBreakHours = bestShift.breakHours != null ? bestShift.breakHours : (totalWorkedHours >= 12.0 ? 1.5 : 1.0);

        let rawOTHours = Math.max(0, totalWorkedHours - otThresholdHours);
        let effectiveWorkHours = Math.max(0, totalWorkedHours - totalBreakHours);
        let payableMins = Math.min((bestShift.netHours || 7.5) * 60, effectiveWorkHours * 60); 
        let payableDecimal = (payableMins / 60).toFixed(1);

        const totalOTHours = (Math.floor(rawOTHours * 2) / 2);
        let overlapOT = 0.0, extraOT = 0.0;
        if (totalOTHours > 0) { overlapOT = Math.min(0.5, totalOTHours); extraOT = Math.max(0, totalOTHours - 0.5); }

        return { 
            shift: sName, totalHrs: toHM(totalWorkedMins), totalMins: totalWorkedMins,
            lateIn: lateIn, 
            earlyOut: earlyOut, 
            payableHrs: payableDecimal, payableMins: payableMins, overlapOT: overlapOT.toFixed(1),
            extraOT: extraOT.toFixed(1), totalOT: totalOTHours, remark: remarks.join(", ")
        };
    }

    async function handleFile(file) {
        const XLSX = (await import('xlsx-js-style')).default;
        $('#emptyStateMsg').hide(); $('#initialLoader').hide();
        const reader = new FileReader();
        reader.onload = (e) => {
            const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
            parseData(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header: 1, raw: false}));
        };
        reader.readAsArrayBuffer(file);
    }

    function parseData(raw) {
        const hIdx = raw.findIndex(r => { const rowStr = (r||[]).join(' ').toLowerCase(); return rowStr.includes('employee id') || rowStr.includes('name'); });
        if(hIdx === -1) { alert("Header row not found in file!"); return; }
        
        const headers = raw[hIdx].map(h => (h||'').toString().toLowerCase().trim());
        const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));
        
        const col = { 
            id: findCol(['employee id', 'ac-no']), name: findCol(['first name', 'name']),
            date: findCol(['date', 'time']), in: findCol(['first punch', 'clock in', 'in']),
            out: findCol(['last punch', 'clock out', 'out'])
        };

        const newData = [];
        let ignoredCount = 0;
        let importedCount = 0;

        raw.slice(hIdx + 1).filter(r => r[col.date]).forEach((r, i) => {
            let dStr = r[col.date] ? r[col.date].toString().trim() : "";
            const normDate = normalizeDateStr(dStr);
            const valIn = (col.in !== -1 && r[col.in]) ? r[col.in].toString().trim() : "";
            const valOut = (col.out !== -1 && r[col.out]) ? r[col.out].toString().trim() : "";
            const month = normDate.length >= 7 ? normDate.substring(0, 7) : "Unknown";
            
            let rawStaffName = col.name !== -1 && r[col.name] ? String(r[col.name]).trim() : "";
            let rawStaffId = col.id !== -1 && r[col.id] ? String(r[col.id]).trim() : "";

            let resolvedStaff = findStaffSetting(rawStaffId, rawStaffName);

            // User requirement: "system should ignore the attendance that staff not register on the system"
            if (!resolvedStaff) {
                ignoredCount++;
                return;
            }

            // Capture biometric ID on resolvedStaff for fast lookups
            if (rawStaffId && !resolvedStaff.biometricId) {
                resolvedStaff.biometricId = rawStaffId;
            }

            // User requirement: "the name should follow the system registed name"
            const staffName = resolvedStaff.name;
            const staffId = resolvedStaff.employeeNo || resolvedStaff.username || resolvedStaff.id || rawStaffId;
            const staffCompany = getStaffCompany(resolvedStaff);

            const calc = calculateStats(valIn, valOut, "AUTO", staffCompany, resolvedStaff);

            newData.push({ 
                id: staffId, 
                name: staffName, 
                rawId: rawStaffId,
                rawName: rawStaffName,
                rawMachineName: rawStaffName,
                biometricId: resolvedStaff.biometricId || rawStaffId,
                employeeNo: resolvedStaff.employeeNo || '',
                date: normDate, 
                month: month, 
                in: valIn, 
                out: valOut, 
                manualPayType: "AUTO",
                manualShift: "AUTO", 
                dbRemark: "", 
                autoRemark: calc.remark, 
                ...calc
            });
            importedCount++;
        });

        if (ignoredCount > 0) {
            console.log(`[Attendance Import] Imported ${importedCount} records for registered staff. Ignored ${ignoredCount} records for unregistered staff.`);
        }

        let lockedWarning = false;
        newData.forEach(nRow => {
            if (lockedMonthsData[nRow.month]) { lockedWarning = true; return; }
            const existingIdx = globalData.findIndex(g => g.id === nRow.id && g.date === nRow.date);
            if (existingIdx !== -1) {
                const existing = globalData[existingIdx];
                const firstIn = pickFirstInTime(existing.in, nRow.in);
                const lastOut = pickLastOutTime(existing.out, nRow.out);
                const shift = (existing.manualShift && existing.manualShift !== 'AUTO') ? existing.manualShift : (nRow.manualShift || 'AUTO');
                const shiftStaffObj = findStaffSetting(existing.id || existing.rawId || nRow.id || nRow.rawId, existing.name || existing.rawName || nRow.name || nRow.rawName);
                const calc = calculateStats(firstIn, lastOut, shift, comp, shiftStaffObj);
                globalData[existingIdx] = {
                    ...existing,
                    ...nRow,
                    in: firstIn,
                    out: lastOut,
                    autoRemark: calc.remark,
                    ...calc
                };
            }
            else globalData.push(nRow);
        });

        attendanceIndexSource = null;
        if (lockedWarning) alert("Warning: Some rows belonged to a locked month and were ignored. Locked months cannot be overwritten by new file uploads.");

        const staffMap = new Map();
        if (Object.keys(staffSettings).length > 0) {
            Object.keys(staffSettings).forEach(name => {
                const id = staffSettings[name].employeeNo || staffSettings[name].username || name;
                staffMap.set(id, name);
            });
        }
        if (globalData.length > 0) {
            globalData.forEach(d => {
                if (d.id && d.name && !staffMap.has(d.id)) {
                    staffMap.set(d.id, d.name);
                }
            });
        }
        staffList = Array.from(staffMap.entries()).sort((a,b)=>a[1].localeCompare(b[1]));

        CacheManager.saveAttendanceRows(globalData);
        syncMonthSelectDropdowns();
        populateAttendanceFilters();
        populateSummaryFilters();
        if ($('#summary-dashboard').hasClass('active')) renderSummaryDashboard();
        if ($('#dashboard').hasClass('active')) renderDashboard();

        if($('#summary-dashboard').hasClass('active'))$('#summary-dashboard').show();
        $('#kpiPanelSum').css('display', 'flex'); $('#chartPanelSum').css('display', 'flex'); $('#exportPanelSum').show();
        $('#controlPanel').show(); 
        
        renderSummaryDashboard(); renderDashboard(); syncToGoogleSheets();
    }

    function generatePayrollData(m, ratesSnapshot) {
        m = m || $('#monthSelect').val();
        if (!m || !m.includes('-')) return [];

        const compFilter = $('#summaryCompanySelect').val() || $('#attendanceCompanySelect').val() || 'ALL';
        const mKey = (compFilter && compFilter !== 'ALL') ? `${m}__${compFilter}` : m;
        const lockedRecord = lockedMonthsData[mKey] || lockedMonthsData[m];
        if (lockedRecord && lockedRecord.payrollRows && Array.isArray(lockedRecord.payrollRows) && lockedRecord.payrollRows.length > 0 && !ratesSnapshot) {
            return JSON.parse(JSON.stringify(lockedRecord.payrollRows));
        }

        const effectiveRates = ratesSnapshot || (lockedRecord && lockedRecord.rates ? lockedRecord.rates : staffSettings);

        const payrollRows = [];
        const [year, month] = m.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const fullDates = Array.from({length: daysInMonth}, (_, i) => {
            return { date: `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}` };
        });

        const isDec = m.slice(-2) === '12';
        const yearStr = String(year);

        staffList.forEach(([id, name]) => {
            const settings = effectiveRates[id] || effectiveRates[name] || { basic: 0, restDays: [] };
            const basicSalary = parseFloat(settings.basic);
            
            if (basicSalary <= 0) return; 
            
            const totalWorkingDays = 26;
            const hourlyRate = parseFloat((basicSalary / totalWorkingDays / 8).toFixed(2));

            let workedDays = 0;
            let totalOTPay = 0;

            const sObj = findStaffSetting(id, name);
            const staffDataMap = new Map();
            attendanceRowsForStaff(m, id, name, sObj).forEach(d => staffDataMap.set(d.date, d));

            fullDates.forEach(fd => {
                const d = staffDataMap.get(fd.date) || {};
                const dateObj = new Date(fd.date);
                const isPH = getPublicHolidayForStaff(fd.date, sObj);
                const restDays = getStaffEffectiveRestDays(sObj, settings);
                const isRD = restDays.includes(dateObj.getDay());

                let payType = "NM"; if (isPH) payType = "PH"; else if (isRD) payType = "RD";
                if (d.manualPayType && d.manualPayType !== "AUTO") payType = d.manualPayType;

                const totalTimeHrs = (d.totalMins || 0) / 60;
                if (totalTimeHrs > 0) workedDays++;

                let overlapOT = d.manualOverlap !== undefined && d.manualOverlap !== '' ? parseFloat(d.manualOverlap) : (parseFloat(d.overlapOT) || 0);
                let extraOT = d.manualExtra !== undefined && d.manualExtra !== '' ? parseFloat(d.manualExtra) : (parseFloat(d.extraOT) || 0);
                let totalOTRow = overlapOT + extraOT;

                let rowOTPay = 0;
                const otEligible = isStaffOtEligible(sObj, settings);

                if (d.manualOTPay !== null && d.manualOTPay !== undefined && d.manualOTPay !== '') {
                    // Manual HR override is always respected as a special condition
                    rowOTPay = parseFloat(d.manualOTPay) || 0;
                } else if (!otEligible) {
                    // Employees earning > RM4,000 without contractual entitlement are NOT eligible for automatic OT
                    rowOTPay = 0;
                } else {
                    const orp = basicSalary > 0 ? (basicSalary / 26) : 0;
                    const hrp = orp > 0 ? (orp / 8) : hourlyRate;

                    if (payType === "PH" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                        const normalHrs = Math.min(8, totalTimeHrs || 0);
                        const exceedHrs = Math.max(0, totalTimeHrs - 8) + totalOTRow;
                        rowOTPay = (normalHrs > 0 ? (2.0 * orp) : 0) + (exceedHrs * hrp * 3.0);
                    } else if (payType === "RD" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                        if (totalTimeHrs <= 4 && totalTimeHrs > 0) {
                            rowOTPay = 0.5 * orp + (totalOTRow * hrp * 2.0);
                        } else if (totalTimeHrs > 4) {
                            const exceedHrs = Math.max(0, totalTimeHrs - 8) + totalOTRow;
                            rowOTPay = 1.0 * orp + (exceedHrs * hrp * 2.0);
                        } else {
                            rowOTPay = totalOTRow * hrp * 2.0;
                        }
                    } else if (totalOTRow > 0) {
                        rowOTPay = totalOTRow * hrp * 1.5;
                    }
                }

                totalOTPay += rowOTPay;
            });

            // 1. Pro-rated basic calculation
            let basic = basicSalary;
            const staffObj = staffSettings[id] || staffSettings[name] || {};
            const resignDateStr = normalizeDateStr(staffObj.resignDate || staffObj.resignationDate);
            if (workedDays > 0 && workedDays < totalWorkingDays && (
                (staffObj.joinedDate && staffObj.joinedDate.slice(0, 7) === m) ||
                (resignDateStr && resignDateStr.slice(0, 7) === m)
            )) {
                basic = Math.round((basicSalary * (workedDays / totalWorkingDays)) * 100) / 100;
            }

            // 2. Fractional NPL deduction
            let unpaidDays = 0;
            const empMonthLeaves = leavesForStaff(name).filter(l => l.name === name && (l.status === 'Approved' || l.status === 'approved') && String(l.start).slice(0, 7) === m);
            empMonthLeaves.forEach(l => {
                unpaidDays += Number(l.unpaidDays) || (l.type === 'NPL' || /unpaid/i.test(l.type) ? Number(l.days) : 0);
            });
            const dailyRate = basicSalary / totalWorkingDays;
            const nplDeduction = Math.round(dailyRate * unpaidDays * 100) / 100;

            // 3. December Zero-MC award token
            let zeroMcAward = 0;
            if (isDec) {
                const confirmDate = staffObj.confirmDate ? String(staffObj.confirmDate).slice(0, 10) : '';
                const isConfirmed = !!(confirmDate && confirmDate <= yearStr + '-12-31');
                const empYearMc = leavesForStaff(name).filter(l => l.name === name && (l.status === 'Approved' || l.status === 'approved') && String(l.start).slice(0, 4) === yearStr && (l.type === 'MC' || /medical/i.test(l.type) || l.type === 'Sick Leave'));
                if (isConfirmed && empYearMc.length === 0) {
                    zeroMcAward = 300.0;
                }
            }

            // 4. Gross pay including fixed allowance
            const fixedAllowance = parseFloat(settings.fixedAllowance || staffObj.fixedAllowance) || 0;
            const fixedAllowances = settings.fixedAllowances || staffObj.fixedAllowances || [];
            const grossPay = Math.round((basic - nplDeduction + fixedAllowance + zeroMcAward + totalOTPay) * 100) / 100;

            if (grossPay > 0 || workedDays > 0) {
                const age = Number(staffObj.ageSource || staffObj.age) || 30;
                const stat = calcStatutory({ basic: (basic - nplDeduction), fixedAllowances, grossPay }, age);
                const totalEmpDed = Math.round((stat.epfEmp + stat.socsoEmp + stat.eisEmp + (stat.pcb || 0)) * 100) / 100;
                const totalEmprCont = Math.round((stat.epfEmpr + stat.socsoEmpr + stat.eisEmpr) * 100) / 100;

                // Claims reimbursement (passed from settings or staffObj or 0)
                const claimsReimbursement = Number(settings.claimsReimbursement || staffObj.claimsReimbursement) || 0;
                const nettPay = Math.round((grossPay - totalEmpDed + claimsReimbursement) * 100) / 100;

                payrollRows.push([
                    m, id, name, basicSalary, workedDays || totalWorkingDays, totalOTPay.toFixed(2), grossPay.toFixed(2),
                    stat.epfEmp.toFixed(2), stat.socsoEmp.toFixed(2), stat.eisEmp.toFixed(2), totalEmpDed.toFixed(2),
                    stat.epfEmpr.toFixed(2), stat.socsoEmpr.toFixed(2), stat.eisEmpr.toFixed(2), totalEmprCont.toFixed(2),
                    nettPay.toFixed(2),
                    (stat.pcb || 0).toFixed(2), nplDeduction.toFixed(2), claimsReimbursement.toFixed(2), zeroMcAward.toFixed(2)
                ]);
            }
        });
        return payrollRows;
    }

    async function recommendAttendanceHOD(m, comp) {
        m = m || $('#monthSelect').val();
        comp = comp || $('#attendanceCompanySelect').val() || 'ALL';
        if(!m || !m.includes('-')) {
            alert('Please select an attendance month first.');
            return;
        }
        const compLabel = (comp && comp !== 'ALL') ? ` for ${comp}` : '';
        if(!confirm(`Submit verified attendance for ${m}${compLabel} as HOD recommendation?\n\nThis will advance the attendance report to HR for final review and payroll autolock.`)) return;

        const ratesSnapshot = {};
        staffList.forEach(([id, name]) => {
            const s = staffSettings[id] || staffSettings[name] || { basic: 0, restDays: [] };
            ratesSnapshot[id] = { basic: s.basic, restDays: s.restDays };
            ratesSnapshot[name] = { basic: s.basic, restDays: s.restDays }; 
        });

        $('#syncStatus').html('<span class="spinner-border spinner-border-sm"></span> Submitting recommendation...').show();

        const res = await apiPost('approveAttendanceHOD', { month: m, company: comp, rates: ratesSnapshot });
        if(res.status === 'success') {
            const mKey = (comp && comp !== 'ALL') ? `${m}__${comp}` : m;
            lockedMonthsData[mKey] = res.data || { month: m, company: comp, approvalStatus: 'Pending HR', status: 'Pending HR', rates: ratesSnapshot, hodApprover: currentUser?.name || 'HOD', hodApprovedAt: new Date().toISOString() };
            renderDashboard();
            fetchActionCount();
            $('#syncStatus').html('<i class="bi bi-check-circle-fill text-success"></i> Recommended by HOD').fadeOut(4000);
        } else {
            $('#syncStatus').html(`<i class="bi bi-exclamation-triangle-fill text-danger"></i> Error: ${res.message}`).show();
            alert(res.message || 'Failed to recommend attendance.');
        }
    }

    async function approveAttendanceHR(m, comp) {
        m = m || $('#monthSelect').val();
        comp = comp || $('#attendanceCompanySelect').val() || 'ALL';
        if(!m || !m.includes('-')) {
            alert('Please select an attendance month first.');
            return;
        }
        const compLabel = (comp && comp !== 'ALL') ? ` for ${comp}` : '';
        if(!confirm(`Give final HR approval and permanently AUTOLOCK attendance for ${m}${compLabel}?\n\nThis will freeze salary rates, calculate pro-rated basic wages, deduct fractional NPL, transition approved claims <= 20th to Paid, apply statutory deductions, and post payroll.`)) return;

        const ratesSnapshot = {};
        staffList.forEach(([id, name]) => {
            const s = staffSettings[id] || staffSettings[name] || { basic: 0, restDays: [] };
            const basic = parseFloat(s.basic) || 0;
            const hourly = basic > 0 ? parseFloat((basic / 26 / 8).toFixed(2)) : 0;
            const snap = {
                basic: basic,
                hourly: hourly,
                fixedAllowance: parseFloat(s.fixedAllowance) || 0,
                fixedAllowances: s.fixedAllowances || [],
                otEligible: isStaffOtEligible(s),
                restDays: s.restDays || [],
                role: s.role || 'Staff',
                age: s.ageSource || s.age || 30
            };
            ratesSnapshot[id] = snap;
            ratesSnapshot[name] = snap; 
        });

        const payrollData = generatePayrollData(m, ratesSnapshot);
        const timestamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
        const payload = {
            month: m,
            company: comp,
            data: {
                rates: ratesSnapshot,
                payrollRows: payrollData,
                savedAt: timestamp,
                company: comp,
                approvalStatus: 'Locked',
                status: 'Locked',
                hrApprover: currentUser?.name || 'HR Admin',
                hrApprovedAt: new Date().toISOString()
            },
            payrollData: payrollData
        };

        $('#syncStatus').html('<span class="spinner-border spinner-border-sm"></span> Approving & Autolocking Payroll...').show();

        const res = await apiPost('approveAttendanceHR', payload);
        if(res.status === 'success') {
            const mKey = (comp && comp !== 'ALL') ? `${m}__${comp}` : m;
            lockedMonthsData[mKey] = payload.data;
            CacheManager.saveLockedMonths(lockedMonthsData);
            CacheManager.saveAttendanceRows(globalData);
            syncMonthSelectDropdowns();
            renderDashboard();
            if ($('#summary-dashboard').hasClass('active')) renderSummaryDashboard();
            fetchActionCount();
            $('#syncStatus').html('<i class="bi bi-lock-fill text-success"></i> Approved & Autolocked for Payroll').fadeOut(4000);
        } else {
            $('#syncStatus').html(`<i class="bi bi-exclamation-triangle-fill text-danger"></i> Error: ${res.message}`).show();
            alert(res.message || 'Failed to approve attendance.');
        }
    }

    async function rejectAttendanceApproval(m, comp) {
        m = m || $('#monthSelect').val();
        comp = comp || $('#attendanceCompanySelect').val() || 'ALL';
        if(!m || !m.includes('-')) {
            alert('Please select an attendance month first.');
            return;
        }
        const reason = prompt('Please enter the reason for returning the attendance report to Draft:');
        if(reason === null) return;
        if(!reason.trim()) { alert('A rejection reason is required.'); return; }

        $('#syncStatus').html('<span class="spinner-border spinner-border-sm"></span> Returning report...').show();

        const res = await apiPost('rejectAttendanceApproval', { month: m, company: comp, reason: reason.trim() });
        if(res.status === 'success') {
            const mKey = (comp && comp !== 'ALL') ? `${m}__${comp}` : m;
            if(lockedMonthsData[mKey]) {
                lockedMonthsData[mKey].approvalStatus = 'Rejected';
                lockedMonthsData[mKey].status = 'Rejected';
                lockedMonthsData[mKey].rejectionReason = reason.trim();
            } else {
                delete lockedMonthsData[mKey];
            }
            renderDashboard();
            fetchActionCount();
            $('#syncStatus').html('<i class="bi bi-arrow-counterclockwise text-warning"></i> Returned to Draft').fadeOut(4000);
        } else {
            $('#syncStatus').html(`<i class="bi bi-exclamation-triangle-fill text-danger"></i> Error: ${res.message}`).show();
            alert(res.message || 'Failed to return attendance.');
        }
    }

    async function lockCurrentMonth(m, comp) {
        return approveAttendanceHR(m, comp);
    }
    
    async function unlockCurrentMonth(m, comp) {
        m = m || $('#monthSelect').val();
        comp = comp || $('#attendanceCompanySelect').val() || 'ALL';
        if(!m || !m.includes('-')) {
            alert('Please select an attendance month first.');
            return;
        }
        const compLabel = (comp && comp !== 'ALL') ? ` for ${comp}` : '';
        if(!confirm(`Are you sure you want to UNLOCK ${m}${compLabel}? \n\nThis will allow new uploads to overwrite the data and update to the latest salary rates.`)) return;
        
        $('#syncStatus').html('<span class="spinner-border spinner-border-sm"></span> Unlocking...').show();
        
        const res = await apiPost('unlockMonth', { month: m, company: comp });
        if(res.status === 'success') {
            const mKey = (comp && comp !== 'ALL') ? `${m}__${comp}` : m;
            delete lockedMonthsData[mKey]; 
            CacheManager.saveLockedMonths(lockedMonthsData, true);
            renderDashboard(); 
            if ($('#summary-dashboard').hasClass('active')) renderSummaryDashboard();
            fetchActionCount();
            $('#syncStatus').html('<i class="bi bi-unlock-fill text-success"></i> Unlocked successfully').fadeOut(4000);
        }
    }

    function renderDashboard() {
        let m = $('#monthSelect').val(); const sId = $('#staffSelect').val();
        if (!m || !m.includes('-')) {
            if ($('#monthSelect option').length <= 1) {
                const monthsSet = new Set();
                if (typeof globalData !== 'undefined' && Array.isArray(globalData)) {
                    globalData.forEach(r => {
                        const dateStr = r.date || r.Date || (Array.isArray(r) ? r[0] : '');
                        if (dateStr && String(dateStr).length >= 7) monthsSet.add(String(dateStr).substring(0, 7));
                    });
                }
                if (typeof lockedMonthsData !== 'undefined') {
                    Object.keys(lockedMonthsData).forEach(k => { 
                        const baseM = k.includes('__') ? k.split('__')[0] : k;
                        if (baseM.includes('-')) monthsSet.add(baseM); 
                    });
                }
                const sortedMonths = Array.from(monthsSet).sort().reverse();
                sortedMonths.forEach(mon => {
                    if (!$(`#monthSelect option[value="${mon}"]`).length) {
                        $('#monthSelect').append(`<option value="${mon}">${formatMonthStr(mon)}</option>`);
                    }
                });
            }
            const firstOpt = $('#monthSelect option').filter((_, el) => el.value && el.value.includes('-')).first().val();
            if (firstOpt) {
                $('#monthSelect').val(firstOpt);
                m = firstOpt;
            }
        }
        const container = $('#reportContainer').empty(); currentProcessedRows = []; 
        if(!m || !m.includes('-')) {
            container.html(`
                <div class="alert alert-info text-center p-4 my-4 rounded-3 shadow-sm">
                    <i class="bi bi-calendar-event fs-2 text-primary d-block mb-2"></i>
                    <h5 class="fw-bold">No Attendance Month Selected</h5>
                    <p class="text-muted mb-0">Please select an attendance month from the dropdown above or upload raw biometric attendance data.</p>
                </div>
            `);
            return;
        }

        if (!currentUser && typeof window !== 'undefined' && window.currentUser) {
            currentUser = window.currentUser;
        }
        const role = currentUser?.role || 'Staff';
        const isHodOrAdmin = ['Admin', 'HR', 'HOD', 'Supervisor'].includes(role);
        const isHrOrAdmin = ['Admin', 'HR'].includes(role);

        const selComp = $('#attendanceCompanySelect').val() || 'ALL';
        const compKey = (selComp && selComp !== 'ALL') ? `${m}__${selComp}` : m;
        const monthRec = lockedMonthsData[compKey] || (selComp === 'ALL' ? lockedMonthsData[m] : null) || lockedMonthsData[m];
        const approvalStatus = monthRec ? (monthRec.approvalStatus || (monthRec.rates ? 'Locked' : 'Draft')) : 'Draft';
        const isLocked = approvalStatus === 'Locked';
        const effectiveSettings = (monthRec && monthRec.rates) ? monthRec.rates : staffSettings;

        const unlockBtn = isAdmin && isLocked ? `<button class="btn btn-sm btn-outline-danger py-1 px-3 fw-bold shadow-sm" onclick="unlockCurrentMonth('${m}', '${selComp}')"><i class="bi bi-unlock-fill me-1"></i> Unlock Month</button>` : '';

        // Stepper & Status Banner
        let statusBadge = `<span class="badge bg-secondary px-3 py-2 fs-6"><i class="bi bi-pencil-square me-1"></i>Draft / Unlocked</span>`;
        let step1Class = 'border-primary bg-primary text-white';
        let step1Icon = 'bi-1-circle-fill';
        let step2Class = 'border-secondary text-muted bg-light';
        let step2Icon = 'bi-2-circle';
        let hodNote = 'Awaiting HOD Review';
        let hrNote = 'Awaiting Autolock';

        if (approvalStatus === 'Pending HR') {
            statusBadge = `<span class="badge bg-warning text-dark px-3 py-2 fs-6"><i class="bi bi-clock-history me-1"></i>Pending HR Approval</span>`;
            step1Class = 'border-success bg-success text-white';
            step1Icon = 'bi-check-circle-fill';
            step2Class = 'border-warning bg-warning text-dark';
            step2Icon = 'bi-2-circle-fill';
            hodNote = `Recommended by ${monthRec.hodApprover || 'HOD'}`;
            hrNote = 'Awaiting HR Decision';
        } else if (approvalStatus === 'Locked') {
            statusBadge = `<span class="badge bg-success px-3 py-2 fs-6"><i class="bi bi-lock-fill me-1"></i>Locked for Payroll</span>`;
            step1Class = 'border-success bg-success text-white';
            step1Icon = 'bi-check-circle-fill';
            step2Class = 'border-success bg-success text-white';
            step2Icon = 'bi-check-circle-fill';
            hodNote = monthRec.hodApprover ? `Recommended by ${monthRec.hodApprover}` : 'HOD Verified';
            hrNote = `Approved by ${monthRec.hrApprover || 'HR'}`;
        } else if (approvalStatus === 'Rejected') {
            statusBadge = `<span class="badge bg-danger px-3 py-2 fs-6"><i class="bi bi-x-circle me-1"></i>Returned / Rejected</span>`;
            step1Class = 'border-danger bg-danger text-white';
            step1Icon = 'bi-x-circle-fill';
            hodNote = monthRec.rejectionReason ? `Returned: ${monthRec.rejectionReason}` : 'Requires revision';
        }

        let topActionBtn = '';
        if (!isLocked) {
            if (approvalStatus === 'Pending HR') {
                if (isHrOrAdmin) {
                    topActionBtn = `
                        <button id="btnApproveAttendanceHRTop" class="btn btn-sm btn-success py-1 px-3 fw-bold shadow-sm" onclick="approveAttendanceHR('${m}', '${selComp}')">
                            <i class="bi bi-shield-lock-fill me-1"></i> Approve &amp; Autolock (HR)
                        </button>
                        <button id="btnRejectAttendanceTop" class="btn btn-sm btn-outline-danger py-1 px-3 fw-bold shadow-sm ms-1" onclick="rejectAttendanceApproval('${m}', '${selComp}')">
                            <i class="bi bi-arrow-counterclockwise me-1"></i> Return / Reject
                        </button>
                    `;
                }
            } else {
                // Draft or Rejected
                if (isHodOrAdmin) {
                    topActionBtn = `
                        <button id="btnRecommendAttendanceHODTop" class="btn btn-sm btn-primary py-1 px-3 fw-bold shadow-sm" onclick="recommendAttendanceHOD('${m}', '${selComp}')">
                            <i class="bi bi-send-check-fill me-1"></i> Recommend Attendance (HOD)
                        </button>
                    `;
                }
                if (isHrOrAdmin) {
                    topActionBtn += `
                        <button id="btnApproveAttendanceHRDirectTop" class="btn btn-sm btn-outline-success py-1 px-3 fw-bold shadow-sm ms-1" onclick="approveAttendanceHR('${m}', '${selComp}')">
                            <i class="bi bi-shield-lock-fill me-1"></i> Direct Autolock (HR)
                        </button>
                    `;
                }
            }
        }

        const compScopePill = (selComp && selComp !== 'ALL') ? `<span class="badge bg-primary-subtle text-primary border px-2 py-1 ms-2"><i class="bi bi-building me-1"></i>${selComp}</span>` : '';

        const approvalBanner = `
        <div class="main-card p-3 mb-4 border rounded-3 bg-white shadow-sm" id="attendanceApprovalBanner">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-3">
                <div class="d-flex align-items-center gap-3">
                    <div class="fs-4 text-primary"><i class="bi bi-shield-check"></i></div>
                    <div>
                        <div class="fw-bold fs-6 text-dark d-flex align-items-center">Attendance Multi-Tier Approval Workflow · ${m} ${compScopePill}</div>
                        <div class="text-muted small">HOD Attendance Verification &rarr; HR Final Approval &rarr; Payroll Autolock</div>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    ${statusBadge}
                    ${topActionBtn}
                    ${unlockBtn}
                </div>
            </div>
        </div>`;
        // approvalBanner appended at bottom after tables

        const [year, month] = m.split('-').map(Number);
        if(!year || !month) return;
        
        const todayKl = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); // e.g. '2026-10-19'
        const currentMonthKl = todayKl.substring(0, 7);

        const daysInMonth = new Date(year, month, 0).getDate();
        let fullDates = Array.from({length: daysInMonth}, (_, i) => {
            const dStr = `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
            const obj = new Date(dStr); return { date: dStr, day: obj.toLocaleDateString('en-US', { weekday: 'long' }), dayIdx: obj.getDay() };
        });

        if (m === currentMonthKl) {
            fullDates = fullDates.filter(fd => fd.date <= todayKl);
        } else if (m > currentMonthKl) {
            fullDates = [];
        }

        const selDept = $('#attendanceDepartmentSelect').val() || 'ALL';

        const matchComp = (s, targetComp) => {
            if (!targetComp || targetComp === 'ALL') return true;
            if (!s) return false;
            const t = targetComp.trim().toLowerCase();
            const validTargets = new Set([t]);
            if (cachedCompanies && cachedCompanies.length) {
                const comp = cachedCompanies.find(c => 
                    (c.id && c.id.trim().toLowerCase() === t) ||
                    (c.code && c.code.trim().toLowerCase() === t) ||
                    (c.title && c.title.trim().toLowerCase() === t) ||
                    (c.name && c.name.trim().toLowerCase() === t)
                );
                if (comp) {
                    if (comp.id) validTargets.add(comp.id.trim().toLowerCase());
                    if (comp.code) validTargets.add(comp.code.trim().toLowerCase());
                    if (comp.title) validTargets.add(comp.title.trim().toLowerCase());
                    if (comp.name) validTargets.add(comp.name.trim().toLowerCase());
                }
            }
            const cName = (getStaffCompany(s) || '').trim().toLowerCase();
            const cId = (s.companyId || '').trim().toLowerCase();
            const cCompany = (s.company || '').trim().toLowerCase();
            const cCompName = (s.companyName || '').trim().toLowerCase();
            return validTargets.has(cName) || validTargets.has(cId) || validTargets.has(cCompany) || validTargets.has(cCompName);
        };

        const matchDept = (s, targetDept) => {
            if (!targetDept || targetDept === 'ALL') return true;
            if (!s) return false;
            const t = targetDept.trim().toLowerCase();
            const validTargets = new Set([t]);
            if (cachedDepartments && cachedDepartments.length) {
                const dept = cachedDepartments.find(d => 
                    (d.id && d.id.trim().toLowerCase() === t) ||
                    (d.code && d.code.trim().toLowerCase() === t) ||
                    (d.title && d.title.trim().toLowerCase() === t) ||
                    (d.name && d.name.trim().toLowerCase() === t)
                );
                if (dept) {
                    if (dept.id) validTargets.add(dept.id.trim().toLowerCase());
                    if (dept.code) validTargets.add(dept.code.trim().toLowerCase());
                    if (dept.title) validTargets.add(dept.title.trim().toLowerCase());
                    if (dept.name) validTargets.add(dept.name.trim().toLowerCase());
                }
            }
            const dName = (getStaffDepartment(s) || '').trim().toLowerCase();
            const dId = (s.departmentId || '').trim().toLowerCase();
            const dDept = (s.department || '').trim().toLowerCase();
            const dDeptName = (s.departmentName || '').trim().toLowerCase();
            return validTargets.has(dName) || validTargets.has(dId) || validTargets.has(dDept) || validTargets.has(dDeptName);
        };

        let subset = (sId === "ALL") ? staffList : staffList.filter(s => s[0] === sId || s[1] === sId || (findStaffSetting(s[0], s[1])?.biometricId === sId));

        // User requirement: Attendance dashboard should show the attendance based on the staff Joined date.
        // "without joined date also should not appear"
        subset = subset.filter(([id, name]) => {
            const sObj = findStaffSetting(id, name);
            const jDate = normalizeDateStr(sObj?.joinedDate || sObj?.joined);
            if (!jDate) return false;
            const rDate = normalizeDateStr(sObj?.resignDate || sObj?.resignationDate);
            if (rDate && rDate < m + '-01') return false;
            return true;
        });

        if (selComp !== 'ALL') {
            subset = subset.filter(([id, name]) => matchComp(findStaffSetting(id, name), selComp));
        }
        if (selDept !== 'ALL') {
            subset = subset.filter(([id, name]) => matchDept(findStaffSetting(id, name), selDept));
        }
        const staffSearchVal = ($('#attendanceStaffSearch').val() || '').trim().toLowerCase();
        if (staffSearchVal) {
            subset = subset.filter(([id, name]) => {
                const sObj = findStaffSetting(id, name) || {};
                const text = `${id} ${name} ${sObj.jobTitle || ''} ${sObj.employeeNo || ''} ${sObj.icNo || ''} ${sObj.biometricId || ''}`.toLowerCase();
                return text.includes(staffSearchVal);
            });
        }

        if (subset.length === 0) {
            container.append(`<div class="alert alert-light border text-center p-5 shadow-sm rounded-3"><i class="bi bi-person-x fs-1 text-muted mb-2 d-block"></i><h5 class="fw-bold">No Staff Found</h5><p class="text-muted mb-0">No matching staff attendance found for the selected company (${selComp}) and project/department (${selDept}).</p></div>`);
            return;
        }

        // Group subset by Company -> Department for structured review & approval
        const companyGroups = new Map();
        subset.forEach(([id, name]) => {
            const s = findStaffSetting(id, name) || {};
            const cName = getStaffCompany(s) || 'General Company';
            const dName = getStaffDepartment(s) || 'General Department';
            if (!companyGroups.has(cName)) companyGroups.set(cName, new Map());
            const deptMap = companyGroups.get(cName);
            if (!deptMap.has(dName)) deptMap.set(dName, []);
            deptMap.get(dName).push([id, name]);
        });

        companyGroups.forEach((deptMap, cName) => {
            let totalStaffInCompany = 0;
            deptMap.forEach(arr => { totalStaffInCompany += arr.length; });

            const compHeader = $(`
                <div class="company-attendance-section mb-4" data-company-name="${cName}">
                    <div class="d-flex align-items-center justify-content-between p-3 bg-light border rounded-3 mb-3 shadow-sm">
                        <div class="d-flex align-items-center gap-3">
                            <div class="bg-primary text-white p-2 rounded-3"><i class="bi bi-building fs-5"></i></div>
                            <div>
                                <h5 class="fw-bold mb-0 text-dark">${cName}</h5>
                                <span class="text-muted small">Company Attendance Verification</span>
                            </div>
                        </div>
                        <span class="badge bg-primary px-3 py-2 fs-6"><i class="bi bi-people-fill me-1"></i>${totalStaffInCompany} Staff</span>
                    </div>
                    <div class="company-depts-container"></div>
                </div>
            `);

            const deptsContainer = compHeader.find('.company-depts-container');

            deptMap.forEach((staffInDept, dName) => {
                const deptHeader = $(`
                    <div class="dept-attendance-section ms-md-3 mb-4" data-dept-name="${dName}">
                        <div class="d-flex align-items-center justify-content-between p-2 px-3 bg-white border-start border-4 border-info rounded-2 shadow-sm mb-3">
                            <div class="d-flex align-items-center gap-2">
                                <i class="bi bi-diagram-3-fill text-info fs-5"></i>
                                <span class="fw-bold fs-6 text-dark">${dName}</span>
                                ${deptMap.size > 1 ? `<span class="text-muted small">(${staffInDept.length} staff)</span>` : ''}
                            </div>
                        </div>
                        <div class="dept-staff-container"></div>
                    </div>
                `);

                const deptStaffContainer = deptHeader.find('.dept-staff-container');

                staffInDept.forEach(([id, name]) => {
                    const sObj = findStaffSetting(id, name);
                    const staffDataMap = new Map();
                    attendanceRowsForStaff(m, id, name, sObj).forEach(d => {
                        const dDate = normalizeDateStr(d.date);
                        staffDataMap.set(dDate, { ...d, date: dDate });
                    });
                    const staffLeaves = leavesForStaff(name, sObj?.employeeNo);
                    const settings = effectiveSettings[id] || effectiveSettings[name] || sObj || { basic: 0, restDays: [] };
                    const jDate = normalizeDateStr(settings.joinedDate || sObj?.joinedDate || sObj?.joined);

                    let hrSchedules = window.workSchedules || [];
                    if (!hrSchedules.length) {
                        try {
                            const raw = localStorage.getItem('hr_workSchedules') || localStorage.getItem('hr_custom_workSchedules');
                            if (raw) hrSchedules = JSON.parse(raw);
                        } catch (_) {}
                    }

                    let assignedShift = (sObj?.schedules && sObj.schedules.length) ? sObj.schedules.join(', ') : (sObj?.schedule || (settings?.schedules && settings.schedules.length ? settings.schedules.join(', ') : (settings?.schedule || '')));

                    if (!assignedShift && hrSchedules.length) {
                        const sComp = sObj?.company || sObj?.companyId || '';
                        const sBase = sObj?.workBase || '';
                        const found = hrSchedules.find(s => (s.companyId === sComp || !sComp) && (s.workBase === sBase || !sBase)) || hrSchedules[0];
                        if (found) {
                            assignedShift = found.code || found.title || found.name || '';
                        }
                    }

                    // Sunday is not Rest day by default, refer to the schedule for rest day
                    let staffRestDays = getStaffEffectiveRestDays(sObj, settings, hrSchedules);

                    const rDate = normalizeDateStr(settings.resignDate || settings.resignationDate || sObj?.resignDate || sObj?.resignationDate);

                    const staffDates = fullDates.filter(fd => {
                        // User requirement: "don't show staff attendance after the resignation date"
                        if (rDate && fd.date > rDate) return false;
                        return true;
                    });

                    if (staffDates.length === 0) return;

                    const mergedRows = staffDates.map(fd => {
                        // User requirement: "Period before the joined date should be appear as empty attendance."
                        if (jDate && fd.date < jDate) {
                            const rowData = {
                                id,
                                name,
                                date: fd.date,
                                day: fd.day,
                                payType: '—',
                                manualShift: 'AUTO',
                                rowClass: 'text-muted bg-light opacity-50',
                                remark: '',
                                in: '-',
                                out: '-',
                                totalHrs: '-',
                                totalMins: 0,
                                lateIn: '-',
                                earlyOut: '-',
                                payableHrs: '-',
                                overlapOT: 0,
                                extraOT: 0,
                                manualOTPay: null,
                                isBeforeJoin: true
                            };
                            currentProcessedRows.push(rowData);
                            return rowData;
                        }

                        const existing = staffDataMap.get(fd.date);
                        const isPH = getPublicHolidayForStaff(fd.date, sObj);
                        const restDays = staffRestDays;
                        
                        let autoPayType = "NM", baseRemark = "", rowClass = "";
                        if (isPH) { autoPayType = "PH"; baseRemark = isPH.name; rowClass = "holiday-row"; } 
                        else if (restDays.includes(fd.dayIdx)) { autoPayType = "RD"; baseRemark = "Rest Day"; rowClass = "rest-row"; }

                        let leaveOnDate = staffLeaves.find(l => {
                            if (fd.date < l.start || fd.date > l.end) return false;
                            if (l.name && name && l.name.trim().toLowerCase() === name.trim().toLowerCase()) return true;
                            if (sObj && sObj.employeeNo && l.employeeNo === sObj.employeeNo) return true;
                            return false;
                        });
                        if (leaveOnDate) {
                            autoPayType = leaveOnDate.type.split(' ')[0]; 
                            baseRemark = baseRemark ? baseRemark + `, ${leaveOnDate.type} (Approved)` : `${leaveOnDate.type} (Approved)`;
                            
                            if (leaveOnDate.type.startsWith('NPL')) {
                                rowClass = "table-danger text-danger fw-bold"; 
                            } else if (leaveOnDate.type.startsWith('MC')) {
                                rowClass = "table-warning text-dark fw-bold"; 
                            } else {
                                rowClass = "table-info text-primary fw-bold"; 
                            }
                        }

                        let finalPayType = existing && existing.manualPayType && existing.manualPayType !== "AUTO" ? existing.manualPayType : autoPayType;
                        
                        let finalRemark = baseRemark;
                        if (existing) {
                            let parts = [];
                            if (baseRemark) parts.push(baseRemark);
                            if (existing.autoRemark) parts.push(existing.autoRemark);
                            let defaultCombined = parts.join(", ");
                            let dbRem = existing.dbRemark || "";
                            finalRemark = (dbRem && dbRem !== defaultCombined && dbRem !== baseRemark && dbRem !== existing.autoRemark) ? dbRem : defaultCombined; 
                        }

                        let finalOverlap = existing && existing.manualOverlap !== undefined && String(existing.manualOverlap).trim() !== '' ? existing.manualOverlap : (existing ? existing.overlapOT : 0);
                        let finalExtra = existing && existing.manualExtra !== undefined && String(existing.manualExtra).trim() !== '' ? existing.manualExtra : (existing ? existing.extraOT : 0);
                        let finalOTPay = existing && existing.manualOTPay !== undefined && String(existing.manualOTPay).trim() !== '' ? existing.manualOTPay : null;

                        const hasClockIn = existing && existing.in && existing.in !== '-' && String(existing.in).trim() !== '';
                        const hasClockOut = existing && existing.out && existing.out !== '-' && String(existing.out).trim() !== '';
                        const hasAttendance = hasClockIn || hasClockOut;
                        const isApprovedLeave = Boolean(leaveOnDate);

                        const isToday = fd.date === todayKl;
                        const isFutureDate = fd.date > todayKl;
                        const singleAssignedShift = (assignedShift || '—').split(',')[0].trim();

                        let finalShift = 'Off / Rest';
                        if (isFutureDate) {
                            finalShift = '-';
                            finalPayType = '-';
                            rowClass = 'text-muted opacity-50';
                            finalRemark = '';
                        } else if (hasAttendance) {
                            if (existing && existing.manualShift && existing.manualShift !== 'AUTO') {
                                finalShift = existing.manualShift;
                            } else if (existing && existing.shift && existing.shift !== '-' && existing.shift !== 'Off / Rest') {
                                finalShift = existing.shift;
                            } else {
                                const sComp = getStaffCompany(sObj);
                                const calc = calculateStats(existing?.in || '-', existing?.out || '-', 'AUTO', sComp, sObj);
                                finalShift = (calc && calc.shift && calc.shift !== '-') ? calc.shift : singleAssignedShift;
                            }
                        } else if (isApprovedLeave) {
                            finalShift = leaveOnDate.type || 'Leave';
                        } else if (isPH) {
                            finalShift = isPH.name || 'Public Holiday';
                        } else if (isToday) {
                            // Today attendance will not be RD, just leave it blank because the attendance not yet sync to system
                            finalShift = (existing && existing.manualShift && existing.manualShift !== 'AUTO') ? existing.manualShift : '-';
                            if (!existing || !existing.manualPayType || existing.manualPayType === 'AUTO') {
                                finalPayType = '-';
                                rowClass = '';
                                finalRemark = '';
                            }
                        } else {
                            finalShift = 'Off / Rest';
                            if ((!existing || !existing.manualPayType || existing.manualPayType === 'AUTO') && (finalPayType === 'NM' || autoPayType === 'NM')) {
                                finalPayType = 'RD';
                                rowClass = 'rest-row';
                                if (!finalRemark) finalRemark = 'Off / Rest';
                            }
                        }

                        if (finalShift && finalShift.includes(',')) {
                            finalShift = finalShift.split(',')[0].trim();
                        }

                        const rowData = existing ? { ...existing, day: fd.day, payType: finalPayType, shift: finalShift, rowClass, remark: finalRemark, overlapOT: finalOverlap, extraOT: finalExtra, manualOTPay: finalOTPay }
                                                 : { id, name, date: fd.date, day: fd.day, payType: finalPayType, shift: finalShift, manualShift: 'AUTO', rowClass, remark: finalRemark, in: '-', out: '-', totalHrs: '-', totalMins: 0, lateIn: '-', earlyOut: '-', payableHrs: '-', overlapOT: 0, extraOT: 0, manualOTPay: null };
                        
                        currentProcessedRows.push(rowData); return rowData;
                    });
                    deptStaffContainer.append(buildTable(mergedRows, id, name, isLocked, effectiveSettings));
                });

                deptsContainer.append(deptHeader);
            });

            container.append(compHeader);
        });

        container.append(approvalBanner);

        if (!isLocked && currentProcessedRows.length > 0) {
            const role = currentUser?.role || 'Staff';
            const isHodOrAdmin = ['Admin', 'HR', 'HOD', 'Supervisor'].includes(role);
            const isHrOrAdmin = ['Admin', 'HR'].includes(role);

            let actionHtml = '';

            if (approvalStatus === 'Pending HR') {
                if (isHrOrAdmin) {
                    actionHtml = `
                    <div class="text-center mt-5 mb-5 p-4 bg-white border rounded-3 shadow-sm" id="attendanceApprovalActions">
                        <h5 class="fw-bold text-success mb-2"><i class="bi bi-shield-lock-fill me-2"></i>Stage 2: HR Final Approval &amp; Payroll Autolock</h5>
                        <p class="text-muted small mb-4" style="max-width: 650px; margin: 0 auto;">
                            HOD has recommended this attendance. Approving will permanently autolock attendance rates, calculate pro-rated basic wages, deduct fractional unpaid leave (NPL), transition approved claims up to 20th to Paid, and generate payroll rows.
                        </p>
                        <div class="d-flex justify-content-center gap-3 flex-wrap">
                            <button id="btnApproveAttendanceHR" class="btn btn-success btn-lg fw-bold shadow-sm px-4" onclick="approveAttendanceHR('${m}')">
                                <i class="bi bi-lock-fill me-2"></i> Approve &amp; Auto-Lock for Payroll (HR)
                            </button>
                            <button id="btnRejectAttendance" class="btn btn-outline-danger btn-lg fw-bold shadow-sm px-4" onclick="rejectAttendanceApproval('${m}')">
                                <i class="bi bi-arrow-counterclockwise me-2"></i> Return to HOD / Reject
                            </button>
                        </div>
                        <button id="saveLockBtn" style="display:none;" onclick="lockCurrentMonth('${m}')"></button>
                    </div>`;
                } else {
                    actionHtml = `
                    <div class="alert alert-info text-center mt-5 mb-5 p-4 shadow-sm border-info rounded-3">
                        <i class="bi bi-clock-history fs-3 d-block mb-2 text-info"></i>
                        <h6 class="fw-bold mb-1">Recommended by HOD (${monthRec?.hodApprover || 'HOD'})</h6>
                        <p class="small text-muted mb-0">This attendance report is awaiting final HR approval and payroll autolock.</p>
                        <button id="saveLockBtn" style="display:none;" onclick="lockCurrentMonth('${m}')"></button>
                    </div>`;
                }
            } else {
                // Draft or Rejected
                if (isHodOrAdmin) {
                    actionHtml = `
                    <div class="text-center mt-5 mb-5 p-4 bg-white border rounded-3 shadow-sm" id="attendanceApprovalActions">
                        <h5 class="fw-bold text-primary mb-2"><i class="bi bi-send-check-fill me-2"></i>Stage 1: HOD Review &amp; Recommendation</h5>
                        <p class="text-muted small mb-4" style="max-width: 650px; margin: 0 auto;">
                            Review all attendance, punch-clock hours, and OT adjustments above. Once verified, submit your HOD recommendation to forward this month to HR for autolock.
                        </p>
                        <div class="d-flex justify-content-center gap-3 flex-wrap">
                            <button id="btnRecommendAttendanceHOD" class="btn btn-primary btn-lg fw-bold shadow-sm px-4" onclick="recommendAttendanceHOD('${m}')">
                                <i class="bi bi-send-check-fill me-2"></i> Recommend Attendance (HOD)
                            </button>
                            ${isHrOrAdmin ? `
                            <button id="btnApproveAttendanceHRDirect" class="btn btn-success btn-lg fw-bold shadow-sm px-4" onclick="approveAttendanceHR('${m}')">
                                <i class="bi bi-shield-lock-fill me-2"></i> Approve &amp; Auto-Lock for Payroll (HR)
                            </button>` : ''}
                        </div>
                        <button id="saveLockBtn" style="display:none;" onclick="lockCurrentMonth('${m}')"></button>
                    </div>`;
                } else {
                    actionHtml = `
                    <div class="alert alert-light border text-center mt-5 mb-5 p-4 rounded-3">
                        <i class="bi bi-hourglass-split fs-3 d-block mb-2 text-muted"></i>
                        <h6 class="fw-bold mb-1">Attendance Report in Review</h6>
                        <p class="small text-muted mb-0">Awaiting HOD verification and recommendation for ${m}.</p>
                        <button id="saveLockBtn" style="display:none;" onclick="lockCurrentMonth('${m}')"></button>
                    </div>`;
                }
            }

            container.append(actionHtml);
        }

        if (isLocked) {
            const lockedInfo = `
            <div class="alert alert-success text-center mt-4 mb-5 p-3 shadow-sm border-success rounded-3">
                <i class="bi bi-shield-lock-fill fs-4 me-2"></i>
                <strong>Attendance Locked for Payroll.</strong> All timesheets, OT calculations, and statutory deductions for ${m} have been finalized and frozen.
            </div>`;
            container.append(lockedInfo);
        }
    }

    async function syncToGoogleSheets() {
        const m = $('#monthSelect').val();
        if (lockedMonthsData[m]) return; 

        const syncLabel = $('#syncStatus');
        syncLabel.html('<span class="spinner-border spinner-border-sm"></span> Syncing...').show();
        
        const rawPayload = globalData.map(d => ({ id: d.id, name: d.name, date: d.date, weekday: d.weekday || '', in: d.in, out: d.out, totalHrs: d.totalHrs }));
        
        const attPayload = globalData.map(r => {
            const rowMonth = r.date.substring(0, 7);
            const isLocked = !!lockedMonthsData[rowMonth];
            const effectiveSettings = isLocked ? lockedMonthsData[rowMonth].rates : staffSettings;
            const settings = effectiveSettings[r.id] || effectiveSettings[r.name] || { basic: 0, restDays: [] };
            
            const basicSalary = parseFloat(settings.basic) || 0;
            const hourlyRate = basicSalary > 0 ? parseFloat((basicSalary / 26 / 8).toFixed(2)) : 0;

            const sObj = findStaffSetting(r.id, r.name);
            const isPH = getPublicHolidayForStaff(r.date, sObj);
            const dateObj = new Date(r.date);
            const restDays = getStaffEffectiveRestDays(sObj, settings);
            const isRD = restDays.includes(dateObj.getDay());

            let payType = "NM"; if (isPH) payType = "PH"; else if (isRD) payType = "RD";
            if (r.manualPayType && r.manualPayType !== "AUTO") payType = r.manualPayType;

            const totalTimeHrs = (r.totalMins || 0) / 60;
            
            let overlapOT = parseFloat(r.manualOverlap);
            if (isNaN(overlapOT)) overlapOT = parseFloat(r.overlapOT);
            if (isNaN(overlapOT)) overlapOT = 0;

            let extraOT = parseFloat(r.manualExtra);
            if (isNaN(extraOT)) extraOT = parseFloat(r.extraOT);
            if (isNaN(extraOT)) extraOT = 0;

            let totalOTRow = overlapOT + extraOT;
            let rowPay = 0, colPHT1 = 0, colPHT2 = 0;

            if (r.manualOTPay !== null && r.manualOTPay !== undefined && String(r.manualOTPay).trim() !== '') {
                rowPay = parseFloat(r.manualOTPay) || 0;
                if (payType === "PH") { colPHT2 = totalOTRow; }
                else if (payType === "RD") { colPHT1 = Math.min(8, totalTimeHrs || 0); }
            } else {
                if (payType === "PH" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                    colPHT1 = 0; 
                    let parsedPayable = parseFloat(r.payableHrs);
                    if (isNaN(parsedPayable)) parsedPayable = 0;
                    colPHT2 = parsedPayable + totalOTRow; 
                    rowPay = colPHT2 * hourlyRate * 3.0;
                } else if (payType === "RD" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                    let rdBase = Math.min(8, totalTimeHrs || 0);
                    rowPay = (rdBase * hourlyRate * 2.0) + (totalOTRow * hourlyRate * 2.0);
                    colPHT1 = rdBase; 
                } else if (totalTimeHrs > 0 || totalOTRow > 0) {
                    rowPay = totalOTRow * hourlyRate * 1.5;
                }
            }

            if (isNaN(rowPay)) rowPay = 0;

            let rowDailyPay = 0;
            if (payType === "NM" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                rowDailyPay = parseFloat((basicSalary / 26).toFixed(2));
            }
            if (isNaN(rowDailyPay)) rowDailyPay = 0;
            
            let rowTotalPay = rowDailyPay + rowPay;

            let displayRemark = r.dbRemark || r.autoRemark || '';
            if (payType === "RD" && !displayRemark.includes("RD") && !displayRemark.toLowerCase().includes("rest day")) {
                displayRemark = displayRemark ? "RD, " + displayRemark : "RD";
            }

            return {
                id: r.id, name: r.name, date: r.date, 
                payType: r.manualPayType || 'AUTO', 
                manualShift: r.manualShift || 'AUTO',
                in: r.in, out: r.out, totalHrs: r.totalHrs, shift: r.shift || '-', 
                lateIn: r.lateIn, earlyOut: r.earlyOut, payableHrs: r.payableHrs, 
                overlapOT: overlapOT, extraOT: extraOT, 
                remark: displayRemark,
                totalOT: totalOTRow,            
                phT1: colPHT1,                  
                phT2: colPHT2,                  
                otPay: rowPay.toFixed(2),       
                totalPay: rowTotalPay.toFixed(2), 
                manualOTPay: r.manualOTPay || ''
            };
        });

        const [res1, res2] = await Promise.all([
            apiPost('saveData', rawPayload),
            apiPost('saveAttendance', attPayload)
        ]);
        if ((!res1 || res1.status === 'success') && (!res2 || res2.status === 'success')) {
            syncLabel.html('<i class="bi bi-cloud-check text-success"></i> Auto-Synced').show().fadeOut(4000);
        } else {
            syncLabel.html('<i class="bi bi-exclamation-triangle text-danger"></i> Sync Warning').show();
        }
    }

    function openEditModal(staffId, date) {
        const sObj = findStaffSetting(staffId);
        let record = globalData.find(d => isRecordForStaff(d, staffId, '', sObj) && d.date === date);
        if(!record) record = { in: '', out: '', remark: '', manualPayType: 'AUTO', manualShift: 'AUTO', overlapOT: 0, extraOT: 0, dbRemark: '', autoRemark: '' };

        $('#editStaffId').val(staffId); $('#editDate').val(date);
        $('#editIn').val(formatTimeForInput(record.in)); $('#editOut').val(formatTimeForInput(record.out));
        
        $('#editOverlap').val(record.manualOverlap || ''); $('#editOverlap').attr('placeholder', `Auto: ${record.overlapOT}`);
        $('#editExtra').val(record.manualExtra || ''); $('#editExtra').attr('placeholder', `Auto: ${record.extraOT}`);
        $('#editOTPay').val(isAdmin ? (record.manualOTPay || '') : '').prop('disabled', !isAdmin).attr('placeholder', 'Auto Calc').parent().toggle(isAdmin);
        
        $('#editShift').val(record.manualShift || 'AUTO'); 
        $('#editPayType').val(record.manualPayType || 'AUTO');
        $('#editRemark').val(record.dbRemark && record.dbRemark !== record.autoRemark ? record.dbRemark : (record.remark || ''));

        new bootstrap.Modal(document.getElementById('editRowModal')).show();
    }

    function saveRowEdit() {
        const staffId = $('#editStaffId').val(); const date = $('#editDate').val();
        const sObj = findStaffSetting(staffId);
        let record = globalData.find(d => isRecordForStaff(d, staffId, '', sObj) && d.date === date);
        if (!record) {
            const staffPair = staffList.find(s => s[0] === staffId);
            const staffName = staffPair ? staffPair[1] : (sObj ? sObj.name : staffId);
            record = { 
                id: staffId, 
                name: staffName, 
                date: date, 
                month: date.substring(0, 7),
                biometricId: sObj?.biometricId || staffId,
                employeeNo: sObj?.employeeNo || staffId
            };
            globalData.push(record);
        }

        const valIn = $('#editIn').val(); const valOut = $('#editOut').val();
        const manualShift = $('#editShift').val(); 
        
        record.in = valIn; record.out = valOut; 
        
        const sComp = getStaffCompany(sObj);
        const calc = calculateStats(valIn, valOut, manualShift, sComp, sObj);
        
        Object.assign(record, calc);
        record.autoRemark = calc.remark;
        record.manualShift = manualShift;

        record.manualOverlap = $('#editOverlap').val();
        record.manualExtra = $('#editExtra').val();
        if (isAdmin) record.manualOTPay = $('#editOTPay').val();
        record.manualPayType = $('#editPayType').val();
        record.dbRemark = $('#editRemark').val(); 

        bootstrap.Modal.getInstance(document.getElementById('editRowModal')).hide();
        CacheManager.saveAttendanceRows(globalData);
        renderDashboard(); 
        if ($('#summary-dashboard').hasClass('active')) renderSummaryDashboard();
        syncToGoogleSheets();  
    }

    function updateStaffAttendanceRemark(employeeObjOrName, date, remark) {
        if (!date) return;
        const cleanDate = String(date).trim();
        const cleanRemark = String(remark || '').trim();

        const empName = typeof employeeObjOrName === 'string' ? employeeObjOrName : (employeeObjOrName?.name || '');
        const empId = typeof employeeObjOrName === 'object' ? (employeeObjOrName?.employeeNo || employeeObjOrName?.id || empName) : empName;
        const sObj = findStaffSetting(empId, empName);

        let record = globalData.find(d => isRecordForStaff(d, empId, empName, sObj) && (d.date === cleanDate || d.Date === cleanDate));
        if (!record) {
            const staffPair = staffList.find(s => s[0] === empId || s[1] === empName);
            const resolvedName = staffPair ? staffPair[1] : (sObj ? sObj.name : empName);
            const resolvedId = staffPair ? staffPair[0] : (sObj ? (sObj.employeeNo || sObj.username || empId) : empId);
            record = {
                id: resolvedId,
                name: resolvedName,
                date: cleanDate,
                Date: cleanDate,
                month: cleanDate.substring(0, 7),
                biometricId: sObj?.biometricId || resolvedId,
                employeeNo: sObj?.employeeNo || resolvedId,
                in: '-',
                out: '-',
                totalHrs: '-',
                totalMins: 0,
                lateIn: '-',
                earlyOut: '-',
                payableHrs: '-',
                overlapOT: 0,
                extraOT: 0,
                manualOTPay: null,
                shift: '-',
                manualShift: 'AUTO',
                manualPayType: 'AUTO'
            };
            globalData.push(record);
        }

        record.dbRemark = cleanRemark;
        record.remark = cleanRemark;

        CacheManager.saveAttendanceRows(globalData);
        try {
            renderDashboard();
            if (typeof $ !== 'undefined' && $('#summary-dashboard').hasClass('active')) {
                renderSummaryDashboard();
            }
        } catch (e) {
            console.warn('Attendance re-render warning:', e);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('hr-attendance-remark-updated', {
                detail: { employee: empName, date: cleanDate, remark: cleanRemark }
            }));
        }
    }

    function buildTable(rows, id, name, isLocked, effectiveSettings) {
        const canViewPay = isAdmin;
        let sumOverlap = 0, sumExtra = 0, sumPH2 = 0, sumPH3 = 0, sumTotalOT = 0, sumOTPay = 0, sumTotalPay = 0;
        const basicSalary = canViewPay ? parseFloat((effectiveSettings[id] || effectiveSettings[name] || {}).basic || 0) : 0;
        const hourlyRate = basicSalary > 0 ? parseFloat((basicSalary / 26 / 8).toFixed(2)) : 0;

        const rowHtml = rows.map(d => {
            let overlapOT = parseFloat(d.overlapOT) || 0;
            let extraOT = parseFloat(d.extraOT) || 0;
            let totalOTRow = overlapOT + extraOT;
            
            let rowOTPay = 0, totalTimeHrs = (d.totalMins || 0) / 60;
            const payType = d.payType;

            let rowPH2 = 0, rowPH3 = 0;

            if (canViewPay && d.manualOTPay !== null && d.manualOTPay !== undefined && String(d.manualOTPay).trim() !== '') {
                rowOTPay = parseFloat(d.manualOTPay) || 0;
            } else {
                if (payType === "PH" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                    let parsedPayable = parseFloat(d.payableHrs);
                    if (isNaN(parsedPayable)) parsedPayable = 0;
                    rowPH2 = 0; 
                    rowPH3 = parsedPayable + totalOTRow; 
                    rowOTPay = rowPH3 * hourlyRate * 3.0;
                } else if (payType === "RD" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                    rowPH2 = Math.min(8, totalTimeHrs || 0);
                    rowOTPay = (rowPH2 * hourlyRate * 2.0) + (totalOTRow * hourlyRate * 2.0);
                } else if (totalTimeHrs > 0 || totalOTRow > 0) {
                    rowOTPay = totalOTRow * hourlyRate * 1.5;
                }
            }

            if (isNaN(rowOTPay)) rowOTPay = 0;

            let rowDailyPay = 0;
            if (payType === "NM" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                rowDailyPay = parseFloat((basicSalary / 26).toFixed(2));
            }
            if (isNaN(rowDailyPay)) rowDailyPay = 0;

            let rowTotalPay = rowDailyPay + rowOTPay;

            let displayRemark = d.remark || "";
            if (payType === "RD" && !displayRemark.includes("RD") && !displayRemark.toLowerCase().includes("rest day") && !displayRemark.toLowerCase().includes("off")) {
                displayRemark = displayRemark ? "RD, " + displayRemark : "RD";
            }

            sumOverlap += overlapOT; sumExtra += extraOT; sumPH2 += rowPH2; sumPH3 += rowPH3; sumTotalOT += totalOTRow; sumOTPay += rowOTPay; sumTotalPay += rowTotalPay;

            let hasManualOTPay = canViewPay && d.manualOTPay !== null && d.manualOTPay !== undefined && String(d.manualOTPay).trim() !== '';
            let overrideBadge = hasManualOTPay || (d.manualShift && d.manualShift !== 'AUTO') ? ' <i class="bi bi-info-circle text-warning" title="Manual Override"></i>' : '';
            let actionBtn = (isLocked || d.isBeforeJoin) ? '<td class="action-col text-center text-muted">—</td>' : `<td class="action-col text-center"><button class="btn btn-sm btn-outline-primary py-0" onclick="openEditModal('${id}', '${d.date}')"><i class="bi bi-pencil-square"></i></button></td>`;
            
            let shiftDisplay = d.shift || '-';
            if (d.manualShift && d.manualShift !== 'AUTO') {
                shiftDisplay += ' <i class="bi bi-asterisk text-danger small"></i>';
            }

            return `<tr class="${d.rowClass || ''}">
                <td>${formatDateDMY(d.date)}</td><td>${d.day}</td><td>${d.payType}</td>
                <td>${d.in}</td><td>${d.out}</td><td>${d.totalHrs}</td>
                <td>${shiftDisplay}</td><td>${d.lateIn}</td><td>${d.earlyOut}</td>
                <td>${d.payableHrs}</td><td>${d.overlapOT}</td><td>${d.extraOT}</td>
                <td class="col-ot">${rowPH2 > 0 ? rowPH2.toFixed(1) : '-'}</td>
                <td class="col-ot">${rowPH3 > 0 ? rowPH3.toFixed(1) : '-'}</td>
                <td class="fw-bold">${totalOTRow > 0 ? totalOTRow.toFixed(1) : '-'}</td>
                ${canViewPay ? `<td class="col-money">${rowOTPay > 0 ? rowOTPay.toFixed(2) + overrideBadge : '-'}</td><td class="col-money text-success fw-bold">${rowTotalPay > 0 ? rowTotalPay.toFixed(2) : '-'}</td>` : ''}
                <td class="small text-muted">${displayRemark}</td>
                ${actionBtn}
            </tr>`;
        }).join('');

        let actionHeader = isLocked ? '' : '<th class="action-col">Action</th>';
        let actionFooter = isLocked ? '' : '<td class="action-col"></td>';

        const s = findStaffSetting(id, name);
        const bioBadge = (s && s.biometricId) ? `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle font-monospace ms-2 small" title="Biometric ID"><i class="bi bi-fingerprint me-1"></i>${s.biometricId}</span>` : '';

        return `<div class="staff-section"><div class="staff-header"><h5 class="staff-name">${name}${bioBadge}</h5><span class="days-badge">${rows.length} Days</span></div><div class="table-responsive"><table class="custom-table"><thead><tr><th>Date</th><th>Day</th><th>Type</th><th>1st In</th><th>Last Out</th><th>Total</th><th>Shift</th><th>Late</th><th>Early</th><th>Payable</th><th>Overlap</th><th>Extra</th><th>PH 2.0</th><th>PH 3.0</th><th>Total OT</th>${canViewPay ? '<th class="text-end">OT Pay (RM)</th><th class="text-end">Total Pay (RM)</th>' : ''}<th>Remark</th>${actionHeader}</tr></thead><tbody>${rowHtml}</tbody><tfoot style="background:#f8f9fa; font-weight:700;"><tr><td colspan="10" class="text-end text-uppercase text-muted small">Total</td><td class="col-ot">${sumOverlap.toFixed(1)}</td><td class="col-ot">${sumExtra.toFixed(1)}</td><td class="col-ot">${sumPH2.toFixed(1)}</td><td class="col-ot">${sumPH3.toFixed(1)}</td><td class="col-ot fw-bold">${sumTotalOT.toFixed(1)}</td>${canViewPay ? `<td class="col-money">${sumOTPay.toFixed(2)}</td><td class="col-money text-success">${sumTotalPay.toFixed(2)}</td>` : ''}<td></td>${actionFooter}</tr></tfoot></table></div></div>`;
    }

    function handleReportExport() {
        const type = $('#reportTypeSelect').val();
        if (type === 'monthly') {
            exportToExcel($('#exportMonthStart').val());
        } else if (type === 'ot_claim') {
            exportOTClaimForm($('#exportMonthStart').val());
        } else {
            exportSummaryRange($('#exportMonthStart').val(), $('#exportMonthEnd').val());
        }
    }

    async function exportOTClaimForm(selectedMonth) {
        const XLSX = (await import('xlsx-js-style')).default;
        const wb = XLSX.utils.book_new();
        const m = selectedMonth || $('#exportMonthStart').val();
        if (!m) { alert("Please select a month before exporting."); return; }

        const [year, month] = m.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const fullDates = Array.from({length: daysInMonth}, (_, i) => {
            const dStr = `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
            const obj = new Date(dStr); return { date: dStr, day: obj.toLocaleDateString('en-US', { weekday: 'long' }), dayIdx: obj.getDay() };
        });

        const staffGroups = {};
        staffList.forEach(([id, name]) => { staffGroups[id] = { name: name }; });

        Object.keys(staffGroups).sort((a,b) => staffGroups[a].name.localeCompare(staffGroups[b].name)).forEach(id => {
            const staff = staffGroups[id]; const name = staff.name;
            
            const isLocked = !!lockedMonthsData[m];
            const effectiveSettings = isLocked ? lockedMonthsData[m].rates : staffSettings;
            const settings = effectiveSettings[id] || effectiveSettings[name] || { basic: 0, restDays: [] };

            // --- NEW: SKIP INACTIVE/NO ATTENDANCE STAFF ---
            const sObj = findStaffSetting(id, name);
            const staffDataMap = new Map();
            let hasAttendance = false;
            
            attendanceRowsForStaff(m, id, name, sObj).forEach(d => {
                staffDataMap.set(d.date, d);
                // Check if they actually clocked in or out at least once this month
                if (d.in && d.in !== '-' && String(d.in).trim() !== '') hasAttendance = true;
                if (d.out && d.out !== '-' && String(d.out).trim() !== '') hasAttendance = true;
            });

            // If they have zero attendance records, skip generating a sheet for them!
            if (!hasAttendance) return;
            // ----------------------------------------------

            const formatMonthStrXl = (mStr) => {
                const mNames = ["Jan", "Feb", "Mac", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const [yyyy, mm] = mStr.split('-');
                return `${mNames[parseInt(mm)-1]} ${yyyy.substring(2)}`;
            };
            const monthLabel = formatMonthStrXl(m);

            const sheetData = [];
            sheetData.push([`Staff OT Claim Form - ${monthLabel}`]); 
            sheetData.push(["Employee Name", name]);                      
            sheetData.push([]);
            sheetData.push(["Date", "Day", "Type", "In", "Out", "Total", "Shift", "Late", "Early", "OT (Hrs)", "Remark"]);

            fullDates.forEach(fd => {
                const d = staffDataMap.get(fd.date) || {};
                const isPH = getPublicHolidayForStaff(fd.date, sObj);
                const restDays = getStaffEffectiveRestDays(sObj, settings);
                const isRD = restDays.includes(fd.dayIdx);
                
                let payType = "NM"; if (isPH) payType = "PH"; else if (isRD) payType = "RD";
                if (d.manualPayType && d.manualPayType !== "AUTO") payType = d.manualPayType;

                let leaveOnDate = leavesForStaff(name).find(l => l.name === name && fd.date >= l.start && fd.date <= l.end);
                if (leaveOnDate) { payType = leaveOnDate.type.split(' ')[0]; }

                sheetData.push([
                    formatDateDMY(fd.date), fd.day, payType, d.in || '-', d.out || '-', d.totalHrs || '-', 
                    d.shift || '-', d.lateIn || '-', d.earlyOut || '-', "", ""
                ]);
            });

            const ws = XLSX.utils.aoa_to_sheet(sheetData);
            ws['!cols'] = [{wch:12}, {wch:12}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:18}, {wch:8}, {wch:8}, {wch:12}, {wch:35}];
            
            // --- EXCEL STYLING ENGINE ---
            const borderBox = {
                top: { style: "thin", color: { rgb: "000000" } },
                bottom: { style: "thin", color: { rgb: "000000" } },
                left: { style: "thin", color: { rgb: "000000" } },
                right: { style: "thin", color: { rgb: "000000" } }
            };

            for (let key in ws) {
                if (key.startsWith('!')) continue; 
                
                let cell = ws[key];
                let rowNum = parseInt(key.replace(/[a-zA-Z]/g, ''));
                cell.s = cell.s || {}; 

                if (rowNum >= 4) {
                    cell.s.border = borderBox;
                    
                    if (rowNum === 4) {
                        cell.s.font = { bold: true };
                        cell.s.alignment = { horizontal: "center", vertical: "center" };
                        cell.s.fill = { fgColor: { rgb: "E9ECEF" } }; 
                    } else {
                        if (!key.startsWith('K')) {
                            cell.s.alignment = { horizontal: "center", vertical: "center" };
                        } else {
                            cell.s.alignment = { vertical: "center" }; 
                        }
                    }
                } else if (rowNum === 1 || rowNum === 2) {
                    cell.s.font = { bold: true };
                }
            }

            let safeName = name.replace(/[\/\\\?\*\]\[]/g, "").substring(0, 30);
            if(safeName.length === 0) safeName = "Staff " + id;
            if(wb.SheetNames.includes(safeName)) safeName = safeName.substring(0,27) + "_" + id.substring(0,2);
            XLSX.utils.book_append_sheet(wb, ws, safeName);
        });

        if (wb.SheetNames.length === 0) { alert("No staff attendance data found for this month."); return; }
        XLSX.writeFile(wb, `Staff_OT_Claim_${m}.xlsx`);
    }

    async function exportSummaryRange(startM, endM) {
        const XLSX = (await import('xlsx-js-style')).default;
        const wb = XLSX.utils.book_new();
        if (!startM || !endM) { alert("Please select a valid month range."); return; }
        if (startM > endM) { alert("Start month must be before or equal to End month."); return; }

        const allMonths = [...new Set(globalData.map(d => d.month).filter(m => m && m !== "Unknown" && m.includes('-')))].sort();
        const monthsToProcess = allMonths.filter(m => m >= startM && m <= endM);
        if (monthsToProcess.length === 0) { alert("No data found for the selected range."); return; }

        const unlocked = monthsToProcess.filter(m => !lockedMonthsData[m]);
        if (unlocked.length > 0) {
            if (!confirm(`Warning: The following months are not locked: ${unlocked.join(', ')}.\n\nUn-locked months will use the current live salary rates. Do you want to proceed anyway?`)) {
                return;
            }
        }

        const formatMonthStr = (mStr) => {
            const monthNames = ["Jan", "Feb", "Mac", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const [yyyy, mm] = mStr.split('-'); return `${monthNames[parseInt(mm)-1]} ${yyyy.substring(2)}`;
        };

        const staffGroups = {};
        staffList.forEach(([id, name]) => { staffGroups[name] = { id, name, monthlyData: {} }; });

        monthsToProcess.forEach(m => {
            const isLocked = !!lockedMonthsData[m];
            const effectiveSettings = isLocked ? lockedMonthsData[m].rates : staffSettings;

            const [year, month] = m.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const fullDates = Array.from({length: daysInMonth}, (_, i) => {
                const dStr = `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
                const obj = new Date(dStr); return { date: dStr, dayIdx: obj.getDay() };
            });

            Object.keys(staffGroups).forEach(name => {
                const staff = staffGroups[name]; const id = staff.id;
                const settings = effectiveSettings[id] || effectiveSettings[name] || { basic: 0, restDays: [] };
                const basicSalary = parseFloat(settings.basic) || 0;
                const hourlyRate = basicSalary > 0 ? parseFloat((basicSalary / 26 / 8).toFixed(2)) : 0;

                let nmOTHrs = 0, nmOTPay = 0, rdOTHrs = 0, rdOTPay = 0;
                let phT1Hrs = 0, phT1Pay = 0, phT2Hrs = 0, phT2Pay = 0;
                let staffTotalPay = 0; 

                const sObj = findStaffSetting(id, name);
                const rDate = normalizeDateStr(settings.resignDate || settings.resignationDate || sObj?.resignDate || sObj?.resignationDate);
                const staffDataMap = new Map();
                attendanceRowsForStaff(m, id, name, sObj).forEach(d => staffDataMap.set(d.date, d));

                fullDates.forEach(fd => {
                    if (rDate && fd.date > rDate) return;
                    const d = staffDataMap.get(fd.date) || {};
                    const isPH = getPublicHolidayForStaff(fd.date, sObj);
                    const restDays = getStaffEffectiveRestDays(sObj, settings);
                    const isRD = restDays.includes(fd.dayIdx);
                    
                    let payType = "NM"; if (isPH) payType = "PH"; else if (isRD) payType = "RD";
                    if (d.manualPayType && d.manualPayType !== "AUTO") payType = d.manualPayType;

                    const totalTimeHrs = (d.totalMins || 0) / 60;
                    
                    let overlapOT = parseFloat(d.manualOverlap);
                    if (isNaN(overlapOT)) overlapOT = parseFloat(d.overlapOT);
                    if (isNaN(overlapOT)) overlapOT = 0;

                    let extraOT = parseFloat(d.manualExtra);
                    if (isNaN(extraOT)) extraOT = parseFloat(d.extraOT);
                    if (isNaN(extraOT)) extraOT = 0;

                    let totalOTRow = overlapOT + extraOT;
                    let rowPay = 0, colPHT1 = 0, colPHT2 = 0;

                    if (d.manualOTPay !== null && d.manualOTPay !== undefined && String(d.manualOTPay).trim() !== '') {
                        rowPay = parseFloat(d.manualOTPay) || 0;
                        if (payType === "PH") {
                            phT2Hrs += totalOTRow; phT2Pay += rowPay; 
                        } else if (payType === "RD") {
                            rdOTHrs += totalOTRow; rdOTPay += rowPay;
                        } else {
                            nmOTHrs += totalOTRow; nmOTPay += rowPay;
                        }
                    } else {
                        if (payType === "PH" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                            colPHT1 = 0; 
                            let parsedPayable = parseFloat(d.payableHrs);
                            if (isNaN(parsedPayable)) parsedPayable = 0;
                            colPHT2 = parsedPayable + totalOTRow; 
                            rowPay = colPHT2 * hourlyRate * 3.0;
                            phT2Hrs += colPHT2; phT2Pay += rowPay;
                        } else if (payType === "RD" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                            let rdBase = Math.min(8, totalTimeHrs || 0);
                            rowPay = (rdBase * hourlyRate * 2.0) + (totalOTRow * hourlyRate * 2.0);
                            rdOTHrs += (rdBase + totalOTRow); 
                            rdOTPay += rowPay;
                        } else if (totalTimeHrs > 0 || totalOTRow > 0) {
                            rowPay = totalOTRow * hourlyRate * 1.5;
                            nmOTHrs += totalOTRow; nmOTPay += rowPay;
                        }
                    }

                    if (isNaN(rowPay)) rowPay = 0;

                    let rowDailyPay = 0;
                    if (payType === "NM" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                        rowDailyPay = parseFloat((basicSalary / 26).toFixed(2));
                    }
                    if (isNaN(rowDailyPay)) rowDailyPay = 0;
                    
                    staffTotalPay += (rowDailyPay + rowPay);
                });

                const totalOTPay = nmOTPay + rdOTPay + phT1Pay + phT2Pay;
                const totalPayout = staffTotalPay;
                
                const stat = calcStatutory(totalPayout);

                staff.monthlyData[m] = {
                    basic: basicSalary, hourlyRate, nmOTHrs, nmOTPay, rdOTHrs, rdOTPay, 
                    phT1Hrs, phT1Pay, phT2Hrs, phT2Pay, totalOTPay: (nmOTPay + rdOTPay + phT1Pay + phT2Pay), 
                    totalPayout: staffTotalPay, epfEmp: stat.epfEmp, socsoEmp: stat.socsoEmp, eisEmp: stat.eisEmp
                };
                staff.latestBasic = basicSalary;
            });
        });

        const activeStaffNames = Object.keys(staffGroups).filter(name => {
            let hasPayout = false;
            monthsToProcess.forEach(m => {
                if (staffGroups[name].monthlyData[m] && staffGroups[name].monthlyData[m].totalPayout > 0) {
                    hasPayout = true;
                }
            });
            return hasPayout;
        }).sort();

        if (activeStaffNames.length === 0) { alert("No staff members have a payout > RM 0.00 for the selected range."); return; }

        const sumSheet = [];
        let row1 = ["", "", "", "", ""];
        let row2 = ["No.", "Name", "Basic Salary", "OT Hrs", "OT Rate"];
        
        monthsToProcess.forEach(m => {
            row1.push(formatMonthStr(m), "");
            row2.push("Hours", "Amount");
        });
        
        sumSheet.push(row1);
        sumSheet.push(row2);

        let gTotals = {}; 
        monthsToProcess.forEach(m => { gTotals[m] = { hrs: 0, amt: 0 }; });

        const fmtHrs = (val) => { return val > 0 ? (Math.round(val * 2) / 2).toFixed(2) : ""; };
        const fmtAmt = (val) => { return val > 0 ? val.toFixed(2) : ""; };

        activeStaffNames.forEach((name, i) => {
            const staff = staffGroups[name];
            
            let rNormal = ["", "", "", "Normal 1.5", ""];
            let rRD = ["", "", "", "RD 2.0", ""];
            let rPHT3 = ["", "", "", "PH T2 (3.0x)", ""]; 
            let rPHT2 = ["", "", "", "PH T1 (2.0x)", ""]; 
            let rTotal = ["", "", "", "Total OT Pay", ""];
            
            rNormal[0] = i + 1;
            rNormal[1] = name;
            rNormal[2] = staff.latestBasic > 0 ? staff.latestBasic.toFixed(2) : "0.00"; 

            monthsToProcess.forEach(m => {
                const data = staff.monthlyData[m];
                if (!data) {
                    rNormal.push("", ""); rRD.push("", ""); rPHT3.push("", ""); rPHT2.push("", ""); rTotal.push("", "");
                    return;
                }

                const rate15 = data.hourlyRate * 1.5;
                const rate20 = data.hourlyRate * 2.0;
                const rate30 = data.hourlyRate * 3.0;

                if (data.hourlyRate > 0) {
                    rNormal[4] = rate15.toFixed(2);
                    rRD[4] = rate20.toFixed(2);
                    rPHT3[4] = rate30.toFixed(2);
                    rPHT2[4] = rate20.toFixed(2);
                }

                rNormal.push(fmtHrs(data.nmOTHrs), fmtAmt(data.nmOTPay));
                rRD.push(fmtHrs(data.rdOTHrs), fmtAmt(data.rdOTPay));
                rPHT3.push(fmtHrs(data.phT2Hrs), fmtAmt(data.phT2Pay)); 
                rPHT2.push(fmtHrs(data.phT1Hrs), fmtAmt(data.phT1Pay)); 

                const totalStaffHrs = data.nmOTHrs + data.rdOTHrs + data.phT2Hrs + data.phT1Hrs;
                const totalStaffAmt = data.nmOTPay + data.rdOTPay + data.phT2Pay + data.phT1Pay;
                
                rTotal.push(fmtHrs(totalStaffHrs), fmtAmt(totalStaffAmt));

                gTotals[m].hrs += totalStaffHrs;
                gTotals[m].amt += totalStaffAmt;
            });

            sumSheet.push(rNormal, rRD, rPHT3, rPHT2, rTotal, []); 
        });

        let rGrand = ["", "Grand Total OT Pay", "", "", ""];
        monthsToProcess.forEach(m => {
            rGrand.push(fmtHrs(gTotals[m].hrs), fmtAmt(gTotals[m].amt));
        });
        sumSheet.push(rGrand);

        const wsSum = XLSX.utils.aoa_to_sheet(sumSheet);
        
        // --- STYLING ENGINE FOR SUMMARY REPORT ---
        const borderBox = {
            top: { style: "thin", color: { rgb: "000000" } }, bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } }, right: { style: "thin", color: { rgb: "000000" } }
        };

        for (let key in wsSum) {
            if (key.startsWith('!')) continue;
            let cell = wsSum[key];
            let rowNum = parseInt(key.replace(/[a-zA-Z]/g, ''));
            if (!cell) continue;
            
            cell.s = cell.s || {};
            cell.s.border = borderBox; // Draw borders on all active cells
            
            if (rowNum === 1 || rowNum === 2) {
                cell.s.font = { bold: true };
                cell.s.alignment = { horizontal: "center", vertical: "center" };
                cell.s.fill = { fgColor: { rgb: "E9ECEF" } };
            } else {
                if (key.startsWith('A') || key.startsWith('B')) {
                    cell.s.alignment = { horizontal: "left", vertical: "center" }; // Keep Names left-aligned
                } else {
                    cell.s.alignment = { horizontal: "center", vertical: "center" }; // Center everything else
                }
            }
        }
        // ------------------------------------------

        let cols = [{wch:5}, {wch:30}, {wch:15}, {wch:15}, {wch:12}];
        monthsToProcess.forEach(() => { cols.push({wch:12}, {wch:15}); });
        wsSum['!cols'] = cols;

        XLSX.utils.book_append_sheet(wb, wsSum, "Summary Report");
        
        let rangeStr = monthsToProcess.length > 1 ? `${startM}_to_${endM}` : startM;
        XLSX.writeFile(wb, `Payroll_Summary_${rangeStr}.xlsx`);
    }

    async function exportToExcel(selectedMonth) {
        const XLSX = (await import('xlsx-js-style')).default;
        const wb = XLSX.utils.book_new();
        const m = selectedMonth || $('#exportMonthStart').val();
        if (!m) { alert("Please select a month before exporting."); return; }

        if (!lockedMonthsData[m]) {
            if (!confirm(`Warning: The report for ${m} has not been locked.\n\nIt will export using the current live salary rates. Do you want to proceed anyway?`)) {
                return;
            }
        }

        const isLocked = !!lockedMonthsData[m];
        const effectiveSettings = isLocked ? lockedMonthsData[m].rates : staffSettings;

        const now = new Date();
        const exportDateStr = `${now.toLocaleDateString('en-US')}, ${now.toLocaleTimeString('en-US')}`;

        const [year, month] = m.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const fullDates = Array.from({length: daysInMonth}, (_, i) => {
            const dStr = `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
            const obj = new Date(dStr); return { date: dStr, day: obj.toLocaleDateString('en-US', { weekday: 'long' }), dayIdx: obj.getDay() };
        });

        const staffGroups = {};
        staffList.forEach(([id, name]) => { staffGroups[id] = { id: id, name: name }; });

        const summaryData = [];
        const toHM = (mins) => {
            if (mins <= 0) return "00:00";
            mins = Math.round(mins);
            return `${Math.floor(mins/60).toString().padStart(2,'0')}:${(mins%60).toString().padStart(2,'0')}`;
        };

        Object.keys(staffGroups).sort((a,b) => staffGroups[a].name.localeCompare(staffGroups[b].name)).forEach(id => {
            const staff = staffGroups[id]; const name = staff.name;
            const settings = effectiveSettings[id] || effectiveSettings[name] || { basic: 0, restDays: [] };
            const basicSalary = parseFloat(settings.basic) || 0;
            const hourlyRate = basicSalary > 0 ? parseFloat((basicSalary / 26 / 8).toFixed(2)) : 0;

            const formatMonthStrXl = (mStr) => {
                const mNames = ["Jan", "Feb", "Mac", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const [yyyy, mm] = mStr.split('-');
                return `${mNames[parseInt(mm)-1]} ${yyyy.substring(2)}`;
            };
            const monthLabel = formatMonthStrXl(m);

            const sheetData = [];
            sheetData.push([`Export Date: ${exportDateStr}`, "", "", "", "", "", "", "", "", "Enhanced OT Logic" + (isLocked ? " (LOCKED)" : "")]);
            sheetData.push([`OT & Payroll Calculation - ${monthLabel}`]); 
            sheetData.push(["Employee Name", name]);                      
            sheetData.push(["Basic Salary (RM)", basicSalary.toFixed(2)]);
            sheetData.push(["Hourly Rate (RM)", hourlyRate.toFixed(2)]);
            sheetData.push(["Calendar Days in Month", `${daysInMonth} Days`]);
            sheetData.push(["OT Rule", "1 hr lunch + 30 mins 2nd rest if gross > 12 hrs; OT rounded down to 0.5 hr blocks"]);
            sheetData.push([]);
            sheetData.push(["Date", "Day", "Pay Type", "In", "Out", "Gross", "Lunch", "2nd Rest", "Total Rest", "Net Worked", "Shift", "Late", "Early", "Payable", "Overlap", "Extra OT", "Total OT", "PH T1 (2.0x)", "PH T2 (3.0x)", "OT Pay (RM)", "Total Pay (RM)", "Remark"]);

            let staffExtraOT = 0, staffOverlapOT = 0, staffTotalOT = 0;
            let nmOTHrs = 0, nmOTPay = 0, rdOTHrs = 0, rdOTPay = 0;
            let phT1Hrs = 0, phT1Pay = 0, phT2Hrs = 0, phT2Pay = 0;
            let workedDays = 0, staffTotalPay = 0; 

            const sObj = findStaffSetting(id, name);
            const rDate = normalizeDateStr(settings.resignDate || settings.resignationDate || sObj?.resignDate || sObj?.resignationDate);
            const staffDataMap = new Map();
            attendanceRowsForStaff(m, id, name, sObj).forEach(d => staffDataMap.set(d.date, d));

            fullDates.forEach(fd => {
                if (rDate && fd.date > rDate) return;
                const d = staffDataMap.get(fd.date) || {};
                const isPH = getPublicHolidayForStaff(fd.date, sObj);
                const restDays = getStaffEffectiveRestDays(sObj, settings);
                const isRD = restDays.includes(fd.dayIdx);
                
                let payType = "NM"; if (isPH) payType = "PH"; else if (isRD) payType = "RD";
                if (d.manualPayType && d.manualPayType !== "AUTO") payType = d.manualPayType;

                let remark = ""; let baseRemark = "";
                if (isPH) baseRemark = isPH.name; else if (isRD) baseRemark = "Rest Day";
                
                if (d.id) {
                    let parts = [];
                    if (baseRemark) parts.push(baseRemark);
                    if (d.autoRemark) parts.push(d.autoRemark);
                    let defaultCombined = parts.join(", ");
                    let dbRem = d.dbRemark || "";
                    remark = (dbRem && dbRem !== defaultCombined && dbRem !== baseRemark && dbRem !== d.autoRemark) ? dbRem : defaultCombined;
                } else remark = baseRemark;

                const totalTimeHrs = (d.totalMins || 0) / 60;
                let lunchStr = "00:00", rest2Str = "00:00", totalRestStr = "00:00", netWorkedStr = "00:00";
                
                if (totalTimeHrs > 0) {
                    workedDays++;
                    let lunchMins = 60; let rest2Mins = totalTimeHrs >= 12.0 ? 30 : 0;
                    let totalRestMins = lunchMins + rest2Mins;
                    lunchStr = toHM(lunchMins); rest2Str = toHM(rest2Mins); totalRestStr = toHM(totalRestMins);
                    netWorkedStr = toHM(Math.max(0, d.totalMins - totalRestMins));
                }

                let overlapOT = parseFloat(d.manualOverlap);
                if (isNaN(overlapOT)) overlapOT = parseFloat(d.overlapOT);
                if (isNaN(overlapOT)) overlapOT = 0;

                let extraOT = parseFloat(d.manualExtra);
                if (isNaN(extraOT)) extraOT = parseFloat(d.extraOT);
                if (isNaN(extraOT)) extraOT = 0;

                let totalOTRow = overlapOT + extraOT;
                
                let rowPay = 0, colPHT1 = 0, colPHT2 = 0, rowTotalOT = 0;

                if (d.manualOTPay !== null && d.manualOTPay !== undefined && String(d.manualOTPay).trim() !== '') {
                    rowPay = parseFloat(d.manualOTPay) || 0;
                    rowTotalOT = totalOTRow;
                    if (payType === "PH") {
                        phT2Hrs += totalOTRow; phT2Pay += rowPay; colPHT2 = totalOTRow;
                    } else if (payType === "RD") {
                        rdOTHrs += totalOTRow; rdOTPay += rowPay;
                    } else {
                        nmOTHrs += totalOTRow; nmOTPay += rowPay;
                    }
                } else {
                    if (payType === "PH" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                        colPHT1 = 0; 
                        let parsedPayable = parseFloat(d.payableHrs);
                        if (isNaN(parsedPayable)) parsedPayable = 0;
                        colPHT2 = parsedPayable + totalOTRow; 
                        rowPay = colPHT2 * hourlyRate * 3.0;
                        rowTotalOT = colPHT1 + colPHT2;
                        phT1Hrs += colPHT1; phT1Pay += p1;
                        phT2Hrs += colPHT2; phT2Pay += p2;
                    } else if (payType === "RD" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                        let rdBase = Math.min(8, totalTimeHrs || 0);
                        rowPay = (rdBase * hourlyRate * 2.0) + (totalOTRow * hourlyRate * 2.0);
                        rowTotalOT = rdBase + totalOTRow;
                        rdOTHrs += (rdBase + totalOTRow); rdOTPay += rowPay;
                        colPHT1 = rdBase; 
                    } else if (totalTimeHrs > 0 || totalOTRow > 0) {
                        rowPay = totalOTRow * hourlyRate * 1.5;
                        rowTotalOT = totalOTRow;
                        nmOTHrs += totalOTRow; nmOTPay += rowPay;
                    }
                }
                
                staffOverlapOT += overlapOT; staffExtraOT += extraOT; staffTotalOT += rowTotalOT;

                let payableDec = d.payableHrs ? d.payableHrs : "-";
                const fmtHrsXl = (val) => { return val > 0 ? (Math.round(val * 2) / 2).toFixed(2) : '-'; };

                let rowDailyPay = 0;
                if (payType === "NM" && (totalTimeHrs > 0 || totalOTRow > 0)) {
                    rowDailyPay = parseFloat((basicSalary / 26).toFixed(2));
                }
                if (isNaN(rowDailyPay)) rowDailyPay = 0;
                
                let rowTotalPay = rowDailyPay + rowPay;
                staffTotalPay += rowTotalPay; 

                sheetData.push([
                    formatDateDMY(fd.date), fd.day, payType, d.in||'-', d.out||'-', d.totalHrs||'-', lunchStr, rest2Str, totalRestStr, netWorkedStr,
                    d.shift||'-', d.lateIn||'-', d.earlyOut||'-', payableDec, fmtHrsXl(overlapOT), fmtHrsXl(extraOT), 
                    fmtHrsXl(rowTotalOT), colPHT1 > 0 ? fmtHrsXl(colPHT1) : '-', colPHT2 > 0 ? fmtHrsXl(colPHT2) : '-', 
                    rowPay.toFixed(2), rowTotalPay.toFixed(2), remark
                ]);
            });

            const totalOTPay = nmOTPay + rdOTPay + phT1Pay + phT2Pay;
            const totalPayout = staffTotalPay; 

            // Spacer row
            sheetData.push([]); 
            
            // Push summary metrics to the bottom
            const bottomStartRow = sheetData.length + 1;
            sheetData.push([`PAYROLL SUMMARY - ${monthLabel}`]);
            sheetData.push(["Employee Name", name]);            
            sheetData.push(["Basic Salary (RM)", basicSalary]);
            sheetData.push(["Worked Days", workedDays]);
            sheetData.push(["Overlap OT (hrs)", staffOverlapOT]);
            sheetData.push(["Extra OT (hrs)", staffExtraOT]);
            sheetData.push(["PH T1 (2.0x) Hours", phT1Hrs]);
            sheetData.push(["PH T2 (3.0x) Hours", phT2Hrs]);
            sheetData.push(["TOTAL OT (hrs)", staffTotalOT]);
            sheetData.push(["TOTAL OT PAY (RM)", Number(totalOTPay.toFixed(2))]);
            sheetData.push(["GRAND TOTAL PAY (RM)", Number(totalPayout.toFixed(2))]); 

            if (totalPayout > 0) {
                const ws = XLSX.utils.aoa_to_sheet(sheetData);
                
                // --- STYLING ENGINE FOR MONTHLY REPORT TABS ---
                const borderBox = {
                    top: { style: "thin", color: { rgb: "000000" } }, bottom: { style: "thin", color: { rgb: "000000" } },
                    left: { style: "thin", color: { rgb: "000000" } }, right: { style: "thin", color: { rgb: "000000" } }
                };

                const dataStartRow = 9; // Row 9 is the Header row
                const dataEndRow = 9 + fullDates.length; 

                for (let key in ws) {
                    if (key.startsWith('!')) continue;
                    let cell = ws[key];
                    let rowNum = parseInt(key.replace(/[a-zA-Z]/g, ''));
                    if (!cell) continue;
                    
                    cell.s = cell.s || {};
                    
                    if (rowNum < dataStartRow) {
                        if (key.startsWith('A')) cell.s.font = { bold: true };
                    } else if (rowNum >= dataStartRow && rowNum <= dataEndRow) {
                        cell.s.border = borderBox;
                        if (rowNum === dataStartRow) {
                            cell.s.font = { bold: true };
                            cell.s.alignment = { horizontal: "center", vertical: "center" };
                            cell.s.fill = { fgColor: { rgb: "E9ECEF" } };
                        } else {
                            if (!key.startsWith('V')) { // Column 22 = V (Remark)
                                cell.s.alignment = { horizontal: "center", vertical: "center" };
                            } else {
                                cell.s.alignment = { vertical: "center" };
                            }
                        }
                    } else if (rowNum >= bottomStartRow) {
                        if (key.startsWith('A')) cell.s.font = { bold: true };
                        if (ws[key].v && ws[key].v.toString().includes('TOTAL PAY')) cell.s.font = { bold: true };
                    }
                }
                // ----------------------------------------------
                
                ws['!cols'] = [{wch:12}, {wch:10}, {wch:10}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:10}, {wch:10}, {wch:10}, {wch:16}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:10}, {wch:10}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:35}];
                let safeName = name.replace(/[\/\\\?\*\]\[]/g, "").substring(0, 30);
                if(safeName.length === 0) safeName = "Staff " + id;
                if(wb.SheetNames.includes(safeName)) safeName = safeName.substring(0,27) + "_" + id.substring(0,2);
                XLSX.utils.book_append_sheet(wb, ws, safeName);

                summaryData.push({ 
                    name, basic: basicSalary, hourlyRate, workedDays, 
                    nmOTHrs, nmOTPay, rdOTHrs, rdOTPay, 
                    phT1Hrs, phT1Pay, phT2Hrs, phT2Pay, 
                    totalOTPay, totalPayout 
                });
            }
        });

        if (summaryData.length === 0) { alert("No staff members have a payout > RM 0.00 for this month."); return; }

        const summarySheet = [];
        summarySheet.push(["Employee", "Worked Days", "Normal OT (Hrs)", "Rest Day OT (Hrs)", "PH T1 (2.0x)", "PH T2 (3.0x)", "Total OT (RM)", "Total Payout"]);
        
        let gWorked = 0, gNmOTHrs = 0, gRdOTHrs = 0, gPHT1 = 0, gPHT2 = 0, gOTPay = 0, gTotalPayout = 0;
        const fmtHrs = (val) => { return val > 0 ? (Math.round(val * 2) / 2).toFixed(2) : '0'; };
        
        summaryData.forEach(s => {
            gWorked += s.workedDays; gNmOTHrs += s.nmOTHrs; gRdOTHrs += s.rdOTHrs; gPHT1 += s.phT1Hrs; gPHT2 += s.phT2Hrs; gOTPay += s.totalOTPay; gTotalPayout += s.totalPayout;
            summarySheet.push([
                s.name, s.workedDays, 
                fmtHrs(s.nmOTHrs), fmtHrs(s.rdOTHrs), fmtHrs(s.phT1Hrs), fmtHrs(s.phT2Hrs), 
                s.totalOTPay ? s.totalOTPay.toFixed(2) : '0', 
                s.totalPayout ? s.totalPayout.toFixed(2) : '0'
            ]);
        });
        
        const wsSummary = XLSX.utils.aoa_to_sheet(summarySheet);
        
        // --- STYLING ENGINE FOR MASTER SUMMARY TAB ---
        const borderBox = {
            top: { style: "thin", color: { rgb: "000000" } }, bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } }, right: { style: "thin", color: { rgb: "000000" } }
        };
        for (let key in wsSummary) {
            if (key.startsWith('!')) continue;
            let cell = wsSummary[key];
            let rowNum = parseInt(key.replace(/[a-zA-Z]/g, ''));
            if (!cell) continue;
            
            cell.s = cell.s || {};
            cell.s.border = borderBox;
            
            if (rowNum === 1) {
                cell.s.font = { bold: true };
                cell.s.alignment = { horizontal: "center", vertical: "center" };
                cell.s.fill = { fgColor: { rgb: "E9ECEF" } };
            } else {
                if (key.startsWith('A')) {
                    cell.s.alignment = { horizontal: "left", vertical: "center" };
                } else {
                    cell.s.alignment = { horizontal: "center", vertical: "center" };
                }
            }
        }
        // ---------------------------------------------
        
        wsSummary['!cols'] = [{wch:30}, {wch:12}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:15}];
        XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
        XLSX.writeFile(wb, `Monthly_Attendance_${m}${isLocked ? '_LOCKED' : ''}.xlsx`);
    }

   function renderStaffMgmt() {
        const container = $('#staffCardsContainer').empty(); 
        populateStaffFilters();
        
        // 1. Gather all unique staff names strictly from backend staffSettings
        let allStaffNames = Object.keys(staffSettings);
        if (allStaffNames.length === 0) {
            if (typeof window !== 'undefined' && window.staffSettings && Object.keys(window.staffSettings).length > 0) {
                staffSettings = window.staffSettings;
                allStaffNames = Object.keys(staffSettings);
            } else {
                const cachedBoot = CacheManager.getBootstrap();
                if (cachedBoot && cachedBoot.staffSettings && Object.keys(cachedBoot.staffSettings).length > 0) {
                    staffSettings = cachedBoot.staffSettings;
                    if (typeof window !== 'undefined') window.staffSettings = staffSettings;
                    allStaffNames = Object.keys(staffSettings);
                }
            }
        }

        if (allStaffNames.length === 0) {
            container.html('<div class="p-4 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading staff profiles...</div>');
            apiPost('getStaff', {}).then(res => {
                if (res && res.status === 'success' && res.data && Object.keys(res.data).length > 0) {
                    staffSettings = res.data;
                    if (typeof window !== 'undefined') window.staffSettings = staffSettings;
                    CacheManager.saveBootstrap({ staffSettings });
                    renderStaffMgmt();
                } else {
                    container.html('<div class="p-4 text-center text-muted">No staff records found.</div>');
                }
            }).catch(() => {
                container.html('<div class="p-4 text-center text-muted">Unable to load staff records.</div>');
            });
            return;
        }
        let displayStaffNames = allStaffNames;

        // Filter to subordinates if viewing Team Directory (scope === 'team')
        if (currentStaffScope === 'team' && currentUser) {
            const subs = getSubordinateNames(currentUser.name);
            displayStaffNames = allStaffNames.filter(name => subs.has(String(name).trim().toUpperCase()));
            $('#btnAddStaff').hide();
            $('#pageTitle').text('Team Directory');
            $('#staff-mgmt .staff-toolbar label[for="staffSearch"]').html('<i class="bi bi-search me-1"></i>Team Member Search');
        } else {
            $('#btnAddStaff').toggle(isAdmin);
            $('#pageTitle').text('Employee Management');
            $('#staff-mgmt .staff-toolbar label[for="staffSearch"]').html('<i class="bi bi-search me-1"></i>Staff Search');
        }
        
        // 2. Sort Logic: Active first, Resigned at the bottom, then alphabetical
        displayStaffNames.sort((a, b) => {
            const statusA = (staffSettings[a] && staffSettings[a].status) ? staffSettings[a].status : "Active";
            const statusB = (staffSettings[b] && staffSettings[b].status) ? staffSettings[b].status : "Active";
            
            if (statusA === "Active" && statusB === "Resigned") return -1;
            if (statusA === "Resigned" && statusB === "Active") return 1;
            
            return a.localeCompare(b);
        });

        if (currentStaffViewMode === 'table') {
            const tableWrapper = $(`
                <div class="table-responsive bg-white rounded-3 shadow-sm border mb-3">
                    <table class="table table-hover align-middle staff-mgmt-table mb-0">
                        <thead class="table-light">
                            <tr>
                                <th scope="col" style="min-width: 200px;">EMPLOYEE</th>
                                <th scope="col" style="min-width: 170px;">ORGANISATION</th>
                                <th scope="col" style="min-width: 160px;">ROLE &amp; GRADE</th>
                                <th scope="col" style="min-width: 130px;">STATUS</th>
                                <th scope="col" style="min-width: 220px;" class="text-end">ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody id="staffTableBody"></tbody>
                    </table>
                </div>
            `);
            const tbody = tableWrapper.find('#staffTableBody');

            displayStaffNames.forEach((name) => {
                const s = staffSettings[name] || { basic: 0, restDays: [], status: 'Active' };

                const compName = getStaffCompany(s);
                const deptName = getStaffDepartment(s);
                const gradeCode = getStaffGrade(s);
                const jobTitleText = s.jobTitle || 'Unassigned';

                const nameParts = name.trim().split(/\s+/);
                const initials = nameParts.length > 1 
                    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
                    : name.substring(0, 2).toUpperCase();

                let statusBadge = `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">Active</span>`;
                let avatarClass = 'staff-avatar';
                let rowBgClass = '';

                if (s.status === 'Resigned') {
                    statusBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1">Resigned</span>`;
                    avatarClass = 'staff-avatar avatar-resigned';
                    rowBgClass = 'opacity-75 bg-light';
                }

                let gradeBadge = '';
                if (gradeCode) {
                    gradeBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 fw-bold d-inline-flex align-items-center justify-content-center">Grade ${gradeCode}</span>`;
                }

                const photoUrl = s.photo || s.photoUrl || '';
                const avatarHtml = photoUrl
                    ? `<div class="${avatarClass} overflow-hidden p-0 border" style="width:36px;height:36px;min-width:36px;"><img src="${photoUrl}" class="w-100 h-100 object-fit-cover rounded-circle" alt="${name}" onerror="this.onerror=null;this.parentElement.innerHTML='${initials}';"></div>`
                    : `<div class="${avatarClass}">${initials}</div>`;

                const rowHtml = `
                <tr class="staff-record ${rowBgClass}" data-staff-status="${s.status === 'Resigned' ? 'Resigned' : 'Active'}" data-staff-company="${compName}" data-staff-company-id="${s.companyId || ''}" data-staff-department="${deptName}" data-staff-department-id="${s.departmentId || ''}">
                    <td>
                        <div class="d-flex align-items-center gap-2">
                            ${avatarHtml}
                            <div>
                                <div class="fw-bold text-dark text-uppercase">${name}</div>
                                <div class="text-muted small">
                                    <span class="badge bg-light text-secondary border font-monospace">${s.employeeNo || 'No ID'}</span>
                                    <span class="ms-1 font-monospace">IC: ${s.icNo || '-'}</span>
                                    ${s.biometricId ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace ms-1" title="Biometric Clock Machine ID"><i class="bi bi-fingerprint me-1"></i>${s.biometricId}</span>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="fw-semibold text-dark small"><i class="bi bi-building me-1 text-primary"></i>${compName || 'General Company'}</div>
                        <div class="text-muted small"><i class="bi bi-diagram-3 me-1 text-secondary"></i>${deptName || 'General Dept'}</div>
                    </td>
                    <td>
                        <div class="fw-bold text-dark small mb-1">${jobTitleText}</div>
                        ${gradeBadge}
                    </td>
                    <td>
                        <div>${statusBadge}</div>
                    </td>
                    <td class="text-end">
                        ${['Admin','HR'].includes(currentUser?.role) ? `
                        <div class="d-flex justify-content-end gap-1">
                            <button class="btn btn-sm btn-outline-primary fw-bold" onclick="openStaffModal('UPDATE', '${name}')" title="Update Profile"><i class="bi bi-pencil-square me-1"></i>Update Profile</button>
                            <button class="btn btn-sm btn-outline-info fw-bold" onclick="window.openStaffDossier ? window.openStaffDossier('${name}') : null" title="360° Staff Dossier"><i class="bi bi-file-earmark-person me-1"></i>360° Dossier</button>
                        </div>` : ['HOD','Supervisor'].includes(currentUser?.role) ? `
                        <div class="d-flex justify-content-end gap-1">
                            <button class="btn btn-sm btn-outline-info fw-bold" onclick="window.openStaffDossier ? window.openStaffDossier('${name}') : null" title="360° Staff Dossier"><i class="bi bi-file-earmark-person me-1"></i>360° Dossier</button>
                        </div>` : ''}
                    </td>
                </tr>`;
                tbody.append(rowHtml);
            });
            container.append(tableWrapper);

        } else {
            // Cards View
            const grid = $(`<div class="row g-3" id="staffCardsGrid"></div>`);
            displayStaffNames.forEach((name) => {
                const s = staffSettings[name] || { basic: 0, restDays: [], status: 'Active' };

                const compName = getStaffCompany(s);
                const deptName = getStaffDepartment(s);
                const gradeCode = getStaffGrade(s);
                const jobTitleText = s.jobTitle || 'Unassigned';

                const nameParts = name.trim().split(/\s+/);
                const initials = nameParts.length > 1 
                    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
                    : name.substring(0, 2).toUpperCase();

                let statusBadge = `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">Active</span>`;
                let avatarClass = 'staff-avatar';
                let cardOpacityClass = '';

                if (s.status === 'Resigned') {
                    statusBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1">Resigned</span>`;
                    avatarClass = 'staff-avatar avatar-resigned';
                    cardOpacityClass = 'opacity-75 bg-light';
                }

                let gradeBadge = '';
                if (gradeCode) {
                    gradeBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 fw-bold d-inline-flex align-items-center justify-content-center">Grade ${gradeCode}</span>`;
                }

                const photoUrl = s.photo || s.photoUrl || '';
                const cardAvatarHtml = photoUrl
                    ? `<div class="${avatarClass} overflow-hidden p-0 border" style="width:38px;height:38px;min-width:38px;"><img src="${photoUrl}" class="w-100 h-100 object-fit-cover rounded-circle" alt="${name}" onerror="this.onerror=null;this.parentElement.innerHTML='${initials}';"></div>`
                    : `<div class="${avatarClass}">${initials}</div>`;

                const cardHtml = `
                <div class="col-md-6 col-lg-4">
                    <div class="card staff-record staff-card-compact h-100 shadow-sm border rounded-3 ${cardOpacityClass}" data-staff-status="${s.status === 'Resigned' ? 'Resigned' : 'Active'}" data-staff-company="${compName}" data-staff-company-id="${s.companyId || ''}" data-staff-department="${deptName}" data-staff-department-id="${s.departmentId || ''}">
                        <div class="card-body p-3 d-flex flex-column justify-content-between">
                            <div>
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <div class="d-flex align-items-center gap-2">
                                        ${cardAvatarHtml}
                                        <div>
                                            <h6 class="fw-bold mb-0 text-dark text-uppercase">${name}</h6>
                                            <div class="text-muted small">
                                                <span class="badge bg-light text-secondary border font-monospace">${s.employeeNo || 'No ID'}</span>
                                                <span class="ms-1 font-monospace">IC: ${s.icNo || '-'}</span>
                                                ${s.biometricId ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace ms-1" title="Biometric Clock Machine ID"><i class="bi bi-fingerprint me-1"></i>${s.biometricId}</span>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    ${statusBadge}
                                </div>
                                <div class="d-flex flex-wrap gap-1 mb-2">
                                    <span class="badge bg-light text-dark border small"><i class="bi bi-building me-1"></i>${compName || 'General'}</span>
                                    <span class="badge bg-light text-dark border small"><i class="bi bi-diagram-3 me-1"></i>${deptName || 'General'}</span>
                                    ${gradeBadge}
                                </div>
                                <div class="text-muted small mb-2"><i class="bi bi-briefcase me-1"></i>${jobTitleText}</div>
                            </div>
                            ${['Admin','HR'].includes(currentUser?.role) ? `
                            <div class="d-flex gap-2 pt-2 border-top">
                                <button class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" onclick="openStaffModal('UPDATE', '${name}')"><i class="bi bi-pencil-square me-1"></i>Update Profile</button>
                                <button class="btn btn-sm btn-outline-info fw-bold" onclick="window.openStaffDossier ? window.openStaffDossier('${name}') : null"><i class="bi bi-file-earmark-person me-1"></i>360° Dossier</button>
                            </div>` : ['HOD','Supervisor'].includes(currentUser?.role) ? `
                            <div class="d-flex gap-2 pt-2 border-top">
                                <button class="btn btn-sm btn-outline-info fw-bold w-100" onclick="window.openStaffDossier ? window.openStaffDossier('${name}') : null"><i class="bi bi-file-earmark-person me-1"></i>360° Dossier</button>
                            </div>` : ''}
                        </div>
                    </div>
                </div>`;
                grid.append(cardHtml);
            });
            container.append(grid);
        }

        filterStaffCards();
    }

    function handleStaffFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (file.size > 3 * 1024 * 1024) {
            alert("File is too large! Please select a file smaller than 3MB.");
            event.target.value = ''; 
            selectedFileBase64 = null; selectedFileName = null; selectedFileMime = null;
            return;
        }

        selectedFileName = file.name; 
        selectedFileMime = file.type;
        
        const reader = new FileReader();
        reader.onload = function(e) { 
            selectedFileBase64 = e.target.result.split(',')[1]; 
        };
        reader.readAsDataURL(file);
    }

    function addNewStaff() { openStaffModal('ADD'); }

    function renderStaffFolder(url) {
        const box = $('#staffFolderLink').empty();
        if (!['Admin', 'HR'].includes(currentUser?.role)) return;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com') throw Error('Invalid folder');
            $('<a target="_blank" rel="noopener noreferrer">').attr('href', parsed.href).text('Open staff folder in Google Drive').appendTo(box);
        } catch (_) { box.text('The staff folder will be created when the profile is saved.'); }
    }

    async function saveStaffPayslipToFolder() {
        if (!['Admin', 'HR'].includes(currentUser?.role) || $('#staffModalMode').val() !== 'UPDATE') return;
        const name = $('#staffOriginalName').val(), month = $('#staffPayslipMonth').val();
        if (!month) { $('#staffDocumentStatus').text('Select a pay period.'); return; }
        const button = document.getElementById('staffPayslipSaveBtn');
        button.disabled = true;
        $('#staffDocumentUploadBtn, #saveStaffProfileBtn').prop('disabled', true);
        try {
            const result = await apiPost('getPayroll', {name});
            if (result.status !== 'success') throw Error(result.message || 'Unable to load salary slips');
            const records = (result.data || []).filter(row => row.name === name);
            if (!records.some(row => row.month === month)) throw Error('No published salary slip for the selected period.');
            await printPayslip(month, button, {records, profile: staffSettings[name] || {}});
        } catch (error) { $('#staffDocumentStatus').text(error.message); }
        finally { button.disabled = false; $('#staffDocumentUploadBtn, #saveStaffProfileBtn').prop('disabled', false); }
    }

    async function uploadStaffDocuments() {
        if (!['Admin', 'HR'].includes(currentUser?.role) || $('#staffModalMode').val() !== 'UPDATE') return;
        const files = Array.from(document.getElementById('staffDocumentFile').files || []);
        const status = $('#staffDocumentStatus');
        if (!files.length) { status.text('Select at least one file.'); return; }
        if (files.some(file => file.size > 3 * 1024 * 1024)) { status.text('Each file must be 3 MB or smaller.'); return; }
        const name = $('#staffOriginalName').val(), category = $('#staffDocumentCategory').val();
        $('#staffDocumentUploadBtn, #staffDocumentFile, #staffDocumentCategory, #staffPayslipSaveBtn, #saveStaffProfileBtn').prop('disabled', true);
        let completed = 0;
        try {
            for (const file of files) {
                status.text(`Uploading ${completed + 1} of ${files.length}: ${file.name}`);
                const fileData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1]);
                    reader.onerror = () => reject(Error('Unable to read ' + file.name));
                    reader.readAsDataURL(file);
                });
                const result = await apiPost('staffDocumentUpload', {name, category, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileData});
                if (result.status !== 'success') throw Error(result.message || 'Upload failed.');
                Object.assign(staffSettings[name], {version: result.version, staffFolderUrl: result.staffFolderUrl, staffFolderId: result.staffFolderId, attachment: result.attachment});
                renderStaffFolder(result.staffFolderUrl);
                completed++;
            }
            status.text(`${completed} document(s) saved to the staff folder.`);
            $('#staffDocumentFile').val('');
        } catch (error) {
            status.text(`${completed} of ${files.length} saved. ${error.message} Select only the remaining files before retrying.`);
        } finally {
            $('#staffDocumentUploadBtn, #staffDocumentFile, #staffDocumentCategory, #staffPayslipSaveBtn, #saveStaffProfileBtn').prop('disabled', false);
        }
    }


    
    
    function updateStaffOtBadge() {
        const checked = $('#staffOtEligible').is(':checked');
        const basic = parseFloat($('#staffBasic').val()) || 0;
        const $badge = $('#staffOtStatusBadge');
        if (checked) {
            if (basic > 4000) {
                $badge.text('Eligible (Special Condition)').removeClass('bg-secondary-subtle text-secondary bg-danger-subtle text-danger').addClass('bg-success-subtle text-success');
            } else {
                $badge.text('Eligible (EA 1955)').removeClass('bg-secondary-subtle text-secondary bg-danger-subtle text-danger').addClass('bg-success-subtle text-success');
            }
        } else {
            $badge.text('Not Eligible (No OT)').removeClass('bg-secondary-subtle text-secondary bg-success-subtle text-success').addClass('bg-danger-subtle text-danger');
        }
    }

    function isStaffOtEligible(staffObj, settings) {
        const s = Object.assign({}, staffObj || {}, settings || {});
        // Explicit contractual entitlement / special condition override
        if (s.otEligible !== undefined && s.otEligible !== null && s.otEligible !== '') {
            return (s.otEligible === true || s.otEligible === 'true' || s.otEligible === 1 || s.otEligible === 'Yes');
        }
        // Default eligibility under Malaysian Employment Act 1955:
        // Basic salary <= RM4,000 per month
        const basic = parseFloat(s.basic) || 0;
        if (basic <= 4000) return true;
        // Site workers / manual labor
        const wb = String(s.workBase || '').toUpperCase();
        if (wb === 'SITE' && basic <= 7000) return true;
        return false;
    }

    function getAvailableAllowanceTypes() {
        if (typeof window !== 'undefined' && window.statutorySettings?.allowanceTypes && window.statutorySettings.allowanceTypes.length) {
            return window.statutorySettings.allowanceTypes;
        }
        try {
            const raw = localStorage.getItem('hr_statutory_settings');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.allowanceTypes && parsed.allowanceTypes.length) return parsed.allowanceTypes;
            }
        } catch (_) {}
        return DEFAULT_ALLOWANCE_TYPES;
    }

    function addStaffAllowanceRow(category = '', amount = '', remarks = '') {
        const types = getAvailableAllowanceTypes();
        const optionsHtml = types.map(t => {
            const isSel = (category && (t.name === category || t.id === category)) ? 'selected' : '';
            return `<option value="${t.name}" ${isSel}>${t.name}</option>`;
        }).join('');

        const rowHtml = `
            <tr class="staff-allowance-row">
                <td>
                    <select class="form-select form-select-sm staff-allowance-cat" onchange="recalcStaffAllowanceTotal()">
                        <option value="">-- Select Category --</option>
                        ${optionsHtml}
                    </select>
                </td>
                <td>
                    <div class="input-group input-group-sm">
                        <span class="input-group-text">RM</span>
                        <input type="number" step="0.01" min="0" class="form-control staff-allowance-amount" value="${amount !== '' ? amount : ''}" placeholder="0.00" oninput="recalcStaffAllowanceTotal()">
                    </div>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm staff-allowance-remarks" value="${remarks || ''}" placeholder="e.g. Monthly fixed / travel">
                </td>
                <td class="text-center">
                    <button type="button" class="btn btn-outline-danger btn-sm p-0 px-2" title="Remove allowance" onclick="removeStaffAllowanceRow(this)">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
        $('#staffAllowanceTableBody').append(rowHtml);
        recalcStaffAllowanceTotal();
    }

    function removeStaffAllowanceRow(btn) {
        $(btn).closest('tr').remove();
        recalcStaffAllowanceTotal();
    }

    function recalcStaffAllowanceTotal() {
        let sum = 0;
        $('#staffAllowanceTableBody tr.staff-allowance-row').each(function() {
            const amt = parseFloat($(this).find('.staff-allowance-amount').val()) || 0;
            sum += amt;
        });
        $('#staffFixedAllowance').val(sum > 0 ? sum.toFixed(2) : '');
        $('#staffAllowanceTotalDisplay').text('RM ' + sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }

    function collectStaffAllowances() {
        const list = [];
        $('#staffAllowanceTableBody tr.staff-allowance-row').each(function() {
            const category = $(this).find('.staff-allowance-cat').val();
            const amount = parseFloat($(this).find('.staff-allowance-amount').val()) || 0;
            const remarks = $(this).find('.staff-allowance-remarks').val() || '';
            if (category || amount > 0) {
                list.push({ category: category || 'Other Allowance', amount, remarks });
            }
        });
        return list;
    }

    
    function getAvailableResourceCatalog() {
        let list = [];
        if (cachedHrBootstrapData && cachedHrBootstrapData.records && cachedHrBootstrapData.records.resources && cachedHrBootstrapData.records.resources.length) {
            list = cachedHrBootstrapData.records.resources;
        } else if (typeof window !== 'undefined' && window.hrResources && window.hrResources.length) {
            list = window.hrResources;
        } else {
            try {
                const raw = localStorage.getItem('hr_resources');
                if (raw) list = JSON.parse(raw);
            } catch(_) {}
        }
        if (!list || !list.length) {
            list = [
                { title: 'Notebook / Laptop' },
                { title: 'Desktop Computer' },
                { title: 'Monitor' },
                { title: 'Tablet' },
                { title: 'Mobile Phone' },
                { title: 'Mobile SIM Card' },
                { title: 'Broadband / Internet Device' },
                { title: 'Office Telephone' },
                { title: 'Company Vehicle' },
                { title: 'Access Card' },
                { title: 'Office / Gate Key' },
                { title: 'Printer' },
                { title: 'Other' }
            ];
        }
        return list.filter(r => r.availability !== 'Inactive');
    }

    function addStaffResourceRow(item = {}) {
        const rowId = item.id || ('res_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
        const isRet = Boolean(item.returned);
        const catList = getAvailableResourceCatalog();
        
        let selectedType = item.type || item.category || '';
        let selectedModel = item.model || '';
        if (!selectedType && item.name) {
            const match = catList.find(c => item.name.toLowerCase().startsWith(c.title.toLowerCase()));
            if (match) {
                selectedType = match.title;
                selectedModel = item.name.slice(match.title.length).replace(/^[:s-]+/, '');
            } else {
                selectedModel = item.name;
            }
        }
        if (!selectedType && catList.length > 0) {
            selectedType = catList[0].title;
        }

        if (selectedModel === '[]' || selectedModel === 'No resources assigned' || selectedModel === 'null') {
            selectedModel = '';
        }
        const hasOther = catList.some(c => String(c.title || '').trim().toLowerCase() === 'other');
        const catOptions = catList.map(c => {
            const isSel = (c.title === selectedType) ? 'selected' : '';
            return `<option value="${c.title}" ${isSel}>${c.title}</option>`;
        }).join('');

        const rowHtml = `
            <tr class="staff-resource-row" data-id="${rowId}">
                <td>
                    <select class="form-select form-select-sm staff-res-type" required>
                        <option value="">-- Select Type --</option>
                        ${catOptions}
                        ${hasOther ? '' : `<option value="Other" ${selectedType === 'Other' ? 'selected' : ''}>Other</option>`}
                    </select>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm staff-res-model" value="${selectedModel || ''}" placeholder="e.g. Dell XPS 15 / iPhone 14" required>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm staff-res-serial" value="${item.serialNo || ''}" placeholder="e.g. SN-88291 / Tag">
                </td>
                <td>
                    <input type="date" class="form-control form-control-sm staff-res-issue" value="${item.issueDate || ''}">
                </td>
                <td class="text-center">
                    <div class="form-check d-flex justify-content-center mb-0">
                        <input type="checkbox" class="form-check-input staff-res-returned" ${isRet ? 'checked' : ''} onchange="handleResourceReturnedChange(this)">
                    </div>
                </td>
                <td>
                    <input type="date" class="form-control form-control-sm staff-res-retdate" value="${item.returnedDate || ''}">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm staff-res-remarks" value="${item.remarks || ''}" placeholder="Return condition / handover notes">
                </td>
                <td class="text-center">
                    <button type="button" class="btn btn-outline-danger btn-sm p-0 px-2" title="Remove resource" onclick="removeStaffResourceRow(this)">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
        $('#staffResourcesTableBody').append(rowHtml);
    }

    function removeStaffResourceRow(btn) {
        $(btn).closest('tr').remove();
    }

    function handleResourceReturnedChange(chk) {
        const $row = $(chk).closest('tr');
        const $dateInput = $row.find('.staff-res-retdate');
        if (chk.checked) {
            if (!$dateInput.val()) {
                const todayIso = new Date().toISOString().split('T')[0];
                $dateInput.val(todayIso);
            }
            $row.addClass('table-success-subtle');
        } else {
            $row.removeClass('table-success-subtle');
        }
    }

    function collectStaffResources() {
        const list = [];
        $('#staffResourcesTableBody tr.staff-resource-row').each(function() {
            const type = $(this).find('.staff-res-type').val() || '';
            const model = $(this).find('.staff-res-model').val() || '';
            const name = model ? (type ? `${type}: ${model}` : model) : type;
            const serialNo = $(this).find('.staff-res-serial').val() || '';
            const issueDate = $(this).find('.staff-res-issue').val() || '';
            const returned = $(this).find('.staff-res-returned').is(':checked');
            const returnedDate = $(this).find('.staff-res-retdate').val() || '';
            const remarks = $(this).find('.staff-res-remarks').val() || '';
            if (type || model || serialNo) {
                list.push({
                    type: type || 'Equipment',
                    model: model,
                    name: name || 'Item',
                    serialNo: serialNo,
                    issueDate: issueDate,
                    returned: returned,
                    returnedDate: returnedDate,
                    remarks: remarks
                });
            }
        });
        return list;
    }

    async function openStaffModal(mode, staffName = "") {
        const isHrDeptHod = ['HOD', 'Supervisor'].includes(currentUser?.role) && (
            String(currentUser?.departmentId || '').toUpperCase() === 'HR' ||
            /human resource|hr/i.test(currentUser?.departmentTitle || currentUser?.department || '')
        );
        const hasAccess = ['Admin', 'HR'].includes(currentUser?.role) || isHrDeptHod;
        if (!hasAccess) return;
        const firstTab = document.getElementById('staff-tab-personal-btn');
        if (firstTab && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
            bootstrap.Tab.getOrCreateInstance(firstTab).show();
        }
        $('#staffDocumentStatus').text('');
        $('#staffDocumentUploadPanel').toggle(mode === 'UPDATE');
        $('#staffProfileModal input').val('');
        $('#staffProfileModal textarea').val('');
        $('#staffName, #staffIcNo').prop('readonly', false).removeClass('bg-light');
        $('#staffJoined, #staffConfirm').prop('readonly', false).removeClass('bg-light');
        $('#currentAttachment').html('');
        $('#staffRestDaysGroup input').prop('checked', false);
        $('#staffAllowanceTableBody').empty();
        $('#staffResourcesTableBody').empty();

        selectedFileBase64 = null; selectedFileName = null; selectedFileMime = null;
        $('#staffModalMode').val(mode); $('#staffOriginalName').val(staffName);

        const formatInputDate = (dStr) => {
            if (!dStr) return '';
            let d = new Date(dStr);
            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
            return dStr.substring(0, 10);
        };

        if (mode === 'UPDATE') {
            const s = staffSettings[staffName] || {};
            const isSuperadmin = currentUser?.role === 'Admin';
            if (!isSuperadmin && s.role === 'Admin') {
                alert('Only Admin can edit Admin accounts.');
                return;
            }
            
            $('#staffStatus').val(s.status || 'Active');
            $('#staffResignDate').val(formatInputDate(s.resignDate));
            handleStatusChange();
            
            $('#staffName').val(staffName).prop('readonly', true).addClass('bg-light');
            $('#staffIcNo').val(s.icNo);
            $('#staffGender').val(s.gender || 'Male');
            
            $('#staffUsername').val(s.username);
            $('#staffPassword').val(s.password);
            $('#staffRole').val(({Staff:'User',Supervisor:'HOD'})[s.role]||s.role||'User');
            
            $('#staffContact').val(s.contactNo);
            $('#staffEmergency').val(s.emergency);
            $('#staffAddress').val(s.address);
            $('#staffBasic').val(s.basic);
            const isOtAuto = isStaffOtEligible(s);
            $('#staffOtEligible').prop('checked', s.otEligible !== undefined ? Boolean(s.otEligible) : isOtAuto);
            updateStaffOtBadge();
            $('#staffBasic, #staffOtEligible').off('change.ot input.ot').on('change.ot input.ot', updateStaffOtBadge);

            $('#staffEpfNo').val(s.epfNo);
            $('#staffSocsoNo').val(s.socsoNo);
            $('#staffTaxNo').val(s.taxNo);
            $('#staffBankNo').val(s.bankNo);
            
            $('#staffAlEntitlement').val(s.alEntitlement);
            $('#staffMcEntitlement').val(s.mcEntitlement);

            const jDate = formatInputDate(s.joinedDate);
            $('#staffJoined').val(jDate);


            const cDate = formatInputDate(s.confirmDate);
            $('#staffConfirm').val(cDate);


            const rds = s.restDays || [];
            rds.forEach(dayIdx => { $(`#staffRestDaysGroup input[value='${dayIdx}']`).prop('checked', true); });

            let linkHtml = '';
            if (s.attachment) {
                let links = s.attachment.split('|').map(l => l.trim()).filter(l => l);
                links.forEach((l, i) => {
                    linkHtml += `<div class="mb-2"><a href="${l}" target="_blank" class="badge bg-primary text-decoration-none p-2"><i class="bi bi-paperclip"></i> View Attachment ${i+1}</a></div>`;
                });
            }
            $('#currentAttachment').html(linkHtml ? `<div class="mt-2 border rounded p-2 bg-white">${linkHtml}</div>` : '<span class="text-muted ms-2 small">No attachments yet</span>');
        } else {
            $('#staffStatus').val('Active');
            handleStatusChange();
        }
        // Only Superadmin can assign Admin role. HR and Admin can assign User, HOD, HR.
        const isSuperadmin = currentUser.role === 'Admin';
        $('#staffRole option[value="Admin"]').prop('disabled', !isSuperadmin);
        $('#staffRole option[value="HR"]').prop('disabled', false);
        $('#staffRole option[value="HOD"]').prop('disabled', false);
        $('#staffRole option[value="User"]').prop('disabled', false);
        $('#staffRole').prop('disabled', false);
        if(mode==='ADD')$('#staffRole').val('User');
        const profile=staffSettings[staffName]||{};

        $('#staffEmail').val(profile.email ?? '');
        const rawRace = String(profile.race || '').trim().toUpperCase();
        if (['CHINESE', 'MALAY', 'INDIAN', 'OTHERS'].includes(rawRace)) {
            $('#staffRace').val(rawRace);
        } else if (rawRace) {
            $('#staffRace').val('OTHERS');
        } else {
            $('#staffRace').val('');
        }
        $('#staffAgeSource').val(profile.ageSource ?? '');
        $('#staffAcademicLevel').val(profile.academicLevel ?? '');
        $('#staffServiceYearsSource').val(profile.serviceYearsSource ?? '');
        $('#staffCompanyName').val(profile.companyName ?? '');
        renderStaffFolder(profile.staffFolderUrl);

        // Populate photo and hero details for staff profile modal
        const photoUrl = profile.photo || profile.photoUrl || '';
        const nameParts = (staffName || '').trim().split(/\s+/);
        const initials = nameParts.length > 1 
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
            : (staffName || '--').substring(0, 2).toUpperCase();

        if (mode === 'UPDATE' && staffName) {
            $('#staffModalDisplayName').text(staffName);
            $('#staffModalStatusBadge').text(profile.status || 'Active')
                .removeClass('bg-success-subtle text-success border-success-subtle bg-danger-subtle text-danger border-danger-subtle')
                .addClass(profile.status === 'Resigned' ? 'bg-danger-subtle text-danger border-danger-subtle' : 'bg-success-subtle text-success border-success-subtle');
            $('#staffModalRoleBadge').text(profile.role || 'Staff');
            $('#staffModalSubEmpNo').text(profile.employeeNo || 'No ID');
            $('#staffModalSubJobTitle').text(profile.jobTitle || 'Unassigned');
            const compName = getStaffCompany(profile);
            const deptName = getStaffDepartment(profile);
            $('#staffModalSubDept').text((compName ? compName + ' · ' : '') + (deptName || ''));
            $('#btnUploadStaffModalPhoto').show();
            $('#staffModalPhotoStatus').html('<span class="text-muted"><i class="bi bi-cloud-check text-success me-1"></i>Drive Sync</span>');
        } else {
            $('#staffModalDisplayName').text('New Employee');
            $('#staffModalStatusBadge').text('Active')
                .removeClass('bg-danger-subtle text-danger border-danger-subtle')
                .addClass('bg-success-subtle text-success border-success-subtle');
            $('#staffModalRoleBadge').text('Staff');
            $('#staffModalSubEmpNo').text('New');
            $('#staffModalSubJobTitle').text('Create profile');
            $('#staffModalSubDept').text('');
            $('#btnUploadStaffModalPhoto').hide();
            $('#staffModalPhotoStatus').empty();
        }

        if (photoUrl) {
            $('#staffModalAvatarImg').attr('src', photoUrl).show();
            $('#staffModalAvatarInitials').addClass('d-none').removeClass('d-flex').hide();
        } else {
            $('#staffModalAvatarImg').attr('src', '').hide();
            $('#staffModalAvatarInitials').text(initials).removeClass('d-none').addClass('d-flex').show();
        }

        // Wire upload photo event handler
        $('#btnUploadStaffModalPhoto').off('click').on('click', function(e) {
            e.stopPropagation();
            $('#staffModalPhotoFileInput').trigger('click');
        });

        $('#staffModalPhotoFileInput').off('change').on('change', async function() {
            const file = this.files && this.files[0];
            if (!file) return;
            this.value = '';
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file (JPG, PNG).');
                return;
            }
            const currentStaffTarget = $('#staffName').val() || staffName;
            if (!currentStaffTarget) {
                alert('Please specify staff name before uploading photo.');
                return;
            }
            $('#staffModalPhotoStatus').html('<span class="spinner-border spinner-border-sm me-1 text-primary"></span>Saving to Drive...');
            try {
                const dataUrl = await compressImageToDataUrl(file, 800, 0.85);
                $('#staffModalAvatarImg').attr('src', dataUrl).show();
                $('#staffModalAvatarInitials').addClass('d-none').removeClass('d-flex').hide();

                const res = await apiPost('uploadProfilePhoto', {
                    name: currentStaffTarget,
                    fileData: dataUrl,
                    fileName: file.name || 'profile.jpg',
                    mimeType: 'image/jpeg'
                });
                if (res && res.status === 'success' && res.photoUrl) {
                    if (!staffSettings[currentStaffTarget]) staffSettings[currentStaffTarget] = {};
                    staffSettings[currentStaffTarget].photo = res.photoUrl;
                    staffSettings[currentStaffTarget].photoUrl = res.photoUrl;
                    if (typeof window !== 'undefined' && window.staffSettings) {
                        if (!window.staffSettings[currentStaffTarget]) window.staffSettings[currentStaffTarget] = {};
                        window.staffSettings[currentStaffTarget].photo = res.photoUrl;
                        window.staffSettings[currentStaffTarget].photoUrl = res.photoUrl;
                    }
                    if (currentUser && currentUser.name === currentStaffTarget) {
                        currentUser.photo = res.photoUrl;
                        currentUser.photoUrl = res.photoUrl;
                    }
                    $('#staffModalAvatarImg').attr('src', res.photoUrl).show();
                    $('#staffModalPhotoStatus').html('<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>Saved to Drive</span>');
                    renderStaffMgmt();
                } else {
                    $('#staffModalPhotoStatus').html('<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Upload failed</span>');
                    alert(res?.message || 'Failed to upload profile photo to Drive.');
                }
            } catch (err) {
                console.error('Error uploading staff photo:', err);
                $('#staffModalPhotoStatus').html('<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Error</span>');
                alert('Error uploading photo: ' + (err.message || err));
            }
        });

        // Instant modal response: show modal immediately without waiting for network
        bootstrap.Modal.getOrCreateInstance(document.getElementById('staffProfileModal')).show();

        const populateStaffModalHr = (records, employees) => {
            if (!records) return;
            const fill=(id,rows,selected)=>{const el=document.getElementById(id);if(!el)return;el.replaceChildren(new Option('Not assigned',''));rows.forEach(r=>el.add(new Option(r.title||r.name,r.id||r.name)));el.value=selected||'';};
            fill('staffCompany',records.companies||[],profile.companyId);
            const departments=records.departments||[];
            if (departments.length) {
                cachedDepartments = departments;
                if (typeof window !== 'undefined') window.hrDepartments = departments;
            }
            if (mode === 'UPDATE' && staffName) {
                const curComp = getStaffCompany(profile);
                const curDept = getStaffDepartment(profile);
                $('#staffModalSubDept').text((curComp ? curComp + ' · ' : '') + (curDept || ''));
            }
            const loadDepartments=()=>{
                const compVal = $('#staffCompany').val();
                const filteredDepts = compVal 
                    ? departments.filter(r => {
                        if (!r.companyId || String(r.companyId).toUpperCase() === 'ALL') return true;
                        const cos = String(r.companyId).split(',').map(s=>s.trim().toUpperCase());
                        return cos.includes(String(compVal).toUpperCase());
                    })
                    : departments;
                const currentDept = $('#staffDepartment').val() || profile.departmentId || '';
                fill('staffDepartment', filteredDepts.map(d => {
                    let title = d.code && d.title && d.code !== d.title ? `${d.title} (${d.code})` : (d.title || d.code || d.id);
                    const tags = [];
                    if (d.workBase && String(d.workBase).toUpperCase() !== 'ALL') tags.push(d.workBase);
                    if (d.workLocation && String(d.workLocation).toUpperCase() !== 'ALL') tags.push(d.workLocation);
                    if (tags.length) title += ` [${tags.join(', ')}]`;
                    return { id: d.id, title };
                }), currentDept);
            };
            loadDepartments();
            $('#staffCompany').off('change.hr').on('change.hr', () => {
                loadDepartments();
                const curComp = getStaffCompany({ companyId: $('#staffCompany').val() });
                const curDept = $('#staffDepartment option:selected').text();
                if (curDept && curDept !== 'Not assigned') {
                    $('#staffModalSubDept').text((curComp ? curComp + ' · ' : '') + curDept);
                }
            });
            $('#staffDepartment').off('change.subDept').on('change.subDept', function() {
                const selectedVal = $(this).val();
                const depts = getAllDepartments();
                const dObj = depts.find(d => d.id === selectedVal || d.code === selectedVal);
                const deptTitle = dObj ? (dObj.title || dObj.name || dObj.code) : $(this).find('option:selected').text();
                const curComp = getStaffCompany({ companyId: $('#staffCompany').val() });
                if (deptTitle && deptTitle !== 'Not assigned') {
                    $('#staffModalSubDept').text((curComp ? curComp + ' · ' : '') + deptTitle);
                }
            });
            const mgrEl = document.getElementById('staffManager');
            if (mgrEl) {
                mgrEl.replaceChildren(new Option('Not assigned', ''));
                const hodNames = new Set(
                    (records.departments || []).map(d => String(d.manager || '').trim()).filter(Boolean)
                );
                const eligibleMgrs = (employees||[]).filter(r=>r.status!=='Resigned'&&(['Admin','HR','HOD','Supervisor'].includes(r.role) || hodNames.has(r.name)));
                eligibleMgrs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
                eligibleMgrs.forEach(r => mgrEl.add(new Option(r.name, r.name)));
                mgrEl.value = profile.manager || '';
                if (!mgrEl.value && profile.manager) {
                    const found = eligibleMgrs.find(r => r.id === profile.manager || r.employeeNo === profile.manager);
                    if (found) mgrEl.value = found.name;
                }
            }
            $('#staffEmployeeNo').val(profile.employeeNo||'').prop('readonly', false);
            $('#staffBiometricId').val(profile.biometricId || '');
            $('#staffAssignedResources').val(profile.assignedResources||'No resources assigned');
            const jobs=records.jobTitles||[],grades=records.jobGrades||[];
            fill('staffJobTitle',jobs.filter(j=>j.availability==='Active'||j.id===profile.jobTitleId),profile.jobTitleId);
            fill('staffJobGrade', grades.filter(g => g.availability !== 'Inactive' || g.id === profile.gradeId)
                .map(g=>({id:g.id,title:`${g.code} — ${g.title}`})),profile.gradeId);
            $('#staffLegacyTitle').text(!profile.jobTitleId&&profile.jobTitle?'Existing title: '+profile.jobTitle+'. Select a library title to apply grade limits.':'Grade is linked to the selected job title.');
            function dedupeByCode(list) {
                if (!Array.isArray(list)) return [];
                const seen = new Set();
                return list.filter(item => {
                    const k = String(item.code || item.title || '').trim().toUpperCase();
                    if (!k || seen.has(k)) return false;
                    seen.add(k);
                    return true;
                });
            }
            const rawWorkBases = (records.workBases && records.workBases.length) ? records.workBases : (window.workBases || [
                { code: 'OFFICE', title: 'Office' },
                { code: 'SITE', title: 'Site' }
            ]);
            const workBases = dedupeByCode(rawWorkBases);
            const rawWorkLocations = (records.workLocations && records.workLocations.length) ? records.workLocations : (window.workLocations || [
                { code: 'PG', title: 'Penang (PG)' },
                { code: 'SEL', title: 'Selangor (SEL)' },
                { code: 'KL', title: 'Kuala Lumpur (KL)' },
                { code: 'NS', title: 'Negeri Sembilan (NS)' }
            ]);
            const workLocations = dedupeByCode(rawWorkLocations);
            
            const locMap = { 'PENANG': 'PG', 'PULAU PINANG': 'PG', 'SELANGOR': 'SEL', 'KUALA LUMPUR': 'KL', 'NEGERI SEMBILAN': 'NS' };
            const selectedLoc = locMap[String(profile.location || '').toUpperCase()] || profile.location;
            const baseMap = { 'OFFICE': 'OFFICE', 'SITE': 'SITE' };
            let selectedBase = baseMap[String(profile.workBase || '').toUpperCase()] || profile.workBase;
            if (!selectedBase && profile.jobTitleId) {
                const currentJob = jobs.find(j => j.id === profile.jobTitleId);
                if (currentJob?.workBase) {
                    selectedBase = baseMap[String(currentJob.workBase).toUpperCase()] || currentJob.workBase;
                }
            }

            fill('staffWorkBase', workBases.map(b => ({ id: b.code || b.title, title: b.title ? `${b.title} (${b.code || b.title})` : b.code })), selectedBase);
            fill('staffLocation', workLocations.map(l => ({ id: l.code || l.title, title: l.title ? `${l.title} (${l.code || l.title})` : l.code })), selectedLoc);

            const renderStaffSchedules = () => {
                const compVal = $('#staffCompany').val() || profile.companyId || profile.company || '';
                const compObj = (records.companies || []).find(c => c.id === compVal || c.code === compVal || c.title === compVal || c.name === compVal);
                const compCode = (compObj ? (compObj.code || compObj.title || compObj.name) : compVal).toUpperCase();
                const workBaseVal = ($('#staffWorkBase').val() || profile.workBase || '').toUpperCase();
                const locationVal = ($('#staffLocation').val() || profile.location || '').toUpperCase();

                const allSchedules = (records.workSchedules && records.workSchedules.length) 
                    ? records.workSchedules 
                    : (window.workSchedules || (typeof DEFAULT_WORK_SCHEDULES !== 'undefined' ? DEFAULT_WORK_SCHEDULES : []));

                const container = $('#staffScheduleOptionsContainer');
                if (!compCode || !workBaseVal) {
                    container.html('<div class="text-muted small p-1">Select a Company and Work Base under Employment &amp; Org to see matching shift templates.</div>');
                    $('#staffScheduleContextBadge').text('Company and Work Base required');
                    return;
                }
                const filtered = allSchedules.filter(sch => {
                    if (compCode) {
                        const schComp = String(sch.company || '').toUpperCase();
                        if (compCode.includes('SQ') || compCode.includes('SETAR')) {
                            if (schComp && schComp !== 'ALL' && !schComp.includes('SQ') && !schComp.includes('SETAR')) return false;
                        } else if (compCode.includes('MS') || compCode.includes('MILAN')) {
                            if (schComp && schComp !== 'ALL' && !schComp.includes('MS') && !schComp.includes('MILAN')) return false;
                        } else if (schComp && schComp !== 'ALL' && schComp !== compCode && !compCode.includes(schComp)) {
                            return false;
                        }
                    }
                    if (workBaseVal) {
                        const schBase = String(sch.workBase || '').toUpperCase();
                        if (workBaseVal.includes('OFFICE')) {
                            if (schBase && !schBase.includes('OFFICE')) return false;
                        } else if (workBaseVal.includes('SITE')) {
                            if (schBase && !schBase.includes('SITE')) return false;
                        } else if (schBase && schBase !== workBaseVal) {
                            return false;
                        }
                    }
                    const schLocation=String(sch.workLocation||'All').toUpperCase();
                    if(locationVal && schLocation!=='ALL' && schLocation!==locationVal) return false;
                    return sch.availability !== 'Inactive';
                });

                let selectedCodes = [];
                if (Array.isArray(profile.schedules)) {
                    selectedCodes = profile.schedules.map(String);
                } else if (profile.schedule) {
                    selectedCodes = String(profile.schedule).split(',').map(s => s.trim());
                }

                if (!filtered.length) {
                    container.html('<div class="text-muted small p-1">No saved active schedules for the selected Company, Work Base and Work Location. Create a template under HR Settings → Working Schedule Templates first.</div>');
                } else {
                    const formatScheduleLabel = (sch) => {
                        const code = String(sch.code || sch.id || '').trim();
                        let rawTitle = String(sch.title || sch.notes || '').trim();
                        
                        let period = '';
                        const periodMatch = rawTitle.match(/\(?(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})\)?/);
                        if (periodMatch) {
                            period = periodMatch[1].replace(/\s*–\s*/, ' - ');
                            rawTitle = rawTitle.replace(periodMatch[0], '').trim();
                        } else if (sch.start || sch.end) {
                            period = `${sch.start || '--:--'} - ${sch.end || '--:--'}`;
                        }
                        
                        if (code) {
                            const codeRegex = new RegExp(`\\b${code}\\b`, 'gi');
                            rawTitle = rawTitle.replace(codeRegex, '').replace(/\s+/g, ' ').trim();
                        }
                        
                        rawTitle = rawTitle.replace(/^[-:–]\s*/, '').replace(/[-:–]\s*$/, '').trim();
                        
                        let parts = [];
                        if (code) parts.push(`${code}:`);
                        if (rawTitle && rawTitle.toLowerCase() !== code.toLowerCase()) parts.push(rawTitle);
                        
                        let label = parts.join(' ').trim();
                        if (!label && code) label = code;
                        if (period) label += ` (${period})`;
                        if (sch.netHours != null) label += ` [${sch.netHours}h]`;
                        return label;
                    };

                    const grid=$('<div class="row g-2">');
                    filtered.forEach((sch,index)=>{
                        const code=String(sch.code||sch.id||'');
                        const checked=selectedCodes.includes(code);
                        const id='sch_chk_'+index;
                        const checkbox=$('<input type="checkbox" class="form-check-input staff-schedule-check">').attr({id,value:code}).prop('checked',checked);
                        const label=$('<label class="form-check-label small">').attr('for',id)
                            .text(formatScheduleLabel(sch));
                        grid.append($('<div class="col-sm-6">').append($('<div class="form-check">').append(checkbox,label)));
                    });
                    container.empty().append(grid);
                }
                $('#staffScheduleContextBadge').text(`${compCode || 'Select company'} · ${workBaseVal || 'Select base'} · ${locationVal || 'All locations'}`);
            };

            const updateJobMetadata = () => {
                const selectedJobId = $('#staffJobTitle').val();
                const job = jobs.find(j => j.id === selectedJobId);
                if (job) {
                    if (job.gradeId) $('#staffJobGrade').val(job.gradeId);
                    if (job.departmentId) {
                        let targetDeptId = '';
                        if (Array.isArray(job.departmentId)) {
                            targetDeptId = String(job.departmentId[0] || '').trim();
                        } else if (typeof job.departmentId === 'string') {
                            targetDeptId = job.departmentId.split(',')[0].trim();
                        }
                        if (targetDeptId) {
                            const targetDeptObj = departments.find(d => 
                                d.id === targetDeptId || 
                                d.name === targetDeptId || 
                                d.code === targetDeptId || 
                                d.title === targetDeptId
                            );
                            const actualId = targetDeptObj ? (targetDeptObj.id || targetDeptObj.name) : targetDeptId;
                            
                            let exists = false;
                            $('#staffDepartment option').each(function() {
                                if ($(this).val() === actualId || $(this).val() === targetDeptId) {
                                    exists = true;
                                }
                            });
                            
                            if (!exists && targetDeptObj) {
                                const deptTitle = targetDeptObj.code && targetDeptObj.title && targetDeptObj.code !== targetDeptObj.title 
                                    ? `${targetDeptObj.title} (${targetDeptObj.code})` 
                                    : (targetDeptObj.title || targetDeptObj.code || targetDeptObj.id);
                                $('#staffDepartment').append(new Option(deptTitle, actualId));
                            }
                            
                            $('#staffDepartment').val(actualId);
                            
                            if (!$('#staffCompany').val() && targetDeptObj && targetDeptObj.companyId && String(targetDeptObj.companyId).toUpperCase() !== 'ALL') {
                                $('#staffCompany').val(targetDeptObj.companyId);
                            }
                        }
                    }
                    if (job.workBase) {
                        const rawBase = String(job.workBase).trim().toUpperCase();
                        let matchedOpt = null;
                        $('#staffWorkBase option').each(function() {
                            if (String($(this).val() || '').toUpperCase() === rawBase) matchedOpt = $(this).val();
                        });
                        if (matchedOpt) $('#staffWorkBase').val(matchedOpt);
                        else if (rawBase) $('#staffWorkBase').val(rawBase);
                    }
                    if (job.workLocation && job.workLocation !== 'All') {
                        const rawLoc = String(job.workLocation).trim().toUpperCase();
                        let matchedLoc = null;
                        $('#staffLocation option').each(function() {
                            if (String($(this).val() || '').toUpperCase() === rawLoc) matchedLoc = $(this).val();
                        });
                        if (matchedLoc) $('#staffLocation').val(matchedLoc);
                    }
                    renderStaffSchedules();
                }
            };
            $('#staffJobTitle').off('change.jobMeta').on('change.jobMeta', updateJobMetadata);
            if (!$('#staffDepartment').val() && $('#staffJobTitle').val()) {
                updateJobMetadata();
            }

            renderStaffSchedules();
            $('#staffCompany').off('change.sch').on('change.sch', renderStaffSchedules);
            $('#staffWorkBase').off('change.sch').on('change.sch', renderStaffSchedules);
            $('#staffLocation').off('change.sch').on('change.sch', renderStaffSchedules);
        };

        // Populate immediately using cached records if available
        let currentRecords = cachedHrBootstrapData?.records;
        let currentEmployees = cachedHrBootstrapData?.employees;

        if (!currentRecords) {
            const cachedHr = CacheManager.getHrRecords();
            if (cachedHr) {
                const foundScope = Object.values(cachedHr).find(s => s && s.records && s.records.companies);
                if (foundScope) {
                    currentRecords = foundScope.records;
                    currentEmployees = foundScope.employees;
                }
            }
        }
        if (!currentRecords) {
            currentRecords = {
                companies: (typeof cachedCompanies !== 'undefined' && cachedCompanies.length) ? cachedCompanies : ((typeof window !== 'undefined' && window.hrCompanies) || []),
                departments: (typeof cachedDepartments !== 'undefined' && cachedDepartments.length) ? cachedDepartments : [],
                jobGrades: (typeof cachedJobGrades !== 'undefined' && cachedJobGrades.length) ? cachedJobGrades : [],
                jobTitles: (typeof cachedJobTitles !== 'undefined' && cachedJobTitles.length) ? cachedJobTitles : [],
                workBases: (typeof window !== 'undefined' && window.workBases) || [],
                workLocations: (typeof window !== 'undefined' && window.workLocations) || [],
                workSchedules: (typeof window !== 'undefined' && window.workSchedules) || []
            };
            currentEmployees = Object.values(staffSettings || {});
        }

        const hasCached = currentRecords && currentRecords.companies && currentRecords.companies.length;
        if (hasCached) {
            populateStaffModalHr(currentRecords, currentEmployees);
            apiPost('hrBootstrap', {}).then(response => {
                if (response && response.status === 'success' && response.data) {
                    cachedHrBootstrapData = response.data;
                    populateStaffModalHr(response.data.records, response.data.employees);
                }
            }).catch(e => console.warn('Background hrBootstrap error:', e));
        } else {
            const response = await apiPost('hrBootstrap', {});
            if (response.status !== 'success') {
                alert(response.message || 'Unable to load employee organisation.');
                return;
            }
            cachedHrBootstrapData = response.data;
            populateStaffModalHr(response.data.records, response.data.employees);
        }

        // Populate allowances breakdown - ALWAYS run for opened profile
        $('#staffAllowanceTableBody').empty();
        const existingAllowances = (profile && profile.fixedAllowances && Array.isArray(profile.fixedAllowances) && profile.fixedAllowances.length)
            ? profile.fixedAllowances
            : ((profile && profile.allowances && Array.isArray(profile.allowances) && profile.allowances.length)
                ? profile.allowances
                : ((profile && profile.fixedAllowance > 0) ? [{ category: 'Other Allowance', amount: profile.fixedAllowance, remarks: 'Monthly fixed' }] : []));
        if (existingAllowances.length > 0) {
            existingAllowances.forEach(a => addStaffAllowanceRow(a.category, a.amount, a.remarks));
        } else {
            addStaffAllowanceRow();
        }
        recalcStaffAllowanceTotal();

        // Populate resources custody - ALWAYS run for opened profile
        $('#staffResourcesTableBody').empty();
        let existingResources = [];
        if (profile && profile.resources && Array.isArray(profile.resources) && profile.resources.length) {
            existingResources = profile.resources;
        } else if (profile && profile.assignedResources) {
            const raw = String(profile.assignedResources).trim();
            if (raw && raw !== '[]' && raw !== 'No resources assigned' && raw !== 'null') {
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) existingResources = parsed;
                    else existingResources = [{ name: raw, serialNo: '', issueDate: '', returned: false, returnedDate: '', remarks: '' }];
                } catch(_) {
                    existingResources = [{ name: raw, serialNo: '', issueDate: '', returned: false, returnedDate: '', remarks: '' }];
                }
            }
        }
        if (existingResources.length > 0) {
            existingResources.forEach(r => addStaffResourceRow(r));
        } else {
            addStaffResourceRow();
        }
    }

    async function refreshStaffData() {
        const res = await apiPost('getStaff', {});
        if (res.staleSession) return false;
        if (res.status !== 'success' || !res.data) {
            alert('The change was saved, but staff records could not be refreshed. Refresh records before editing again.');
            return false;
        }
        staffSettings = res.data;
        if (typeof window !== 'undefined') window.staffSettings = staffSettings;
        CacheManager.saveBootstrap({ staffSettings });
        renderStaffMgmt();
        // Recalculate pay with the new rates/rest days and shift assignments using existing attendance.
        if (globalData.length) {
            globalData = globalData.map(row => {
                if (row.manualShift && row.manualShift !== 'AUTO') return row;
                const sObj = findStaffSetting(row.id || row.biometricId || row.rawId, row.name || row.rawName);
                if (!sObj) return row;
                const sComp = getStaffCompany(sObj);
                const calc = calculateStats(row.in, row.out, row.manualShift || 'AUTO', sComp, sObj);
                return {
                    ...row,
                    ...calc,
                    autoRemark: calc.remark
                };
            });
            CacheManager.saveAttendanceRows(globalData);
            renderSummaryDashboard();
            renderDashboard();
        }
        return true;
    }
    async function saveStaffProfile() {
        if (!['Admin', 'HR'].includes(currentUser?.role)) return;

        const mode = $('#staffModalMode').val();
        const originalName = $('#staffOriginalName').val();
        const name = $('#staffName').val().trim().toUpperCase();
        
        if (!name) {
            $('#staff-tab-personal-btn').click();
            $('#staffName').focus();
            return alert("Name is required.");
        }
        if (mode === 'ADD' && staffSettings[name]) return alert("This staff member already exists!");

        // Validate IC format if provided
        const icVal = $('#staffIcNo').val().trim();
        if (icVal) {
            const icRegex = /^\d{6}-\d{2}-\d{4}$/;
            if (!icRegex.test(icVal)) {
                $('#staff-tab-personal-btn').click();
                $('#staffIcNo').focus();
                return alert("IC No must be strictly in xxxxxx-xx-xxxx format.");
            }
        }

        // Validate email format if provided
        const emailVal = $('#staffEmail').val().trim();
        if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
            $('#staff-tab-employment-btn').click();
            $('#staffEmail').focus();
            return alert("Please enter a valid email address.");
        }

        // Validate age if provided
        const ageVal = $('#staffAgeSource').val();
        if (ageVal !== '' && ageVal !== undefined && ageVal !== null) {
            const ageNum = Number(ageVal);
            if (isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
                $('#staff-tab-personal-btn').click();
                $('#staffAgeSource').focus();
                return alert("Age must be a valid number between 0 and 120.");
            }
        }

        // Validate service years if provided
        const serviceVal = $('#staffServiceYearsSource').val();
        if (serviceVal !== '' && serviceVal !== undefined && serviceVal !== null) {
            const sNum = Number(serviceVal);
            if (isNaN(sNum) || sNum < 0 || sNum > 120) {
                $('#staff-tab-employment-btn').click();
                $('#staffServiceYearsSource').focus();
                return alert("Length of service must be a valid number between 0 and 120.");
            }
        }

        const statusVal = $('#staffStatus').val() || 'Active';
        const resignDateVal = $('#staffResignDate').val() || '';
        const isResigning = (statusVal === 'Resigned' || Boolean(resignDateVal));

        const resources = collectStaffResources();
        if (isResigning && resources.length > 0) {
            const unreturned = resources.filter(r => !r.returned || !r.returnedDate || !String(r.remarks || '').trim());
            if (unreturned.length > 0) {
                const resTabBtn = document.getElementById('staff-tab-resources-btn');
                if (resTabBtn && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
                    bootstrap.Tab.getOrCreateInstance(resTabBtn).show();
                }
                const missingList = unreturned.map(r => `• ${r.name || 'Unnamed item'}${r.serialNo ? ' (' + r.serialNo + ')' : ''} (Check Returned, set Return Date & Remarks)`).join('\n');
                return alert(`Resignation cannot be saved until all company resources are confirmed returned.\n\nPlease complete the return handover for the following item(s):\n\n${missingList}`);
            }
        }

        const fixedAllowances = collectStaffAllowances();
        const fixedAllowanceTotal = parseFloat($('#staffFixedAllowance').val()) || 0;

        const basic = parseFloat($('#staffBasic').val()) || 0;
        const hourly = basic > 0 ? (basic / 26 / 8).toFixed(2) : 0;
        
        let restDays = [];
        $('#staffRestDaysGroup input:checked').each(function() { restDays.push(parseInt($(this).val())); });

        const selectedSchedules = [];
        $('#staffScheduleOptionsContainer input.staff-schedule-check:checked').each(function() {
            selectedSchedules.push($(this).val());
        });
        const scheduleStr = selectedSchedules.join(', ');

        if (restDays.length === 0 && selectedSchedules.length > 0) {
            let hrSchedules = [];
            try {
                if (records && records.workSchedules && records.workSchedules.length) {
                    hrSchedules = records.workSchedules;
                } else {
                    const raw = localStorage.getItem('hr_workSchedules');
                    if (raw) hrSchedules = JSON.parse(raw);
                    if (!hrSchedules || !hrSchedules.length) hrSchedules = window.workSchedules || [];
                }
            } catch (e) {}
            const matched = hrSchedules.filter(sch => selectedSchedules.includes(sch.code || sch.title || sch.name));
            const rdSet = new Set();
            matched.forEach(sch => {
                if (Array.isArray(sch.restDays) && sch.restDays.length) {
                    sch.restDays.forEach(d => rdSet.add(Number(d)));
                } else if (sch.daySchedules) {
                    try {
                        const blocks = typeof sch.daySchedules === 'string' ? JSON.parse(sch.daySchedules) : sch.daySchedules;
                        const workDays = new Set(blocks.flatMap(b => b.days || []));
                        const dayNumMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
                        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => {
                            if (!workDays.has(d)) rdSet.add(dayNumMap[d]);
                        });
                    } catch (_) {}
                }
            });
            if (rdSet.size > 0) {
                restDays = Array.from(rdSet).sort((a, b) => a - b);
            } else {
                restDays = [];
            }
        }

        // Normalize workBase and location to standard codes
        let rawWorkBase = ($('#staffWorkBase').val() || '').trim().toUpperCase();
        let rawLocation = ($('#staffLocation').val() || '').trim().toUpperCase();
        const locMap = {
            'PG': 'PG', 'PENANG': 'PG', 'PULAU PINANG': 'PG',
            'SEL': 'SEL', 'SELANGOR': 'SEL',
            'KL': 'KL', 'KUALA LUMPUR': 'KL', 'WILAYAH PERSEKUTUAN KUALA LUMPUR': 'KL',
            'NS': 'NS', 'NEGERI SEMBILAN': 'NS'
        };
        if (locMap[rawLocation]) rawLocation = locMap[rawLocation];
        const baseMap = { 'OFFICE': 'OFFICE', 'SITE': 'SITE' };
        if (baseMap[rawWorkBase]) rawWorkBase = baseMap[rawWorkBase];

        const existingProfile = (mode === 'UPDATE' && originalName) ? (staffSettings[originalName] || {}) : {};

        const payload = {
            name: name, status: $('#staffStatus').val() || 'Active', resignDate: $('#staffResignDate').val() || '',
            icNo: $('#staffIcNo').val(), gender: $('#staffGender').val() || 'Male',
            username: $('#staffUsername').val(), password: $('#staffPassword').val(), role: $('#staffRole').val() || 'User',
            contactNo: $('#staffContact').val(), emergency: $('#staffEmergency').val(), address: $('#staffAddress').val(),
            basic: basic, hourly: hourly, otEligible: $('#staffOtEligible').is(':checked'), joinedDate: $('#staffJoined').val(), confirmDate: $('#staffConfirm').val(),
            fixedAllowance: fixedAllowanceTotal, fixedAllowances: fixedAllowances,
            resources: resources, assignedResources: (resources.map(r => `${r.name || 'Item'}${r.serialNo ? ' [' + r.serialNo + ']' : ''}${r.returned ? ' (Returned ' + r.returnedDate + ')' : ''}`).join('; ') || 'No resources assigned'),
            epfNo: $('#staffEpfNo').val(), socsoNo: $('#staffSocsoNo').val(), taxNo: $('#staffTaxNo').val(), bankNo: $('#staffBankNo').val(),
            alEntitlement: $('#staffAlEntitlement').val(), mcEntitlement: $('#staffMcEntitlement').val(),
            restDays: restDays,
            schedules: selectedSchedules,
            schedule: scheduleStr,
            email: emailVal, race: ($('#staffRace').val() || '').trim(), ageSource: $('#staffAgeSource').val(), academicLevel: ($('#staffAcademicLevel').val() || '').trim(), workBase: rawWorkBase, serviceYearsSource: $('#staffServiceYearsSource').val(), companyName: ($('#staffCompanyName').val() ? $('#staffCompanyName').val().trim() : (existingProfile.companyName || '')),
            employeeNo: $('#staffEmployeeNo').val(), biometricId: ($('#staffBiometricId').val() || '').trim(), companyId: $('#staffCompany').val(), departmentId: $('#staffDepartment').val(), manager: $('#staffManager').val(), jobTitleId: $('#staffJobTitle').val(), gradeId: $('#staffJobGrade').val(), jobTitle: ($('#staffJobTitle').val() ? ($('#staffJobTitle option:selected').text() || '') : (existingProfile.jobTitle || '')), location: rawLocation, version: existingProfile.version,
            photo: existingProfile.photo || existingProfile.photoUrl || '',
            photoUrl: existingProfile.photoUrl || existingProfile.photo || '',
            existingAttachment: existingProfile.attachment || "",
            fileName: selectedFileName, mimeType: selectedFileMime, fileData: selectedFileBase64
        };

        const btn = $('#saveStaffProfileBtn');
        btn.html('<span class="spinner-border spinner-border-sm"></span> Saving & Uploading...').prop('disabled', true);

        try {
            let res = await apiPost('saveSingleStaff', payload);
            if (res.status !== 'success' && String(res.message || '').includes('cycle') && payload.manager) {
                const shouldClear = confirm(`Reporting line cycle conflict detected on selected manager (${payload.manager}) in the database.\n\nWould you like to set Reporting Manager to 'Not assigned' so your Biometric ID and other profile updates can save immediately?`);
                if (shouldClear) {
                    $('#staffManager').val('');
                    payload.manager = '';
                    res = await apiPost('saveSingleStaff', payload);
                }
            }
            if (res.status === 'success') {
                if (res.folderError) alert("Profile saved, but the staff folder could not be created: " + res.folderError + ". Save the profile again to retry.");
                if (res.uploadError) alert("Drive Upload failed:\n\n" + res.uploadError);
                await refreshStaffData();
                alert("Profile saved successfully!");
                const modalEl = document.getElementById('staffProfileModal');
                if (modalEl) {
                    const inst = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
                    inst?.hide();
                }
            } else {
                alert(res.message || "Error saving profile.");
            }
        } catch (err) {
            console.error("Save staff profile error:", err);
            alert("Error saving profile: " + (err?.message || err));
        } finally {
            btn.html('Save Profile').prop('disabled', false);
        }
    }

    async function saveBiometricLocally() {
        const originalName = $('#staffOriginalName').val() || $('#staffName').val().trim().toUpperCase();
        const bioId = $('#staffBiometricId').val().trim();
        if (!originalName) return alert("Please specify staff name first.");
        const btn = $('#btnQuickSaveBio');
        btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);
        // 1. Try isQuickSave (fastest direct write to biometric column)
        let res = await apiPost('saveSingleStaff', {
            name: originalName,
            biometricId: bioId,
            isQuickSave: true,
            version: staffSettings[originalName]?.version
        });

        // 2. Fallback: if backend returns error or requires manager='', save with manager: ''
        if (res.status !== 'success') {
            res = await apiPost('saveSingleStaff', {
                name: originalName,
                biometricId: bioId,
                manager: '',
                version: staffSettings[originalName]?.version
            });
        }

        if (res.status === 'success') {
            if (staffSettings[originalName]) staffSettings[originalName].biometricId = bioId;
            await refreshStaffData();
            btn.html('<i class="bi bi-check-circle-fill text-success"></i> Saved!').removeClass('btn-outline-primary').addClass('btn-outline-success');
            setTimeout(() => btn.html('<i class="bi bi-check-lg me-1"></i>Save ID').removeClass('btn-outline-success').addClass('btn-outline-primary').prop('disabled', false), 2000);
        } else {
            alert(res.message || "Unable to save Biometric ID.");
            btn.html('<i class="bi bi-check-lg me-1"></i>Save ID').prop('disabled', false);
        }
    }

    async function saveRateLocally(domId, name) { 
        const rds = [];
        $(`#rd_${domId} input:checked`).each(function() { rds.push(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf($(this).parent().text().trim())); });
        const response = await apiPost('saveSingleStaff', { name, isQuickSave: true, restDays: rds, version: staffSettings[name].version });
        if (response.status !== 'success') { alert(response.message || 'Unable to save rest days.'); return; }
        await refreshStaffData();
    }

    async function syncSingleStaff(btnEl, name) {
        $(btnEl).html('<span class="spinner-border spinner-border-sm"></span>').prop('disabled', true);
        const basic = parseFloat(staffSettings[name].basic);
        const payload = { name: name, basic: basic, hourly: basic > 0 ? (basic/26/8).toFixed(2) : 0, restDays: staffSettings[name].restDays, version: staffSettings[name].version };
        
        const response = await apiPost('saveSingleStaff', payload);
        if (response.status !== 'success') { alert(response.message || 'Unable to save salary rates.'); $(btnEl).text('Save').prop('disabled', false); return; }
        await refreshStaffData();
        $(btnEl).html('<i class="bi bi-check-lg"></i>').removeClass('btn-primary').addClass('btn-success');
        setTimeout(() => $(btnEl).text('Save').removeClass('btn-success').addClass('btn-primary').prop('disabled', false), 2000);
    }

    async function deleteStaff(name) {
        if (!confirm(`Are you sure you want to completely delete ${name}? \n\nThis will remove them permanently from the database.`)) return;
        const backup = staffSettings[name];
        delete staffSettings[name];
        renderStaffMgmt(); 
        try {
            const res = await apiPost('deleteSingleStaff', { name: name });
            if (!res || res.status !== 'success') {
                if (backup) staffSettings[name] = backup;
                renderStaffMgmt();
                alert(res?.message || 'Failed to delete staff member. Changes rolled back.');
            }
        } catch (e) {
            if (backup) staffSettings[name] = backup;
            renderStaffMgmt();
            alert('Error deleting staff member: ' + e.message);
        }
    }

    const HOLIDAY_MATRIX_COLS = [
        { key: 'OFFICE_PG', label: 'PG', group: 'OFFICE' },
        { key: 'OFFICE_SEL', label: 'SEL', group: 'OFFICE' },
        { key: 'SITE_PG', label: 'PG', group: 'SITE' },
        { key: 'SITE_SEL', label: 'SEL', group: 'SITE' },
        { key: 'SITE_KL', label: 'KL', group: 'SITE' },
        { key: 'SITE_NS', label: 'NS', group: 'SITE' }
    ];

    function getDayOfWeekName(dStr) {
        if (!dStr) return '—';
        try {
            const iso = parseDateDMYToISO(dStr);
            if (!iso) return '—';
            const dt = new Date(iso + 'T00:00:00');
            if (isNaN(dt.getTime())) return '—';
            return dt.toLocaleDateString('en-GB', { weekday: 'long' });
        } catch (e) {
            return '—';
        }
    }

    function renderHolidayMgmt() {
        const tbody = $('#holidayTableBody');
        if (!tbody.length) return;
        tbody.empty();

        // Sort holidays chronologically: earliest date to latest date (Jan to Dec)
        if (Array.isArray(holidays)) {
            holidays.sort((a, b) => {
                const da = parseDateDMYToISO(a && a.date);
                const db = parseDateDMYToISO(b && b.date);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da.localeCompare(db);
            });
        }

        // Holiday company options come from the editable Companies master register.
        // Preserve codes referenced by existing saved holidays, including legacy entries.
        const masterCompanies = [...(cachedCompanies || []), ...((typeof window !== 'undefined' && window.hrCompanies) || [])];
        const holidayCodes = [...new Set([
            ...masterCompanies.map(c=>String(c.code||c.title||c.name||'').trim()),
            ...holidays.map(h=>String(h.company||'All').trim()).filter(c=>c.toUpperCase()!=='ALL')
        ].filter(Boolean))].sort();
        const holidayCompanyFilter = $('#holidayCompanyFilter');
        if (holidayCompanyFilter.length) {
            const previous=holidayCompanyFilter.val()||'all';
            holidayCompanyFilter.empty().append(new Option('All Companies','all'));
            holidayCodes.forEach(code=>holidayCompanyFilter.append(new Option(code,code)));
            holidayCompanyFilter.val(holidayCodes.some(c=>c.toLowerCase()===String(previous).toLowerCase())?previous:'all');
        }
        const holidayYearSelect = $('#holidayYearFilter');
        if (holidayYearSelect.length) {
            const previous=holidayYearSelect.val()||'all';
            const years=[...new Set(holidays.map(h=>{
                const iso = parseDateDMYToISO(h && h.date);
                return iso ? iso.slice(0, 4) : '';
            }).filter(y=>/^\d{4}$/.test(y)))].sort().reverse();
            holidayYearSelect.empty().append(new Option('All Years','all'));
            years.forEach(year=>holidayYearSelect.append(new Option('Year '+year,year)));
            holidayYearSelect.val(years.includes(previous)?previous:'all');
        }
        const yearFilter = $('#holidayYearFilter').val() || 'all';
        const compFilter = $('#holidayCompanyFilter').val() || 'all';
        const searchQuery = String($('#holidaySearchInput').val() || '').trim().toLowerCase();

        const canEdit = isAdmin || ['Admin', 'HR'].includes(currentUser?.role);

        let rowCount = 0;
        holidays.forEach((h, idx) => {
            if (!h) return;
            const isoDate = parseDateDMYToISO(h.date);
            const hYear = isoDate ? isoDate.substring(0, 4) : '';
            if (yearFilter !== 'all' && hYear && hYear !== yearFilter) return;

            const hComp = String(h.company || 'All').toUpperCase();
            if (compFilter !== 'all' && hComp !== 'ALL' && !hComp.includes(compFilter.toUpperCase())) return;

            if (searchQuery) {
                const combined = (String(h.name || '') + ' ' + String(formatDateDMY(h.date)) + ' ' + String(h.date || '') + ' ' + String(h.company || '')).toLowerCase();
                if (!combined.includes(searchQuery)) return;
            }

            rowCount++;
            if (!h.matrix) h.matrix = {};

            const dayName = getDayOfWeekName(h.date);

            let matrixCellsHtml = '';
            HOLIDAY_MATRIX_COLS.forEach(col => {
                const val = (h.matrix[col.key] === 1 || h.matrix[col.key] === true);
                const displayVal = val ? '1' : '—';
                const cellBg = col.group === 'OFFICE' 
                    ? (val ? 'background-color: #ffedd5; color: #9a3412;' : 'color: #94a3b8;') 
                    : (val ? 'background-color: #dcfce7; color: #166534;' : 'color: #94a3b8;');
                const btnStyle = val ? 'font-weight: 700; font-size: 0.95rem;' : 'color: #94a3b8; font-size: 0.95rem;';
                
                matrixCellsHtml += `
                    <td class="text-center align-middle p-1" style="${cellBg}">
                        <button type="button" 
                            class="btn btn-sm btn-link text-decoration-none w-100 p-1" 
                            style="${btnStyle}" 
                            onclick="toggleHolidayMatrixCell(${idx}, '${col.key}')" 
                            ${canEdit ? '' : 'disabled'}
                            title="${col.group} ${col.label}: ${val ? 'Active (1)' : 'Inactive (—)'}">
                            ${displayVal}
                        </button>
                    </td>
                `;
            });

            const tr = $(`
                <tr data-holiday-idx="${idx}">
                    <td class="text-center align-middle fw-semibold text-secondary small">${rowCount}</td>
                    <td class="align-middle p-1">
                        <div class="input-group input-group-sm" style="min-width: 145px;">
                            <input type="text" class="form-control form-control-sm text-center fw-medium holiday-date-text" 
                                value="${formatDateDMY(h.date)}" 
                                placeholder="DD/MM/YYYY" 
                                pattern="\\d{2}/\\d{2}/\\d{4}" 
                                title="Date format: DD/MM/YYYY" 
                                onchange="updateHolidayDateFromText(${idx}, this.value)" 
                                ${canEdit ? '' : 'disabled'}>
                            <button type="button" class="btn btn-outline-secondary position-relative p-0 px-2 d-flex align-items-center justify-content-center" 
                                style="overflow: hidden;" ${canEdit ? '' : 'disabled'} title="Select date from calendar">
                                <i class="bi bi-calendar3"></i>
                                <input type="date" class="position-absolute top-0 start-0 w-100 h-100 opacity-0 cursor-pointer" 
                                    value="${parseDateDMYToISO(h.date)}" 
                                    tabindex="-1" 
                                    aria-label="Pick date" 
                                    onchange="updateHolidayField(${idx}, 'date', this.value)" 
                                    ${canEdit ? '' : 'disabled'}>
                            </button>
                        </div>
                    </td>
                    <td class="text-center align-middle small text-muted px-2">${dayName}</td>
                    <td class="align-middle p-1">
                        <input type="text" class="form-control form-control-sm" value="${h.name || ''}" 
                            placeholder="Holiday title..." 
                            onchange="updateHolidayField(${idx}, 'name', this.value)" 
                            ${canEdit ? '' : 'disabled'}>
                    </td>
                    <td class="align-middle p-1">
                        <select class="form-select form-select-sm holiday-company-row" 
                            onchange="updateHolidayField(${idx}, 'company', this.value)" 
                            ${canEdit ? '' : 'disabled'}>
                        </select>
                    </td>
                    ${matrixCellsHtml}
                    <td class="text-center align-middle p-1">
                        <div class="btn-group btn-group-sm">
                            <button type="button" class="btn btn-outline-secondary" onclick="toggleHolidayRowAll(${idx})" title="Toggle All Cells" ${canEdit ? '' : 'disabled'}>
                                <i class="bi bi-check2-all"></i>
                            </button>
                            <button type="button" class="btn btn-outline-danger" onclick="deleteHolidayRow(${idx})" title="Delete Holiday" ${canEdit ? '' : 'disabled'}>
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `);
            const companySelect=tr.find('.holiday-company-row');
            companySelect.append(new Option('All','All'));
            holidayCodes.forEach(code=>companySelect.append(new Option(code,code)));
            companySelect.val(h.company||'All');
            tbody.append(tr);
        });

        if (rowCount === 0) {
            tbody.append(`
                <tr>
                    <td colspan="12" class="text-center py-4 text-muted">
                        <i class="bi bi-calendar-x fs-3 d-block mb-2"></i>
                        No public holidays match the selected filter.
                    </td>
                </tr>
            `);
        }
    }

    function updateHolidayField(idx, field, value) {
        if (!holidays[idx]) return;
        holidays[idx][field] = value;
        if (field === 'date') {
            holidays[idx].date = parseDateDMYToISO(value);
            if (Array.isArray(holidays)) {
                holidays.sort((a, b) => {
                    const da = parseDateDMYToISO(a && a.date);
                    const db = parseDateDMYToISO(b && b.date);
                    return da.localeCompare(db);
                });
            }
            renderHolidayMgmt();
        }
    }

    function updateHolidayDateFromText(idx, val) {
        if (!holidays[idx]) return;
        const iso = parseDateDMYToISO(val);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            holidays[idx].date = iso;
        } else if (val) {
            holidays[idx].date = val;
        }
        if (Array.isArray(holidays)) {
            holidays.sort((a, b) => {
                const da = parseDateDMYToISO(a && a.date);
                const db = parseDateDMYToISO(b && b.date);
                return da.localeCompare(db);
            });
        }
        renderHolidayMgmt();
    }

    function toggleHolidayMatrixCell(idx, colKey) {
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) return;
        if (!holidays[idx]) return;
        if (!holidays[idx].matrix) holidays[idx].matrix = {};
        const cur = holidays[idx].matrix[colKey];
        holidays[idx].matrix[colKey] = (cur === 1 || cur === true) ? 0 : 1;
        renderHolidayMgmt();
    }

    function toggleHolidayRowAll(idx) {
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) return;
        if (!holidays[idx]) return;
        if (!holidays[idx].matrix) holidays[idx].matrix = {};
        const keys = HOLIDAY_MATRIX_COLS.map(c => c.key);
        const allActive = keys.every(k => holidays[idx].matrix[k] === 1 || holidays[idx].matrix[k] === true);
        const nextVal = allActive ? 0 : 1;
        keys.forEach(k => { holidays[idx].matrix[k] = nextVal; });
        renderHolidayMgmt();
    }

    function deleteHolidayRow(idx) {
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) return;
        if (!confirm(`Are you sure you want to delete "${holidays[idx]?.name || 'this holiday'}"?`)) return;
        holidays.splice(idx, 1);
        renderHolidayMgmt();
    }

    function addHolidayRow() {
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) return;
        const today = new Date().toISOString().split('T')[0];
        holidays.push({
            date: today,
            name: 'New Public Holiday',
            company: 'All',
            workBase: 'All',
            location: 'All',
            matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 }
        });
        if (Array.isArray(holidays)) {
            holidays.sort((a, b) => {
                const da = parseDateDMYToISO(a && a.date);
                const db = parseDateDMYToISO(b && b.date);
                return da.localeCompare(db);
            });
        }
        renderHolidayMgmt();
    }

    async function downloadHolidayTemplate() {
        try {
            const XLSX = (await import('xlsx-js-style')).default;
            const wb = XLSX.utils.book_new();

            const headers = ['Date', 'Public Holiday', 'Company', 'Work Base', 'Location', 'OFFICE_PG', 'OFFICE_SEL', 'SITE_PG', 'SITE_SEL', 'SITE_KL', 'SITE_NS'];
            const sourceList = (holidays && holidays.length) ? holidays : DEFAULT_2026_HOLIDAYS;
            const sampleRows = sourceList.map(h => [
                h.date || '',
                h.name || '',
                h.company || 'All',
                h.workBase || 'All',
                h.location || 'All',
                (h.matrix && (h.matrix.OFFICE_PG === 1 || h.matrix.OFFICE_PG === true)) ? 1 : 0,
                (h.matrix && (h.matrix.OFFICE_SEL === 1 || h.matrix.OFFICE_SEL === true)) ? 1 : 0,
                (h.matrix && (h.matrix.SITE_PG === 1 || h.matrix.SITE_PG === true)) ? 1 : 0,
                (h.matrix && (h.matrix.SITE_SEL === 1 || h.matrix.SITE_SEL === true)) ? 1 : 0,
                (h.matrix && (h.matrix.SITE_KL === 1 || h.matrix.SITE_KL === true)) ? 1 : 0,
                (h.matrix && (h.matrix.SITE_NS === 1 || h.matrix.SITE_NS === true)) ? 1 : 0,
            ]);

            const wsData = [headers, ...sampleRows];
            const ws = XLSX.utils.aoa_to_sheet(wsData);

            ws['!cols'] = [
                { wch: 14 }, // Date
                { wch: 42 }, // Public Holiday
                { wch: 12 }, // Company
                { wch: 12 }, // Work Base
                { wch: 12 }, // Location
                { wch: 12 }, // OFFICE_PG
                { wch: 12 }, // OFFICE_SEL
                { wch: 12 }, // SITE_PG
                { wch: 12 }, // SITE_SEL
                { wch: 12 }, // SITE_KL
                { wch: 12 }  // SITE_NS
            ];

            const headerStyle = {
                font: { bold: true, color: { rgb: "FFFFFF" } },
                fill: { fgColor: { rgb: "198754" } },
                alignment: { horizontal: "center", vertical: "center" }
            };

            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:K1');
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
                if (ws[cellAddress]) ws[cellAddress].s = headerStyle;
            }

            XLSX.utils.book_append_sheet(wb, ws, "Public Holidays");
            XLSX.writeFile(wb, "PeopleOS_Public_Holidays_Template_2026.xlsx");
        } catch (e) {
            console.error("Failed to download holiday template:", e);
            alert("Error downloading holiday template: " + e.message);
        }
    }

    async function handleHolidayFileUpload(event) {
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) {
            alert('Admin or HR access required to upload holidays.');
            return;
        }
        const file = event?.target?.files?.[0];
        if (!file) return;

        try {
            const XLSX = (await import('xlsx-js-style')).default;
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

            if (!rawRows || rawRows.length < 2) {
                alert('No holiday data found in the uploaded file.');
                return;
            }

            const headerRow = rawRows[0].map(h => String(h || '').trim().toUpperCase().replace(/[\s_-]+/g, ''));
            const dateColIdx = headerRow.findIndex(h => h.includes('DATE'));
            const nameColIdx = headerRow.findIndex(h => h.includes('HOLIDAY') || h.includes('NAME') || h.includes('TITLE'));
            const compColIdx = headerRow.findIndex(h => h.includes('COMPANY'));
            const baseColIdx = headerRow.findIndex(h => h.includes('BASE'));
            const locColIdx = headerRow.findIndex(h => h.includes('LOC'));

            const matrixColKeys = ['OFFICE_PG', 'OFFICE_SEL', 'SITE_PG', 'SITE_SEL', 'SITE_KL', 'SITE_NS'];
            const matrixIndices = {};
            matrixColKeys.forEach(k => {
                const cleanK = k.replace('_', '');
                matrixIndices[k] = headerRow.findIndex(h => h === k || h === cleanK);
            });

            const parsedHolidays = [];
            for (let i = 1; i < rawRows.length; i++) {
                const row = rawRows[i];
                if (!row || !row.length) continue;
                const rawDate = row[dateColIdx !== -1 ? dateColIdx : 0];
                const rawName = row[nameColIdx !== -1 ? nameColIdx : 1];
                if (!rawDate && !rawName) continue;

                const normDate = parseDateDMYToISO(rawDate) || normalizeDateStr(rawDate);
                if (!normDate) continue;

                const comp = compColIdx !== -1 ? String(row[compColIdx] || 'All').trim() : 'All';
                const base = baseColIdx !== -1 ? String(row[baseColIdx] || 'All').trim() : 'All';
                const loc = locColIdx !== -1 ? String(row[locColIdx] || 'All').trim() : 'All';

                const matrix = {};
                matrixColKeys.forEach(k => {
                    const idx = matrixIndices[k];
                    if (idx !== -1 && row[idx] !== undefined) {
                        const val = String(row[idx]).trim();
                        matrix[k] = (val === '1' || val.toLowerCase() === 'true' || val.toLowerCase() === 'yes' || val === '✓') ? 1 : 0;
                    } else {
                        matrix[k] = 1;
                    }
                });

                parsedHolidays.push({
                    date: normDate,
                    name: String(rawName || 'Public Holiday').trim(),
                    company: comp || 'All',
                    workBase: base || 'All',
                    location: loc || 'All',
                    matrix
                });
            }

            if (parsedHolidays.length === 0) {
                alert('Could not parse any valid holidays from file. Please ensure Date and Holiday Name columns exist.');
                return;
            }

            // Merge or update into existing holidays
            const existingMap = new Map();
            (holidays || []).forEach(h => {
                const k = `${normalizeDateStr(h.date)}|${String(h.name || '').trim().toUpperCase()}`;
                existingMap.set(k, h);
            });

            parsedHolidays.forEach(ph => {
                const k = `${normalizeDateStr(ph.date)}|${String(ph.name || '').trim().toUpperCase()}`;
                existingMap.set(k, ph);
            });

            holidays = Array.from(existingMap.values()).sort((a, b) => {
                const da = parseDateDMYToISO(a && a.date);
                const db = parseDateDMYToISO(b && b.date);
                return da.localeCompare(db);
            });

            renderHolidayMgmt();
            await syncHolidaysToDB();
            alert(`Successfully loaded ${parsedHolidays.length} holidays from file and synced to backend!`);
        } catch (err) {
            console.error('Failed to parse holiday file:', err);
            alert('Error parsing holiday file: ' + err.message);
        } finally {
            if (event.target) event.target.value = '';
        }
    }

    function loadDefault2026HolidayMatrix() {
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) return;
        if (!confirm("Merge the 2026 preset into the current schedule? Existing custom records and other years will be preserved. Review all dates and entitlements before saving.")) return;
        const ids = new Set(holidays.map(h => [parseDateDMYToISO(h.date),String(h.name||'').trim().toUpperCase(),String(h.company||'All').trim().toUpperCase()].join('|')));
        DEFAULT_2026_HOLIDAYS.forEach(h => {
            const id=[parseDateDMYToISO(h.date),String(h.name||'').trim().toUpperCase(),String(h.company||'All').trim().toUpperCase()].join('|');
            if(!ids.has(id)){holidays.push(JSON.parse(JSON.stringify(h)));ids.add(id);}
        });
        if (Array.isArray(holidays)) {
            holidays.sort((a, b) => {
                const da = parseDateDMYToISO(a && a.date);
                const db = parseDateDMYToISO(b && b.date);
                return da.localeCompare(db);
            });
        }
        renderHolidayMgmt();
        alert("2026 preset merged without deleting existing entries. Check every holiday date and entitlement before saving to DB.");
    }

    async function syncHolidaysToDB() { 
        if (!isAdmin && !['Admin', 'HR'].includes(currentUser?.role)) return;
        if (Array.isArray(holidays)) {
            holidays.sort((a, b) => {
                const da = parseDateDMYToISO(a && a.date);
                const db = parseDateDMYToISO(b && b.date);
                return da.localeCompare(db);
            });
        }
        const btn = $('#saveHolBtn');
        btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true); 
        try {
            const res = await apiPost('saveHolidays', holidays); 
            if (res && res.status === 'success') {
                btn.html('<i class="bi bi-cloud-arrow-up-fill me-1"></i> Saved!').prop('disabled', false); 
                setTimeout(() => { btn.html('<i class="bi bi-cloud-arrow-up-fill me-1"></i> Save Holidays to DB'); }, 2500);
                alert("Holidays saved to database successfully!");
                if (globalData && globalData.length) {
                    renderSummaryDashboard();
                    renderDashboard();
                }
            } else {
                btn.html('<i class="bi bi-exclamation-triangle me-1"></i> Save Failed').prop('disabled', false);
                alert(res?.message || 'Failed to save holidays.');
            }
        } catch(e) {
            btn.html('<i class="bi bi-exclamation-triangle me-1"></i> Save Failed').prop('disabled', false);
            alert('Error saving holidays: ' + e.message);
        }
    }

    function handleStatusChange() {
        if ($('#staffStatus').val() === 'Resigned') {
            $('#divResignDate').show();
            if (!$('#staffResignDate').val()) {
                const today = new Date();
                const localStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                $('#staffResignDate').val(localStr);
            }
        } else {
            $('#divResignDate').hide();
            $('#staffResignDate').val('');
        }
    }

    function toggleForgotPass(showForgot) {
        if (showForgot) {
            $('#loginBox').hide();
            $('#forgotPassBox').fadeIn();
            $('#resetError, #resetSuccess').hide();
            $('#resetUser, #resetIc, #resetNewPass').val('');
        } else {
            $('#forgotPassBox').hide();
            $('#loginBox').fadeIn();
            $('#loginError').hide();
        }
    }

    async function processResetPassword() {
        const user = $('#resetUser').val().trim();
        const ic = $('#resetIc').val().trim();
        const newPass = $('#resetNewPass').val();

        if (!user || !ic || !newPass) {
            return $('#resetError').text("All fields are required.").show();
        }

        const icRegex = /^\d{6}-\d{2}-\d{4}$/;
        if (!icRegex.test(ic)) {
            return $('#resetError').text("IC No must be strictly in xxxxxx-xx-xxxx format.").show();
        }

        $('#btnResetPass').html('<span class="spinner-border spinner-border-sm"></span>').prop('disabled', true);
        $('#resetError, #resetSuccess').hide();

        const res = await apiPost('resetPassword', { username: user, icNo: ic, newPassword: newPass });
        
        if (res.status === 'success') {
            $('#resetSuccess').text("Password reset successful! You can now login.").show();
            setTimeout(() => toggleForgotPass(false), 3000);
        } else {
            $('#resetError').text(res.message).show();
        }
        $('#btnResetPass').text('Reset Password').prop('disabled', false);
    }

    async function fetchActionCount() {
        try {
            const res = await apiPost('getActionCount', {});
            if (res && res.status === 'success' && res.data) {
                window.dispatchEvent(new CustomEvent('hr-action-count', { detail: res.data }));
                return res.data;
            }
        } catch (e) {
            // Non-blocking
        }
        return { total: 0 };
    }


export const dashboardActions = { isStaffOtEligible, updateStaffOtBadge, addStaffAllowanceRow, removeStaffAllowanceRow, recalcStaffAllowanceTotal, addStaffResourceRow, removeStaffResourceRow, handleResourceReturnedChange, downloadHolidayTemplate, handleHolidayFileUpload, confirmLeaveDecision, renderMyLeaveHistory, filterStaffCards, renderSummaryDashboard, renderPie, resetPie, getTieredWage, calcStatutory, calculatePeriodDataRange, processLogin, applyUserRoleUI, logout, switchTab, switchMobileTab, fetchPayslips, formatMonthStr, renderSelectedPayslip, closePayslip, printPayslip, handleLeaveTypeChange, loadStaffPortal, loadMyProfile, updateMyProfile, calculateLeaveDays, handleLeaveFileUpload, handleHalfDayChange, submitLeaveApp, fetchMyLeave, withdrawLeave, fetchLeaveManagementData, processLeave, toggleSummaryView, toggleReportType, formatTimeForInput, generateColors, apiPost, formatLocalDate, formatDateDMY, parseDateDMYToISO, initializeApp, calculateStats, handleFile, parseData, generatePayrollData, lockCurrentMonth, unlockCurrentMonth, renderDashboard, syncToGoogleSheets, openEditModal, saveRowEdit, updateStaffAttendanceRemark, buildTable, handleReportExport, exportOTClaimForm, exportSummaryRange, exportToExcel, renderStaffMgmt, handleStaffFileUpload, addNewStaff, openStaffModal, saveStaffProfile, saveBiometricLocally, uploadStaffDocuments, saveStaffPayslipToFolder, saveRateLocally, syncSingleStaff, deleteStaff, renderHolidayMgmt, addHolidayRow, syncHolidaysToDB, toggleHolidayMatrixCell, toggleHolidayRowAll, deleteHolidayRow, loadDefault2026HolidayMatrix, updateHolidayField, updateHolidayDateFromText, handleStatusChange, toggleForgotPass, processResetPassword, checkSplitLeaveOffer, enableSplitLeave, handleSplitDaysInput, handleAttendanceCompanyChange, handleAttendanceDepartmentChange, handleStaffCompanyFilterChange, setStaffViewMode, populateAttendanceFilters, populateStaffFilters, handleSummaryCompanyChange, populateSummaryFilters, recommendAttendanceHOD, approveAttendanceHR, rejectAttendanceApproval, fetchActionCount, findStaffSetting, isRecordForStaff, getStaffSettings: () => staffSettings };

if (typeof window !== 'undefined') {
    window.dashboardActions = dashboardActions;
    window.isStaffOtEligible = isStaffOtEligible;
    window.updateStaffOtBadge = updateStaffOtBadge;
    window.addStaffAllowanceRow = addStaffAllowanceRow;
    window.removeStaffAllowanceRow = removeStaffAllowanceRow;
    window.recalcStaffAllowanceTotal = recalcStaffAllowanceTotal;
    window.addStaffResourceRow = addStaffResourceRow;
    window.removeStaffResourceRow = removeStaffResourceRow;
    window.handleResourceReturnedChange = handleResourceReturnedChange;
    window.downloadHolidayTemplate = downloadHolidayTemplate;
    window.handleHolidayFileUpload = handleHolidayFileUpload;
    window.updateStaffAttendanceRemark = updateStaffAttendanceRemark;
    window.switchTab = switchTab;
    window.recommendAttendanceHOD = recommendAttendanceHOD;
    window.approveAttendanceHR = approveAttendanceHR;
    window.rejectAttendanceApproval = rejectAttendanceApproval;
    window.unlockCurrentMonth = unlockCurrentMonth;
    window.toggleHolidayMatrixCell = toggleHolidayMatrixCell;
    window.toggleHolidayRowAll = toggleHolidayRowAll;
    window.deleteHolidayRow = deleteHolidayRow;
    window.loadDefault2026HolidayMatrix = loadDefault2026HolidayMatrix;
    window.updateHolidayField = updateHolidayField;
    window.updateHolidayDateFromText = updateHolidayDateFromText;
    window.addHolidayRow = addHolidayRow;
    window.syncHolidaysToDB = syncHolidaysToDB;
    window.renderHolidayMgmt = renderHolidayMgmt;
    window.formatDateDMY = formatDateDMY;
    window.parseDateDMYToISO = parseDateDMYToISO;
}

export function mountDashboard() {
 Object.assign(window, dashboardActions);
 Object.defineProperty(window, "holidays", { configurable: true, get: () => holidays });
 initializeDashboard();
}

async function loadBootstrapData() {
  const role = currentUser?.role || 'Staff';
  const isManagerOnly = ['HOD', 'Supervisor'].includes(role);
  if (isManagerOnly) {
    try {
      const res = await apiPost('getAttendanceApproval', { includeData: true });
      if (res && res.status === 'success' && res.data) {
        const d = res.data;
        return [
          { status: 'success', data: d.staff || {} },
          { status: 'success', data: d.holidays || [] },
          { status: 'success', data: d.data || [] },
          { status: 'success', data: d.attendance || [] },
          { status: 'success', data: d.lockedMonths || {} },
          { status: 'success', data: d.leaves || [] }
        ];
      }
      return Array(6).fill(res || { status: 'error', message: 'Attendance approval data unavailable.' });
    } catch (e) {
      return Array(6).fill({ status: 'error', message: e.message || 'Attendance approval data unavailable.' });
    }
  }
  try {
    const res = await apiPost('getBootstrap', {});
    if (res.staleSession) return Array(6).fill(res);
    if (res.status === 'success' && res.data && res.data.staff) {
      const d = res.data;
      return [d.staff, d.holidays, d.data, d.attendance, d.lockedMonths, d.leaves];
    }
    const unsupported = res.code === 'UNSUPPORTED_ACTION' || /^(unknown|unsupported) action[.!]?$/i.test(String(res.message || '').trim());
    if (!unsupported) return Array(6).fill(res.status === 'success' ? {status: 'error', message: 'Startup response is incomplete.'} : res);
  } catch (e) { return Array(6).fill({ status: 'error', message: e.message || 'Startup request failed.' }); }
  return Promise.all([
    ...['getStaff','getHolidays','getData','getAttendance','getLockedMonths']
      .map(action => apiPost(action, {})),
    apiPost('getLeaveData', {role:'Admin'})
  ]);
}

function filterStaffCards() {
  const query = String($('#staffSearch').val() || '').trim().toLowerCase();
  const status = $('#staffStatusFilter').val() || 'all';
  const company = $('#staffCompanyFilter').val() || 'all';
  const department = $('#staffDepartmentFilter').val() || 'all';
  const cards = $('#staffCardsContainer .staff-record');
  let visible = 0;
  cards.each(function() {
    const el = $(this);
    const recStatus = el.attr('data-staff-status') || '';
    const recComp = el.attr('data-staff-company') || '';
    const recCompId = el.attr('data-staff-company-id') || '';
    const recDept = el.attr('data-staff-department') || '';
    const recDeptId = el.attr('data-staff-department-id') || '';
    const text = el.text().toLowerCase();

    const matchQuery = !query || text.includes(query);
    const matchStatus = (status === 'all') || (recStatus === status);
    const matchCompany = (company === 'all') || (recComp === company) || (recCompId === company);
    const matchDept = (department === 'all') || (recDept === department) || (recDeptId === department);

    const match = matchQuery && matchStatus && matchCompany && matchDept;
    el.toggleClass('d-none', !match);
    if (match) visible++;
  });
  $('#staffResultCount').text(`${visible} of ${cards.length} staff`);
  $('#staffSearchEmpty').toggle(visible === 0);
}

