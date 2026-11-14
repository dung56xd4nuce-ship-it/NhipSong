import { useEffect, useState } from "preact/hooks";
import { useApp, getToast, undo, tzMismatch, adoptDeviceTimeZone, keepTimeZone } from "./store";
import { Today } from "./screens/Today";
import { Plan } from "./screens/Plan";
import { Review } from "./screens/Review";
import { Rhythm } from "./screens/Rhythm";
import { Settings } from "./screens/Settings";
import { Onboarding } from "./screens/Onboarding";

const TABS = [
  ["hom-nay", "Hôm nay", "📅"], ["len-ke-hoach", "Kế hoạch", "🗒️"], ["nhin-lai", "Nhìn lại", "🌙"], ["nhip", "Nhịp của tôi", "🌱"], ["cai-dat", "Cài đặt", "⚙️"],
] as const;

function route(): string { return (location.hash.replace(/^#\//, "").split("?")[0] || "hom-nay"); }

export function App() {
  const s = useApp();
  const [r, setR] = useState(route());
  useEffect(() => { const f = () => { setR(route()); window.scrollTo(0, 0); }; addEventListener("hashchange", f); setR(route()); return () => removeEventListener("hashchange", f); }, []);
  const toast = getToast();
  const cls = `app ${s.notificationSettings.reduceMotion ? "reduce-motion" : ""}`;
  if (!s.profile.onboarded) return <div class={cls}><Onboarding /></div>;
  return (
    <div class={cls}>
      {tzMismatch && (
        <div class="banner warn small">Máy đang ở múi giờ <b>{tzMismatch}</b>, lịch đang theo <b>{s.profile.timeZone}</b>. Bạn muốn đổi múi giờ của lịch không?
          <div class="row"><button class="btn small" onClick={adoptDeviceTimeZone}>Đổi sang {tzMismatch}</button><button class="btn small" onClick={keepTimeZone}>Giữ nguyên</button></div>
        </div>
      )}
      {r === "hom-nay" && <Today />}
      {r === "len-ke-hoach" && <Plan />}
      {r === "nhin-lai" && <Review />}
      {r === "nhip" && <Rhythm />}
      {r === "cai-dat" && <Settings />}
      {toast && <div class="toast" role="status" aria-live="polite"><span>{toast.text}</span>{toast.undoOcc && <button onClick={() => undo(toast.undoOcc!)}>Hoàn tác</button>}</div>}
      <nav class="tabs" aria-label="Điều hướng chính"><div class="tabs-inner">
        {TABS.map(([k, l, i]) => <a class="tab" href={`#/${k}`} aria-current={r === k ? "page" : undefined}><span class="ico" aria-hidden="true">{i}</span>{l}</a>)}
      </div></nav>
    </div>
  );
}
