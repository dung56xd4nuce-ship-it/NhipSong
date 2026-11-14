// Lưu dữ liệu lịch cục bộ. Android: tệp JSON trong thư mục dữ liệu riêng của app (ghi tạm rồi đổi tên).
// Trình duyệt: localStorage. Token KHÔNG bao giờ đi qua lớp này.
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { AppState } from "../core/types";

const FILE = "nhip-song/state.json";
const TMP = "nhip-song/state.tmp.json";
const LS_KEY = "nhip-song-state";

export const isNative = () => Capacitor.isNativePlatform();

export async function loadState(): Promise<AppState | null> {
  try {
    if (!isNative()) {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as AppState) : null;
    }
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(r.data as string) as AppState;
  } catch {
    return null;
  }
}

let chain: Promise<void> = Promise.resolve();

export function saveState(state: AppState): Promise<void> {
  const json = JSON.stringify(state);
  chain = chain.then(async () => {
    if (!isNative()) { localStorage.setItem(LS_KEY, json); return; }
    await Filesystem.writeFile({ path: TMP, directory: Directory.Data, data: json, encoding: Encoding.UTF8, recursive: true });
    try { await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }); } catch { /* lần đầu */ }
    await Filesystem.rename({ from: TMP, to: FILE, directory: Directory.Data, toDirectory: Directory.Data });
  }).catch((e) => { console.warn("Không lưu được dữ liệu", e?.message); });
  return chain;
}

export async function wipeState(): Promise<void> {
  if (!isNative()) { localStorage.removeItem(LS_KEY); return; }
  for (const path of [FILE, TMP]) { try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch { /* không có */ } }
}

/** Ghi tệp xuất ra thư mục Documents (Android) hoặc tải xuống (trình duyệt). */
export async function writeExport(name: string, json: string): Promise<string> {
  if (!isNative()) {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return name;
  }
  const r = await Filesystem.writeFile({ path: name, directory: Directory.Documents, data: json, encoding: Encoding.UTF8, recursive: true });
  return r.uri;
}
