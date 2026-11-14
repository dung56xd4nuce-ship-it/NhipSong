import { useState } from "preact/hooks";
import * as AI from "../../core/ai";
import { dayReport, DEVIATION_THRESHOLD, summaryCutoff } from "../../core/evaluation";
import { effective, setReason } from "../../core/schedule";
import { addDays, fmtLocalTime, todayIn, viDate } from "../../core/time";
import { DeviationReason, TaskOccurrence } from "../../core/types";
import { aiAdjust, dispatch, useApp } from "../store";
import { ActualEditor, Mascot } from "../components";
import { AdjustPreview } from "./Proposal";
import { AiStatusNote } from "./Plan";

const REASONS: [DeviationReason, string][] = [["phat-sinh", "Việc phát sinh"], ["thieu-nang-luong", "Thiếu năng lượng"], ["thieu-thoi-luong", "Thời lượng chưa đủ"], ["quen-cap-nhat", "Quên cập nhật"], ["khac", "Lý do khác"]];
const WHY: Record<string, string> = { "bat-dau-muon": "bắt đầu muộn", "ket-thuc-muon": "xong muộn", "bo-qua-sau-han": "bỏ qua sau giờ hẹn", "huy-sau-han": "hủy sau giờ hẹn" };

export function Review() {
  const s = useApp();
  const tz = s.profile.timeZone;
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [causes, setCauses] = useState<DeviationReason[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prop, setProp] = useState<{ draft: AI.AdjustDraft; id: string; source: "ai" | "quy-tac" } | null>(null);
  const [actualFor, setActualFor] = useState<TaskOccurrence | null>(null);
  const now = Date.now();
  const cutoff = date < today ? Infinity : Math.max(now, 0);
  const rep = dayReport(s, date, cutoff === Infinity ? Number.MAX_SAFE_INTEGER : cutoff);
  const tomorrow = addDays(date, 1);
  const rules = AI.ruleSuggestions(s, rep, tomorrow, causes);
  const ready = s.aiConnection.status === "da-ket-noi" && s.aiConnection.planUsage;
  const occ = (id: string) => s.occurrences[id]!;
  const sumTime = fmtLocalTime(summaryCutoff(s, date), tz);

  const askAi = async () => {
    setErr(null); setBusy(true);
    try {
      const draft = await aiAdjust(date, causes);
      let id = "";
      dispatch((st) => { const r = AI.storeProposal(st, "dieu-chinh", tomorrow, "can-bang", draft, "ai"); id = r.proposal.id; return r.state; });
      setProp({ draft, id, source: "ai" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const useRules = () => {
    const changes = rules.map((r) => r.change).filter(Boolean) as AI.AdjustChange[];
    if (!changes.length) return;
    const draft: AI.AdjustDraft = { baseScheduleVersion: s.scheduleVersion, date: tomorrow, summary: "Gợi ý theo quy tắc cục bộ (không dùng AI).", changes, assumptions: [] };
    let id = "";
    dispatch((st) => { const r = AI.storeProposal(st, "dieu-chinh", tomorrow, "nhe-nhang", draft, "quy-tac"); id = r.proposal.id; return r.state; });
    setProp({ draft, id, source: "quy-tac" });
  };

  return (
    <div>
      <div class="row spread">
        <button class="linkbtn" onClick={() => setDate(addDays(date, -1))}>‹ Trước</button>
        <h1 style="margin:0">Nhìn lại ngày</h1>
        <button class="linkbtn" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>Sau ›</button>
      </div>
      <p class="muted small" style="text-align:center">{viDate(date)} · giờ tổng kết {sumTime}{date === today ? " · đang cập nhật theo dữ liệu mới" : ""}</p>

      <div class="row card">
        <div class="stat"><b>{rep.completed.length}</b><span class="small">Hoàn thành</span></div>
        <div class="stat"><b>{rep.deviatedConfirmed.length}</b><span class="small">Đã xác nhận lệch</span></div>
        <div class="stat"><b>{rep.unconfirmed.length}</b><span class="small">Chưa xác nhận</span></div>
      </div>
      <p class="small muted">Việc chưa xác nhận không bị tính là lệch. Ngưỡng gợi ý điều chỉnh: từ {DEVIATION_THRESHOLD} việc lệch đã xác nhận.</p>

      {rep.thresholdReached
        ? <Mascot text={`Hôm nay có ${rep.deviatedConfirmed.length} việc lệch giờ. Hơi nhiều việc nhỉ — mình cùng sắp lại ngày mai cho dễ thở hơn nhé.`} />
        : <Mascot text={rep.deviatedConfirmed.length ? `Có ${rep.deviatedConfirmed.length} việc lệch giờ, vẫn trong mức ổn. Bạn làm tốt lắm.` : "Một ngày nhẹ nhàng. 🌿"} />}

      {rep.unconfirmed.length > 0 && (<>
        <h2>Chưa xác nhận</h2>
        {rep.unconfirmed.map((id) => { const o = occ(id); const e = effective(s, o); return (
          <div class="row card"><span class="grow"><span class="time">{fmtLocalTime(o.planned.startMs, tz)}</span> {e.title}</span><button class="btn small" onClick={() => setActualFor(o)}>Cập nhật</button></div>
        ); })}
      </>)}

      {rep.deviatedConfirmed.length > 0 && (<>
        <h2>Việc lệch giờ</h2>
        {rep.deviatedConfirmed.map((id) => { const o = occ(id); const ev = rep.evaluations.find((x) => x.occurrenceId === id)!; return (
          <div class="card">
            <div class="row spread"><b>{effective(s, o).title}</b><span class="small muted">{WHY[ev.why ?? ""]}</span></div>
            <div class="row" style="margin-top:6px">
              <select value={o.reason ?? ""} aria-label="Nguyên nhân (tùy chọn)" onChange={(e) => dispatch((st) => setReason(st, id, (e.currentTarget.value || undefined) as any))}>
                <option value="">Nguyên nhân (không bắt buộc)</option>{REASONS.map(([k, l]) => <option value={k}>{l}</option>)}
              </select>
              <button class="linkbtn" onClick={() => setActualFor(o)}>Sửa dữ liệu</button>
            </div>
          </div>
        ); })}
      </>)}

      {(rep.thresholdReached || prop) && (<>
        <h2>Ngày mai ({viDate(tomorrow)})</h2>
        <p class="small">Điều gì làm hôm nay khó hơn? (tùy chọn)</p>
        <div class="row">{REASONS.map(([k, l]) => <button class="chip toggle" aria-pressed={causes.includes(k)} onClick={() => setCauses(causes.includes(k) ? causes.filter((x) => x !== k) : [...causes, k])}>{l}</button>)}</div>
        <AiStatusNote />
        {!prop && <button class="btn primary block" style="margin-top:8px" disabled={!ready || busy} onClick={askAi}>{busy ? "Đang nhờ AI…" : "Nhờ AI đề xuất tối đa 3 thay đổi"}</button>}
        {err && <div class="banner bad">{err}<br /><span class="small">Lịch không bị thay đổi. Bạn vẫn có gợi ý theo quy tắc bên dưới.</span></div>}
        {prop && <AdjustPreview draft={prop.draft} proposalId={prop.id} source={prop.source} onDone={() => setProp(null)} />}
        <h3>Gợi ý theo quy tắc (không dùng AI)</h3>
        {rules.map((r) => <div class="card small"><div>{r.text}</div><div class="muted">Nguồn: {r.rule}</div></div>)}
        {!prop && rules.some((r) => r.change) && <button class="btn soft block" style="margin-top:8px" onClick={useRules}>Xem trước gợi ý quy tắc</button>}
      </>)}
      {actualFor && <ActualEditor occ={actualFor} onClose={() => setActualFor(null)} />}
    </div>
  );
}
