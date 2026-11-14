import { useEffect, useState } from "preact/hooks";
import { exportBackup, parseBackup } from "../../core/backup";
import { todayIn } from "../../core/time";
import { NotificationSettings } from "../../core/types";
import { connectChatGPT, disconnectChatGPT, dispatch, listModels, refreshConnection, resetAll, resync, setState, showToast, useApp, getState, lastSync } from "../store";
import { exactAlarmAllowed, openExactAlarmSettings, permissionState, requestPermission, PermissionState } from "../../platform/notify";
import { writeExport, isNative } from "../../platform/storage";
import { siwcCancelConnect } from "../../platform/chatgpt";
import { ConsentEditor, Field } from "../components";

export function Settings() {
  const s = useApp();
  const n = s.notificationSettings;
  const c = s.aiConnection;
  const [perm, setPerm] = useState<PermissionState>("unsupported");
  const [exact, setExact] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => { void permissionState().then(setPerm); void exactAlarmAllowed().then(setExact); }, []);
  const setN = (patch: Partial<NotificationSettings>) => dispatch((st) => ({ ...st, notificationSettings: { ...st.notificationSettings, ...patch, updatedAt: new Date().toISOString() } }));

  const doConnect = async () => { setBusy(true); setMsg(null); const r = await connectChatGPT(); setBusy(false); setMsg(r ?? "Đã kết nối ChatGPT và có quyền dùng gói cho AI. 🎉"); };
  const doImport = async (file: File) => {
    try {
      const next = parseBackup(await file.text(), getState().aiConnection);
      if (!confirm("Nhập dữ liệu sẽ GHI ĐÈ toàn bộ lịch hiện tại trên máy. Tiếp tục?")) return;
      setState(next); showToast("Đã nhập dữ liệu.");
    } catch (e) { showToast((e as Error).message); }
  };

  return (
    <div>
      <h1>Cài đặt</h1>

      <h2>Thông báo</h2>
      <div class="card">
        <p class="small">Quyền thông báo: <b>{{ granted: "đã cho phép", denied: "đã từ chối", prompt: "chưa hỏi", unsupported: "không hỗ trợ trên trình duyệt" }[perm]}</b></p>
        {perm === "prompt" && <button class="btn soft small" onClick={async () => setPerm(await requestPermission())}>Cho phép thông báo</button>}
        {perm === "denied" && <p class="small muted">Bạn có thể bật lại trong Cài đặt Android › Ứng dụng › Nhịp Sống › Thông báo. App vẫn dùng bình thường khi không có thông báo.</p>}
        {exact === false && <div class="banner warn small">Android đang chặn báo thức chính xác, thông báo có thể đến trễ vài phút. <button class="linkbtn" onClick={() => void openExactAlarmSettings()}>Mở cài đặt</button></div>}
        <label class="check"><input type="checkbox" checked={n.enabled} onChange={(e) => setN({ enabled: e.currentTarget.checked })} /> Bật nhắc việc</label>
        <div class="row">
          <div class="grow"><Field label="Gia hạn mặc định (phút)"><input type="number" min={0} max={120} value={n.defaultGraceMin} onChange={(e) => setN({ defaultGraceMin: Number(e.currentTarget.value) })} /></Field></div>
          <div class="grow"><Field label="Tối đa thông báo/việc"><select value={n.maxPerTask} onChange={(e) => setN({ maxPerTask: Number(e.currentTarget.value) })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></Field></div>
        </div>
        <label class="check"><input type="checkbox" checked={!!n.quietHours} onChange={(e) => setN({ quietHours: e.currentTarget.checked ? { start: "22:30", end: "06:00" } : null })} /> Giờ yên lặng</label>
        {n.quietHours && <div class="row"><input type="time" class="grow" value={n.quietHours.start} onChange={(e) => setN({ quietHours: { ...n.quietHours!, start: e.currentTarget.value } })} aria-label="Yên lặng từ" /><input type="time" class="grow" value={n.quietHours.end} onChange={(e) => setN({ quietHours: { ...n.quietHours!, end: e.currentTarget.value } })} aria-label="Yên lặng đến" /></div>}
        <div class="row" style="margin-top:8px">
          {n.pausedUntil && n.pausedUntil > Date.now()
            ? <><span class="chip warn">Đang tạm dừng nhắc</span><button class="btn small" onClick={() => setN({ pausedUntil: null })}>Bật lại</button></>
            : <><button class="btn small" onClick={() => setN({ pausedUntil: Date.now() + 3600_000 })}>Tạm dừng 1 giờ</button><button class="btn small" onClick={() => setN({ pausedUntil: Date.now() + 24 * 3600_000 })}>Tạm dừng 24 giờ</button></>}
        </div>
        <Field label="Giờ tổng kết"><input type="time" value={n.summaryTime} onChange={(e) => setN({ summaryTime: e.currentTarget.value })} /></Field>
        <Field label="Phong cách lời nhắc"><select value={n.style} onChange={(e) => setN({ style: e.currentTarget.value as any })}><option value="dang-yeu">Đáng yêu 🐣</option><option value="ngan-gon">Ngắn gọn</option></select></Field>
        <label class="check"><input type="checkbox" checked={n.hideOnLockScreen} onChange={(e) => setN({ hideOnLockScreen: e.currentTarget.checked })} /> Ẩn tên việc trong thông báo (màn hình khóa)</label>
        {lastSync && <p class="small muted">Lần lập nhắc gần nhất: thêm {lastSync.scheduled}, hủy {lastSync.cancelled}.</p>}
        <button class="btn small" onClick={() => void resync()}>Lập lại lịch nhắc</button>
      </div>

      <h2>Kết nối ChatGPT</h2>
      <div class="card">
        <p class="small">Trạng thái: <b>{{ "chua-ket-noi": "Chưa kết nối", "da-ket-noi": c.planUsage ? "Đã kết nối · có quyền dùng gói cho AI" : "Đã đăng nhập · CHƯA có quyền dùng gói cho AI", "can-ket-noi-lai": "Cần kết nối lại", "khong-du-dieu-kien": "Không khả dụng trên nền tảng này" }[c.status]}</b>{c.email ? ` · ${c.email}` : ""}</p>
        <p class="small muted">Dùng “Sign in with ChatGPT” chính thức qua trình duyệt hệ thống. Đăng nhập (danh tính) và quyền dùng gói ChatGPT cho AI là hai quyền riêng. App không dùng API key, không đọc lịch sử trò chuyện hay bộ nhớ ChatGPT, không cần app ChatGPT đang mở.</p>
        {c.status === "khong-du-dieu-kien" && <p class="small">{c.lastError}</p>}
        {isNative() && (c.status !== "da-ket-noi" || !c.planUsage) && <div class="row"><button class="btn primary" disabled={busy} onClick={doConnect}>{busy ? "Đang chờ trình duyệt…" : c.status === "can-ket-noi-lai" ? "Kết nối lại với ChatGPT" : "Continue with ChatGPT"}</button>{busy && <button class="btn" onClick={() => void siwcCancelConnect()}>Hủy</button>}</div>}
        {c.status === "da-ket-noi" && (<>
          {c.planUsage && <div class="row">
            <select class="grow" value={c.model ?? ""} aria-label="Model" onFocus={async () => { if (!models.length) { try { setModels(await listModels()); } catch (e) { setMsg((e as Error).message); } } }} onChange={(e) => dispatch((st) => ({ ...st, aiConnection: { ...st.aiConnection, model: e.currentTarget.value } }))}>
              {[c.model, ...models.filter((m) => m !== c.model)].filter(Boolean).map((m) => <option value={m}>{m}</option>)}
            </select>
          </div>}
          <div class="row" style="margin-top:8px"><button class="btn small" onClick={() => void refreshConnection()}>Kiểm tra lại</button><button class="btn danger small" onClick={async () => { if (confirm("Ngắt kết nối ChatGPT? Lịch trên máy sẽ được giữ nguyên.")) setMsg(await disconnectChatGPT()); }}>Ngắt kết nối</button></div>
        </>)}
        {c.lastError && c.status !== "khong-du-dieu-kien" && <p class="small" style="color:var(--bad)">{c.lastError}</p>}
        {msg && <div class="banner info small">{msg}</div>}
        <h3>Quyền dữ liệu gửi cho AI</h3>
        <ConsentEditor state={s} onChange={(cs) => dispatch((st) => ({ ...st, profile: { ...st.profile, aiConsent: cs } }))} />
      </div>

      <h2>Hiển thị</h2>
      <div class="card">
        <label class="check"><input type="checkbox" checked={n.mascot} onChange={(e) => setN({ mascot: e.currentTarget.checked })} /> Hiện linh vật “Nhịp” 🐣</label>
        <label class="check"><input type="checkbox" checked={n.reduceMotion} onChange={(e) => setN({ reduceMotion: e.currentTarget.checked })} /> Giảm chuyển động</label>
      </div>

      <h2>Dữ liệu</h2>
      <div class="card stack">
        <p class="small muted">Lịch và lịch sử lưu trên máy này. Bản xuất không chứa thông tin đăng nhập ChatGPT.</p>
        <button class="btn block" onClick={async () => { const where = await writeExport(`nhip-song-${todayIn(s.profile.timeZone)}.json`, exportBackup(getState())); showToast(`Đã xuất: ${where}`); }}>Xuất dữ liệu</button>
        <label class="btn block" style="display:flex;justify-content:center;align-items:center">Nhập dữ liệu…<input type="file" accept="application/json,.json" class="sr" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void doImport(f); e.currentTarget.value = ""; }} /></label>
        <button class="btn danger block" onClick={async () => { if (confirm("Xóa TOÀN BỘ lịch, lịch sử và cài đặt trên máy? Không thể hoàn tác. (Kết nối ChatGPT được giữ, ngắt riêng ở trên.)")) { await resetAll(); showToast("Đã xóa dữ liệu."); } }}>Xóa toàn bộ dữ liệu</button>
      </div>

      <h2>Giới hạn hiện tại</h2>
      <ul class="small muted">
        <li>Thông báo do Android lập lịch; chế độ tiết kiệm pin có thể làm trễ vài phút.</li>
        <li>App chỉ biết bạn đã làm gì khi bạn xác nhận.</li>
        <li>Đề xuất AI cuối ngày được tạo khi bạn mở app; báo cáo cục bộ luôn có sẵn.</li>
      </ul>
    </div>
  );
}
