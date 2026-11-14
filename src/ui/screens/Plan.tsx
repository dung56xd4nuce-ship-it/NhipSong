import { useState } from "preact/hooks";
import * as AI from "../../core/ai";
import { startHHMM } from "../../core/schedule";
import { todayIn, viWeekday } from "../../core/time";
import { TaskTemplate } from "../../core/types";
import { aiExtractProfile, aiPlan, dispatch, useApp } from "../store";
import { CATEGORY_LABEL, ConsentEditor, Mascot, TaskEditor } from "../components";
import { PlanPreview } from "./Proposal";
import { ProfileConfirm } from "./Rhythm";

function recLabel(t: TaskTemplate) {
  const r = t.recurrence;
  return r.kind === "once" ? `Một lần ${r.date}` : r.kind === "daily" ? "Hằng ngày" : r.days.map(viWeekday).join(", ");
}

export function Plan() {
  const s = useApp();
  const lowEnergyAsk = location.hash.includes("nangluong=thap");
  const [tab, setTab] = useState<"tay" | "ai">(lowEnergyAsk ? "ai" : "tay");
  const [edit, setEdit] = useState<TaskTemplate | "new" | null>(null);
  const today = todayIn(s.profile.timeZone);
  const active = s.templates.filter((t) => !t.archived && !(t.recurrence.kind !== "once" && t.recurrence.until && t.recurrence.until < today) && !(t.recurrence.kind === "once" && t.recurrence.date < today));
  return (
    <div>
      <h1>Lên kế hoạch</h1>
      <div class="row" role="tablist">
        <button class="chip toggle" role="tab" aria-pressed={tab === "tay"} onClick={() => setTab("tay")}>✍️ Tự lên lịch</button>
        <button class="chip toggle" role="tab" aria-pressed={tab === "ai"} onClick={() => setTab("ai")}>✨ Nhờ AI đề xuất</button>
      </div>
      {tab === "tay" ? (
        <div style="margin-top:10px">
          <button class="btn primary block" onClick={() => setEdit("new")}>＋ Thêm việc mới</button>
          <h2>Việc đang có ({active.length})</h2>
          {active.length === 0 && <p class="muted">Chưa có việc nào. Bạn có thể tự thêm hoặc nhờ AI đề xuất.</p>}
          {active.sort((a, b) => startHHMM(a).localeCompare(startHHMM(b))).map((t) => (
            <button class="card block" style="display:block;width:100%;text-align:left;cursor:pointer" onClick={() => setEdit(t)}>
              <div class="row spread"><b>{t.title}</b><span class="time">{startHHMM(t)} · {t.durationMin}′</span></div>
              <div class="small muted">{CATEGORY_LABEL[t.category]} · {recLabel(t)}{t.flexibility === "co-dinh" ? " · 🔒 cố định" : ""}{t.optional ? " · tùy chọn" : ""}</div>
            </button>
          ))}
        </div>
      ) : <AiPlanner lowEnergy={lowEnergyAsk} />}
      {edit && <TaskEditor date={today} template={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function AiStatusNote() {
  const s = useApp();
  const c = s.aiConnection;
  if (c.status === "da-ket-noi" && c.planUsage) return <div class="banner ok small">Đã kết nối ChatGPT{c.email ? ` (${c.email})` : ""} · model {c.model ?? "chưa chọn"}</div>;
  if (c.status === "khong-du-dieu-kien") return <div class="banner warn small">AI chưa khả dụng: {c.lastError ?? "nền tảng này chưa hỗ trợ kết nối."} Mọi tính năng khác vẫn dùng bình thường.</div>;
  if (c.status === "da-ket-noi") return <div class="banner warn small">Đã đăng nhập ChatGPT nhưng chưa có quyền dùng gói cho AI. <a href="#/cai-dat">Xem chi tiết</a></div>;
  return <div class="banner info small">{c.status === "can-ket-noi-lai" ? "Phiên ChatGPT đã hết hạn hoặc bị thu hồi." : "Chưa kết nối ChatGPT."} <a href="#/cai-dat">Kết nối trong Cài đặt</a></div>;
}

export function AiPlanner({ lowEnergy, onApplied }: { lowEnergy?: boolean; onApplied?: () => void }) {
  const s = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<AI.ProfileDraft | null>(null);
  const [mode, setMode] = useState<AI.PlanMode>(lowEnergy ? "nhe-nhang" : "can-bang");
  const [low, setLow] = useState(!!lowEnergy);
  const [plan, setPlan] = useState<{ draft: AI.PlanDraft; id: string } | null>(null);
  const ready = s.aiConnection.status === "da-ket-noi" && s.aiConnection.planUsage;

  const run = async (label: string, f: () => Promise<void>) => {
    setErr(null); setBusy(label);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div style="margin-top:10px">
      <AiStatusNote />
      <h3>Dữ liệu được gửi cho AI</h3>
      <ConsentEditor state={s} onChange={(c) => dispatch((st) => ({ ...st, profile: { ...st.profile, aiConsent: c } }))} />

      {!profileDraft && !plan && (<>
        <h2>1. Mô tả nhịp sống của bạn</h2>
        <textarea value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Ví dụ: Tôi làm từ 8h đến 17h, đi đường 30 phút, muốn tập thể dục và học tiếng Anh, tối thường mệt." aria-label="Mô tả nhịp sống" />
        <button class="btn primary block" disabled={!ready || !text.trim() || !s.profile.aiConsent.profile || !!busy} onClick={() => run("Đang đọc mô tả…", async () => setProfileDraft(await aiExtractProfile(text.trim())))}>{busy ?? "Trích xuất hồ sơ"}</button>
        {!s.profile.aiConsent.profile && <p class="small muted">Cần cho phép gửi hồ sơ nhịp sống để AI đọc mô tả.</p>}
        <h2>2. Hoặc tạo lịch từ hồ sơ hiện có</h2>
      </>)}

      {profileDraft && <ProfileConfirm draft={profileDraft} onDone={() => setProfileDraft(null)} />}

      {!profileDraft && !plan && (<>
        <div class="row" role="group" aria-label="Chế độ">
          {(["nhe-nhang", "can-bang", "tap-trung"] as const).map((m) => <button class="chip toggle" aria-pressed={mode === m} onClick={() => setMode(m)}>{{ "nhe-nhang": "🌿 Nhẹ nhàng", "can-bang": "⚖️ Cân bằng", "tap-trung": "🎯 Tập trung" }[m]}</button>)}
        </div>
        <label class="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.currentTarget.checked)} /> Hôm nay tôi ít năng lượng (đề xuất giảm tải)</label>
        <button class="btn soft block" disabled={!ready || !s.profile.aiConsent.profile || !!busy} onClick={() => run("Đang nhờ AI xếp lịch…", async () => {
          const { draft } = await aiPlan(mode, low);
          let id = "";
          dispatch((st) => { const r = AI.storeProposal(st, "lap-lich", todayIn(st.profile.timeZone), mode, draft, "ai"); id = r.proposal.id; return r.state; });
          setPlan({ draft, id });
        })}>{busy ?? "Nhờ AI đề xuất lịch"}</button>
        {low && !ready && <Mascot text="Ngày ít năng lượng thì cứ làm việc quan trọng nhất trước, bỏ bớt việc tùy chọn. Bạn có thể dời hoặc bỏ qua việc ngay ở màn Hôm nay." />}
      </>)}

      {err && <div class="banner bad">{err}<br /><span class="small">Lịch hiện tại không bị thay đổi.</span></div>}
      {plan && <PlanPreview draft={plan.draft} proposalId={plan.id} onDone={() => { setPlan(null); onApplied?.(); }} />}
    </div>
  );
}
