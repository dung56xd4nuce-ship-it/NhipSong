import { AppState, ExecEventType, ExecutionEvent, LocalDate, PlannedTime, Recurrence, TaskOccurrence, TaskTemplate } from "./types";
import { addDays, compareDate, MINUTE, parseHHMM, weekdayOf, zonedToUtc, todayIn } from "./time";
import { meta, touch } from "./defaults";

export function occursOn(r: Recurrence, date: LocalDate): boolean {
  switch (r.kind) {
    case "once": return r.date === date;
    case "daily": return compareDate(date, r.from) >= 0 && (!r.until || compareDate(date, r.until) <= 0);
    case "weekly": return compareDate(date, r.from) >= 0 && (!r.until || compareDate(date, r.until) <= 0) && r.days.includes(weekdayOf(date));
  }
}

export function startHHMM(t: TaskTemplate): string { return t.timing.kind === "fixed" ? t.timing.start : t.timing.from; }

/** Quy tắc qua nửa đêm: lần thực hiện thuộc ngày của giờ bắt đầu; giờ kết thúc có thể sang ngày hôm sau. */
export function planFor(t: TaskTemplate, date: LocalDate, timeZone: string, durationMin = t.durationMin): PlannedTime {
  const startMs = zonedToUtc(date, startHHMM(t), timeZone);
  return { startMs, endMs: startMs + durationMin * MINUTE };
}

export function occurrenceId(templateId: string, date: LocalDate): string { return `${templateId}@${date}`; }

export type Effective = Pick<TaskTemplate, "title" | "durationMin" | "graceMin" | "remindBeforeMin" | "trackPunctuality" | "optional" | "priority"> & { template: TaskTemplate };
export function effective(state: AppState, occ: TaskOccurrence): Effective {
  const t = state.templates.find((x) => x.id === occ.templateId);
  if (!t) throw new Error(`Không tìm thấy mẫu việc ${occ.templateId}`);
  return { template: t, title: t.title, durationMin: t.durationMin, graceMin: t.graceMin, remindBeforeMin: t.remindBeforeMin, trackPunctuality: t.trackPunctuality, optional: t.optional, priority: t.priority, ...occ.overrides };
}

function isUntouched(state: AppState, o: TaskOccurrence): boolean {
  return o.status === "chua-bat-dau" && !o.actual.startMs && !o.actual.endMs && Object.keys(o.overrides).length === 0
    && o.planned.startMs === o.original.startMs && o.planned.endMs === o.original.endMs
    && !state.events.some((e) => e.occurrenceId === o.id && e.type !== "tao");
}

/** Bảo đảm các lần thực hiện của một ngày đã được tạo từ mẫu. */
export function materializeDay(state: AppState, date: LocalDate, now = Date.now()): AppState {
  const tz = state.profile.timeZone;
  let occurrences = state.occurrences;
  for (const t of state.templates) {
    if (t.archived || !occursOn(t.recurrence, date)) continue;
    const id = occurrenceId(t.id, date);
    if (occurrences[id]) continue;
    const plan = planFor(t, date, tz);
    const occ: TaskOccurrence = { ...meta("occ", now, id), templateId: t.id, date, timeZone: tz, original: plan, planned: plan, overrides: {}, status: "chua-bat-dau", actual: {} };
    if (occurrences === state.occurrences) occurrences = { ...occurrences };
    occurrences[id] = occ;
  }
  return occurrences === state.occurrences ? state : { ...state, occurrences };
}

export function materializeRange(state: AppState, from: LocalDate, days: number, now = Date.now()): AppState {
  let s = state;
  for (let i = 0; i < days; i++) s = materializeDay(s, addDays(from, i), now);
  return s;
}

export function dayOccurrences(state: AppState, date: LocalDate): TaskOccurrence[] {
  return Object.values(state.occurrences)
    .filter((o) => o.date === date && state.templates.some((t) => t.id === o.templateId))
    .sort((a, b) => a.planned.startMs - b.planned.startMs);
}

export function crossesMidnight(o: TaskOccurrence): boolean {
  // so sánh ngày của giờ kết thúc (trừ 1ms để 00:00 đúng không tính sang ngày mới)
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: o.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(o.planned.endMs - 1));
  return endDate !== o.date;
}

// ---------- Mẫu việc ----------

export type TemplateInput = Omit<TaskTemplate, keyof import("./types").Meta | "archived">;

export function validateTemplateInput(t: TemplateInput): string[] {
  const errs: string[] = [];
  if (!t.title.trim()) errs.push("Tên việc không được để trống.");
  if (!(t.durationMin > 0 && t.durationMin <= 24 * 60)) errs.push("Thời lượng phải từ 1 phút đến 24 giờ.");
  if (t.timing.kind === "fixed" && parseHHMM(t.timing.start) === null) errs.push("Giờ bắt đầu không hợp lệ.");
  if (t.timing.kind === "window") {
    const a = parseHHMM(t.timing.from), b = parseHHMM(t.timing.to);
    if (a === null || b === null) errs.push("Cửa sổ thời gian không hợp lệ.");
  }
  if (t.recurrence.kind === "weekly" && t.recurrence.days.length === 0) errs.push("Chọn ít nhất một ngày lặp.");
  if (t.graceMin < 0 || t.graceMin > 240) errs.push("Khoảng gia hạn phải từ 0 đến 240 phút.");
  return errs;
}

function bump(state: AppState): AppState { return { ...state, scheduleVersion: state.scheduleVersion + 1 }; }

export function createTemplate(state: AppState, input: TemplateInput, now = Date.now()): { state: AppState; template: TaskTemplate } {
  const errs = validateTemplateInput(input);
  if (errs.length) throw new Error(errs.join(" "));
  const template: TaskTemplate = { ...meta("tpl", now), ...input, archived: false };
  let s: AppState = bump({ ...state, templates: [...state.templates, template] });
  s = materializeDay(s, todayIn(s.profile.timeZone, now), now);
  return { state: s, template };
}

export type EditScope = { kind: "one"; date: LocalDate } | { kind: "future"; date: LocalDate } | { kind: "all" };

/** Sửa mẫu việc theo phạm vi: chỉ lần này, lần này và về sau, hoặc toàn bộ chuỗi. */
export function updateTemplate(state: AppState, templateId: string, patch: Partial<TemplateInput>, scope: EditScope, now = Date.now()): AppState {
  const t = state.templates.find((x) => x.id === templateId);
  if (!t) throw new Error("Không tìm thấy việc.");
  const today = todayIn(state.profile.timeZone, now);
  if (scope.kind === "one") {
    const id = occurrenceId(templateId, scope.date);
    let s = materializeDay(state, scope.date, now);
    const occ = s.occurrences[id];
    if (!occ) throw new Error("Việc không diễn ra vào ngày này.");
    const { timing, durationMin, ...rest } = patch;
    const overrides = { ...occ.overrides };
    for (const k of ["title", "graceMin", "remindBeforeMin", "trackPunctuality", "optional", "priority"] as const) if (k in rest) (overrides as any)[k] = (rest as any)[k];
    if (durationMin !== undefined) overrides.durationMin = durationMin;
    let next: TaskOccurrence = touch({ ...occ, overrides }, now);
    s = { ...s, occurrences: { ...s.occurrences, [id]: next } };
    if (timing || durationMin !== undefined) {
      const tmp = { ...t, ...(timing ? { timing } : {}) } as TaskTemplate;
      const plan = planFor(tmp, scope.date, occ.timeZone, durationMin ?? effective(s, next).durationMin);
      s = reschedule(s, id, plan.startMs, now, "nguoi-dung", plan.endMs - plan.startMs);
    }
    return bump(s);
  }
  const merged = { ...t, ...patch } as TaskTemplate;
  const errs = validateTemplateInput(merged);
  if (errs.length) throw new Error(errs.join(" "));
  if (scope.kind === "future" && compareDate(scope.date, recurrenceStart(t.recurrence)) > 0 && t.recurrence.kind !== "once") {
    // Tách chuỗi: chuỗi cũ kết thúc hôm trước, chuỗi mới bắt đầu từ ngày chọn
    const old: TaskTemplate = touch({ ...t, recurrence: { ...t.recurrence, until: addDays(scope.date, -1) } as Recurrence }, now);
    const fresh: TaskTemplate = { ...merged, ...meta("tpl", now), recurrence: { ...(merged.recurrence as any), from: scope.date } };
    let s: AppState = { ...state, templates: state.templates.map((x) => (x.id === t.id ? old : x)).concat(fresh) };
    s = dropUntouchedFrom(s, t.id, scope.date);
    return bump(materializeDay(s, today, now));
  }
  const updated = touch(merged, now);
  let s: AppState = { ...state, templates: state.templates.map((x) => (x.id === t.id ? updated : x)) };
  // Sinh lại những lần chưa đụng tới từ hôm nay trở đi; quá khứ giữ nguyên
  s = dropUntouchedFrom(s, t.id, today);
  return bump(materializeDay(s, today, now));
}

function recurrenceStart(r: Recurrence): LocalDate { return r.kind === "once" ? r.date : r.from; }

function dropUntouchedFrom(state: AppState, templateId: string, from: LocalDate): AppState {
  const occurrences = { ...state.occurrences };
  for (const o of Object.values(occurrences)) {
    if (o.templateId === templateId && compareDate(o.date, from) >= 0 && isUntouched(state, o)) delete occurrences[o.id];
  }
  return { ...state, occurrences };
}

export function deleteTemplate(state: AppState, templateId: string, scope: EditScope, now = Date.now()): AppState {
  const t = state.templates.find((x) => x.id === templateId);
  if (!t) return state;
  if (scope.kind === "one") {
    const s = materializeDay(state, scope.date, now);
    return cancel(s, occurrenceId(templateId, scope.date), now);
  }
  const today = todayIn(state.profile.timeZone, now);
  const from = scope.kind === "future" ? scope.date : today;
  let s: AppState;
  if (t.recurrence.kind !== "once" && compareDate(from, recurrenceStart(t.recurrence)) > 0) {
    s = { ...state, templates: state.templates.map((x) => (x.id === t.id ? touch({ ...x, recurrence: { ...x.recurrence, until: addDays(from, -1) } as Recurrence }, now) : x)) };
  } else {
    s = { ...state, templates: state.templates.map((x) => (x.id === t.id ? touch({ ...x, archived: true }, now) : x)) };
  }
  // giữ lịch sử đã có phản hồi; xóa các lần chưa đụng tới
  return bump(dropUntouchedFrom(s, t.id, from));
}

// ---------- Thao tác trên lần thực hiện ----------

function record(state: AppState, occ: TaskOccurrence, next: TaskOccurrence, type: ExecEventType, now: number): AppState {
  const ev: ExecutionEvent = { ...meta("ev", now), occurrenceId: occ.id, type, at: now, before: snapshot(occ), after: snapshot(next) };
  return { ...state, occurrences: { ...state.occurrences, [occ.id]: touch(next, now) }, events: [...state.events, ev] };
}

function snapshot(o: TaskOccurrence): Partial<TaskOccurrence> {
  return { status: o.status, statusAt: o.statusAt, actual: { ...o.actual }, planned: { ...o.planned }, overrides: { ...o.overrides }, reason: o.reason };
}

function getOcc(state: AppState, id: string): TaskOccurrence {
  const o = state.occurrences[id];
  if (!o) throw new Error("Không tìm thấy lần thực hiện.");
  return o;
}

export function startTask(state: AppState, id: string, now = Date.now(), actualStartMs = now): AppState {
  const o = getOcc(state, id);
  return record(state, o, { ...o, status: "dang-lam", statusAt: now, actual: { ...o.actual, startMs: actualStartMs } }, "bat-dau", now);
}

export function completeTask(state: AppState, id: string, now = Date.now(), actual?: { startMs?: number; endMs?: number }): AppState {
  const o = getOcc(state, id);
  const endMs = actual?.endMs ?? now;
  const startMs = actual?.startMs ?? o.actual.startMs;
  return record(state, o, { ...o, status: "hoan-thanh", statusAt: now, actual: { startMs, endMs } }, "hoan-thanh", now);
}

export function skipTask(state: AppState, id: string, now = Date.now()): AppState {
  const o = getOcc(state, id);
  return record(state, o, { ...o, status: "bo-qua", statusAt: now }, "bo-qua", now);
}

export function cancel(state: AppState, id: string, now = Date.now()): AppState {
  const o = getOcc(state, id);
  return bump(record(state, o, { ...o, status: "huy", statusAt: now }, "huy", now));
}

/** Bổ sung/sửa giờ thực tế sau đó (dùng cả để sửa dữ liệu sai); tổng kết sẽ được tính lại. */
export function setActual(state: AppState, id: string, actual: { startMs?: number; endMs?: number }, status: "hoan-thanh" | "dang-lam" | "bo-qua" | "chua-bat-dau", now = Date.now()): AppState {
  const o = getOcc(state, id);
  if (actual.startMs && actual.endMs && actual.endMs < actual.startMs) throw new Error("Giờ kết thúc phải sau giờ bắt đầu.");
  const next: TaskOccurrence = { ...o, status, statusAt: status === "chua-bat-dau" ? undefined : (o.statusAt ?? now), actual: status === "bo-qua" || status === "chua-bat-dau" ? {} : actual };
  return record(state, o, next, "sua-thuc-te", now);
}

export function setReason(state: AppState, id: string, reason: TaskOccurrence["reason"], now = Date.now()): AppState {
  const o = getOcc(state, id);
  return { ...state, occurrences: { ...state.occurrences, [id]: touch({ ...o, reason }, now) } };
}

/** Dời giờ: ghi ScheduleRevision để không mất lịch sử lệch giờ. */
export function reschedule(state: AppState, id: string, newStartMs: number, now = Date.now(), source: "nguoi-dung" | "ai" = "nguoi-dung", durationMs?: number): AppState {
  const o = getOcc(state, id);
  const dur = durationMs ?? o.planned.endMs - o.planned.startMs;
  const after = { startMs: newStartMs, endMs: newStartMs + dur };
  const s = record(state, o, { ...o, planned: after }, "doi-gio", now);
  const ev = s.events[s.events.length - 1]!;
  const rev = { ...meta("rev", now), occurrenceId: id, at: now, before: o.planned, after, source, eventId: ev.id } as any;
  return bump({ ...s, revisions: [...s.revisions, rev] });
}

export function lastUndoable(state: AppState, occurrenceId: string): ExecutionEvent | undefined {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]!;
    if (e.occurrenceId !== occurrenceId) continue;
    return e.type === "hoan-tac" || e.type === "tao" ? undefined : e;
  }
  return undefined;
}

/** Hoàn tác thao tác cuối của một lần thực hiện. */
export function undoLast(state: AppState, occId: string, now = Date.now()): AppState {
  const e = lastUndoable(state, occId);
  if (!e || !e.before) throw new Error("Không có thao tác để hoàn tác.");
  const o = getOcc(state, occId);
  const restored: TaskOccurrence = { ...o, ...(e.before as TaskOccurrence) };
  let s = record(state, o, restored, "hoan-tac", now);
  if (e.type === "doi-gio") s = bump({ ...s, revisions: s.revisions.filter((r) => (r as any).eventId !== e.id) });
  if (e.type === "huy") s = bump(s);
  return s;
}
