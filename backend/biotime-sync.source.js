// Insert-only BioTime import. Called only after doPost authentication and script lock.
function syncBioTimeAttendance_(payload, actor) {
  hrAssert_(hrAdmin_(actor), 'HR or Admin access is required.');
  const records = payload.records;
  hrAssert_(Array.isArray(records) && records.length <= 10000, 'Send at most 10000 records.');
  const clean = v => String(v == null ? '' : v).trim();
  const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v;
  const from = clean(payload.from), to = clean(payload.to);
  hrAssert_(validDate(from) && validDate(to) && from <= to, 'Invalid date range.');
  const time = (value, duration) => {
    const v = clean(value);
    if (!v || v === '-' || v === '—') return '';
    const m = /^(\d{1,3}):(\d{2})(?::00)?$/.exec(v);
    hrAssert_(m && Number(m[2]) < 60 && (duration || Number(m[1]) < 24), 'Invalid time value.');
    return m[1].padStart(2,'0')+':'+m[2];
  };
  const ss = getSpreadsheet_(), staff = ss.getSheetByName('Staff');
  const staffRows = staff.getDataRange().getDisplayValues();
  const bioCol = hrStaffCols_(staffRows[0]).bioCol;
  const byBio = new Map();
  staffRows.slice(1).forEach(r => {
    const bio = clean(r[bioCol]);
    if (!bio || !clean(r[0])) return;
    const profile = {bio, name:clean(r[0]), id:clean(r[24]) || clean(r[2]) || bio,
      company:clean(r[25]), username:clean(r[2])};
    if (!byBio.has(bio)) byBio.set(bio, []);
    byBio.get(bio).push(profile);
  });
  const dataSheet = ss.getSheetByName('Data');
  hrAssert_(dataSheet, 'Data sheet is missing.');
  const existing = [];
  ['Data','Attendance'].forEach(tab => {
    const sheet = ss.getSheetByName(tab);
    if (!sheet) return;
    sheet.getDataRange().getDisplayValues().slice(1).forEach(r => {
      if (!r.some(v=>clean(v))) return;
      const date = clean(r[2]);
      // Refuse ambiguous historic dates rather than silently introducing duplicates.
      hrAssert_(validDate(date), tab+' has a non-ISO date; standardize its date display to yyyy-MM-dd before syncing.');
      existing.push({id:clean(r[0]),name:clean(r[1]),date,
        in:clean(r[4]),out:clean(r[5]),total:clean(r[6]),tab});
    });
  });
  const lockSheet = ss.getSheetByName('LockedMonths');
  const locked = new Set(lockSheet ? lockSheet.getDataRange().getDisplayValues().slice(1).filter(r=>r[0]).map(r=>clean(r[0])) : []);
  const counts = {inserted:0,identical:0,conflicts:0,unmatched:0,ambiguous:0,locked:0,outOfRange:0};
  const issues = [], additions = [], batch = new Map(), blocked = new Set();
  const issue = (kind,bio,date) => { counts[kind]++; issues.push({kind,biometricId:bio,date}); };
  // Validate and group the whole request before any write.
  records.forEach(raw => {
    const bio = clean(raw.biometricId), date = clean(raw.date);
    hrAssert_(bio && validDate(date), 'Each row requires biometricId and ISO date.');
    const r = {bio,date,in:time(raw.in,false),out:time(raw.out,false),total:time(raw.totalHrs,true)};
    const key = bio+'|'+date;
    if (batch.has(key) && JSON.stringify(batch.get(key)) !== JSON.stringify(r)) blocked.add(key);
    else batch.set(key,r);
  });
  batch.forEach((r,key) => {
    if (blocked.has(key)) return issue('conflicts',r.bio,r.date);
    if (r.date < from || r.date > to) return issue('outOfRange',r.bio,r.date);
    const matches = byBio.get(r.bio) || [];
    if (!matches.length) return issue('unmatched',r.bio,r.date);
    if (matches.length !== 1) return issue('ambiguous',r.bio,r.date);
    const p = matches[0], month = r.date.slice(0,7);
    if (locked.has(month) || locked.has(month+'__'+p.company)) return issue('locked',r.bio,r.date);
    const old = existing.filter(e => e.date === r.date &&
      ([p.id,p.bio,p.username].filter(Boolean).includes(e.id) || e.name.toUpperCase() === p.name.toUpperCase()));
    if (old.length) {
      let same = false;
      try { same = old.every(e => time(e.in,false)===r.in && time(e.out,false)===r.out && time(e.total,true)===r.total); } catch (_) {}
      if (same) counts.identical++; else issue('conflicts',r.bio,r.date);
      return;
    }
    const weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(r.date+'T00:00:00Z').getUTCDay()];
    additions.push([p.id,p.name,r.date,weekday,r.in,r.out,r.total]);
  });
  counts.inserted = additions.length;
  const dryRun = payload.dryRun !== false;
  if (!dryRun && additions.length) {
    const first = dataSheet.getLastRow()+1;
    ensureRows_(dataSheet,first+additions.length-1);
    // Append only. Never call replaceRows_, clear(), or saveAttendance().
    const safe = additions.map(row=>row.map(v=>/^[=+@-]/.test(v) ? "'"+v : v));
    dataSheet.getRange(first,1,safe.length,7).setNumberFormat('@').setValues(safe);
  }
  return jsonResponse({status:'success',dryRun,counts,issues,
    message:dryRun?'Preview only; inserted is the number of proposed additions.':'Missing raw attendance appended. Existing records unchanged.'});
}
