// Kiểm thử trải nghiệm trên trình duyệt giả lập điện thoại (Chromium với hồ sơ Pixel 7 và iPhone 14).
// Lưu ý: đây là bản web; thông báo hệ thống và kết nối ChatGPT chỉ có trong app Android.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PW_PATH ?? "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright");

const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => { results.push([cond, name, extra]); console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

async function run(profileName) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
  const ctx = await browser.newContext({ ...devices[profileName], timezoneId: "Asia/Bangkok", locale: "vi-VN" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on("dialog", (d) => d.accept());
  const tag = profileName.replace(/\s+/g, "-");
  const shot = (n) => page.screenshot({ path: `${OUT}${tag}-${n}.png`, fullPage: false });

  await page.goto(BASE);
  await page.getByText("Sống theo nhịp của bạn").waitFor();
  await shot("01-gioi-thieu");
  await page.getByRole("button", { name: "Bắt đầu" }).click();
  ok(`${tag}: lần đầu cho chọn Tự lên lịch / Nhờ AI`, await page.getByText("Tự lên lịch").isVisible() && await page.getByText("Nhờ AI đề xuất").isVisible());
  await page.getByText("Nhờ AI đề xuất").click();
  const connectBtn = page.getByRole("button", { name: "Continue with ChatGPT" });
  ok(`${tag}: bản web không giả lập kết nối ChatGPT`, await connectBtn.isDisabled() && await page.getByText("chỉ có trong app Android").isVisible());
  await shot("02-ai-giai-thich");
  await page.getByRole("button", { name: "Tự lên lịch" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await shot("03-thong-bao");
  await page.getByRole("button", { name: "Để sau" }).click();
  ok(`${tag}: từ chối thông báo không làm kẹt app`, await page.getByRole("heading", { name: "Hôm nay" }).isVisible());

  // Thêm 7 việc hằng ngày từ 07:00
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    await page.getByRole("button", { name: "＋ Thêm việc" }).click();
    await page.getByPlaceholder("Ví dụ: Học tiếng Anh").fill(`Việc ${i + 1}`);
    await page.locator('input[type=time]').first().fill(`${String(7 + i).padStart(2, "0")}:00`);
    await page.locator("select").nth(2).selectOption("daily");
    await page.getByRole("button", { name: "Lưu" }).click();
  }
  await shot("04-hom-nay");
  ok(`${tag}: thêm 7 việc`, (await page.locator(".card .time").count()) === 7);

  // Đánh dấu 6 việc là hoàn thành muộn qua "Giờ thực tế"
  for (let i = 0; i < 6; i++) {
    const card = page.locator(".card", { hasText: `Việc ${i + 1}` }).first();
    await card.getByRole("button", { name: "Thêm…" }).click();
    await card.getByRole("button", { name: "Giờ thực tế" }).click();
    await page.getByRole("button", { name: "Đã xong" }).last().click();
    const times = page.locator(".sheet input[type=time]");
    await times.nth(0).fill(`${String(7 + i).padStart(2, "0")}:40`);
    await times.nth(1).fill(`${String(8 + i).padStart(2, "0")}:10`);
    await page.locator(".sheet").getByRole("button", { name: "Lưu" }).click();
  }
  await page.goto(`${BASE}/#/nhin-lai`);
  await page.getByRole("heading", { name: "Nhìn lại ngày" }).waitFor();
  const stats = await page.locator(".stat b").allTextContents();
  ok(`${tag}: 6 việc lệch đã xác nhận được đếm`, stats[1] === "6", `stats=${stats.join("/")}`);
  ok(`${tag}: đạt ngưỡng ⇒ mời xem lại lịch`, await page.getByText("mình cùng sắp lại ngày mai").isVisible());
  ok(`${tag}: có gợi ý theo quy tắc ghi rõ nguồn`, await page.getByText(/Nguồn: R/).first().isVisible());
  await shot("05-nhin-lai");

  // Sửa dữ liệu sai một việc ⇒ còn 5 ⇒ chưa đạt ngưỡng
  await page.locator(".card", { hasText: "Việc 1" }).getByRole("button", { name: "Sửa dữ liệu" }).click();
  const t = page.locator(".sheet input[type=time]");
  await t.nth(0).fill("07:02"); await t.nth(1).fill("07:30");
  await page.locator(".sheet").getByRole("button", { name: "Lưu" }).click();
  const stats2 = await page.locator(".stat b").allTextContents();
  ok(`${tag}: sửa dữ liệu sai được tính lại (6→5, hết ngưỡng)`, stats2[1] === "5" && !(await page.getByText("mình cùng sắp lại ngày mai").isVisible()), `stats=${stats2.join("/")}`);

  // Dữ liệu còn sau khi tải lại
  await page.reload();
  await page.goto(`${BASE}/#/hom-nay`);
  await page.getByRole("heading", { name: "Hôm nay" }).waitFor({ timeout: 5000 });
  await page.locator(".card .time").nth(6).waitFor({ timeout: 5000 }).catch(() => {});
  ok(`${tag}: đóng/mở vẫn giữ dữ liệu`, (await page.locator(".card .time").count()) === 7);

  // Cài đặt & xuất dữ liệu không chứa token
  await page.goto(`${BASE}/#/cai-dat`);
  await page.getByRole("heading", { name: "Cài đặt" }).waitFor();
  await shot("06-cai-dat");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất dữ liệu" }).click();
  const file = await (await dl).path();
  const json = (await import("node:fs")).readFileSync(file, "utf8");
  ok(`${tag}: bản xuất có schemaVersion và không có token`, /"schemaVersion": 1/.test(json) && !/token/i.test(json));

  // Kế hoạch & AI: không gọi được AI trên web và báo rõ
  await page.goto(`${BASE}/#/len-ke-hoach`);
  await page.getByRole("tab", { name: /Nhờ AI/ }).click();
  ok(`${tag}: màn AI báo rõ chưa khả dụng, nút gọi AI bị khóa`, await page.getByText("AI chưa khả dụng").isVisible() && await page.getByRole("button", { name: "Nhờ AI đề xuất lịch" }).isDisabled());
  await shot("07-ke-hoach-ai");

  // Nút bấm đủ lớn (≥ 40px)
  const small = await page.$$eval("button, a.tab", (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.textContent?.trim()).slice(0, 5));
  ok(`${tag}: vùng chạm ≥ 40px`, small.length === 0, small.join(", "));
  ok(`${tag}: không có lỗi JavaScript`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

for (const d of ["Pixel 7", "iPhone 14"]) await run(d);
const fails = results.filter((r) => !r[0]);
console.log(`\n${results.length - fails.length}/${results.length} kiểm thử giao diện đạt`);
process.exit(fails.length ? 1 : 0);
