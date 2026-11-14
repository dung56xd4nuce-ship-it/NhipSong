import { emptyState } from "../src/core/defaults";
import { createTemplate, TemplateInput } from "../src/core/schedule";
import { zonedToUtc, MINUTE } from "../src/core/time";
import { AppState } from "../src/core/types";

export const TZ = "Asia/Bangkok";
export const DAY = "2026-11-16"; // Thứ Hai
export const at = (time: string, date = DAY, tz = TZ) => zonedToUtc(date, time, tz);
export const min = (n: number) => n * MINUTE;

export function baseState(tz = TZ): AppState {
  const s = emptyState(tz, at("05:00"));
  return { ...s, profile: { ...s.profile, onboarded: true } };
}

export function tpl(over: Partial<TemplateInput> = {}): TemplateInput {
  return {
    title: "Việc", category: "khac", durationMin: 30, timing: { kind: "fixed", start: "08:00" }, priority: 2,
    flexibility: "linh-hoat", recurrence: { kind: "daily", from: "2026-11-01" }, graceMin: 10, remindBeforeMin: null,
    trackPunctuality: true, optional: false, ...over,
  };
}

/** Tạo n việc hằng ngày, mỗi việc cách nhau 1 giờ bắt đầu từ 07:00. */
export function withTasks(n: number, s = baseState()): { s: AppState; ids: string[] } {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = createTemplate(s, tpl({ title: `Việc ${i + 1}`, timing: { kind: "fixed", start: `${String(7 + i).padStart(2, "0")}:00` } }), at("05:00"));
    s = r.state; ids.push(`${r.template.id}@${DAY}`);
  }
  return { s, ids };
}
