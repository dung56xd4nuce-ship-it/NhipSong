import { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { AppState, Category, TaskOccurrence, TaskTemplate, Recurrence } from "../core/types";
import { createTemplate, deleteTemplate, effective, EditScope, TemplateInput, updateTemplate, setActual, crossesMidnight, startHHMM } from "../core/schedule";
import { fmtLocalTime, parseHHMM, viWeekday, zonedToUtc, todayIn } from "../core/time";
import { dispatch, getState } from "./store";

export const CATEGORY_LABEL: Record<Category, string> = {
  "lam-viec": "💼 Làm việc", hoc: "📘 Học", "suc-khoe": "🏃 Sức khỏe", "gia-dinh": "🏡 Gia đình", nghi: "☕ Nghỉ", "ca-nhan": "🌼 Cá nhân", khac: "🔹 Khác",
};

export function Sheet(p: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-backdrop" role="dialog" aria-modal="true" aria-label={p.title} onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="sheet">
        <div class="sheet-head"><h2 style="margin:0">{p.title}</h2><button class="linkbtn" onClick={p.onClose}>Đóng</button></div>
        {p.children}
      </div>
    </div>
  );
}

export function Field(p: { label: string; children: ComponentChildren; hint?: string }) {
  return <label class="field"><span>{p.label}</span>{p.children}{p.hint && <div class="small muted">{p.hint}</div>}</label>;
}

export function DayPicker(p: { value: number[]; onChange: (v: number[]) => void }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div class="row" role="group" aria-label="Chọn ngày trong tuần">
      {order.map((d) => {
        const on = p.value.includes(d);
        return <button type="button" class="chip toggle" aria-pressed={on} onClick={() => p.onChange(on ? p.value.filter((x) => x !== d) : [...p.value, d].sort())}>{viWeekday(d)}</button>;
      })}
    </div>
  );
}

export function Mascot(p: { text: string }) {
  const s = getState().notificationSettings;
  if (!s.mascot) return <p class="muted">{p.text}</p>;
  return <div class="row" style="align-items:flex-start"><span class={`mascot ${s.reduceMotion ? "" : "anim"}`} aria-hidden="true">🐣</span><p class="grow" style="margin-top:4px"><b>Nhịp:</b> {p.text}</p></div>;
}

export function timeRange(o: TaskOccurrence): string {
  const a = fmtLocalTime(o.planned.startMs, o.timeZone), b = fmtLocalTime(o.planned.endMs, o.timeZone);
  return `${a}–${b}${crossesMidnight(o) ? " (sang hôm sau)" : ""}`;
}

// ---------------- Trình sửa việc ----------------

interface EditorProps { template?: TaskTemplate; occurrence?: TaskOccurrence; date: string; onClose: () => void }

export function TaskEditor({ template, occurrence, date, onClose }: EditorProps) {
  const s = getState();
  const eff = occurrence ? effective(s, occurrence) : null;
  const t = template;
  const [title, setTitle] = useState(eff?.title ?? t?.title ?? "");
  const [category, setCategory] = useState<Category>(t?.category ?? "ca-nhan");
  const [kind, setKind] = useState<"fixed" | "window">(t?.timing.kind ?? "fixed");
  const [start, setStart] = useState(occurrence ? fmtLocalTime(occurrence.planned.startMs, occurrence.timeZone) : t ? startHHMM(t) : "19:00");
  const [winTo, setWinTo] = useState(t?.timing.kind === "window" ? t.timing.to : "21:00");
  const [duration, setDuration] = useState(eff?.durationMin ?? t?.durationMin ?? 30);
  const [priority, setPriority] = useState<1 | 2 | 3>(eff?.priority ?? t?.priority ?? 2);
  const [fixed, setFixed] = useState(t?.flexibility === "co-dinh");
  const [rec, setRec] = useState<"once" | "daily" | "weekly">(t?.recurrence.kind ?? "once");
  const [days, setDays] = useState<number[]>(t?.recurrence.kind === "weekly" ? t.recurrence.days : [1, 2, 3, 4, 5]);
  const [grace, setGrace] = useState(eff?.graceMin ?? t?.graceMin ?? s.notificationSettings.defaultGraceMin);
  const [before, setBefore] = useState<number>(eff?.remindBeforeMin ?? t?.remindBeforeMin ?? 0);
  const [track, setTrack] = useState(eff?.trackPunctuality ?? t?.trackPunctuality ?? true);
  const [optional, setOptional] = useState(eff?.optional ?? t?.optional ?? false);
  const [deadline, setDeadline] = useState(t?.deadline ?? "");
  const recurring = t && t.recurrence.kind !== "once";
  const [scope, setScope] = useState<EditScope["kind"]>(recurring ? "one" : "all");

  const recurrence = (): Recurrence => rec === "once" ? { kind: "once", date } : rec === "daily" ? { kind: "daily", from: t && t.recurrence.kind !== "once" ? t.recurrence.from : date } : { kind: "weekly", days, from: t && t.recurrence.kind !== "once" ? t.recurrence.from : date };

  const input = (): TemplateInput => ({
    title: title.trim(), category, durationMin: Number(duration), timing: kind === "fixed" ? { kind: "fixed", start } : { kind: "window", from: start, to: winTo },
    priority, deadline: deadline || undefined, flexibility: fixed ? "co-dinh" : "linh-hoat", recurrence: recurrence(), graceMin: Number(grace),
    remindBeforeMin: Number(before) > 0 ? Number(before) : null, trackPunctuality: track && !optional, optional,
  });

  const save = () => {
    const ok = t
      ? dispatch((st) => updateTemplate(st, t.id, scope === "one" ? { title: title.trim(), durationMin: Number(duration), timing: input().timing, graceMin: Number(grace), remindBeforeMin: input().remindBeforeMin, trackPunctuality: track && !optional, optional, priority } : input(), scope === "one" ? { kind: "one", date } : scope === "future" ? { kind: "future", date } : { kind: "all" }), "Đã lưu thay đổi.", occurrence?.id)
      : dispatch((st) => createTemplate(st, input()).state, "Đã thêm việc. 🌱");
    if (ok) onClose();
  };
  const remove = () => {
    if (!t) return;
    const label = scope === "one" ? "chỉ lần này" : scope === "future" ? "từ lần này về sau" : "toàn bộ chuỗi";
    if (!confirm(`Xóa "${title}" — ${label}? Lịch sử đã ghi nhận vẫn được giữ.`)) return;
    if (dispatch((st) => deleteTemplate(st, t.id, scope === "one" ? { kind: "one", date } : scope === "future" ? { kind: "future", date } : { kind: "all" }), "Đã xóa.", occurrence?.id)) onClose();
  };

  return (
    <Sheet title={t ? "Sửa việc" : "Thêm việc"} onClose={onClose}>
      {recurring && (
        <div class="card" style="margin-bottom:8px">
          <b>Áp dụng thay đổi cho</b>
          <div class="row" style="margin-top:6px">
            {([["one", "Chỉ lần này"], ["future", "Lần này & về sau"], ["all", "Toàn bộ chuỗi"]] as const).map(([k, l]) => <button type="button" class="chip toggle" aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
          </div>
          {scope === "one" && <p class="small muted">Chỉ sửa được tên, giờ, thời lượng và nhắc nhở cho riêng lần {date}.</p>}
        </div>
      )}
      <Field label="Tên việc"><input type="text" value={title} maxLength={80} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Ví dụ: Học tiếng Anh" /></Field>
      <div class="row">
        <div class="grow"><Field label="Nhóm"><select value={category} disabled={scope === "one" && !!recurring} onChange={(e) => setCategory(e.currentTarget.value as Category)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}</select></Field></div>
        <div class="grow"><Field label="Ưu tiên"><select value={priority} onChange={(e) => setPriority(Number(e.currentTarget.value) as 1 | 2 | 3)}><option value={1}>Cao</option><option value={2}>Vừa</option><option value={3}>Thấp</option></select></Field></div>
      </div>
      <div class="row" role="group" aria-label="Kiểu thời gian">
        <button type="button" class="chip toggle" aria-pressed={kind === "fixed"} onClick={() => setKind("fixed")}>Giờ cố định</button>
        <button type="button" class="chip toggle" aria-pressed={kind === "window"} onClick={() => setKind("window")}>Trong khung giờ</button>
      </div>
      <div class="row">
        <div class="grow"><Field label={kind === "fixed" ? "Bắt đầu" : "Từ"}><input type="time" value={start} onInput={(e) => setStart(e.currentTarget.value)} /></Field></div>
        {kind === "window" && <div class="grow"><Field label="Đến"><input type="time" value={winTo} onInput={(e) => setWinTo(e.currentTarget.value)} /></Field></div>}
        <div class="grow"><Field label="Thời lượng (phút)"><input type="number" min={1} max={1440} value={duration} onInput={(e) => setDuration(Number(e.currentTarget.value))} /></Field></div>
      </div>
      {!(scope === "one" && recurring) && (<>
        <Field label="Lặp lại">
          <select value={rec} onChange={(e) => setRec(e.currentTarget.value as any)}><option value="once">Một lần ({date})</option><option value="daily">Hằng ngày</option><option value="weekly">Theo ngày trong tuần</option></select>
        </Field>
        {rec === "weekly" && <DayPicker value={days} onChange={setDays} />}
        <label class="check"><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.currentTarget.checked)} /> Mốc cố định (AI không được dời)</label>
        <Field label="Hạn chót (tùy chọn)"><input type="date" value={deadline} onInput={(e) => setDeadline(e.currentTarget.value)} /></Field>
      </>)}
      <div class="row">
        <div class="grow"><Field label="Gia hạn (phút)" hint="Trễ trong khoảng này vẫn tính đúng giờ"><input type="number" min={0} max={240} value={grace} onInput={(e) => setGrace(Number(e.currentTarget.value))} /></Field></div>
        <div class="grow"><Field label="Nhắc trước (phút)" hint="0 = không nhắc trước"><input type="number" min={0} max={240} value={before} onInput={(e) => setBefore(Number(e.currentTarget.value))} /></Field></div>
      </div>
      <label class="check"><input type="checkbox" checked={optional} onChange={(e) => setOptional(e.currentTarget.checked)} /> Việc tùy chọn (không theo dõi đúng giờ)</label>
      {!optional && <label class="check"><input type="checkbox" checked={track} onChange={(e) => setTrack(e.currentTarget.checked)} /> Theo dõi đúng giờ</label>}
      <div class="row" style="margin-top:12px">
        <button class="btn primary grow" onClick={save} disabled={!title.trim() || parseHHMM(start) === null}>Lưu</button>
        {t && <button class="btn danger" onClick={remove}>Xóa</button>}
      </div>
    </Sheet>
  );
}

// ---------------- Bổ sung giờ thực tế ----------------

export function ActualEditor({ occ, onClose }: { occ: TaskOccurrence; onClose: () => void }) {
  const tz = occ.timeZone;
  const [status, setStatus] = useState<"hoan-thanh" | "dang-lam" | "bo-qua" | "chua-bat-dau">(occ.status === "huy" ? "hoan-thanh" : (occ.status as any));
  const [st, setSt] = useState(occ.actual.startMs ? fmtLocalTime(occ.actual.startMs, tz) : fmtLocalTime(occ.planned.startMs, tz));
  const [en, setEn] = useState(occ.actual.endMs ? fmtLocalTime(occ.actual.endMs, tz) : fmtLocalTime(occ.planned.endMs, tz));
  const toMs = (hhmm: string, ref: number) => {
    let ms = zonedToUtc(occ.date, hhmm, tz);
    if (ms < ref - 6 * 3600_000) ms += 24 * 3600_000; // giờ sau nửa đêm thuộc ngày hôm sau
    return ms;
  };
  const save = () => {
    const startMs = toMs(st, occ.planned.startMs);
    const actual = status === "hoan-thanh" ? { startMs, endMs: toMs(en, startMs) } : status === "dang-lam" ? { startMs } : {};
    if (dispatch((s) => setActual(s, occ.id, actual, status), "Đã cập nhật và tính lại tổng kết.", occ.id)) onClose();
  };
  return (
    <Sheet title="Cập nhật giờ thực tế" onClose={onClose}>
      <p class="muted small">Dùng khi bạn quên bấm trên thông báo hoặc cần sửa dữ liệu sai. Tổng kết sẽ được tính lại.</p>
      <div class="row">
        {([["hoan-thanh", "Đã xong"], ["dang-lam", "Đang làm"], ["bo-qua", "Bỏ qua"], ["chua-bat-dau", "Chưa làm"]] as const).map(([k, l]) => <button type="button" class="chip toggle" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      {(status === "hoan-thanh" || status === "dang-lam") && <Field label="Bắt đầu lúc"><input type="time" value={st} onInput={(e) => setSt(e.currentTarget.value)} /></Field>}
      {status === "hoan-thanh" && <Field label="Xong lúc"><input type="time" value={en} onInput={(e) => setEn(e.currentTarget.value)} /></Field>}
      <button class="btn primary block" onClick={save}>Lưu</button>
    </Sheet>
  );
}

export function PickTime({ occ, onClose, onPick }: { occ: TaskOccurrence; onClose: () => void; onPick: (ms: number) => void }) {
  const [v, setV] = useState(fmtLocalTime(Math.max(Date.now(), occ.planned.startMs) + 30 * 60_000, occ.timeZone));
  return (
    <Sheet title="Chọn giờ khác" onClose={onClose}>
      <Field label="Giờ mới"><input type="time" value={v} onInput={(e) => setV(e.currentTarget.value)} /></Field>
      <button class="btn primary block" onClick={() => { const d = todayIn(occ.timeZone) > occ.date ? todayIn(occ.timeZone) : occ.date; onPick(zonedToUtc(d, v, occ.timeZone)); onClose(); }}>Dời tới giờ này</button>
    </Sheet>
  );
}

export function ConsentEditor({ state, onChange }: { state: AppState; onChange: (c: AppState["profile"]["aiConsent"]) => void }) {
  const c = state.profile.aiConsent;
  return (
    <div>
      <label class="check"><input type="checkbox" checked={c.profile} onChange={(e) => onChange({ ...c, profile: e.currentTarget.checked })} /> Gửi hồ sơ nhịp sống (giờ ngủ, giờ làm, mục tiêu, khung năng lượng)</label>
      <label class="check"><input type="checkbox" checked={c.schedule} onChange={(e) => onChange({ ...c, schedule: e.currentTarget.checked })} /> Gửi lịch cần điều chỉnh (tên việc, giờ, thời lượng)</label>
      <label class="check"><input type="checkbox" checked={c.stats} onChange={(e) => onChange({ ...c, stats: e.currentTarget.checked })} /> Gửi thống kê tối thiểu (số việc lệch, nguyên nhân bạn chọn)</label>
      <p class="small muted">Không gửi tên thật, email hay lịch sử chi tiết. App không đọc lịch sử trò chuyện hoặc bộ nhớ ChatGPT của bạn.</p>
    </div>
  );
}
