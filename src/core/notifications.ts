// Lập kế hoạch thông báo cục bộ. Không gọi AI cho từng thông báo.
import { AppState, LocalDate, TaskOccurrence } from "./types";
import { addDays, MINUTE, parseHHMM, todayIn, zonedParts, zonedToUtc, fmtLocalTime } from "./time";
import { dayOccurrences, effective, materializeRange } from "./schedule";
import { summaryCutoff, upsertSummary } from "./evaluation";

export type NotifKind = "nhac-truoc" | "den-gio" | "hoi-nhe" | "tong-ket";
export interface PlannedNotification {
  id: number;          // int32 dương, ổn định theo (lần thực hiện, loại)
  key: string;
  kind: NotifKind;
  atMs: number;
  title: string;
  body: string;
  occurrenceId?: string;
  actionTypeId?: string;
  signature: string;   // để biết có cần lập lại hay không
}

export const HORIZON_DAYS = 3;
export const MAX_PENDING = 64;

export function notifIdFor(key: string): number {
  // FNV-1a 32-bit, ép về dương 31 bit; 0 được tránh
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 1) || 1;
}

export function inQuietHours(ms: number, state: AppState): boolean {
  const q = state.notificationSettings.quietHours;
  if (!q) return false;
  const s = parseHHMM(q.start), e = parseHHMM(q.end);
  if (s === null || e === null || s === e) return false;
  const m = zonedParts(ms, state.profile.timeZone).minutes;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

const EMOJI = ["🌱", "🐣", "☀️", "🍃"];

export function texts(kind: NotifKind, title: string, durationMin: number, startLabel: string, style: "dang-yeu" | "ngan-gon", hide: boolean): { title: string; body: string } {
  const name = hide ? "việc đã lên lịch" : title;
  const cute = style === "dang-yeu";
  switch (kind) {
    case "nhac-truoc":
      return { title: cute ? "🍃 Sắp tới giờ rồi" : "Sắp đến giờ", body: cute ? `${startLabel} mình có ${name} nhé. Chuẩn bị nhẹ nhàng thôi.` : `${startLabel}: ${name}` };
    case "den-gio":
      return { title: cute ? `${EMOJI[0]} Đến giờ rồi` : "Đến giờ", body: cute ? `Đến giờ dành ${durationMin} phút cho ${name} rồi. Mình bắt đầu nhé?` : `${name} (${durationMin} phút)` };
    case "hoi-nhe":
      return { title: cute ? `${EMOJI[1]} Có vẻ bạn đang bận` : "Chưa có phản hồi", body: cute ? `Dời ${name} thêm 10 phút nhé? Hoặc bạn đã làm rồi thì cập nhật giúp mình nhé.` : `Bạn đã làm ${name} chưa? Cập nhật giúp mình nhé.` };
    case "tong-ket":
      return { title: cute ? "🌙 Nhìn lại hôm nay" : "Tổng kết ngày", body: "" };
  }
}

export function planNotifications(state0: AppState, nowMs: number): { state: AppState; list: PlannedNotification[] } {
  const ns = state0.notificationSettings;
  const tz = state0.profile.timeZone;
  const today = todayIn(tz, nowMs);
  let state = materializeRange(state0, today, HORIZON_DAYS, nowMs);
  const out: PlannedNotification[] = [];
  if (!ns.enabled) return { state, list: out };
  const paused = (ms: number) => ns.pausedUntil !== null && ms < ns.pausedUntil;

  for (let d = 0; d < HORIZON_DAYS; d++) {
    const date = addDays(today, d);
    for (const o of dayOccurrences(state, date)) {
      if (o.status !== "chua-bat-dau") continue; // đã phản hồi ⇒ không nhắc nữa
      out.push(...forOccurrence(state, o, nowMs, paused));
    }
    const sumAt = summaryCutoff(state, date);
    const done = state.summaries[date]?.notifiedAt;
    if (!done && sumAt > nowMs && !paused(sumAt)) {
      const key = `sum@${date}`;
      const t = texts("tong-ket", "", 0, "", ns.style, ns.hideOnLockScreen);
      out.push({ id: notifIdFor(key), key, kind: "tong-ket", atMs: sumAt, title: t.title, body: "Xem lại một chút để ngày mai dễ thở hơn nhé.", signature: `${key}|${sumAt}`, actionTypeId: undefined });
    }
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return { state, list: out.slice(0, MAX_PENDING) };
}

function forOccurrence(state: AppState, o: TaskOccurrence, nowMs: number, paused: (ms: number) => boolean): PlannedNotification[] {
  const ns = state.notificationSettings;
  const eff = effective(state, o);
  const startLabel = fmtLocalTime(o.planned.startMs, o.timeZone);
  const candidates: { kind: NotifKind; at: number }[] = [];
  if (eff.remindBeforeMin && eff.remindBeforeMin > 0) candidates.push({ kind: "nhac-truoc", at: o.planned.startMs - eff.remindBeforeMin * MINUTE });
  candidates.push({ kind: "den-gio", at: o.planned.startMs });
  candidates.push({ kind: "hoi-nhe", at: o.planned.startMs + Math.max(1, eff.graceMin) * MINUTE });
  // Tối đa N thông báo/việc tính cả nhắc trước (mặc định 2). Ưu tiên giữ "đến giờ".
  const max = Math.max(1, ns.maxPerTask);
  let chosen = candidates;
  if (chosen.length > max) {
    const keepDue = chosen.filter((c) => c.kind === "den-gio");
    const others = chosen.filter((c) => c.kind !== "den-gio");
    chosen = [...keepDue, ...others.slice(0, max - 1)].sort((a, b) => a.at - b.at);
  }
  const res: PlannedNotification[] = [];
  for (const c of chosen) {
    if (c.at <= nowMs) continue;       // không gửi bù thông báo cũ
    if (inQuietHours(c.at, state)) continue;
    if (paused(c.at)) continue;
    const key = `${o.id}#${c.kind}`;
    const t = texts(c.kind, eff.title, eff.durationMin, startLabel, ns.style, ns.hideOnLockScreen);
    res.push({ id: notifIdFor(key), key, kind: c.kind, atMs: c.at, title: t.title, body: t.body, occurrenceId: o.id, actionTypeId: c.kind === "hoi-nhe" ? "NS_FOLLOWUP" : "NS_TASK", signature: `${key}|${c.at}|${t.title}|${t.body}` });
  }
  return res;
}

/** So sánh danh sách mong muốn với danh sách đang chờ để chỉ hủy/lập những gì thay đổi (tránh trùng). */
export function diffNotifications(desired: PlannedNotification[], pending: { id: number; signature?: string }[]) {
  const want = new Map(desired.map((n) => [n.id, n]));
  const cancel: number[] = [];
  const keep = new Set<number>();
  for (const p of pending) {
    const w = want.get(p.id);
    if (!w || w.signature !== p.signature) cancel.push(p.id);
    else keep.add(p.id);
  }
  const schedule = desired.filter((n) => !keep.has(n.id));
  return { cancel, schedule };
}

/** Nội dung thông báo tổng kết, dựa trên báo cáo cục bộ. */
export function summaryMessage(state: AppState, date: LocalDate, nowMs: number): { state: AppState; title: string; body: string } {
  const s = upsertSummary(state, date, nowMs);
  const sum = s.summaries[date]!;
  const dev = sum.deviatedConfirmed.length, unc = sum.unconfirmed.length;
  let body: string;
  if (sum.thresholdReached) body = `Hôm nay có ${dev} việc lệch giờ. Mình cùng sắp lại ngày mai cho dễ thở hơn nhé.`;
  else if (unc > 0) body = `Còn ${unc} việc chưa cập nhật. Ghé xem giúp mình nhé.`;
  else body = `Bạn đã hoàn thành ${sum.completed} việc hôm nay. Nghỉ ngơi nhé.`;
  return { state: s, title: "🌙 Nhìn lại hôm nay", body };
}

export { zonedToUtc };
