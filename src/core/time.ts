// Xử lý thời gian theo múi giờ IANA của lịch, không phụ thuộc múi giờ thiết bị.

export const MINUTE = 60_000;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try { dtf(tz); return true; } catch { return false; }
}

export interface ZonedParts { date: string; time: string; weekday: number; minutes: number }

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Thành phần ngày/giờ của một thời điểm (ms UTC) tại múi giờ cho trước. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of dtf(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hh = parts.hour === "24" ? "00" : parts.hour!;
  const time = `${hh}:${parts.minute}`;
  return { date, time, weekday: WD[parts.weekday!] ?? 0, minutes: Number(hh) * 60 + Number(parts.minute) };
}

function offsetAt(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const sec = new Date(ms).getUTCSeconds();
  const asUtc = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), Math.floor(p.minutes / 60), p.minutes % 60, sec);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Đổi ngày + giờ địa phương (theo múi giờ lịch) thành ms UTC.
 * Giờ không tồn tại (nhảy DST) được đẩy về sau; giờ lặp lại chọn lần đầu.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = offsetAt(naive - 0, timeZone);
  let guess = naive - o1;
  const o2 = offsetAt(guess, timeZone);
  if (o2 !== o1) {
    const alt = naive - o2;
    // Chọn kết quả khớp đúng giờ địa phương nếu có
    if (zonedParts(alt, timeZone).time === time) guess = alt;
    else guess = Math.max(guess, alt);
  }
  // lần đầu trong giờ lặp
  const earlier = guess - 60 * MINUTE;
  const ep = zonedParts(earlier, timeZone);
  if (ep.date === date && ep.time === time) guess = earlier;
  return guess;
}

export function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function fmtHHMM(totalMinutes: number): string {
  const t = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function compareDate(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function todayIn(timeZone: string, now = Date.now()): string { return zonedParts(now, timeZone).date; }

export function fmtLocalTime(ms: number, timeZone: string): string { return zonedParts(ms, timeZone).time; }

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

const VI_WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export function viWeekday(n: number): string { return VI_WD[n] ?? ""; }
export function viDate(date: string): string {
  return `${viWeekday(weekdayOf(date))}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
