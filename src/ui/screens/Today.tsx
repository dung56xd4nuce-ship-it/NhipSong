import { useEffect, useState } from "preact/hooks";
import { TaskOccurrence } from "../../core/types";
import { dayOccurrences, effective, startTask, completeTask, skipTask, cancel, reschedule, lastUndoable, materializeDay } from "../../core/schedule";
import { evaluate } from "../../core/evaluation";
import { addDays, todayIn, viDate } from "../../core/time";
import { dispatch, useApp, undo } from "../store";
import { ActualEditor, CATEGORY_LABEL, Mascot, PickTime, TaskEditor, timeRange } from "../components";

const STATUS: Record<TaskOccurrence["status"], [string, string]> = {
  "chua-bat-dau": ["Chưa bắt đầu", "plain"], "dang-lam": ["Đang làm", "warn"], "hoan-thanh": ["Hoàn thành", "ok"], "bo-qua": ["Bỏ qua", "plain"], huy: ["Đã hủy", "plain"],
};
const PUNCT: Record<string, [string, string]> = {
  "dung-han": ["Đúng giờ", "ok"], "lech-han": ["Lệch giờ", "bad"], "chua-du-du-lieu": ["Chưa đủ dữ liệu", "plain"], "khong-theo-doi": ["Không theo dõi", "plain"],
};

export function Today() {
  const s = useApp();
  const tz = s.profile.timeZone;
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<TaskOccurrence | "new" | null>(null);
  const [actualFor, setActualFor] = useState<TaskOccurrence | null>(null);
  const [pickFor, setPickFor] = useState<TaskOccurrence | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { if (materializeDay(s, date) !== s) dispatch((x) => materializeDay(x, date)); }, [date, s.scheduleVersion]);
  const occs = dayOccurrences(s, date);
  const now = Date.now();
  const nextId = date === today ? occs.find((o) => o.status === "chua-bat-dau" && o.planned.endMs > now)?.id : undefined;
  const remaining = occs.filter((o) => o.status === "chua-bat-dau" || o.status === "dang-lam").length;

  return (
    <div>
      <div class="row spread">
        <button class="linkbtn" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}>‹ Trước</button>
        <h1 style="margin:0">{date === today ? "Hôm nay" : viDate(date)}</h1>
        <button class="linkbtn" aria-label="Ngày sau" onClick={() => setDate(addDays(date, 1))}>Sau ›</button>
      </div>
      <p class="muted small" style="text-align:center">{viDate(date)} · múi giờ lịch {tz}</p>
      {date === today && <Mascot text={occs.length === 0 ? "Hôm nay chưa có việc nào. Thêm một việc nhỏ thôi cũng được nhé." : remaining ? `Còn ${remaining} việc. Mình đi từng bước một nhé.` : "Xong hết rồi! Nghỉ ngơi thôi. 🌙"} />}
      {date === today && <a class="btn soft block" style="display:flex;justify-content:center;align-items:center;text-decoration:none;margin:8px 0" href="#/len-ke-hoach?nangluong=thap">🪫 Hôm nay tôi ít năng lượng</a>}

      <div class="timeline" style="margin-top:10px">
        {occs.map((o) => {
          const e = effective(s, o);
          const ev = evaluate(s, o, now);
          const [sl, sc] = STATUS[o.status];
          const [pl, pc] = PUNCT[ev.punctuality]!;
          const canUndo = !!lastUndoable(s, o.id);
          const pending = o.status === "chua-bat-dau";
          return (
            <div class={`card ${o.id === nextId ? "next" : ""} ${o.status === "hoan-thanh" || o.status === "huy" ? "done" : ""}`} key={o.id}>
              <div class="row spread">
                <span class="time">{timeRange(o)}</span>
                <span class="small muted">{CATEGORY_LABEL[e.template.category]}</span>
              </div>
              <div class="row spread" style="margin-top:4px">
                <b style="font-size:1.05rem">{e.title}</b>
                {e.template.flexibility === "co-dinh" && <span class="chip plain">🔒 Cố định</span>}
              </div>
              <div class="row" style="margin-top:6px">
                <span class={`chip ${sc}`}>{sl}</span>
                <span class={`chip ${pc}`}>{pl}</span>
                {ev.due && ev.confirmation === "chua-xac-nhan" && ev.tracked && <span class="chip warn">Chưa xác nhận</span>}
                {o.id === nextId && <span class="chip">Việc đang tới</span>}
              </div>
              <div class="row" style="margin-top:10px">
                {pending && <button class="btn small primary" onClick={() => dispatch((x) => startTask(x, o.id), "Bắt đầu nhé! 🌱", o.id)}>Bắt đầu</button>}
                {(pending || o.status === "dang-lam") && <button class="btn small soft" onClick={() => dispatch((x) => completeTask(x, o.id), "Tuyệt, đã ghi nhận hoàn thành.", o.id)}>Đã xong</button>}
                {pending && <button class="btn small" onClick={() => dispatch((x) => reschedule(x, o.id, Math.max(Date.now(), o.planned.startMs) + 10 * 60_000), "Đã dời 10 phút.", o.id)}>Dời 10 phút</button>}
                <button class="btn small" aria-expanded={menu === o.id} onClick={() => setMenu(menu === o.id ? null : o.id)}>Thêm…</button>
              </div>
              {menu === o.id && (
                <div class="row" style="margin-top:8px">
                  {pending && <button class="btn small" onClick={() => { setPickFor(o); setMenu(null); }}>Chọn giờ khác</button>}
                  {pending && <button class="btn small" onClick={() => { dispatch((x) => skipTask(x, o.id), "Hôm nay bỏ qua việc này. Không sao cả.", o.id); setMenu(null); }}>Hôm nay bỏ qua</button>}
                  <button class="btn small" onClick={() => { setActualFor(o); setMenu(null); }}>Giờ thực tế</button>
                  <button class="btn small" onClick={() => { setEditing(o); setMenu(null); }}>Sửa</button>
                  {o.status !== "huy" && <button class="btn small" onClick={() => { dispatch((x) => cancel(x, o.id), "Đã hủy lần này.", o.id); setMenu(null); }}>Hủy lần này</button>}
                  {canUndo && <button class="btn small" onClick={() => { undo(o.id); setMenu(null); }}>Hoàn tác</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button class="btn primary fab" onClick={() => setEditing("new")}>＋ Thêm việc</button>
      {editing && <TaskEditor date={date} occurrence={editing === "new" ? undefined : editing} template={editing === "new" ? undefined : s.templates.find((t) => t.id === editing.templateId)} onClose={() => setEditing(null)} />}
      {actualFor && <ActualEditor occ={actualFor} onClose={() => setActualFor(null)} />}
      {pickFor && <PickTime occ={pickFor} onClose={() => setPickFor(null)} onPick={(ms) => dispatch((x) => reschedule(x, pickFor.id, ms), "Đã dời giờ.", pickFor.id)} />}
    </div>
  );
}
