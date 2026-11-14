// Cầu nối tới plugin native "Siwc" (Sign in with ChatGPT chính thức). Không có đường dự phòng API key.
// Trên trình duyệt: báo rõ là không khả dụng, KHÔNG giả lập kết nối.
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./storage";

export interface SiwcStatus { status: "chua-ket-noi" | "da-ket-noi" | "can-ket-noi-lai"; email?: string; scopes: string[]; planUsage: boolean; connectedAt?: number }
interface SiwcPlugin {
  status(): Promise<SiwcStatus>;
  connect(): Promise<SiwcStatus>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<{ remoteRevoked: boolean }>;
  listModels(): Promise<{ models: string[] }>;
  respond(o: { model: string; instructions: string; input: string }): Promise<{ text: string }>;
  cancelRespond(): Promise<void>;
}

const Siwc = registerPlugin<SiwcPlugin>("Siwc");

export class AiError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); }
}

export const UNAVAILABLE_WEB = "Kết nối ChatGPT chỉ chạy trong app Android. Bản trình duyệt này không gọi AI.";

function wrap(e: any): AiError {
  const code = e?.code ?? "unexpected";
  const msg = e?.message ?? "Lỗi không xác định.";
  return new AiError(code, msg, Boolean(e?.data?.retryable));
}

export async function siwcStatus(): Promise<SiwcStatus | null> {
  if (!isNative()) return null;
  try { return await Siwc.status(); } catch { return null; }
}

export async function siwcConnect(): Promise<SiwcStatus> {
  if (!isNative()) throw new AiError("unsupported", UNAVAILABLE_WEB);
  try { return await Siwc.connect(); } catch (e) { throw wrap(e); }
}
export async function siwcCancelConnect() { if (isNative()) await Siwc.cancelConnect(); }

export async function siwcDisconnect(): Promise<{ remoteRevoked: boolean }> {
  if (!isNative()) return { remoteRevoked: false };
  return Siwc.disconnect();
}

export async function siwcModels(): Promise<string[]> {
  if (!isNative()) throw new AiError("unsupported", UNAVAILABLE_WEB);
  try { return (await Siwc.listModels()).models; } catch (e) { throw wrap(e); }
}

let inflight: Promise<string> | null = null;
/** Một yêu cầu tại một thời điểm (chống gửi trùng); thử lại tối đa 1 lần với lỗi tạm thời. */
export async function siwcRespond(model: string, instructions: string, input: string): Promise<string> {
  if (!isNative()) throw new AiError("unsupported", UNAVAILABLE_WEB);
  if (inflight) throw new AiError("busy", "Đang chờ AI trả lời yêu cầu trước.");
  inflight = (async () => {
    let lastErr: AiError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return (await Siwc.respond({ model, instructions, input })).text; }
      catch (e) { lastErr = wrap(e); if (!lastErr.retryable || lastErr.code === "cancelled") break; await new Promise((r) => setTimeout(r, 1500)); }
    }
    throw lastErr!;
  })();
  try { return await inflight; } finally { inflight = null; }
}
export async function siwcCancelRespond() { if (isNative()) await Siwc.cancelRespond(); }

export function friendlyAiError(e: unknown): string {
  if (!(e instanceof AiError)) return (e as Error)?.message ?? "AI gặp lỗi.";
  switch (e.code) {
    case "reauth_required": case "unauthorized": return "Phiên ChatGPT đã hết hạn hoặc bị thu hồi. Vào Cài đặt để kết nối lại.";
    case "plan_not_granted": return "Bạn đã đăng nhập nhưng chưa cấp quyền dùng gói ChatGPT cho app, nên AI chưa dùng được.";
    case "usage_limit": return "Đã chạm hạn mức dùng gói ChatGPT. Bạn có thể xem mục Usage trong cài đặt ChatGPT.";
    case "network_error": case "timeout": return "Không kết nối được tới ChatGPT. Lịch của bạn vẫn giữ nguyên; thử lại khi có mạng nhé.";
    case "client_not_enabled": case "forbidden": return `ChatGPT từ chối yêu cầu: ${e.message}`;
    default: return e.message;
  }
}
