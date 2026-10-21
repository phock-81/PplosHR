/**
 * Read-only attendance view: one workday row per employee.
 * Combines authenticated/confirmed mobile GPS punches with biometric import records.
 * IN = earliest valid record; OUT = latest valid record, regardless of source.
 * No payroll mutation. MYT day boundaries; a next-morning OUT can close an open night shift.
 */
const tz = 'Asia/Kuala_Lumpur';
const mytDate = date => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const ymd = value => {
  if (value instanceof Date) return mytDate(value);
  let s = String(value||'').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return '';
};
const wallMins = time => {
  if (time == null || /^[-—]$/.test(String(time).trim())) return null;
  const s=String(time).trim();
  const m=s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h=Number(m[1]), minute=Number(m[2]);
  if (minute>59 || h>(m[3]?12:23) || h<0) return null;
  if (m[3]) {if (h===12)h=0;if (m[3].toUpperCase()==='PM')h+=12;}
  return h*60+minute;
};
const formatMins = minutes => `${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}${minutes>=1440?' (+1d)':''}`;
const previousDay = day => { const date=new Date(day+'T00:00:00Z'); date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10); };
function rowFor(map, day, employeeName) {
  if (!map.has(day))map.set(day,{Date:day,date:day,Name:employeeName,name:employeeName,ClockIn:'—',ClockOut:'—',In:'—',Out:'—',OT:'0.0',Late:false,inCandidates:[],outCandidates:[]});
  return map.get(day);
}
export function mergeAttendancePunches({imported=[],mobileEvents=[],joinedDate='',resignDate='',month='',employeeName=''}) {
  const map = new Map();
  const insert = (day,kind,raw,source,evt) => {
    if (!day) return;
    if (joinedDate && day < joinedDate) return;
    if (resignDate && day > resignDate) return;
    const minutes=wallMins(raw);if(minutes==null)return;
    const rec=rowFor(map,day,employeeName);
    const c={time:formatMins(minutes),mins:minutes,source,evt};
    (kind==='IN'?rec.inCandidates:rec.outCandidates).push(c);
    if(source==='Mobile'){
      rec.hasMobilePunch=true;
      if(evt?.photolink || /^https:\/\//.test(evt?.photo||''))rec.photo=evt.photolink || evt.photo;
    }
  };
  for(const r of imported){
    const day=ymd(r.Date||r.date);if(!day||day<joinedDate||(resignDate&&day>resignDate))continue;
    const rec=rowFor(map,day,employeeName);
    // Multiple biometric records on one day must ACCUMULATE, never overwrite.
    if(r.OT!=null)rec.OT=r.OT;
    if(r.Late)rec.Late=true;
    if(r.remark)rec.remark=r.remark;
    if(r.shift)rec.shift=r.shift;
    insert(day,'IN',r.ClockIn&&r.ClockIn!=='—'?r.ClockIn:r.In,'Biometric');
    insert(day,'OUT',r.ClockOut&&r.ClockOut!=='—'?r.ClockOut:r.Out,'Biometric');
  }
  for(const evt of mobileEvents){
    if (!evt || evt.isOffline || (evt.status && evt.status!=='Recorded'))continue;
    const ms=Date.parse(evt.serverTime||'');if(!Number.isFinite(ms))continue;
    const day=ymd(evt.date)||mytDate(new Date(ms));
    if (resignDate && day > resignDate) continue;
    const time=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms));
    insert(day,String(evt.type).toUpperCase(),time,'Mobile',evt);
  }
  // Attach an early next-morning OUT to an unfinished night shift. Avoid reassigning
  // a morning punch on a day that already has an IN before the OUT.
  for(const [day,rec] of [...map].sort((a,b)=>a[0].localeCompare(b[0]))){
    const prev=map.get(previousDay(day));
    if(!prev || !rec.outCandidates.length || !prev.inCandidates.length || prev.outCandidates.length)continue;
    const overnightStart=Math.max(...prev.inCandidates.map(c=>c.mins));
    if(overnightStart<17*60)continue;
    const candidates=rec.outCandidates.filter(c=>c.mins<12*60 && !rec.inCandidates.some(x=>x.mins<=c.mins));
    for(const c of candidates){prev.outCandidates.push({...c,mins:c.mins+1440,time:formatMins(c.mins+1440)});}
    if(candidates.length)rec.outCandidates=rec.outCandidates.filter(c=>!candidates.includes(c));
  }
  return [...map.values()].filter(rec=>!month||rec.Date.startsWith(month)).map(rec=>{
    const i=rec.inCandidates.slice().sort((a,b)=>a.mins-b.mins)[0];
    const latestIn=rec.inCandidates.slice().sort((a,b)=>b.mins-a.mins)[0];
    const o=rec.outCandidates.slice().sort((a,b)=>b.mins-a.mins)[0];
    if(i){
      rec.ClockIn=rec.In=i.time;
      rec.clockInSource=i.source;
      if(i.evt){
        rec.mobileIn=i.evt;
        rec.inPhoto=i.evt.photolink||i.evt.photo||'';
        rec.inAddress=i.evt.address||'';
        rec.inCheckInLocation=i.evt.checkInLocation||'';
        rec.inRemark=i.evt.remark||'';
      }
    }
    if(latestIn){rec.latestIn=latestIn.time;rec.latestInSource=latestIn.source;}
    if(o){
      const isOpen=Boolean(latestIn && o && latestIn.mins > o.mins);
      rec.isOpen=isOpen;
      if(isOpen){
        rec.ClockOut=rec.Out='—';
        rec.clockOutSource='';
        rec.interimOut=o.time;
        rec.interimOutSource=o.source;
      } else {
        rec.ClockOut=rec.Out=o.time;
        rec.clockOutSource=o.source;
        if(o.evt){
          rec.mobileOut=o.evt;
          rec.outPhoto=o.evt.photolink||o.evt.photo||'';
          rec.outAddress=o.evt.address||'';
          rec.outCheckInLocation=o.evt.checkInLocation||'';
          rec.outRemark=o.evt.remark||'';
        }
      }
    } else if(latestIn){
      rec.isOpen=true;
    }
    if(!rec.remark) rec.remark = rec.inRemark || rec.outRemark || '';
    delete rec.inCandidates;delete rec.outCandidates;
    return rec;
  }).sort((a,b)=>b.Date.localeCompare(a.Date));
}
