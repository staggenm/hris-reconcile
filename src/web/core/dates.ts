// Date normalization: "2026-02-01", "01/02/2026", "1 Feb 2026" and
// "01-FEB-2026" all reduce to the ISO date "2026-02-01". Year-first dates are
// unambiguous; for all-numeric day/month dates the field's order (dmy or mdy)
// decides. A time of midnight is dropped; any other time is kept as hh:mm:ss.

export type DateOrder = "dmy" | "mdy";

const MONTHS: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, {
  jan: 1, january: 1, januar: 1, jän: 1,
  feb: 2, february: 2, februar: 2,
  mar: 3, march: 3, mär: 3, mrz: 3, märz: 3,
  apr: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dez: 12, dezember: 12,
});

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Two-digit years follow the spreadsheet convention: 00–29 → 2000s, 30–99 → 1900s.
function fullYear(text: string): number {
  const year = Number(text);
  if (text.length === 4) return year;
  return year < 30 ? 2000 + year : 1900 + year;
}

function iso(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function splitTime(value: string): { date: string; time: string | null } | null {
  const match = /^(.*?)(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|[AaPp][Mm])?)?$/.exec(value);
  if (!match) return null;
  const [, date, hours, minutes, seconds = "00", suffix] = match;
  if (hours === undefined) return { date, time: null };
  let hour = Number(hours);
  if (suffix && /^[ap]m$/i.test(suffix)) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (/^p/i.test(suffix) ? 12 : 0);
  }
  if (hour > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
  const time = `${String(hour).padStart(2, "0")}:${minutes}:${seconds}`;
  return { date, time: time === "00:00:00" ? null : time };
}

function parseDatePart(text: string, order: DateOrder): string | null {
  let match = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text);
  if (match) return iso(Number(match[1]), Number(match[3]), Number(match[4]));
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})$/.exec(text);
  if (match) {
    const [first, second] = [Number(match[1]), Number(match[3])];
    const [day, month] = order === "dmy" ? [first, second] : [second, first];
    return iso(fullYear(match[4]), month, day);
  }
  // Day and month name: "1 Feb 2026", "01-FEB-2026", "1. Februar 2026".
  match = /^(\d{1,2})\.?[\s\-/]*([\p{L}]+)\.?,?[\s\-/]*(\d{4}|\d{2})$/u.exec(text);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    return month ? iso(fullYear(match[3]), month, Number(match[1])) : null;
  }
  // Month name first: "Feb 1, 2026", "February 1 2026".
  match = /^([\p{L}]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/u.exec(text);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    return month ? iso(Number(match[3]), month, Number(match[2])) : null;
  }
  return null;
}

// The canonical ISO form of `value`, or null if it is not a recognizable date.
export function parseDate(value: string, order: DateOrder = "dmy"): string | null {
  const parts = splitTime(value.trim().replace(/\s+/g, " "));
  if (!parts) return null;
  const date = parseDatePart(parts.date.trim(), order);
  if (!date) return null;
  return parts.time ? `${date}T${parts.time}` : date;
}
