// Bộ điều phối trạng thái: lưu cục bộ, đồng bộ thông báo, hoàn tác, luồng AI.
import { useEffect, useState } from "preact/hooks";
import { AppState, DeviationReason } from "../core/types";
import { emptyState } from "../core/defaults";
import { deviceTimeZone, todayIn, addDays, isValidTimeZone } from "../core/time";
import { planNotifications } from "../core/notifications";
import { completeTask, materializeRange, reschedule, skipTask, startTask, undoLast } from "../core/schedule";
import { summaryCutoff, upsertSummary, dayReport } from "../core/evaluation";
import * as AI from "../core/ai";
import { loadState, saveState, wipeState } from "../platform/storage";
import { onNotificationAction, syncNotifications, cancelAllNotifications } from "../platform/notify";
import { siwcConnect, siwcDisconnect, siwcModels, siwcRespond, siwcStatus, friendlyAiError } from "../platform/chatgpt";

type Listener = () => void;
let state: AppState | null = null;
const listeners = new Set<Listener>();
export interface Toast { id: number; text: string; undoOcc?: string }
let toast: Toast | null = null;
let toastSeq = 0;
export let tzMismatch: string | null = null;
export let lastSync: { at: number; scheduled: number; cancelled: number } | null = null;

export function getState(): AppState { if (!state) throw new Error("Chưa khởi tạo"); return state; }
export function getToast() { return toast; }
function emit() { for (const l of listeners) l(); }

export function useApp(): AppState {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return getState();
}

export function showToast(text: string, undoOcc?: string) {
  toast = { id: ++toastSeq, text, undoOcc };
  const id = toast.id;
  setTimeout(() => { if (toast?.id === id) { toast = null; emit(); } }, 6000);
  emit();
}

export async function init(): Promise<void> {
  const loaded = await loadState();
  const dev = deviceTimeZone();
  state = loaded && isValidTimeZone(loaded.profile?.timeZone) ? loaded : emptyState(dev);
  if (loaded && loaded.profile.timeZone !== dev) tzMismatch = dev; // không tự đổi múi giờ lịch
  state = materializeRange(state, todayIn(state.profile.timeZone), 3);
  onNotificationAction(handleAction);
  await refreshConnection();
  tick();
  setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); void refreshConnection(); } });
  emit();
  void resync();
}

export function setState(next: AppState, opts: { sync?: boolean } = {}) {
  state = next;
  void saveState(next);
  emit();
  if (opts.sync !== false) scheduleResync();
}

export function dispatch(fn: (s: AppState) => AppState, msg?: string, undoOcc?: string): boolean {
  try {
    setState(fn(getState()));
    if (msg) showToast(msg, undoOcc);
    return true;
  } catch (e) {
    showToast((e as Error).message);
    return false;
  }
}

export function undo(occId: string) {
  dispatch((s) => undoLast(s, occId), "Đã hoàn tác.");
}

let resyncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleResync() { if (resyncTimer) clearTimeout(resyncTimer); resyncTimer = setTimeout(() => void resync(), 400); }

export async function resync(): Promise<void> {
  const { state: s, list } = planNotifications(getState(), Date.now());
  if (s !== state) { state = s; void saveState(s); emit(); }
  try { const r = await syncNotifications(list); if (r) lastSync = { at: Date.now(), ...r }; }
  catch (e) { console.warn("Không lập được thông báo", (e as Error).message); }
}

/** Mỗi phút: cập nhật tổng kết, đánh dấu đã qua giờ tổng kết (thông báo tối đa 1 lần/ngày). */
function tick() {
  const s = getState();
  const now = Date.now();
  const today = todayIn(s.profile.timeZone, now);
  let next = materializeRange(s, today, 3, now);
  const yesterday = addDays(today, -1);
  for (const d of [yesterday, today]) {
    if (now >= summaryCutoff(next, d)) {
      next = upsertSummary(next, d, now);
      if (!next.summaries[d]!.notifiedAt) next = { ...next, summaries: { ...next.summaries, [d]: { ...next.summaries[d]!, notifiedAt: now } } };
    }
  }
  if (next !== s) setState(next, { sync: false });
}

function handleAction(a: { actionId: string; occurrenceId?: string; kind?: string }) {
  const id = a.occurrenceId;
  if (a.kind === "tong-ket") { location.hash = "#/nhin-lai"; return; }
  if (!id || !getState().occurrences[id]) { location.hash = "#/hom-nay"; return; }
  const now = Date.now();
  switch (a.actionId) {
    case "start": dispatch((s) => startTask(s, id, now), "Bắt đầu nhé! 🌱", id); break;
    case "done": dispatch((s) => completeTask(s, id, now), "Tuyệt, đã ghi nhận hoàn thành.", id); break;
    case "snooze10": dispatch((s) => reschedule(s, id, Math.max(now, s.occurrences[id]!.planned.startMs) + 10 * 60_000, now), "Đã dời 10 phút.", id); break;
    case "skip": dispatch((s) => skipTask(s, id, now), "Hôm nay bỏ qua việc này. Không sao cả.", id); break;
    default: location.hash = `#/hom-nay?occ=${encodeURIComponent(id)}`;
  }
}

export function adoptDeviceTimeZone() {
  if (!tzMismatch) return;
  const tz = tzMismatch;
  dispatch((s) => ({ ...s, profile: { ...s.profile, timeZone: tz }, scheduleVersion: s.scheduleVersion + 1 }), `Đã chuyển lịch sang múi giờ ${tz}.`);
  tzMismatch = null;
}
export function keepTimeZone() { tzMismatch = null; emit(); }

export async function resetAll(): Promise<void> {
  const conn = getState().aiConnection; // xóa dữ liệu lịch không đụng tới kết nối ChatGPT
  await cancelAllNotifications();
  await wipeState();
  state = { ...emptyState(deviceTimeZone()), aiConnection: conn };
  void saveState(state);
  emit();
}

// ---------------- Kết nối ChatGPT ----------------

export async function refreshConnection(): Promise<void> {
  const st = await siwcStatus();
  const s = getState();
  const now = Date.now();
  if (st === null) {
    state = { ...s, aiConnection: { ...s.aiConnection, status: "khong-du-dieu-kien", planUsage: false, lastCheckedAt: now, lastError: "Chỉ khả dụng trong app Android." } };
  } else {
    state = { ...s, aiConnection: { ...s.aiConnection, status: st.status, email: st.email, scopes: st.scopes, planUsage: st.planUsage, connectedAt: st.connectedAt || undefined, lastCheckedAt: now } };
  }
  void saveState(state);
  emit();
}

export async function connectChatGPT(): Promise<string | null> {
  try {
    await siwcConnect();
    await refreshConnection();
    const s = getState();
    if (!s.aiConnection.planUsage) return "Đã đăng nhập ChatGPT, nhưng tài khoản/app chưa được cấp quyền dùng gói cho AI. Bạn vẫn dùng mọi tính năng không cần AI.";
    try {
      const models = await siwcModels();
      const pick = models.find((m) => /^gpt-5/.test(m)) ?? models[0];
      setState({ ...getState(), aiConnection: { ...getState().aiConnection, model: getState().aiConnection.model ?? pick, lastError: undefined } }, { sync: false });
    } catch (e) { return `Đã kết nối nhưng chưa lấy được danh sách model: ${friendlyAiError(e)}`; }
    return null;
  } catch (e) {
    setState({ ...getState(), aiConnection: { ...getState().aiConnection, lastError: friendlyAiError(e) } }, { sync: false });
    return friendlyAiError(e);
  }
}

export async function disconnectChatGPT(): Promise<string> {
  const r = await siwcDisconnect();
  await refreshConnection();
  // Ngắt kết nối không xóa lịch cục bộ
  return r.remoteRevoked ? "Đã ngắt kết nối và thu hồi quyền. Lịch của bạn vẫn còn nguyên." : "Đã xóa thông tin đăng nhập trên máy. Nếu cần, hãy gỡ app khỏi mục kết nối trong cài đặt ChatGPT. Lịch vẫn còn nguyên.";
}

export async function listModels(): Promise<string[]> { return siwcModels(); }

async function askAi(instructions: string, input: string): Promise<unknown> {
  const s = getState();
  if (s.aiConnection.status !== "da-ket-noi" || !s.aiConnection.planUsage) throw new Error("Chưa có kết nối ChatGPT đủ quyền để gọi AI.");
  const model = s.aiConnection.model;
  if (!model) throw new Error("Chưa chọn model AI. Vào Cài đặt › Kết nối ChatGPT.");
  try {
    const text = await siwcRespond(model, instructions, input);
    return AI.extractJson(text);
  } catch (e) {
    await refreshConnection();
    throw new Error(friendlyAiError(e));
  }
}

export async function aiExtractProfile(description: string): Promise<AI.ProfileDraft> {
  const raw = await askAi(AI.profileInstructions(), JSON.stringify({ timeZone: getState().profile.timeZone, description }));
  return AI.parseProfileDraft(raw);
}

export async function aiPlan(mode: AI.PlanMode, lowEnergy: boolean): Promise<{ draft: AI.PlanDraft; errors: string[] }> {
  const s = getState();
  const raw = await askAi(AI.planInstructions(mode), AI.buildPlanInput(s, mode, lowEnergy));
  const draft = AI.parsePlanDraft(raw, mode);
  return { draft, errors: AI.checkPlanDraft(getState(), draft) };
}

export async function aiAdjust(date: string, causes: DeviationReason[]): Promise<AI.AdjustDraft> {
  const s = getState();
  const rep = dayReport(s, date, Date.now());
  const raw = await askAi(AI.adjustInstructions(), AI.buildAdjustInput(s, rep, addDays(date, 1), causes));
  const d = AI.parseAdjustDraft(raw);
  if (d.date !== addDays(date, 1)) throw new Error("AI trả đề xuất cho sai ngày.");
  return d;
}
