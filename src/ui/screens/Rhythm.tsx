import { useState } from "preact/hooks";
import * as AI from "../../core/ai";
import { meta } from "../../core/defaults";
import { isValidTimeZone, viWeekday } from "../../core/time";
import { ScheduleConstraint, TimeBlock, UserProfile } from "../../core/types";
import { dispatch, useApp } from "../store";
import { DayPicker, Field } from "../components";

/** Xác nhận hồ sơ do AI trích xuất: hiển thị câu hỏi còn thiếu và giả định trước khi lưu. */
export function ProfileConfirm({ draft, onDone }: { draft: AI.ProfileDraft; onDone: () => void }) {
  return (
    <div class="card">
      <b>Mình hiểu như sau, bạn xem đúng chưa nhé:</b>
      <ul class="small">
        {draft.sleep && <li>Ngủ {draft.sleep.bed} – dậy {draft.sleep.wake}</li>}
        {draft.work.map((w) => <li>{w.label}: {w.start}–{w.end} ({w.days.map(viWeekday).join(", ")})</li>)}
        {draft.commuteMinutes != null && <li>Di chuyển {draft.commuteMinutes} phút mỗi chiều</li>}
        {draft.goals.map((g) => <li>Mục tiêu: {g.name} — {g.minutesPerSession} phút × {g.sessionsPerWeek} lần/tuần</li>)}
        {draft.energy.map((e) => <li>Năng lượng {e.level === "cao" ? "cao" : "thấp"}: {e.start}–{e.end}</li>)}
        {draft.familyDuties.map((f) => <li>Gia đình: {f}</li>)}
      </ul>
      {draft.assumptions.length > 0 && <div class="banner info small"><b>Giả định:</b> {draft.assumptions.join(" · ")}</div>}
      {draft.questions.length > 0 && <div class="banner warn small"><b>Còn thiếu:</b> {draft.questions.join(" · ")}<br />Bạn có thể bổ sung ở màn “Nhịp của tôi”.</div>}
      <div class="row"><button class="btn primary grow" onClick={() => { if (dispatch((s) => AI.applyProfileDraft(s, draft), "Đã lưu hồ sơ nhịp sống.")) onDone(); }}>Đúng rồi, lưu hồ sơ</button><button class="btn" onClick={onDone}>Bỏ qua</button></div>
    </div>
  );
}

export function Rhythm() {
  const s = useApp();
  const p = s.profile;
  const set = (patch: Partial<UserProfile>) => dispatch((st) => ({ ...st, profile: { ...st.profile, ...patch, updatedAt: new Date().toISOString() }, scheduleVersion: st.scheduleVersion + 1 }));
  const [tz, setTz] = useState(p.timeZone);
  const [goal, setGoal] = useState({ name: "", minutes: 20, perWeek: 3 });
  const [lock, setLock] = useState({ title: "", start: "18:00", end: "19:00", days: [1, 2, 3, 4, 5] as number[], kind: "khoa" as ScheduleConstraint["kind"] });

  const updWork = (i: number, w: Partial<TimeBlock>) => set({ work: p.work.map((x, j) => (j === i ? { ...x, ...w } : x)) });
  return (
    <div>
      <h1>Nhịp của tôi</h1>
      <p class="muted small">Thông tin này giúp lịch vừa sức hơn. Không cần tên thật.</p>

      <h2>Múi giờ của lịch</h2>
      <div class="row"><input class="grow" type="text" value={tz} onInput={(e) => setTz(e.currentTarget.value)} aria-label="Múi giờ IANA" />
        <button class="btn small" disabled={!isValidTimeZone(tz) || tz === p.timeZone} onClick={() => set({ timeZone: tz })}>Lưu</button></div>
      <p class="small muted">Ví dụ Asia/Ho_Chi_Minh. App không tự đổi múi giờ khi bạn đi du lịch.</p>

      <h2>Giấc ngủ</h2>
      <div class="row">
        <div class="grow"><Field label="Đi ngủ"><input type="time" value={p.sleep.bed} onChange={(e) => set({ sleep: { ...p.sleep, bed: e.currentTarget.value } })} /></Field></div>
        <div class="grow"><Field label="Thức dậy"><input type="time" value={p.sleep.wake} onChange={(e) => set({ sleep: { ...p.sleep, wake: e.currentTarget.value } })} /></Field></div>
      </div>

      <h2>Giờ làm / học</h2>
      {p.work.map((w, i) => (
        <div class="card">
          <div class="row"><input class="grow" type="text" value={w.label} onChange={(e) => updWork(i, { label: e.currentTarget.value })} aria-label="Tên" />
            <button class="linkbtn" onClick={() => set({ work: p.work.filter((_, j) => j !== i) })}>Xóa</button></div>
          <div class="row"><input type="time" class="grow" value={w.start} onChange={(e) => updWork(i, { start: e.currentTarget.value })} aria-label="Bắt đầu" /><input type="time" class="grow" value={w.end} onChange={(e) => updWork(i, { end: e.currentTarget.value })} aria-label="Kết thúc" /></div>
          <DayPicker value={w.days} onChange={(d) => updWork(i, { days: d })} />
        </div>
      ))}
      <button class="btn small" onClick={() => set({ work: [...p.work, { label: "Giờ làm", start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] }] })}>＋ Thêm khung giờ làm/học</button>
      <Field label="Thời gian di chuyển mỗi chiều (phút)"><input type="number" min={0} max={600} value={p.commuteMinutes} onChange={(e) => set({ commuteMinutes: Number(e.currentTarget.value) || 0 })} /></Field>
      <h3>Ngày nghỉ</h3>
      <DayPicker value={p.daysOff} onChange={(d) => set({ daysOff: d })} />

      <h2>Mục tiêu cá nhân</h2>
      {p.goals.map((g) => <div class="row card"><span class="grow">{g.name} — {g.minutesPerSession}′ × {g.sessionsPerWeek}/tuần</span><button class="linkbtn" onClick={() => set({ goals: p.goals.filter((x) => x.id !== g.id) })}>Xóa</button></div>)}
      <div class="card">
        <Field label="Mục tiêu mới"><input type="text" value={goal.name} onInput={(e) => setGoal({ ...goal, name: e.currentTarget.value })} placeholder="Ví dụ: Học tiếng Anh" /></Field>
        <div class="row"><div class="grow"><Field label="Phút/lần"><input type="number" min={5} value={goal.minutes} onInput={(e) => setGoal({ ...goal, minutes: Number(e.currentTarget.value) })} /></Field></div>
          <div class="grow"><Field label="Lần/tuần"><input type="number" min={1} max={14} value={goal.perWeek} onInput={(e) => setGoal({ ...goal, perWeek: Number(e.currentTarget.value) })} /></Field></div></div>
        <button class="btn small" disabled={!goal.name.trim()} onClick={() => { set({ goals: [...p.goals, { id: meta("goal").id, name: goal.name.trim(), minutesPerSession: goal.minutes, sessionsPerWeek: goal.perWeek }] }); setGoal({ name: "", minutes: 20, perWeek: 3 }); }}>Thêm mục tiêu</button>
      </div>

      <h2>Năng lượng trong ngày</h2>
      {p.energy.map((e, i) => {
        const upd = (x: Partial<typeof e>) => set({ energy: p.energy.map((y, j) => (j === i ? { ...y, ...x } : y)) });
        return <div class="row card"><span>{e.level === "cao" ? "⚡ Cao" : "🪫 Thấp"}</span>
          <input type="time" class="grow" value={e.start} onChange={(ev) => upd({ start: ev.currentTarget.value })} aria-label="Từ" />
          <input type="time" class="grow" value={e.end} onChange={(ev) => upd({ end: ev.currentTarget.value })} aria-label="Đến" />
          <button class="linkbtn" onClick={() => set({ energy: p.energy.filter((_, j) => j !== i) })}>Xóa</button></div>;
      })}
      <div class="row">
        <button class="btn small" onClick={() => set({ energy: [...p.energy, { start: "08:00", end: "11:00", level: "cao" }] })}>＋ Khung năng lượng cao</button>
        <button class="btn small" onClick={() => set({ energy: [...p.energy, { start: "19:00", end: "22:00", level: "thap" }] })}>＋ Khung năng lượng thấp</button>
      </div>

      <h2>Mốc khóa & trách nhiệm gia đình</h2>
      <p class="small muted">AI không được đặt việc vào các khung này.</p>
      {s.constraints.map((c) => <div class="row card"><span class="grow">🔒 {c.title} {c.start}–{c.end} ({c.days.map(viWeekday).join(", ")})</span><button class="linkbtn" onClick={() => dispatch((st) => ({ ...st, constraints: st.constraints.filter((x) => x.id !== c.id), scheduleVersion: st.scheduleVersion + 1 }))}>Xóa</button></div>)}
      <div class="card">
        <Field label="Tên mốc"><input type="text" value={lock.title} onInput={(e) => setLock({ ...lock, title: e.currentTarget.value })} placeholder="Ví dụ: Đón con" /></Field>
        <div class="row"><input type="time" class="grow" value={lock.start} onInput={(e) => setLock({ ...lock, start: e.currentTarget.value })} aria-label="Từ" /><input type="time" class="grow" value={lock.end} onInput={(e) => setLock({ ...lock, end: e.currentTarget.value })} aria-label="Đến" /></div>
        <DayPicker value={lock.days} onChange={(d) => setLock({ ...lock, days: d })} />
        <select value={lock.kind} onChange={(e) => setLock({ ...lock, kind: e.currentTarget.value as any })} aria-label="Loại"><option value="khoa">Mốc khóa</option><option value="gia-dinh">Trách nhiệm gia đình</option><option value="di-chuyen">Di chuyển</option></select>
        <button class="btn small" style="margin-top:8px" disabled={!lock.title.trim() || !lock.days.length} onClick={() => { dispatch((st) => ({ ...st, constraints: [...st.constraints, { ...meta("lock"), kind: lock.kind, title: lock.title.trim(), days: lock.days, start: lock.start, end: lock.end }], scheduleVersion: st.scheduleVersion + 1 }), "Đã thêm mốc."); setLock({ ...lock, title: "" }); }}>Thêm mốc</button>
      </div>
      {p.assumptions.length > 0 && <><h2>Giả định đã ghi</h2><ul class="small">{p.assumptions.map((a) => <li>{a}</li>)}</ul></>}
    </div>
  );
}
