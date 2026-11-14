import { describe, it, expect } from "vitest";
import { at, baseState, DAY, min, tpl, withTasks } from "./helpers";
import { planNotifications, diffNotifications, notifIdFor } from "../src/core/notifications";
import { completeTask, createTemplate, cancel, reschedule, occurrenceId, materializeDay } from "../src/core/schedule";
import { parsePlanDraft, checkPlanDraft, parseAdjustDraft, checkAdjustDraft, applyAdjustDraft, extractJson, parseProfileDraft, applyPlanDraft, buildAdjustInput, ConsentError, ruleSuggestions } from "../src/core/ai";
import { dayReport } from "../src/core/evaluation";
import { exportBackup, parseBackup } from "../src/core/backup";
import { addDays } from "../src/core/time";

describe("Thông báo", () => {
  it("tối đa 2 thông báo/việc kể cả nhắc trước; không gửi bù thông báo cũ", () => {
    let s = baseState();
    s = createTemplate(s, tpl({ remindBeforeMin: 5, timing: { kind: "fixed", start: "08:00" } }), at("05:00")).state;
    const { list } = planNotifications(s, at("05:00"));
    const today = list.filter((n) => n.occurrenceId?.endsWith(DAY));
    expect(today.map((n) => n.kind)).toEqual(["nhac-truoc", "den-gio"]);
    const later = planNotifications(s, at("08:00")).list.filter((n) => n.occurrenceId?.endsWith(DAY));
    expect(later.length).toBe(0); // đã qua các mốc ⇒ không gửi lại
  });

  it("không nhắc trước ⇒ đến giờ + hỏi nhẹ sau gia hạn", () => {
    const { s } = withTasks(1);
    const n = planNotifications(s, at("05:00")).list.filter((x) => x.occurrenceId?.endsWith(DAY));
    expect(n.map((x) => [x.kind, x.atMs])).toEqual([["den-gio", at("07:00")], ["hoi-nhe", at("07:10")]]);
  });

  it("hoàn thành/hủy/dời cập nhật đúng, không trùng, không lỗi thời", () => {
    let { s, ids } = withTasks(2);
    const before = planNotifications(s, at("05:00")).list;
    const pending = before.map((n) => ({ id: n.id, signature: n.signature }));
    s = completeTask(s, ids[0]!, at("06:00"));
    s = cancel(s, ids[1]!, at("06:00"));
    let d = diffNotifications(planNotifications(s, at("06:00")).list, pending);
    const removed = before.filter((n) => n.occurrenceId === ids[0] || n.occurrenceId === ids[1]).map((n) => n.id);
    expect(d.cancel.sort()).toEqual(removed.sort());
    expect(d.schedule.length).toBe(0);
    // dời giờ ⇒ hủy bản cũ, lập bản mới cùng ID (không trùng)
    let { s: s2, ids: ids2 } = withTasks(1);
    const p2 = planNotifications(s2, at("05:00")).list;
    s2 = reschedule(s2, ids2[0]!, at("09:00"), at("05:30"));
    d = diffNotifications(planNotifications(s2, at("05:30")).list, p2.map((n) => ({ id: n.id, signature: n.signature })));
    const ownNew = d.schedule.filter((n) => n.occurrenceId === ids2[0]);
    expect(ownNew.map((n) => n.atMs)).toEqual([at("09:00"), at("09:10")]);
    expect(d.cancel.length).toBe(2);
    expect(new Set(planNotifications(s2, at("05:30")).list.map((n) => n.id)).size).toBe(planNotifications(s2, at("05:30")).list.length);
  });

  it("giờ yên lặng và tạm dừng nhắc", () => {
    let s = baseState();
    s = createTemplate(s, tpl({ timing: { kind: "fixed", start: "23:00" } }), at("05:00")).state;
    expect(planNotifications(s, at("05:00")).list.filter((n) => n.occurrenceId?.endsWith(DAY)).length).toBe(0);
    let { s: p } = withTasks(1);
    p = { ...p, notificationSettings: { ...p.notificationSettings, pausedUntil: at("12:00") } };
    expect(planNotifications(p, at("05:00")).list.filter((n) => n.occurrenceId?.endsWith(DAY)).length).toBe(0);
  });

  it("thông báo tổng kết tối đa 1 lần/ngày", () => {
    const { s } = withTasks(1);
    const sums = planNotifications(s, at("05:00")).list.filter((n) => n.kind === "tong-ket");
    expect(new Set(sums.map((n) => n.key)).size).toBe(sums.length);
    const notified = { ...s, summaries: { [DAY]: { notifiedAt: at("21:30") } as any } };
    expect(planNotifications(notified, at("05:00")).list.some((n) => n.key === `sum@${DAY}`)).toBe(false);
  });

  it("ID thông báo là int32 dương ổn định", () => {
    const id = notifIdFor("abc#den-gio");
    expect(id).toBe(notifIdFor("abc#den-gio"));
    expect(id > 0 && id <= 0x7fffffff).toBe(true);
  });
});

describe("Kiểm tra đề xuất AI", () => {
  const profileState = () => {
    const s = baseState();
    return { ...s, profile: { ...s.profile, sleep: { bed: "23:00", wake: "06:30" }, commuteMinutes: 30, work: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", label: "Giờ làm" }], aiConsent: { profile: true, schedule: true, stats: true } } };
  };

  it("tách JSON kể cả khi có code fence", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(() => extractJson("xin chào")).toThrow();
  });

  it("phát hiện trùng giờ làm, di chuyển, giờ ngủ và trùng nhau", () => {
    const s = profileState();
    const d = parsePlanDraft({ tasks: [
      { title: "Tập thể dục", category: "suc-khoe", start: "07:15", durationMin: 30, days: [1], priority: 2, flexibility: "linh-hoat", track: true, reason: "" },
      { title: "Tiếng Anh", category: "hoc", start: "20:00", durationMin: 30, days: [1], priority: 2, flexibility: "linh-hoat", track: true, reason: "" },
      { title: "Đọc sách", category: "ca-nhan", start: "20:15", durationMin: 30, days: [1], priority: 3, flexibility: "linh-hoat", track: true, reason: "" },
      { title: "Thiền", category: "nghi", start: "23:30", durationMin: 15, days: [1], priority: 3, flexibility: "linh-hoat", track: false, reason: "" },
    ] }, "can-bang");
    const errs = checkPlanDraft(s, d);
    expect(errs.some((e) => e.includes("Tập thể dục") && e.includes("Di chuyển"))).toBe(true);
    expect(errs.some((e) => e.includes("Đọc sách") && e.includes("Tiếng Anh"))).toBe(true);
    expect(errs.some((e) => e.includes("Thiền") && e.includes("Giờ ngủ"))).toBe(true);
    expect(() => applyPlanDraft(s, d, [0, 1, 2, 3], DAY)).toThrow();
    const ok = applyPlanDraft(s, d, [1], DAY, at("05:00"));
    expect(ok.templates.length).toBe(1);
  });

  it("từ chối schema sai và quá 3 thay đổi", () => {
    expect(() => parsePlanDraft({ tasks: [{ title: "", start: "25:00" }] }, "nhe-nhang")).toThrow();
    expect(() => parseAdjustDraft({ date: DAY, baseScheduleVersion: 1, changes: [1, 2, 3, 4].map(() => ({ type: "them", reason: "x" })) })).toThrow();
    expect(() => parseProfileDraft({ sleep: { bed: "abc", wake: "06:00" } })).toThrow();
  });

  it("không ghi đè phiên bản lịch mới bằng kết quả cũ", () => {
    let { s, ids } = withTasks(2);
    s = { ...s, profile: { ...s.profile, aiConsent: { profile: true, schedule: true, stats: true } } };
    const d = parseAdjustDraft({ baseScheduleVersion: s.scheduleVersion, date: DAY, summary: "", changes: [{ type: "doi-thoi-luong", occurrenceId: ids[0], durationMin: 20, reason: "giảm tải" }] });
    expect(checkAdjustDraft(s, d)).toEqual([]);
    const changed = reschedule(s, ids[1]!, at("10:00"), at("05:10"));
    expect(checkAdjustDraft(changed, d)[0]).toContain("Lịch đã thay đổi");
    expect(() => applyAdjustDraft(changed, d, [0], at("05:10"))).toThrow();
  });

  it("không đổi mốc cố định, không gây trùng, không tự áp dụng", () => {
    let s = baseState();
    const r = createTemplate(s, tpl({ flexibility: "co-dinh", timing: { kind: "fixed", start: "07:00" } }), at("05:00"));
    s = createTemplate(r.state, tpl({ timing: { kind: "fixed", start: "09:00" } }), at("05:00")).state;
    s = materializeDay(s, DAY, at("05:00"));
    const fixedId = occurrenceId(r.template.id, DAY);
    const other = Object.values(s.occurrences).find((o) => o.id !== fixedId)!.id;
    const d1 = parseAdjustDraft({ baseScheduleVersion: s.scheduleVersion, date: DAY, changes: [{ type: "doi-gio", occurrenceId: fixedId, start: "08:00", reason: "x" }] });
    expect(checkAdjustDraft(s, d1)[0]).toContain("cố định");
    const d2 = parseAdjustDraft({ baseScheduleVersion: s.scheduleVersion, date: DAY, changes: [{ type: "doi-gio", occurrenceId: other, start: "07:15", reason: "x" }] });
    expect(checkAdjustDraft(s, d2).join()).toContain("trùng");
    const d3 = parseAdjustDraft({ baseScheduleVersion: s.scheduleVersion, date: DAY, changes: [{ type: "doi-gio", occurrenceId: other, start: "10:00", reason: "x" }] });
    expect(s.occurrences[other]!.planned.startMs).toBe(at("09:00")); // chưa áp dụng
    const applied = applyAdjustDraft(s, d3, [0], at("05:00"));
    expect(applied.occurrences[other]!.planned.startMs).toBe(at("10:00"));
    expect(applied.revisions.at(-1)!.source).toBe("ai");
  });

  it("chỉ gửi dữ liệu đã được phép", () => {
    const { s } = withTasks(6);
    expect(() => buildAdjustInput(s, dayReport(s, DAY, at("21:30")), addDays(DAY, 1), [])).toThrow(ConsentError);
    const s2 = { ...s, profile: { ...s.profile, aiConsent: { profile: false, schedule: true, stats: false } } };
    const payload = JSON.parse(buildAdjustInput(s2, dayReport(s2, DAY, at("21:30")), addDays(DAY, 1), []));
    expect(payload.todayStats).toBeUndefined();
    expect(payload.profile.goals).toBeUndefined();
  });

  it("gợi ý theo quy tắc khi offline có ghi rõ nguồn", () => {
    const { s } = withTasks(3);
    const sg = ruleSuggestions(s, dayReport(s, DAY, at("21:30")), addDays(DAY, 1), ["phat-sinh"]);
    expect(sg[0]!.rule).toMatch(/^R1/);
  });
});

describe("Sao lưu", () => {
  it("xuất/nhập giữ dữ liệu, không chứa thông tin kết nối", () => {
    let { s } = withTasks(2);
    s = { ...s, aiConnection: { ...s.aiConnection, status: "da-ket-noi", email: "a@b.c", scopes: ["openid"] } };
    const json = exportBackup(s);
    expect(json).not.toContain("a@b.c");
    expect(json).not.toMatch(/token/i);
    const back = parseBackup(json);
    expect(back.templates.length).toBe(2);
    expect(back.aiConnection.status).toBe("chua-ket-noi");
    expect(() => parseBackup("{\"format\":\"khac\"}")).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...JSON.parse(json), schemaVersion: 99 }))).toThrow(/mới hơn/);
  });
});

void min;
