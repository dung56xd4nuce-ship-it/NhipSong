# Báo cáo kiểm thử — Nhịp Sống (14/11/2026)

Môi trường: Linux container, Node 22, JDK 21, Chromium 1243. **Không có điện thoại thật, không có Android SDK, không gọi dịch vụ OpenAI thật.**

## 1. Lõi nghiệp vụ TypeScript — 33/33 đạt (vitest)
- ✓ test/notif-ai-backup.test.ts > Thông báo > tối đa 2 thông báo/việc kể cả nhắc trước; không gửi bù thông báo cũ 19ms
- ✓ test/notif-ai-backup.test.ts > Thông báo > không nhắc trước ⇒ đến giờ + hỏi nhẹ sau gia hạn 1ms
- ✓ test/notif-ai-backup.test.ts > Thông báo > hoàn thành/hủy/dời cập nhật đúng, không trùng, không lỗi thời 3ms
- ✓ test/notif-ai-backup.test.ts > Thông báo > giờ yên lặng và tạm dừng nhắc 1ms
- ✓ test/notif-ai-backup.test.ts > Thông báo > thông báo tổng kết tối đa 1 lần/ngày 1ms
- ✓ test/notif-ai-backup.test.ts > Thông báo > ID thông báo là int32 dương ổn định 0ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > tách JSON kể cả khi có code fence 1ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > phát hiện trùng giờ làm, di chuyển, giờ ngủ và trùng nhau 2ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > từ chối schema sai và quá 3 thay đổi 1ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > không ghi đè phiên bản lịch mới bằng kết quả cũ 1ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > không đổi mốc cố định, không gây trùng, không tự áp dụng 1ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > chỉ gửi dữ liệu đã được phép 1ms
- ✓ test/notif-ai-backup.test.ts > Kiểm tra đề xuất AI > gợi ý theo quy tắc khi offline có ghi rõ nguồn 0ms
- ✓ test/notif-ai-backup.test.ts > Sao lưu > xuất/nhập giữ dữ liệu, không chứa thông tin kết nối 1ms
- ✓ test/core.test.ts > Múi giờ > đổi giờ địa phương sang UTC không phụ thuộc máy 20ms
- ✓ test/core.test.ts > Múi giờ > xử lý nhảy giờ mùa hè (giờ không tồn tại đẩy về sau) 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > 5 việc lệch chưa kích hoạt; 6 việc lệch kích hoạt 4ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > 5 lệch + 2 chưa xác nhận vẫn chưa đạt ngưỡng; chưa xác nhận tách riêng 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > một việc trễ bắt đầu, trễ kết thúc, nhiều lần nhắc chỉ tính một 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > hoàn thành trong gia hạn không tính lệch 0ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > bỏ qua sau hạn có theo dõi thì tính; bỏ qua trước hạn thì không 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > việc tùy chọn không theo dõi không bị tính 0ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > sửa lịch trước hạn không tạo lệch 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > hủy trước hạn không tính, hủy sau hạn tính như bỏ qua 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > dời sau khi đã trễ không xóa lịch sử lệch 0ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > chỉnh dữ liệu sai rồi tính lại được 1ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > chưa phản hồi không đồng nghĩa với không làm 0ms
- ✓ test/core.test.ts > Ngưỡng 6 việc lệch kế hoạch > tổng kết chỉ tính việc đã đến hạn ở giờ tổng kết 1ms
- ✓ test/core.test.ts > Việc lặp và qua nửa đêm > lần thực hiện theo ngày được tính độc lập 1ms
- ✓ test/core.test.ts > Việc lặp và qua nửa đêm > việc qua nửa đêm thuộc ngày bắt đầu và hiển thị đánh dấu 1ms
- ✓ test/core.test.ts > Việc lặp và qua nửa đêm > sửa một lần không sửa toàn chuỗi; sửa từ nay về sau tách chuỗi 1ms
- ✓ test/core.test.ts > Việc lặp và qua nửa đêm > xóa từ ngày chọn giữ lịch sử đã có phản hồi 1ms
- ✓ test/core.test.ts > Việc lặp và qua nửa đêm > hoàn tác thao tác cuối 0ms

## 2. Lõi Sign in with ChatGPT (Java) — 11/11 đạt với máy chủ OAuth/Responses GIẢ LẬP
- ✓ Kết nối đầy đủ: đăng ký động, PKCE, xác minh ID token, có quyền dùng gói
- ✓ Một yêu cầu AI (Responses SSE) trả văn bản
- ✓ Token hết hạn ⇒ tự làm mới, refresh token xoay vòng
- ✓ Kết nối lại dùng client_id đã cấp, không đăng ký trùng
- ✓ Quyền bị thu hồi ⇒ yêu cầu kết nối lại, giữ client_id
- ✓ Chỉ có quyền danh tính ⇒ không coi là AI đã hoạt động
- ✓ Hết hạn mức ⇒ báo usage_limit
- ✓ Từ chối cấp quyền ⇒ access_denied, không đổi code
- ✓ ID token bị sửa chữ ký ⇒ từ chối
- ✓ Callback sai state bị bỏ qua, không làm hỏng giao dịch
- ✓ Ngắt kết nối: thu hồi và xóa thông tin xác thực
- Biên dịch SiwcPlugin/KeystoreSecretStore/MainActivity với API Android/Capacitor giả: OK (chỉ bắt lỗi cú pháp/kiểu, không thay build thật)

## 3. Giao diện trên Chromium giả lập Pixel 7 và iPhone 14 — 26/26 đạt
- ✓ Pixel-7: lần đầu cho chọn Tự lên lịch / Nhờ AI
- ✓ Pixel-7: bản web không giả lập kết nối ChatGPT
- ✓ Pixel-7: từ chối thông báo không làm kẹt app
- ✓ Pixel-7: thêm 7 việc
- ✓ Pixel-7: 6 việc lệch đã xác nhận được đếm — stats=6/6/1
- ✓ Pixel-7: đạt ngưỡng ⇒ mời xem lại lịch
- ✓ Pixel-7: có gợi ý theo quy tắc ghi rõ nguồn
- ✓ Pixel-7: sửa dữ liệu sai được tính lại (6→5, hết ngưỡng) — stats=6/5/1
- ✓ Pixel-7: đóng/mở vẫn giữ dữ liệu
- ✓ Pixel-7: bản xuất có schemaVersion và không có token
- ✓ Pixel-7: màn AI báo rõ chưa khả dụng, nút gọi AI bị khóa
- ✓ Pixel-7: vùng chạm ≥ 40px
- ✓ Pixel-7: không có lỗi JavaScript
- ✓ iPhone-14: lần đầu cho chọn Tự lên lịch / Nhờ AI
- ✓ iPhone-14: bản web không giả lập kết nối ChatGPT
- ✓ iPhone-14: từ chối thông báo không làm kẹt app
- ✓ iPhone-14: thêm 7 việc
- ✓ iPhone-14: 6 việc lệch đã xác nhận được đếm — stats=6/6/1
- ✓ iPhone-14: đạt ngưỡng ⇒ mời xem lại lịch
- ✓ iPhone-14: có gợi ý theo quy tắc ghi rõ nguồn
- ✓ iPhone-14: sửa dữ liệu sai được tính lại (6→5, hết ngưỡng) — stats=6/5/1
- ✓ iPhone-14: đóng/mở vẫn giữ dữ liệu
- ✓ iPhone-14: bản xuất có schemaVersion và không có token
- ✓ iPhone-14: màn AI báo rõ chưa khả dụng, nút gọi AI bị khóa
- ✓ iPhone-14: vùng chạm ≥ 40px
- ✓ iPhone-14: không có lỗi JavaScript

## 4. Chưa kiểm thử (cần máy thật / tài khoản thật)
- Build APK bằng Gradle; cài trên Android
- Đăng nhập ChatGPT thật qua callback 127.0.0.1 trên Android; một yêu cầu AI thật
- Thông báo khi app đóng, tiết kiệm pin, khởi động lại, đổi múi giờ, từ chối quyền ở cấp hệ điều hành
- WebKit/iOS
