import { describe, it, expect } from "vitest";
import { at, baseState, DAY, min, tpl, TZ, withTasks } from "./helpers";
import { createTemplate, materializeDay, dayOccurrences, completeTask, startTask, skipTask, cancel, reschedule, setActual, updateTemplate, deleteTemplate, undoLast, crossesMidnight, occurrenceId } from "../src/core/schedule";
import { dayReport, evaluate, DEVIATION_THRESHOLD, upsertSummary } from "../src/core/evaluation";
import { zonedToUtc, zonedParts, addDays, fmtLocalTime } from "../src/core/time";
import { AppState } from "../src/core/types";

function lateN(s: AppState, ids: string[], n: number): AppState {
  // hoàn thành muộn 30 phút (vượt gia hạn 10)
  ids.slice(0, n).forEach((id, i) => {
    const st = at(`${String(7 + i).padStart(2, "0")}:30`);
    s = startTask(s, id, st, st);
    s = completeTask(s, id, st + min(30));
  });
  return s;
}

describe("Múi giờ", () => {
  it("đổi giờ địa phương sang UTC không phụ thuộc máy", () => {
    expect(new Date(zonedToUtc("2026-11-16", "08:00", "Asia/Bangkok")).toISOString()).toBe("2026-11-16T01:00:00.000Z");
    expect(new Date(zonedToUtc("2026-11-16", "08:00", "Europe/London")).toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });
  it("xử lý nhảy giờ mùa hè (giờ không tồn tại đẩy về sau)", () => {
    const ms = zonedToUtc("2026-03-08", "02:30", "America/New_York");
    expect(zonedParts(ms, "America/New_York").time).toBe("03:30");
    const back = zonedToUtc("2026-11-01", "01:30", "America/New_York"); // giờ lặp ⇒ lần đầu (EDT)
    expect(new Date(back).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("Ngưỡng 6 việc lệch kế hoạch", () => {
  it("5 việc lệch chưa kích hoạt; 6 việc lệch kích hoạt", () => {
    const { s, ids } = withTasks(7);
    const five = dayReport(lateN(s, ids, 5), DAY, at("21:30"));
    expect(five.deviatedConfirmed.length).toBe(5);
    expect(five.thresholdReached).toBe(false);
    const six = dayReport(lateN(s, ids, 6), DAY, at("21:30"));
    expect(six.deviatedConfirmed.length).toBe(DEVIATION_THRESHOLD);
    expect(six.thresholdReached).toBe(true);
  });

  it("5 lệch + 2 chưa xác nhận vẫn chưa đạt ngưỡng; chưa xác nhận tách riêng", () => {
    const { s, ids } = withTasks(7);
    const r = dayReport(lateN(s, ids, 5), DAY, at("21:30"));
    expect(r.unconfirmed.length).toBe(2);
    expect(r.thresholdReached).toBe(false);
  });

  it("một việc trễ bắt đầu, trễ kết thúc, nhiều lần nhắc chỉ tính một", () => {
    let { s, ids } = withTasks(1);
    const id = ids[0]!;
    s = reschedule(s, id, at("07:10"), at("07:00")); // dời sau hạn (snooze)
    s = reschedule(s, id, at("07:20"), at("07:10"));
    s = startTask(s, id, at("07:40"), at("07:40"));
    s = completeTask(s, id, at("08:40"));
    expect(dayReport(s, DAY, at("21:30")).deviatedConfirmed).toEqual([id]);
  });

  it("hoàn thành trong gia hạn không tính lệch", () => {
    let { s, ids } = withTasks(1);
    s = startTask(s, ids[0]!, at("07:09"), at("07:09"));
    s = completeTask(s, ids[0]!, at("07:39"));
    const e = evaluate(s, s.occurrences[ids[0]!]!, at("21:30"));
    expect(e.deviated).toBe(false);
    expect(e.punctuality).toBe("dung-han");
  });

  it("bỏ qua sau hạn có theo dõi thì tính; bỏ qua trước hạn thì không", () => {
    let { s, ids } = withTasks(2);
    s = skipTask(s, ids[0]!, at("07:05"));
    s = skipTask(s, ids[1]!, at("06:00"));
    const r = dayReport(s, DAY, at("21:30"));
    expect(r.deviatedConfirmed).toEqual([ids[0]]);
  });

  it("việc tùy chọn không theo dõi không bị tính", () => {
    let s = baseState();
    const r = createTemplate(s, tpl({ optional: true, trackPunctuality: false }), at("05:00"));
    s = r.state; const id = occurrenceId(r.template.id, DAY);
    s = materializeDay(s, DAY, at("05:00"));
    s = startTask(s, id, at("09:00"), at("09:00"));
    expect(evaluate(s, s.occurrences[id]!, at("21:30")).punctuality).toBe("khong-theo-doi");
    expect(dayReport(s, DAY, at("21:30")).deviatedConfirmed).toEqual([]);
  });

  it("sửa lịch trước hạn không tạo lệch", () => {
    let { s, ids } = withTasks(1);
    s = reschedule(s, ids[0]!, at("09:00"), at("06:30")); // dời trước 07:00
    s = startTask(s, ids[0]!, at("09:05"), at("09:05"));
    s = completeTask(s, ids[0]!, at("09:35"));
    expect(evaluate(s, s.occurrences[ids[0]!]!, at("21:30")).deviated).toBe(false);
  });

  it("hủy trước hạn không tính, hủy sau hạn tính như bỏ qua", () => {
    let { s, ids } = withTasks(2);
    s = cancel(s, ids[0]!, at("06:00"));
    s = cancel(s, ids[1]!, at("08:30"));
    expect(dayReport(s, DAY, at("21:30")).deviatedConfirmed).toEqual([ids[1]]);
  });

  it("dời sau khi đã trễ không xóa lịch sử lệch", () => {
    let { s, ids } = withTasks(1);
    s = startTask(s, ids[0]!, at("07:30"), at("07:30"));
    s = reschedule(s, ids[0]!, at("07:30"), at("07:31"));
    expect(evaluate(s, s.occurrences[ids[0]!]!, at("21:30")).deviated).toBe(true);
    expect(s.revisions.length).toBe(1);
  });

  it("chỉnh dữ liệu sai rồi tính lại được", () => {
    let { s, ids } = withTasks(6);
    s = lateN(s, ids, 6);
    expect(dayReport(s, DAY, at("21:30")).thresholdReached).toBe(true);
    s = setActual(s, ids[0]!, { startMs: at("07:02"), endMs: at("07:32") }, "hoan-thanh", at("21:00"));
    const r = dayReport(s, DAY, at("21:30"));
    expect(r.deviatedConfirmed.length).toBe(5);
    expect(r.thresholdReached).toBe(false);
  });

  it("chưa phản hồi không đồng nghĩa với không làm", () => {
    const { s, ids } = withTasks(1);
    const e = evaluate(s, s.occurrences[ids[0]!]!, at("21:30"));
    expect(e.confirmation).toBe("chua-xac-nhan");
    expect(e.deviated).toBe(false);
    expect(e.punctuality).toBe("chua-du-du-lieu");
  });

  it("tổng kết chỉ tính việc đã đến hạn ở giờ tổng kết", () => {
    let s = baseState();
    s = createTemplate(s, tpl({ timing: { kind: "fixed", start: "22:00" } }), at("05:00")).state;
    s = createTemplate(s, tpl({ timing: { kind: "fixed", start: "20:00" } }), at("05:00")).state;
    s = materializeDay(s, DAY, at("05:00"));
    const r = dayReport(s, DAY, at("21:30"));
    expect(r.due.length).toBe(1);
    const s2 = upsertSummary(s, DAY, at("23:59") + min(5));
    expect(s2.summaries[DAY]!.due).toBe(2);
  });
});

describe("Việc lặp và qua nửa đêm", () => {
  it("lần thực hiện theo ngày được tính độc lập", () => {
    let { s, ids } = withTasks(1);
    const tomorrow = addDays(DAY, 1);
    s = materializeDay(s, tomorrow, at("05:00"));
    const tid = ids[0]!.split("@")[0]!;
    const t2 = occurrenceId(tid, tomorrow);
    s = startTask(s, ids[0]!, at("07:40"), at("07:40"));
    expect(dayReport(s, DAY, at("21:30")).deviatedConfirmed.length).toBe(1);
    expect(s.occurrences[t2]!.status).toBe("chua-bat-dau");
    expect(dayReport(s, tomorrow, at("21:30", tomorrow)).deviatedConfirmed.length).toBe(0);
  });

  it("việc qua nửa đêm thuộc ngày bắt đầu và hiển thị đánh dấu", () => {
    let s = baseState();
    const r = createTemplate(s, tpl({ timing: { kind: "fixed", start: "23:30" }, durationMin: 60 }), at("05:00"));
    s = materializeDay(r.state, DAY, at("05:00"));
    const o = s.occurrences[occurrenceId(r.template.id, DAY)]!;
    expect(o.date).toBe(DAY);
    expect(crossesMidnight(o)).toBe(true);
    expect(fmtLocalTime(o.planned.endMs, TZ)).toBe("00:30");
    expect(dayOccurrences(s, addDays(DAY, 1)).some((x) => x.templateId === r.template.id && x.date === DAY)).toBe(false);
  });

  it("sửa một lần không sửa toàn chuỗi; sửa từ nay về sau tách chuỗi", () => {
    let { s, ids } = withTasks(1);
    const tid = ids[0]!.split("@")[0]!;
    s = updateTemplate(s, tid, { title: "Chỉ hôm nay" }, { kind: "one", date: DAY }, at("05:00"));
    const tomorrow = addDays(DAY, 1);
    s = materializeDay(s, tomorrow, at("05:00"));
    expect(s.occurrences[ids[0]!]!.overrides.title).toBe("Chỉ hôm nay");
    expect(s.occurrences[occurrenceId(tid, tomorrow)]!.overrides.title).toBeUndefined();
    s = updateTemplate(s, tid, { title: "Từ ngày kia" }, { kind: "future", date: addDays(DAY, 2) }, at("05:00"));
    const old = s.templates.find((t) => t.id === tid)!;
    expect((old.recurrence as any).until).toBe(addDays(DAY, 1));
    const fresh = s.templates.find((t) => t.title === "Từ ngày kia")!;
    expect((fresh.recurrence as any).from).toBe(addDays(DAY, 2));
  });

  it("xóa từ ngày chọn giữ lịch sử đã có phản hồi", () => {
    let { s, ids } = withTasks(1);
    const tid = ids[0]!.split("@")[0]!;
    s = completeTask(s, ids[0]!, at("07:30"));
    s = deleteTemplate(s, tid, { kind: "all" }, at("08:00"));
    expect(s.occurrences[ids[0]!]!.status).toBe("hoan-thanh");
  });

  it("hoàn tác thao tác cuối", () => {
    let { s, ids } = withTasks(1);
    s = reschedule(s, ids[0]!, at("09:00"), at("06:00"));
    s = undoLast(s, ids[0]!, at("06:01"));
    expect(s.occurrences[ids[0]!]!.planned.startMs).toBe(at("07:00"));
    expect(s.revisions.length).toBe(0);
    s = completeTask(s, ids[0]!, at("07:30"));
    s = undoLast(s, ids[0]!, at("07:31"));
    expect(s.occurrences[ids[0]!]!.status).toBe("chua-bat-dau");
  });
});
