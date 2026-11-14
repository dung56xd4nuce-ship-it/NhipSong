// Thông báo cục bộ qua hệ điều hành (Capacitor LocalNotifications). Không gọi AI cho từng thông báo.
import { LocalNotifications, ActionPerformed } from "@capacitor/local-notifications";
import { isNative } from "./storage";
import { diffNotifications, PlannedNotification } from "../core/notifications";

export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

export async function permissionState(): Promise<PermissionState> {
  if (!isNative()) return "unsupported";
  try { const p = await LocalNotifications.checkPermissions(); return p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "prompt"; }
  catch { return "unsupported"; }
}

export async function requestPermission(): Promise<PermissionState> {
  if (!isNative()) return "unsupported";
  try { const p = await LocalNotifications.requestPermissions(); return p.display === "granted" ? "granted" : "denied"; }
  catch { return "denied"; }
}

export async function exactAlarmAllowed(): Promise<boolean | null> {
  if (!isNative()) return null;
  try { const r = await LocalNotifications.checkExactNotificationSetting(); return r.exact_alarm === "granted"; } catch { return null; }
}
export async function openExactAlarmSettings(): Promise<void> { try { await LocalNotifications.changeExactNotificationSetting(); } catch { /* bỏ qua */ } }

let registered = false;
export async function registerActions(): Promise<void> {
  if (!isNative() || registered) return;
  // Android cho tối đa 3 nút: chọn các nút chính, phần còn lại mở app.
  await LocalNotifications.registerActionTypes({
    types: [
      { id: "NS_TASK", actions: [{ id: "start", title: "Bắt đầu" }, { id: "done", title: "Đã xong" }, { id: "snooze10", title: "Dời 10 phút" }] },
      { id: "NS_FOLLOWUP", actions: [{ id: "done", title: "Đã xong" }, { id: "snooze10", title: "Dời 10 phút" }, { id: "skip", title: "Hôm nay bỏ qua" }] },
    ],
  });
  registered = true;
}

/** Đồng bộ danh sách mong muốn với danh sách đang chờ của hệ điều hành: chỉ hủy/lập phần thay đổi. */
export async function syncNotifications(desired: PlannedNotification[]): Promise<{ scheduled: number; cancelled: number } | null> {
  if (!isNative()) return null;
  if ((await permissionState()) !== "granted") return null;
  await registerActions();
  const pending = await LocalNotifications.getPending();
  const cur = pending.notifications.map((n) => ({ id: n.id, signature: (n.extra as any)?.sig as string | undefined }));
  const { cancel, schedule } = diffNotifications(desired, cur);
  if (cancel.length) await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) });
  if (schedule.length) {
    await LocalNotifications.schedule({
      notifications: schedule.map((n) => ({
        id: n.id, title: n.title, body: n.body,
        schedule: { at: new Date(n.atMs), allowWhileIdle: true },
        actionTypeId: n.actionTypeId,
        smallIcon: "ic_stat_nhip",
        extra: { sig: n.signature, occurrenceId: n.occurrenceId ?? null, kind: n.kind, key: n.key },
      })),
    });
  }
  return { scheduled: schedule.length, cancelled: cancel.length };
}

export async function cancelAllNotifications(): Promise<void> {
  if (!isNative()) return;
  const p = await LocalNotifications.getPending();
  if (p.notifications.length) await LocalNotifications.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) });
}

export function onNotificationAction(cb: (a: { actionId: string; occurrenceId?: string; kind?: string; key?: string }) => void): void {
  if (!isNative()) return;
  void LocalNotifications.addListener("localNotificationActionPerformed", (e: ActionPerformed) => {
    const x = (e.notification.extra ?? {}) as any;
    cb({ actionId: e.actionId, occurrenceId: x.occurrenceId ?? undefined, kind: x.kind, key: x.key });
  });
}
