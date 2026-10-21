/**
 * PplosHR Date Utilities (Kuala Lumpur UTC+8 Timezone) - CommonJS
 */

function formatDateKL(value, style = 'iso') {
  if (!value) return '';
  if (value === 'N/A' || value === '-') return '';
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const str = String(value).trim();
    if (!str || str === 'N/A' || str === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      if (style === 'display') {
        const [y, m, day] = str.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${Number(day)} ${months[Number(m) - 1]} ${y}`;
      }
      return str;
    }
    d = new Date(str);
  }
  if (isNaN(d.getTime())) return String(value).slice(0, 10);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.format(d);
  if (style === 'display') {
    const [y, m, day] = parts.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number(day)} ${months[Number(m) - 1]} ${y}`;
  }
  return parts;
}

function formatDateTimeKL(value, style = 'display') {
  if (!value) return '';
  const str = String(value).trim();
  if (!str || str === 'N/A' || str === '-') return '';

  let d;
  if (value instanceof Date) {
    d = value;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(str)) {
    d = new Date(str + '+08:00');
  } else {
    d = new Date(str);
  }

  if (isNaN(d.getTime())) return str;

  if (style === 'iso') {
    const dStr = formatDateKL(d, 'iso');
    const tStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
    return `${dStr} ${tStr}`;
  }

  const dateFormatted = formatDateKL(d, 'display');
  const timeFormatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);

  return `${dateFormatted}, ${timeFormatted}`;
}

function formatDateOrTimeKL(value, style = 'display') {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  if (str.includes('T') || (str.includes(':') && str.length > 8)) {
    return formatDateTimeKL(value, style);
  }
  return formatDateKL(value, style);
}

function formatRangeKL(startVal, endVal, style = 'display') {
  if (!startVal && !endVal) return '';
  if (!endVal || startVal === endVal) return formatDateOrTimeKL(startVal, style);
  const s = formatDateOrTimeKL(startVal, style);
  const e = formatDateOrTimeKL(endVal, style);
  return `${s} to ${e}`;
}

function formatDateDMY(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str || str === 'N/A' || str === '-') return '';
  // If already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
  // If YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  // Try Date object or timestamp
  const dateObj = value instanceof Date ? value : new Date(str);
  if (!isNaN(dateObj.getTime())) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(dateObj);
  }
  return str;
}

function parseDateDMYToISO(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // If DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // If YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try Date parse
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  }
  return str;
}

module.exports = { formatDateKL, formatDateTimeKL, formatDateOrTimeKL, formatRangeKL, formatDateDMY, parseDateDMYToISO };
