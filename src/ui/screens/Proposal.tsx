import { useState } from "preact/hooks";
import * as AI from "../../core/ai";
import { dayOccurrences, effective } from "../../core/schedule";
import { fmtLocalTime, viWeekday, viDate, todayIn } from "../../core/time";
import { dispatch, getState } from "../store";
import { CATEGORY_LABEL } from "../components";

const MODE_LABEL: Record<AI.PlanMode, string> = { "nhe-nhang": "Nhẹ nhàng", "can-bang": "Cân bằng", "tap-trung": "Tập trung" };

/** Xem trước đề xuất lịch mới: giả định, lý do, xung đột, trước/sau, chọn từng việc rồi mới áp dụng. */
export function PlanPreview({ draft, proposalId, onDone }: { draft: AI.PlanDraft; proposalId: string; onDone: () => void }) {
  const s = getState();
  const [sel, setSel] = useState<number[]>(draft.tasks.map((_, i) => i));
  const errsFor = (i: number) => AI.checkPlanDraft(s, { ...draft, tasks: [draft.tasks[i]!] });
  const chosen = { ...draft, tasks: draft.tasks.filter((_, i) => sel.includes(i)) };
  const all = AI.checkPlanDraft(s, chosen);
  const before = s.templates.filter((t) => !t.archived).length;
  return (
    <div class="card">
      <div class="row spread"><b>Đề xuất lịch · {MODE_LABEL[draft.mode]}</b><span class="chip">AI đề xuất</span></div>
      {draft.assumptions.length > 0 && <div class="banner info"><b>Giả định:</b><ul>{draft.assumptions.map((a) => <li>{a}</li>)}</ul></div>}
      {draft.conflicts.length > 0 && <div class="banner warn"><b>Xung đột AI báo:</b><ul>{draft.conflicts.map((a) => <li>{a}</li>)}</ul></div>}
      <p class="small muted">Trước: {before} việc lặp · Sau: {before + sel.length} việc lặp</p>
      {draft.tasks.map((t, i) => {
        const errs = errsFor(i);
        return (
          <label class="card" style="display:block">
            <div class="row"><input type="checkbox" checked={sel.includes(i)} onChange={(e) => setSel(e.currentTarget.checked ? [...sel, i] : sel.filter((x) => x !== i))} />
              <b class="grow">{t.title}</b><span class="time">{t.start} · {t.durationMin}′</span></div>
            <div class="small muted">{CATEGORY_LABEL[t.category]} · {t.days.length === 7 ? "Hằng ngày" : t.days.map(viWeekday).join(", ")}{t.flexibility === "co-dinh" ? " · cố định" : ""}</div>
            {t.reason && <div class="small">💡 {t.reason}</div>}
            {errs.map((e) => <div class="small" style="color:var(--bad)">⚠ {e}</div>)}
          </label>
        );
      })}
      {all.length > 0 && <div class="banner bad">Chưa áp dụng được vì còn xung đột. Bỏ chọn việc bị trùng hoặc sửa sau khi áp dụng phần còn lại.</div>}
      <div class="row" style="margin-top:10px">
        <button class="btn primary grow" disabled={!sel.length || all.length > 0} onClick={() => {
          if (dispatch((st) => AI.markProposal(AI.applyPlanDraft(st, draft, sel, todayIn(st.profile.timeZone)), proposalId, "da-ap-dung"), `Đã áp dụng ${sel.length} việc. Bạn có thể sửa từng việc bất cứ lúc nào.`)) onDone();
        }}>Áp dụng {sel.length} việc</button>
        <button class="btn" onClick={() => { dispatch((st) => AI.markProposal(st, proposalId, "bo-qua")); onDone(); }}>Bỏ qua</button>
      </div>
    </div>
  );
}

/** Xem trước điều chỉnh ngày mai: tối đa 3 thay đổi, lịch trước/sau, chọn từng thay đổi. */
export function AdjustPreview({ draft, proposalId, source, onDone }: { draft: AI.AdjustDraft; proposalId: string; source: "ai" | "quy-tac"; onDone: () => void }) {
  const s = getState();
  const [sel, setSel] = useState<number[]>(draft.changes.map((_, i) => i));
  const errs = AI.checkAdjustDraft(s, { ...draft, changes: draft.changes.filter((_, i) => sel.includes(i)) });
  const occ = (id?: string) => (id ? s.occurrences[id] : undefined);
  const tz = s.profile.timeZone;
  return (
    <div class="card">
      <div class="row spread"><b>Điều chỉnh cho {viDate(draft.date)}</b><span class="chip">{source === "ai" ? "AI đề xuất" : "Gợi ý theo quy tắc"}</span></div>
      {draft.summary && <p>{draft.summary}</p>}
      {draft.assumptions.length > 0 && <div class="banner info"><b>Giả định:</b><ul>{draft.assumptions.map((a) => <li>{a}</li>)}</ul></div>}
      {draft.changes.map((c, i) => {
        const o = occ(c.occurrenceId);
        const e = o ? effective(s, o) : null;
        const beforeTxt = o && e ? `${fmtLocalTime(o.planned.startMs, tz)} · ${e.durationMin}′ ${e.title}` : "—";
        const afterTxt = c.type === "bo" ? "Bỏ khỏi ngày mai" : c.type === "them" ? `${c.start} · ${c.durationMin}′ ${c.title}` : c.type === "doi-gio" ? `${c.start} · ${c.durationMin ?? e?.durationMin}′ ${e?.title ?? ""}` : `${o ? fmtLocalTime(o.planned.startMs, tz) : ""} · ${c.durationMin}′ ${e?.title ?? ""}`;
        return (
          <label class="card" style="display:block">
            <div class="row"><input type="checkbox" checked={sel.includes(i)} onChange={(ev) => setSel(ev.currentTarget.checked ? [...sel, i] : sel.filter((x) => x !== i))} /><b class="grow">Thay đổi {i + 1}</b></div>
            <div class="diff small"><span class={c.type !== "them" ? "strike" : "muted"}>{beforeTxt}</span><span>→</span><span>{afterTxt}</span></div>
            <div class="small">💡 {c.reason}</div>
          </label>
        );
      })}
      <details><summary class="small">Xem lịch ngày mai hiện tại</summary>
        <ul class="small">{dayOccurrences(s, draft.date).map((o) => <li>{fmtLocalTime(o.planned.startMs, tz)} {effective(s, o).title}</li>)}</ul>
      </details>
      {errs.map((e) => <div class="banner bad small">⚠ {e}</div>)}
      <div class="row" style="margin-top:10px">
        <button class="btn primary grow" disabled={!sel.length || errs.length > 0} onClick={() => {
          if (dispatch((st) => AI.markProposal(AI.applyAdjustDraft(st, draft, sel), proposalId, "da-ap-dung"), "Đã áp dụng. Ngày mai sẽ dễ thở hơn chút nhé. 🌿")) onDone();
        }}>{sel.length === draft.changes.length ? "Áp dụng tất cả" : `Áp dụng ${sel.length} thay đổi`}</button>
        <button class="btn" onClick={() => { dispatch((st) => AI.markProposal(st, proposalId, "bo-qua")); onDone(); }}>Bỏ qua</button>
      </div>
    </div>
  );
}
