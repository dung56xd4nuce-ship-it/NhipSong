import { useState } from "preact/hooks";
import { isValidTimeZone } from "../../core/time";
import { connectChatGPT, dispatch, useApp } from "../store";
import { requestPermission } from "../../platform/notify";
import { isNative } from "../../platform/storage";
import { ConsentEditor, DayPicker, Field } from "../components";
import { AiPlanner } from "./Plan";

type Step = "gioi-thieu" | "chon" | "tay" | "ai-giai-thich" | "ai" | "thong-bao";

export function Onboarding() {
  const s = useApp();
  const [step, setStep] = useState<Step>("gioi-thieu");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const p = s.profile;
  const [work, setWork] = useState({ start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] });
  const finish = () => dispatch((st) => ({ ...st, profile: { ...st.profile, onboarded: true } }));

  if (step === "gioi-thieu") return (
    <div class="stack" style="padding-top:8vh;text-align:center">
      <div class="mascot" style="font-size:3.5rem" aria-hidden="true">🐣</div>
      <h1>Nhịp Sống</h1>
      <p><b>Sống theo nhịp của bạn. Mỗi ngày vừa sức hơn một chút.</b></p>
      <p class="muted">Lên kế hoạch làm việc, sinh hoạt và nghỉ ngơi. Nhắc nhẹ nhàng khi lệch lịch và giúp bạn chỉnh lịch cho vừa sức.</p>
      <button class="btn primary block" onClick={() => setStep("chon")}>Bắt đầu</button>
    </div>
  );

  if (step === "chon") return (
    <div class="stack" style="padding-top:4vh">
      <h1>Bạn muốn bắt đầu thế nào?</h1>
      <button class="card" style="text-align:left;cursor:pointer;width:100%" onClick={() => setStep("tay")}><b>✍️ Tự lên lịch</b><p class="small muted">Không cần đăng nhập. Mọi thứ chạy offline trên máy.</p></button>
      <button class="card" style="text-align:left;cursor:pointer;width:100%" onClick={() => setStep("ai-giai-thich")}><b>✨ Nhờ AI đề xuất</b><p class="small muted">Mô tả nhịp sống bằng lời, AI gợi ý lịch để bạn duyệt. Cần kết nối ChatGPT.</p></button>
    </div>
  );

  if (step === "tay") return (
    <div>
      <h1>Vài thông tin cơ bản</h1>
      <Field label="Múi giờ của lịch"><input type="text" value={p.timeZone} onChange={(e) => { const v = e.currentTarget.value; if (isValidTimeZone(v)) dispatch((st) => ({ ...st, profile: { ...st.profile, timeZone: v } })); }} /></Field>
      <div class="row">
        <div class="grow"><Field label="Đi ngủ"><input type="time" value={p.sleep.bed} onChange={(e) => dispatch((st) => ({ ...st, profile: { ...st.profile, sleep: { ...st.profile.sleep, bed: e.currentTarget.value } } }))} /></Field></div>
        <div class="grow"><Field label="Thức dậy"><input type="time" value={p.sleep.wake} onChange={(e) => dispatch((st) => ({ ...st, profile: { ...st.profile, sleep: { ...st.profile.sleep, wake: e.currentTarget.value } } }))} /></Field></div>
      </div>
      <h3>Giờ làm/học (bỏ trống nếu không có)</h3>
      <div class="row"><input type="time" class="grow" value={work.start} onInput={(e) => setWork({ ...work, start: e.currentTarget.value })} aria-label="Làm từ" /><input type="time" class="grow" value={work.end} onInput={(e) => setWork({ ...work, end: e.currentTarget.value })} aria-label="Làm đến" /></div>
      <DayPicker value={work.days} onChange={(d) => setWork({ ...work, days: d })} />
      <div class="row" style="margin-top:14px">
        <button class="btn primary grow" onClick={() => { dispatch((st) => ({ ...st, profile: { ...st.profile, work: work.days.length ? [{ label: "Giờ làm", ...work }] : [] } })); setStep("thong-bao"); }}>Tiếp tục</button>
        <button class="btn" onClick={() => setStep("thong-bao")}>Bỏ qua</button>
      </div>
    </div>
  );

  if (step === "ai-giai-thich") return (
    <div>
      <h1>Trước khi kết nối AI</h1>
      <p>App sẽ mở trang đăng nhập ChatGPT chính thức trong trình duyệt. Bạn chọn tài khoản và duyệt quyền ngay trên trang của OpenAI.</p>
      <ul class="small">
        <li>Đăng nhập chỉ xác nhận tài khoản. Quyền <b>dùng gói ChatGPT cho AI</b> là quyền riêng, cần tài khoản đủ điều kiện (Plus/Pro).</li>
        <li>App chỉ gửi những dữ liệu bạn cho phép dưới đây, không đọc lịch sử trò chuyện hay bộ nhớ ChatGPT.</li>
        <li>Lịch vẫn lưu trên máy. Ngắt kết nối không làm mất lịch.</li>
      </ul>
      <ConsentEditor state={s} onChange={(c) => dispatch((st) => ({ ...st, profile: { ...st.profile, aiConsent: c } }))} />
      {!isNative() && <div class="banner warn small">Bạn đang dùng bản trình duyệt: kết nối ChatGPT chỉ có trong app Android.</div>}
      {msg && <div class="banner info small">{msg}</div>}
      <div class="row" style="margin-top:10px">
        <button class="btn primary grow" disabled={!isNative() || busy} onClick={async () => { setBusy(true); const r = await connectChatGPT(); setBusy(false); if (r) setMsg(r); else setStep("ai"); }}>{busy ? "Đang chờ trình duyệt…" : "Continue with ChatGPT"}</button>
        <button class="btn" onClick={() => setStep("tay")}>Tự lên lịch</button>
      </div>
    </div>
  );

  if (step === "ai") return (
    <div>
      <h1>Nhờ AI đề xuất</h1>
      <AiPlanner onApplied={() => setStep("thong-bao")} />
      <button class="btn block" style="margin-top:10px" onClick={() => setStep("thong-bao")}>Tiếp tục</button>
    </div>
  );

  return (
    <div class="stack" style="padding-top:6vh">
      <h1>Nhắc việc nhẹ nhàng 🔔</h1>
      <p>Cho phép thông báo để Nhịp nhắc bạn đúng giờ, hỏi thăm nhẹ nếu bạn bận, và gửi tổng kết cuối ngày (tối đa 1 lần/ngày). Có giờ yên lặng và tạm dừng bất cứ lúc nào.</p>
      <button class="btn primary block" onClick={async () => { await requestPermission(); finish(); }}>Cho phép thông báo</button>
      <button class="btn block" onClick={finish}>Để sau</button>
      <p class="small muted">Không cho phép cũng không sao: bạn vẫn xem lịch và xác nhận việc trong app.</p>
    </div>
  );
}
