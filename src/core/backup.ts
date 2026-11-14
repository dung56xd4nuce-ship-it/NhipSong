// Xuất/nhập dữ liệu kèm schema version. Bản xuất KHÔNG chứa token hay siêu dữ liệu kết nối.
import { AppState, SCHEMA_VERSION } from "./types";
import { defaultAiConnection } from "./defaults";
import { isValidTimeZone } from "./time";

export const BACKUP_FORMAT = "nhip-song-backup";

export interface Backup { format: typeof BACKUP_FORMAT; schemaVersion: number; exportedAt: string; data: Omit<AppState, "aiConnection"> }

const SECRET_KEYS = /token|secret|refresh|authorization|bearer|client_?id|host_?id/i;

export function exportBackup(state: AppState, now = Date.now()): string {
  const { aiConnection: _omit, ...data } = state;
  const b: Backup = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date(now).toISOString(), data };
  const json = JSON.stringify(b, null, 2);
  assertNoSecrets(json);
  return json;
}

export function assertNoSecrets(json: string): void {
  // Phòng thủ: không cho phép khóa có tên giống thông tin xác thực trong bản xuất
  const keys = json.match(/"([^"]+)"\s*:/g) ?? [];
  for (const k of keys) if (SECRET_KEYS.test(k)) throw new Error(`Bản xuất chứa trường nhạy cảm: ${k}`);
}

export function migrate(data: any, fromVersion: number): any {
  let d = data;
  if (fromVersion > SCHEMA_VERSION) throw new Error(`Bản sao lưu được tạo bởi phiên bản mới hơn (schema ${fromVersion}). Hãy cập nhật app.`);
  // v1 là phiên bản đầu; các migration tương lai thêm ở đây theo thứ tự.
  return d;
}

export function parseBackup(json: string, currentAi = defaultAiConnection()): AppState {
  let raw: any;
  try { raw = JSON.parse(json); } catch { throw new Error("Tệp không phải JSON hợp lệ."); }
  if (raw?.format !== BACKUP_FORMAT) throw new Error("Đây không phải tệp sao lưu của Nhịp Sống.");
  if (!Number.isInteger(raw.schemaVersion)) throw new Error("Thiếu phiên bản schema.");
  const d = migrate(raw.data, raw.schemaVersion);
  const required = ["profile", "templates", "occurrences", "events", "revisions", "notificationSettings"];
  for (const k of required) if (!(k in d)) throw new Error(`Sao lưu thiếu phần "${k}".`);
  if (!Array.isArray(d.templates) || typeof d.occurrences !== "object") throw new Error("Cấu trúc dữ liệu không hợp lệ.");
  if (!isValidTimeZone(d.profile?.timeZone)) throw new Error("Múi giờ trong sao lưu không hợp lệ.");
  return {
    schemaVersion: SCHEMA_VERSION,
    scheduleVersion: (Number(d.scheduleVersion) || 1) + 1,
    profile: d.profile, constraints: d.constraints ?? [], templates: d.templates, occurrences: d.occurrences,
    events: d.events, revisions: d.revisions, proposals: d.proposals ?? [], summaries: d.summaries ?? {},
    notificationSettings: d.notificationSettings,
    aiConnection: currentAi, // giữ nguyên kết nối hiện tại; nhập dữ liệu không đụng tới đăng nhập
  };
}
