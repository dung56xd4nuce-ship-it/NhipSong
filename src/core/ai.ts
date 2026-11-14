// Tầng AI phía app: dựng yêu cầu tối thiểu theo quyền đã cấp, kiểm tra schema kết quả, áp dụng có duyệt.
// Kết quả AI chỉ là dữ liệu đề xuất, không bao giờ được thực thi trực tiếp.
import { AppState, Category, LocalDate, TaskTemplate, UserProfile, AIProposal, DeviationReason } from "./types";
import { addDays, fmtHHMM, isValidTimeZone, parseHHMM, weekdayOf, zonedToUtc, fmtLocalTime, MINUTE } from "./time";
import { dayOccurrences, effective, occursOn, createTemplate, reschedule, updateTemplate, startHHMM, materializeDay, cancel } from "./schedule";
import { DayReport } from "./evaluation";
import { meta } from "./defaults";

export type PlanMode = "nhe-nhang" | "can-bang" | "tap-trung";
const CATS: Category[] = ["lam-viec", "hoc", "suc-khoe", "gia-dinh", "nghi", "ca-nhan", "khac"];

// ---------- Hồ sơ trích xuất ----------
export interface ProfileDraft {
  sleep?: { bed: string; wake: string };
  work: { days: number[]; start: string; end: string; label: string }[];
  daysOff?: number[];
  commuteMinutes?: number;
  goals: { name: string; minutesPerSession: number; sessionsPerWeek: number }[];
  energy: { start: string; end: string; level: "cao" | "thap" }[];
  familyDuties: string[];
  assumptions: string[];
  questions: string[];
}

export interface TaskDraft {
  title: string; category: Category; start: string; durationMin: number; days: number[];
  priority: 1 | 2 | 3; flexibility: "co-dinh" | "linh-hoat"; track: boolean; reason: string;
}
export interface PlanDraft { mode: PlanMode; tasks: TaskDraft[]; assumptions: string[]; conflicts: string[] }

export type ChangeType = "doi-gio" | "doi-thoi-luong" | "them" | "bo";
export interface AdjustChange {
  type: ChangeType; occurrenceId?: string; title?: string; start?: string; durationMin?: number; reason: string; category?: Category;
}
export interface AdjustDraft { baseScheduleVersion: number; date: LocalDate; summary: string; changes: AdjustChange[]; assumptions: string[] }

// ---------- Schema JSON gửi cho model (để model trả đúng dạng) ----------
export const SCHEMAS = {
  profile: `{"sleep":{"bed":"HH:MM","wake":"HH:MM"}|null,"work":[{"days":[0-6],"start":"HH:MM","end":"HH:MM","label":string}],"daysOff":[0-6]|null,"commuteMinutes":number|null,"goals":[{"name":string,"minutesPerSession":number,"sessionsPerWeek":number}],"energy":[{"start":"HH:MM","end":"HH:MM","level":"cao"|"thap"}],"familyDuties":[string],"assumptions":[string],"questions":[string]}`,
  plan: `{"mode":"nhe-nhang"|"can-bang"|"tap-trung","tasks":[{"title":string,"category":"lam-viec"|"hoc"|"suc-khoe"|"gia-dinh"|"nghi"|"ca-nhan"|"khac","start":"HH:MM","durationMin":number,"days":[0-6],"priority":1|2|3,"flexibility":"co-dinh"|"linh-hoat","track":boolean,"reason":string}],"assumptions":[string],"conflicts":[string]}`,
  adjust: `{"baseScheduleVersion":number,"date":"YYYY-MM-DD","summary":string,"changes":[{"type":"doi-gio"|"doi-thoi-luong"|"them"|"bo","occurrenceId":string|null,"title":string|null,"start":"HH:MM"|null,"durationMin":number|null,"category":string|null,"reason":string}],"assumptions":[string]}`,
};

const COMMON = `Bạn là trợ lý lập lịch của app "Nhịp Sống". Trả lời DUY NHẤT một đối tượng JSON hợp lệ, không kèm chữ nào khác, không markdown. Ngôn ngữ: tiếng Việt, giọng thân thiện, không trách móc, không đánh giá phẩm chất. Ngày trong tuần: 0=CN,1=T2,...,6=T7. Giờ dạng HH:MM 24h theo múi giờ của lịch.`;

export function profileInstructions(): string {
  return `${COMMON}\nNhiệm vụ: trích xuất hồ sơ nhịp sống từ mô tả tự nhiên. Không tự bịa: thông tin thiếu thì để null/mảng rỗng và thêm câu hỏi vào "questions", hoặc ghi rõ giả định vào "assumptions". Schema: ${SCHEMAS.profile}`;
}

export function planInstructions(mode: PlanMode): string {
  const m = { "nhe-nhang": "Nhẹ nhàng: ít việc, nhiều khoảng nghỉ", "can-bang": "Cân bằng", "tap-trung": "Tập trung: ưu tiên mục tiêu nhưng vẫn có nghỉ" }[mode];
  return `${COMMON}\nNhiệm vụ: đề xuất lịch lặp hằng tuần, chế độ ${m}. Quy tắc: không chồng chéo; không đặt việc vào giờ làm/học, giờ ngủ, mốc khóa hoặc thời gian di chuyển; tính thời gian chuẩn bị/nghỉ (ít nhất 10 phút giữa hai việc); không cắt giờ ngủ; không lấp đầy mọi khoảng trống; nếu không đủ thời gian thì ghi vào "conflicts" và đề xuất lựa chọn thay vì tạo lịch bất khả thi; có thể chia việc dài thành phiên nhỏ. Chỉ tạo việc mới (không lặp lại giờ làm). Schema: ${SCHEMAS.plan}`;
}

export function adjustInstructions(): string {
  return `${COMMON}\nNhiệm vụ: đề xuất TỐI ĐA 3 thay đổi chính cho lịch ngày mai dựa trên kết quả hôm nay. Mỗi thay đổi nêu lý do. Không đổi mốc khóa, không gây trùng lịch, không cắt giờ ngủ. Chỉ gắn nguyên nhân cụ thể khi dữ liệu có hoặc người dùng đã xác nhận. Giữ nguyên baseScheduleVersion được cung cấp. Schema: ${SCHEMAS.adjust}`;
}

// ---------- Dữ liệu tối thiểu theo quyền ----------
export function profileForAi(p: UserProfile) {
  return { timeZone: p.timeZone, sleep: p.sleep, work: p.work, daysOff: p.daysOff, commuteMinutes: p.commuteMinutes, goals: p.goals.map((g) => ({ name: g.name, minutesPerSession: g.minutesPerSession, sessionsPerWeek: g.sessionsPerWeek })), energy: p.energy, familyDuties: p.familyDuties };
}

export function buildPlanInput(state: AppState, mode: PlanMode, lowEnergy: boolean): string {
  if (!state.profile.aiConsent.profile) throw new ConsentError("profile");
  const locked = state.constraints.map((c) => ({ title: c.title, days: c.days, start: c.start, end: c.end }));
  const existing = state.aiConnection && state.profile.aiConsent.schedule
    ? state.templates.filter((t) => !t.archived).map((t) => ({ title: t.title, start: startHHMM(t), durationMin: t.durationMin, days: daysOf(t) }))
    : [];
  return JSON.stringify({ mode, lowEnergy, profile: profileForAi(state.profile), lockedBlocks: locked, existingTasks: existing });
}

export function buildAdjustInput(state: AppState, report: DayReport, tomorrow: LocalDate, causes: DeviationReason[]): string {
  if (!state.profile.aiConsent.schedule) throw new ConsentError("schedule");
  const occs = dayOccurrences(state, tomorrow).filter((o) => o.status !== "huy").map((o) => {
    const e = effective(state, o);
    return { occurrenceId: o.id, title: e.title, start: fmtLocalTime(o.planned.startMs, o.timeZone), durationMin: e.durationMin, fixed: e.template.flexibility === "co-dinh", category: e.template.category };
  });
  const stats = state.profile.aiConsent.stats ? { deviated: report.deviatedConfirmed.length, unconfirmed: report.unconfirmed.length, completed: report.completed.length, userReasons: causes } : undefined;
  return JSON.stringify({
    baseScheduleVersion: state.scheduleVersion, date: tomorrow,
    profile: state.profile.aiConsent.profile ? profileForAi(state.profile) : { timeZone: state.profile.timeZone, sleep: state.profile.sleep },
    lockedBlocks: state.constraints.filter((c) => c.days.includes(weekdayOf(tomorrow))).map((c) => ({ title: c.title, start: c.start, end: c.end })),
    tomorrow: occs, todayStats: stats,
  });
}

export class ConsentError extends Error { constructor(public scope: "profile" | "schedule" | "stats") { super(`Bạn chưa cho phép gửi dữ liệu "${scope}" cho AI.`); } }

function daysOf(t: TaskTemplate): number[] {
  return t.recurrence.kind === "weekly" ? t.recurrence.days : t.recurrence.kind === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [weekdayOf(t.recurrence.date)];
}

// ---------- Kiểm tra schema ----------
export class SchemaError extends Error {}

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SchemaError("AI không trả về JSON.");
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { throw new SchemaError("JSON của AI không hợp lệ."); }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, f: string, max = 200): string => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new SchemaError(`Trường ${f} không hợp lệ.`); return v.trim(); };
const hhmm = (v: unknown, f: string): string => { if (typeof v !== "string" || parseHHMM(v) === null) throw new SchemaError(`Giờ ${f} không hợp lệ.`); return v; };
const num = (v: unknown, f: string, min: number, max: number): number => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new SchemaError(`Số ${f} không hợp lệ.`); return Math.round(v); };
const days = (v: unknown, f: string): number[] => { if (!Array.isArray(v) || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new SchemaError(`Ngày ${f} không hợp lệ.`); return [...new Set(v as number[])].sort(); };
const strArr = (v: unknown, f: string): string[] => { if (v == null) return []; if (!Array.isArray(v)) throw new SchemaError(`${f} phải là mảng.`); return v.filter((x) => typeof x === "string").map((x) => (x as string).slice(0, 300)).slice(0, 10); };

export function parseProfileDraft(raw: unknown): ProfileDraft {
  if (!isObj(raw)) throw new SchemaError("Hồ sơ phải là đối tượng.");
  const d: ProfileDraft = { work: [], goals: [], energy: [], familyDuties: strArr(raw.familyDuties, "familyDuties"), assumptions: strArr(raw.assumptions, "assumptions"), questions: strArr(raw.questions, "questions") };
  if (isObj(raw.sleep)) d.sleep = { bed: hhmm(raw.sleep.bed, "đi ngủ"), wake: hhmm(raw.sleep.wake, "thức dậy") };
  if (Array.isArray(raw.work)) d.work = raw.work.slice(0, 7).map((w, i) => { if (!isObj(w)) throw new SchemaError("work"); return { days: days(w.days, `work[${i}]`), start: hhmm(w.start, "làm từ"), end: hhmm(w.end, "làm đến"), label: typeof w.label === "string" ? w.label.slice(0, 60) : "Làm việc" }; });
  if (raw.daysOff != null) d.daysOff = days(raw.daysOff, "daysOff");
  if (raw.commuteMinutes != null) d.commuteMinutes = num(raw.commuteMinutes, "commuteMinutes", 0, 600);
  if (Array.isArray(raw.goals)) d.goals = raw.goals.slice(0, 10).map((g) => { if (!isObj(g)) throw new SchemaError("goals"); return { name: str(g.name, "mục tiêu", 80), minutesPerSession: num(g.minutesPerSession, "phút/phiên", 5, 480), sessionsPerWeek: num(g.sessionsPerWeek, "phiên/tuần", 1, 14) }; });
  if (Array.isArray(raw.energy)) d.energy = raw.energy.slice(0, 6).map((e) => { if (!isObj(e) || (e.level !== "cao" && e.level !== "thap")) throw new SchemaError("energy"); return { start: hhmm(e.start, "năng lượng"), end: hhmm(e.end, "năng lượng"), level: e.level }; });
  return d;
}

export function parsePlanDraft(raw: unknown, mode: PlanMode): PlanDraft {
  if (!isObj(raw) || !Array.isArray(raw.tasks)) throw new SchemaError("Đề xuất lịch thiếu danh sách việc.");
  if (raw.tasks.length > 20) throw new SchemaError("Đề xuất có quá nhiều việc.");
  const tasks = raw.tasks.map((t, i): TaskDraft => {
    if (!isObj(t)) throw new SchemaError(`tasks[${i}]`);
    const cat = CATS.includes(t.category as Category) ? (t.category as Category) : "khac";
    const pr = t.priority === 1 || t.priority === 2 || t.priority === 3 ? t.priority : 2;
    return { title: str(t.title, "tên việc", 80), category: cat, start: hhmm(t.start, "bắt đầu"), durationMin: num(t.durationMin, "thời lượng", 5, 480), days: days(t.days, `tasks[${i}].days`), priority: pr, flexibility: t.flexibility === "co-dinh" ? "co-dinh" : "linh-hoat", track: t.track !== false, reason: typeof t.reason === "string" ? t.reason.slice(0, 300) : "" };
  });
  return { mode, tasks, assumptions: strArr(raw.assumptions, "assumptions"), conflicts: strArr(raw.conflicts, "conflicts") };
}

export function parseAdjustDraft(raw: unknown): AdjustDraft {
  if (!isObj(raw) || !Array.isArray(raw.changes)) throw new SchemaError("Đề xuất điều chỉnh thiếu danh sách thay đổi.");
  if (raw.changes.length > 3) throw new SchemaError("Đề xuất có quá 3 thay đổi.");
  const types: ChangeType[] = ["doi-gio", "doi-thoi-luong", "them", "bo"];
  const changes = raw.changes.map((c, i): AdjustChange => {
    if (!isObj(c) || !types.includes(c.type as ChangeType)) throw new SchemaError(`changes[${i}].type`);
    const ch: AdjustChange = { type: c.type as ChangeType, reason: str(c.reason, "lý do", 300) };
    if (c.occurrenceId != null) ch.occurrenceId = str(c.occurrenceId, "occurrenceId", 120);
    if (c.title != null) ch.title = str(c.title, "title", 80);
    if (c.start != null) ch.start = hhmm(c.start, "start");
    if (c.durationMin != null) ch.durationMin = num(c.durationMin, "durationMin", 5, 480);
    if (c.category != null && CATS.includes(c.category as Category)) ch.category = c.category as Category;
    return ch;
  });
  if (typeof raw.date !== "string") throw new SchemaError("Thiếu ngày.");
  return { baseScheduleVersion: num(raw.baseScheduleVersion, "baseScheduleVersion", 0, 1e9), date: raw.date, summary: typeof raw.summary === "string" ? raw.summary.slice(0, 400) : "", changes, assumptions: strArr(raw.assumptions, "assumptions") };
}

// ---------- Kiểm tra ràng buộc ----------
interface Interval { start: number; end: number; label: string; locked: boolean }

function blockedIntervals(state: AppState, weekday: number): Interval[] {
  const p = state.profile;
  const res: Interval[] = [];
  const push = (s: string, e: string, label: string) => {
    const a = parseHHMM(s)!, b = parseHHMM(e)!;
    if (b > a) res.push({ start: a, end: b, label, locked: true });
    else { res.push({ start: a, end: 1440, label, locked: true }); res.push({ start: 0, end: b, label, locked: true }); }
  };
  push(p.sleep.bed, p.sleep.wake, "Giờ ngủ");
  for (const w of p.work) if (w.days.includes(weekday)) {
    push(w.start, w.end, w.label);
    if (p.commuteMinutes > 0) {
      push(fmtHHMM(parseHHMM(w.start)! - p.commuteMinutes), w.start, "Di chuyển");
      push(w.end, fmtHHMM(parseHHMM(w.end)! + p.commuteMinutes), "Di chuyển");
    }
  }
  for (const c of state.constraints) if (c.days.includes(weekday)) push(c.start, c.end, c.title);
  return res;
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Lỗi ràng buộc của đề xuất lịch lặp (trùng, mốc khóa, giờ ngủ, qua nửa đêm). */
export function checkPlanDraft(state: AppState, draft: PlanDraft): string[] {
  const errs: string[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const blocked = blockedIntervals(state, wd);
    const existing: Interval[] = state.templates.filter((t) => !t.archived && daysOf(t).includes(wd)).map((t) => ({ start: parseHHMM(startHHMM(t))!, end: parseHHMM(startHHMM(t))! + t.durationMin, label: t.title, locked: t.flexibility === "co-dinh" }));
    const mine: Interval[] = [];
    for (const t of draft.tasks.filter((x) => x.days.includes(wd))) {
      const s = parseHHMM(t.start)!; const iv = { start: s, end: s + t.durationMin, label: t.title, locked: false };
      if (iv.end > 1440) errs.push(`"${t.title}" kéo qua nửa đêm.`);
      for (const b of blocked) if (overlap(iv, b)) errs.push(`"${t.title}" trùng ${b.label}.`);
      for (const b of [...existing, ...mine]) if (overlap(iv, b)) errs.push(`"${t.title}" trùng "${b.label}".`);
      mine.push(iv);
    }
  }
  return [...new Set(errs)];
}

/** Kiểm tra đề xuất điều chỉnh theo lịch hiện tại; báo lỗi nếu lịch đã đổi trong lúc chờ AI. */
export function checkAdjustDraft(state: AppState, d: AdjustDraft): string[] {
  const errs: string[] = [];
  if (d.baseScheduleVersion !== state.scheduleVersion) errs.push("Lịch đã thay đổi trong lúc chờ AI. Hãy tạo lại đề xuất.");
  const occs = dayOccurrences(state, d.date).filter((o) => o.status !== "huy");
  const wd = weekdayOf(d.date);
  const blocked = blockedIntervals(state, wd);
  const tz = state.profile.timeZone;
  const toMin = (ms: number) => { const t = fmtLocalTime(ms, tz); return parseHHMM(t)!; };
  const after = new Map<string, Interval>();
  for (const o of occs) { const e = effective(state, o); after.set(o.id, { start: toMin(o.planned.startMs), end: toMin(o.planned.startMs) + e.durationMin, label: e.title, locked: e.template.flexibility === "co-dinh" }); }
  let addN = 0;
  for (const c of d.changes) {
    if (c.type === "them") {
      if (!c.title || !c.start || !c.durationMin) { errs.push("Việc thêm mới thiếu tên/giờ/thời lượng."); continue; }
      after.set(`new${addN++}`, { start: parseHHMM(c.start)!, end: parseHHMM(c.start)! + c.durationMin, label: c.title, locked: false });
      continue;
    }
    const cur = c.occurrenceId ? after.get(c.occurrenceId) : undefined;
    if (!cur) { errs.push(`Không tìm thấy việc ${c.occurrenceId ?? "(thiếu ID)"} trong lịch ngày ${d.date}.`); continue; }
    if (cur.locked) { errs.push(`"${cur.label}" là việc cố định, không được thay đổi.`); continue; }
    if (c.type === "bo") { after.delete(c.occurrenceId!); continue; }
    if (c.type === "doi-gio") { if (!c.start) { errs.push("Thiếu giờ mới."); continue; } const len = cur.end - cur.start; cur.start = parseHHMM(c.start)!; cur.end = cur.start + (c.durationMin ?? len); }
    if (c.type === "doi-thoi-luong") { if (!c.durationMin) { errs.push("Thiếu thời lượng mới."); continue; } cur.end = cur.start + c.durationMin; }
  }
  const list = [...after.values()];
  for (const iv of list) {
    if (iv.end > 1440) errs.push(`"${iv.label}" kéo qua nửa đêm.`);
    if (!iv.locked) for (const b of blocked) if (overlap(iv, b)) errs.push(`"${iv.label}" trùng ${b.label}.`);
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlap(list[i]!, list[j]!)) errs.push(`"${list[i]!.label}" trùng "${list[j]!.label}".`);
  return [...new Set(errs)];
}

// ---------- Áp dụng có duyệt ----------
export function applyPlanDraft(state: AppState, draft: PlanDraft, selected: number[], fromDate: LocalDate, now = Date.now()): AppState {
  const errs = checkPlanDraft(state, { ...draft, tasks: draft.tasks.filter((_, i) => selected.includes(i)) });
  if (errs.length) throw new Error(errs.join("\n"));
  let s = state;
  for (const i of selected) {
    const t = draft.tasks[i]; if (!t) continue;
    s = createTemplate(s, {
      title: t.title, category: t.category, durationMin: t.durationMin, timing: { kind: "fixed", start: t.start }, priority: t.priority,
      flexibility: t.flexibility, recurrence: t.days.length === 7 ? { kind: "daily", from: fromDate } : { kind: "weekly", days: t.days, from: fromDate },
      graceMin: s.notificationSettings.defaultGraceMin, remindBeforeMin: null, trackPunctuality: t.track, optional: !t.track,
    }, now).state;
  }
  return s;
}

export function applyAdjustDraft(state: AppState, d: AdjustDraft, selected: number[], now = Date.now()): AppState {
  const chosen = { ...d, changes: d.changes.filter((_, i) => selected.includes(i)) };
  const errs = checkAdjustDraft(state, chosen);
  if (errs.length) throw new Error(errs.join("\n"));
  let s = materializeDay(state, d.date, now);
  const tz = s.profile.timeZone;
  for (const c of chosen.changes) {
    if (c.type === "them") {
      s = createTemplate(s, { title: c.title!, category: c.category ?? "khac", durationMin: c.durationMin!, timing: { kind: "fixed", start: c.start! }, priority: 2, flexibility: "linh-hoat", recurrence: { kind: "once", date: d.date }, graceMin: s.notificationSettings.defaultGraceMin, remindBeforeMin: null, trackPunctuality: true, optional: false }, now).state;
      s = materializeDay(s, d.date, now);
    } else if (c.type === "bo") {
      s = cancel(s, c.occurrenceId!, now);
    } else if (c.type === "doi-gio") {
      const o = s.occurrences[c.occurrenceId!]!;
      const dur = (c.durationMin ?? effective(s, o).durationMin) * MINUTE;
      s = reschedule(s, o.id, zonedToUtc(d.date, c.start!, tz), now, "ai", dur);
      if (c.durationMin) s = updateTemplate(s, o.templateId, { durationMin: c.durationMin }, { kind: "one", date: d.date }, now);
    } else if (c.type === "doi-thoi-luong") {
      const o = s.occurrences[c.occurrenceId!]!;
      s = updateTemplate(s, o.templateId, { durationMin: c.durationMin! }, { kind: "one", date: d.date }, now);
    }
  }
  return s;
}

export function storeProposal(state: AppState, kind: AIProposal["kind"], date: LocalDate, mode: PlanMode, payload: unknown, source: "ai" | "quy-tac", now = Date.now()): { state: AppState; proposal: AIProposal } {
  const proposal: AIProposal = { ...meta("prop", now), kind, baseScheduleVersion: state.scheduleVersion, date, mode, payload, state: "cho-duyet", source };
  const proposals = state.proposals.map((p) => (p.kind === kind && p.state === "cho-duyet" ? { ...p, state: "het-han" as const } : p)).concat(proposal).slice(-30);
  return { state: { ...state, proposals }, proposal };
}

export function markProposal(state: AppState, id: string, st: AIProposal["state"]): AppState {
  return { ...state, proposals: state.proposals.map((p) => (p.id === id ? { ...p, state: st } : p)) };
}

// ---------- Gợi ý theo quy tắc khi offline / AI lỗi ----------
export interface RuleSuggestion { text: string; rule: string; change?: AdjustChange }

export function ruleSuggestions(state: AppState, report: DayReport, tomorrow: LocalDate, causes: DeviationReason[]): RuleSuggestion[] {
  const out: RuleSuggestion[] = [];
  const evals = report.evaluations.filter((e) => e.deviated);
  const late = evals.filter((e) => e.why === "bat-dau-muon" || e.why === "ket-thuc-muon").length;
  const skipped = evals.filter((e) => e.why === "bo-qua-sau-han" || e.why === "huy-sau-han").length;
  const tmr = dayOccurrences(state, tomorrow).filter((o) => o.status === "chua-bat-dau");
  if (late >= 3 || causes.includes("phat-sinh")) out.push({ rule: "R1: ≥3 việc trễ giờ hoặc bạn chọn 'việc phát sinh'", text: "Chừa một khoảng trống 30 phút cho việc phát sinh vào ngày mai." });
  if (skipped >= 2 || causes.includes("thieu-nang-luong")) {
    const flex = tmr.map((o) => ({ o, e: effective(state, o) })).filter((x) => x.e.template.flexibility === "linh-hoat" && x.e.durationMin >= 20).sort((a, b) => b.e.durationMin - a.e.durationMin)[0];
    if (flex) out.push({ rule: "R2: ≥2 việc bị bỏ qua hoặc bạn chọn 'thiếu năng lượng'", text: `Giảm "${flex.e.title}" ngày mai từ ${flex.e.durationMin} xuống ${Math.max(10, Math.round(flex.e.durationMin * 0.75 / 5) * 5)} phút.`, change: { type: "doi-thoi-luong", occurrenceId: flex.o.id, durationMin: Math.max(10, Math.round(flex.e.durationMin * 0.75 / 5) * 5), reason: "Giảm tải theo quy tắc R2" } });
  }
  if (causes.includes("thieu-thoi-luong")) out.push({ rule: "R3: bạn chọn 'thời lượng chưa đủ'", text: "Thử tăng 10–15 phút cho những việc thường bị kết thúc muộn." });
  if (causes.includes("quen-cap-nhat") || report.unconfirmed.length >= 3) out.push({ rule: "R4: nhiều việc chưa xác nhận", text: "Bật nhắc trước 5 phút cho các việc quan trọng để dễ cập nhật hơn." });
  if (!out.length) out.push({ rule: "R0: mặc định", text: "Giữ lịch ngày mai như cũ và xem lại sau một ngày nữa." });
  return out.slice(0, 3);
}

export function dateFromDraft(today: LocalDate, offset = 1): LocalDate { return addDays(today, offset); }
export { isValidTimeZone, occursOn };

export function applyProfileDraft(state: AppState, d: ProfileDraft, now = Date.now()): AppState {
  const p = state.profile;
  const profile: UserProfile = {
    ...p, updatedAt: new Date(now).toISOString(),
    sleep: d.sleep ?? p.sleep,
    work: d.work.length ? d.work : p.work,
    daysOff: d.daysOff ?? p.daysOff,
    commuteMinutes: d.commuteMinutes ?? p.commuteMinutes,
    goals: d.goals.length ? d.goals.map((g) => ({ id: meta("goal", now).id, ...g })) : p.goals,
    energy: d.energy.length ? d.energy : p.energy,
    familyDuties: d.familyDuties.length ? d.familyDuties : p.familyDuties,
    assumptions: d.assumptions,
  };
  return { ...state, profile, scheduleVersion: state.scheduleVersion + 1 };
}
