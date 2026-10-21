const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("=== Testing Multi-Shift Auto-Detection Logic ===");

function formatTimeForInput(t) {
    if (!t) return "";
    let s = String(t).trim();
    let m = s.match(/(\d{1,2}):(\d{2})/);
    if (!m) return "";
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function calculateStatsSimulated(tIn, tOut, manualShift = "AUTO", staffCompany = "", staffProfile = null) {
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

    let assignedCodes = [];
    let pObj = staffProfile;
    if (pObj && typeof pObj === 'object') {
        if (Array.isArray(pObj.schedules) && pObj.schedules.length > 0) {
            assignedCodes = pObj.schedules.map(s => String(s).trim().toUpperCase());
        } else if (pObj.schedule) {
            assignedCodes = String(pObj.schedule).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        }
        if (!staffCompany && pObj.company) staffCompany = pObj.company;
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
        shift: sName, code: bestShift.code, totalHrs: toHM(totalWorkedMins), totalMins: totalWorkedMins,
        lateIn: lateIn, earlyOut: earlyOut, 
        payableHrs: payableDecimal, payableMins: payableMins, overlapOT: overlapOT.toFixed(1),
        extraOT: extraOT.toFixed(1), totalOT: totalOTHours, remark: remarks.join(", ")
    };
}

// Test with staff profile having multi-shifts: S1, S3, S4, F1, F2
const staff = {
    name: "Ahmad",
    company: "SQ",
    schedules: ["S1", "S3", "S4", "F1", "F2"]
};

// 1. Clock in 05:25, Out 14:35 -> Should auto-detect S1
const r1 = calculateStatsSimulated("05:25", "14:35", "AUTO", "SQ", staff);
console.log("R1 (05:25 - 14:35):", r1.shift);
assert.strictEqual(r1.code, "S1");

// 2. Clock in 05:30, Out 17:30 -> Should auto-detect F1
const r2 = calculateStatsSimulated("05:30", "17:30", "AUTO", "SQ", staff);
console.log("R2 (05:30 - 17:30):", r2.shift);
assert.strictEqual(r2.code, "F1");

// 3. Clock in 14:25, Out 23:35 -> Should auto-detect S3
const r3 = calculateStatsSimulated("14:25", "23:35", "AUTO", "SQ", staff);
console.log("R3 (14:25 - 23:35):", r3.shift);
assert.strictEqual(r3.code, "S3");

// 4. Clock in 22:55, Out 08:05 -> Should auto-detect S4
const r4 = calculateStatsSimulated("22:55", "08:05", "AUTO", "SQ", staff);
console.log("R4 (22:55 - 08:05):", r4.shift);
assert.strictEqual(r4.code, "S4");

// 5. Clock in 11:30, Out 23:30 -> Should auto-detect F2
const r5 = calculateStatsSimulated("11:30", "23:30", "AUTO", "SQ", staff);
console.log("R5 (11:30 - 23:30):", r5.shift);
assert.strictEqual(r5.code, "F2");

console.log("ALL 5 MULTI-SHIFT AUTO-DETECTION TESTS PASSED SUCCESSFULLY!");
