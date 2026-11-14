import { AppState, Confirmation, DailySummary, LocalDate, PlannedTime, Punctuality, TaskOccurrence, DeviationReason } from "./types";
import { dayOccurrences, effective } from "./schedule";
import { MINUTE, zonedToUtc } from "./time";
import { meta } from "./defaults";

export const DEVIATION_THRESHOLD = 6; // "quá 5 việc" ⇒ từ 6 lần thực hiện khác nhau

/**
 * Kế hoạch chuẩn để đánh giá: bắt đầu từ lịch gốc, áp dụng các lần sửa được thực hiện TRƯỚC hạn
 * của kế hoạch đang hiệu lực. Sửa sau hạn không thay đổi chuẩn ⇒ "dời sau khi đã lệch không xóa lệch".
 */
export function baselinePlan(state: AppState, occ: TaskOccurrence): PlannedTime {
  let plan = occ.original;
  const revs = state.revisions.filter((r) => r.occurrenceId === occ.id).sort((a, b) => a.at - b.at);
  for (const r of revs) {
    if (r.at < plan.startMs) plan = r.after;
    else break;
  }
  return plan;
}

export interface Evaluation {
  occurrenceId: string;
  confirmation: Confirmation;
  punctuality: Punctuality;
  deviated: boolean;
  due: boolean; // đã đến hạn tại thời điểm đánh giá
  tracked: boolean;
  why?: "bat-dau-muon" | "ket-thuc-muon" | "bo-qua-sau-han" | "huy-sau-han";
}

export function evaluate(state: AppState, occ: TaskOccurrence, nowMs: number): Evaluation {
  const eff = effective(state, occ);
  const tracked = eff.trackPunctuality && !eff.optional;
  const base = baselinePlan(state, occ);
  const graceMs = eff.graceMin * MINUTE;
  const due = base.startMs <= nowMs;
  const confirmed = occ.status !== "chua-bat-dau" || occ.actual.startMs !== undefined || occ.actual.endMs !== undefined;
  const confirmation: Confirmation = confirmed ? "da-phan-hoi" : "chua-xac-nhan";
  const res: Evaluation = { occurrenceId: occ.id, confirmation, punctuality: "chua-du-du-lieu", deviated: false, due, tracked };
  if (!tracked) { res.punctuality = "khong-theo-doi"; return res; }
  // Hủy/sửa trước hạn: không tính
  if (occ.status === "huy") {
    if (occ.statusAt !== undefined && occ.statusAt >= base.startMs) { res.deviated = true; res.why = "huy-sau-han"; res.punctuality = "lech-han"; }
    else res.punctuality = "khong-theo-doi";
    return res;
  }
  if (occ.status === "bo-qua") {
    if (occ.statusAt !== undefined && occ.statusAt >= base.startMs) { res.deviated = true; res.why = "bo-qua-sau-han"; res.punctuality = "lech-han"; }
    else res.punctuality = "khong-theo-doi";
    return res;
  }
  const { startMs, endMs } = occ.actual;
  if (startMs !== undefined && startMs - base.startMs > graceMs) { res.deviated = true; res.why = "bat-dau-muon"; }
  else if (endMs !== undefined && endMs - base.endMs > graceMs) { res.deviated = true; res.why = "ket-thuc-muon"; }
  if (res.deviated) res.punctuality = "lech-han";
  else if (occ.status === "hoan-thanh") res.punctuality = "dung-han";
  else if (startMs !== undefined && occ.status === "dang-lam") res.punctuality = "chua-du-du-lieu";
  return res;
}

export interface DayReport {
  date: LocalDate;
  cutoffMs: number;
  evaluations: Evaluation[];
  due: string[];
  completed: string[];
  deviatedConfirmed: string[];
  unconfirmed: string[];
  skipped: string[];
  thresholdReached: boolean;
  reasons: Partial<Record<DeviationReason, number>>;
}

/** Báo cáo ngày ở một thời điểm cắt (giờ tổng kết hoặc cuối ngày). Mỗi lần thực hiện chỉ tính một lần. */
export function dayReport(state: AppState, date: LocalDate, cutoffMs: number): DayReport {
  const occs = dayOccurrences(state, date);
  const evaluations = occs.map((o) => evaluate(state, o, cutoffMs));
  const due = evaluations.filter((e) => (e.due && state.occurrences[e.occurrenceId]!.status !== "huy") || e.deviated);
  const r: DayReport = {
    date, cutoffMs, evaluations,
    due: due.map((e) => e.occurrenceId),
    completed: occs.filter((o) => o.status === "hoan-thanh").map((o) => o.id),
    deviatedConfirmed: [...new Set(evaluations.filter((e) => e.deviated).map((e) => e.occurrenceId))],
    unconfirmed: evaluations.filter((e) => e.due && e.confirmation === "chua-xac-nhan" && e.tracked).map((e) => e.occurrenceId),
    skipped: occs.filter((o) => o.status === "bo-qua").map((o) => o.id),
    thresholdReached: false,
    reasons: {},
  };
  r.thresholdReached = r.deviatedConfirmed.length >= DEVIATION_THRESHOLD;
  for (const id of r.deviatedConfirmed) {
    const reason = state.occurrences[id]!.reason;
    if (reason) r.reasons[reason] = (r.reasons[reason] ?? 0) + 1;
  }
  return r;
}

export function summaryCutoff(state: AppState, date: LocalDate): number {
  return zonedToUtc(date, state.notificationSettings.summaryTime, state.profile.timeZone);
}

/** Lưu/cập nhật DailySummary; giữ notifiedAt để thông báo tổng kết nhiều nhất 1 lần/ngày. */
export function upsertSummary(state: AppState, date: LocalDate, nowMs: number): AppState {
  const cutoff = Math.max(summaryCutoff(state, date), Math.min(nowMs, zonedToUtc(date, "23:59", state.profile.timeZone) + MINUTE));
  const rep = dayReport(state, date, cutoff);
  const prev = state.summaries[date];
  const s: DailySummary = {
    ...(prev ?? meta("sum", nowMs, `summary-${date}`)),
    updatedAt: new Date(nowMs).toISOString(),
    date, computedAt: nowMs, cutoffMs: cutoff,
    due: rep.due.length, completed: rep.completed.length,
    deviatedConfirmed: rep.deviatedConfirmed, unconfirmed: rep.unconfirmed,
    skipped: rep.skipped.length, thresholdReached: rep.thresholdReached, reasons: rep.reasons,
    notifiedAt: prev?.notifiedAt,
  };
  return { ...state, summaries: { ...state.summaries, [date]: s } };
}
