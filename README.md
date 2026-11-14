# Nhịp Sống

> Sống theo nhịp của bạn. Mỗi ngày vừa sức hơn một chút.

App Android (Capacitor + Preact + TypeScript) giúp lên kế hoạch sinh hoạt, làm việc và nghỉ ngơi. App chạy offline cho lịch, nhắc việc và tổng kết. Phần AI dùng **Sign in with ChatGPT chính thức**. Không có phương án API key và không dùng cơ chế không chính thức.

Trạng thái: **bản đầu, chưa thử trên điện thoại thật.** Xem mục 6 trước khi dùng.

---

## 1. Kết quả kiểm chứng Sign in with ChatGPT (đọc ngày 14/11/2026)

Nguồn:
- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/request-client-id
- Mã nguồn tham chiếu `openai/sign-in-with-chatgpt-devkit` (commit `0a36fef`, ngày 07/10/2026)

| Nội dung | Đã xác nhận |
|---|---|
| Danh tính và quyền dùng gói | Đây là hai quyền riêng. Scope danh tính là `openid profile email`. Scope dùng gói là `offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`. ID token hợp lệ **không** có nghĩa là được dùng AI. |
| Luồng đăng nhập | OIDC + PKCE `S256`, không cần client secret hay API key. Lần đầu dùng `client_id=dynamic_agent_client`, callback trả về `client_id` được cấp (`oaiapp_…`), app lưu lại để dùng tiếp. Bắt buộc gửi `ext_agent_host_id` cố định cho mỗi lần cài. |
| Callback | **Bắt buộc là `http://127.0.0.1:<cổng>/auth/callback`.** Không được dùng `localhost`. Tài liệu không nói gì về custom scheme hay https. |
| Refresh token | Refresh token xoay vòng: thay access token, hạn dùng, scope và refresh token cùng một lúc. Có endpoint thu hồi. |
| Gọi AI | Gọi Responses API với `store:false, stream:true`. Không hỗ trợ `background`, `previous_response_id` và các công cụ hosted. |
| Đối tượng được dùng gói | Dự án mã nguồn mở, **dự án cá nhân chạy trên máy người dùng** và một số app riêng được chọn. App trả phí hoặc chạy trên máy chủ phải vào danh sách chờ. Người dùng phải có gói ChatGPT Plus/Pro đủ điều kiện. |
| Điện thoại | **Tài liệu không nhắc tới Android/iOS.** Mẫu chính thức là Electron trên macOS. |
| Giấy phép DevKit | Giấy phép phi thương mại. App này **không chép mã DevKit** mà tự viết theo giao thức đã được mô tả công khai. |

### Nút thắt
1. **Trên di động:** app tự mở cổng nghe ở `127.0.0.1` rồi mở trình duyệt hệ thống. Trên Android cách này khả thi về kỹ thuật, nhưng **chưa có xác nhận chính thức và chưa thử trên máy thật**. Trên iOS, app bị treo khi người dùng chuyển sang trình duyệt nên khả năng cao không dùng được cách này.
2. **Hình thức phân phối:** chủ sản phẩm cần quyết định (xem mục 5).
3. **Tài khoản thử:** cần một tài khoản ChatGPT Plus/Pro để chứng minh một yêu cầu AI thật.

Nếu OpenAI từ chối callback loopback từ trình duyệt Android, app sẽ báo lỗi đúng chỗ (`registration_incomplete`, `access_denied`, `timeout`…). Phần offline vẫn chạy bình thường. **Không có đường dự phòng bằng API key.**

## 2. Kiến trúc

```
src/core/        Lõi nghiệp vụ thuần TypeScript (không phụ thuộc nền tảng, có kiểm thử)
  types.ts         Mô hình dữ liệu (đặc tả mục 14)
  time.ts          Múi giờ IANA của lịch; không phụ thuộc múi giờ thiết bị
  schedule.ts      Mẫu việc ↔ lần thực hiện, lặp lại, phạm vi sửa (một lần / về sau / tất cả), hoàn tác, qua nửa đêm
  evaluation.ts    Trạng thái / xác nhận / đúng giờ, quy tắc ngưỡng 6, tổng kết ngày
  notifications.ts Lập kế hoạch thông báo, giờ yên lặng, tạm dừng, tối đa N/việc, so khác (không trùng)
  ai.ts            Prompt, dữ liệu gửi đi theo quyền, kiểm tra schema/ràng buộc/phiên bản lịch, áp dụng có duyệt, gợi ý theo quy tắc
  backup.ts        Xuất/nhập có schemaVersion, chặn trường nhạy cảm
src/platform/    Lưu tệp cục bộ, LocalNotifications, cầu nối plugin Siwc
src/ui/          Giao diện tiếng Việt (Preact)
android/app/src/main/java/vn/nhipsong/app/siwc/
  SiwcCore.java    Lõi OAuth/OIDC/PKCE/loopback/refresh/revoke/Responses SSE (thuần Java, có kiểm thử)
  KeystoreSecretStore.java  Token mã hóa AES-GCM bằng khóa Android Keystore
  SiwcPlugin.java  Cầu nối Capacitor; WebView chỉ nhận trạng thái và văn bản, không bao giờ nhận token
```

Các nguyên tắc chính:
- **Token chỉ nằm ở tầng native.** Token không đi vào state, không có trong bản xuất, không ghi log. `allowBackup=false` và rules loại trừ khỏi sao lưu đám mây.
- **Đánh giá lệch được suy ra từ nhật ký**, không lưu cờ cố định. App dùng *kế hoạch chuẩn*: lịch gốc cộng các lần sửa được thực hiện **trước** giờ hạn đang hiệu lực. Nhờ vậy, sửa trước hạn không tạo lệch, dời sau khi đã trễ không xóa lệch, và khi sửa dữ liệu sai thì kết quả được tính lại.
- **Kết quả AI chỉ là đề xuất.** App kiểm tra schema, ID, giờ, trùng lịch, mốc cố định, giờ ngủ, giờ làm, thời gian di chuyển và `baseScheduleVersion` trước khi cho áp dụng. Nếu lịch đã đổi trong lúc chờ AI, đề xuất bị từ chối.
- **Thông báo** được lập lịch cục bộ trước 3 ngày. ID ổn định theo (lần thực hiện, loại). App so sánh chữ ký để hủy/lập lại khi sửa, hủy hoặc hoàn thành việc. App không gửi bù thông báo cũ. Thông báo tổng kết tối đa 1 lần/ngày.

### Quy ước đã chọn (có thể đổi)
- Một lần thực hiện thuộc ngày của **giờ bắt đầu** theo múi giờ lịch. Việc qua nửa đêm được ghi “(sang hôm sau)”.
- Lệch giờ khi: bắt đầu trễ hơn kế hoạch chuẩn quá khoảng gia hạn, **hoặc** xong trễ hơn quá khoảng gia hạn, **hoặc** bỏ qua/hủy sau giờ hạn. Mỗi lần thực hiện chỉ được tính một lần.
- Tối đa 2 thông báo/việc: có nhắc trước thì gồm *nhắc trước + đến giờ*; không có thì gồm *đến giờ + hỏi nhẹ sau gia hạn*. Thông báo rơi vào giờ yên lặng sẽ bị bỏ, không dời.
- Nội dung thông báo tổng kết được viết chung chung vì Android không cho tính lại lúc thông báo bật lên. Con số chính xác xem trong màn “Nhìn lại”.
- Nút trên thông báo Android: tối đa 3 nút (Bắt đầu / Đã xong / Dời 10 phút; khi hỏi nhẹ thì Đã xong / Dời 10 phút / Hôm nay bỏ qua). “Chọn giờ khác” nằm trong app.

## 3. Mô hình dữ liệu
`UserProfile`, `ScheduleConstraint`, `TaskTemplate`, `TaskOccurrence`, `ExecutionEvent`, `ScheduleRevision`, `AIProposal`, `DailySummary`, `NotificationSettings`, `AIConnectionMetadata` (chỉ siêu dữ liệu). Mọi bản ghi đều có `id`, `createdAt`, `updatedAt`, `schemaVersion`. Thời điểm được lưu bằng ms UTC kèm `timeZone` của lịch.

## 4. Chạy và build

```bash
npm ci
npm test                 # kiểm thử lõi nghiệp vụ
bash native-tests/run.sh # kiểm thử lõi Sign in with ChatGPT với máy chủ giả + biên dịch lớp Android với API giả
npm run build && npx vite preview   # chạy bản web (không có AI, không có thông báo hệ thống)
node e2e/run.mjs         # kiểm thử giao diện trên Chromium giả lập Pixel 7 / iPhone 14

# APK debug (cần Android SDK, JDK 21):
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
```
Workflow `.github/workflows/android.yml` chạy toàn bộ kiểm thử rồi build APK debug thành artifact khi đẩy lên GitHub.

## 5. Quyết định cần chủ sản phẩm chốt
1. **Hình thức phân phối:** app cá nhân, mã nguồn mở hay thương mại. Bản này tạm theo hướng *app cá nhân, chưa công khai mã nguồn*. Nếu bán hoặc phát hành rộng thì phải vào danh sách chờ của OpenAI.
2. **Nền tảng:** Android trước. iOS phụ thuộc việc OpenAI hỗ trợ callback phù hợp.
3. **Tài khoản ChatGPT Plus/Pro** để thử AI thật trên máy.
4. **Repo GitHub riêng tư** để build APK, vì môi trường phát triển hiện tại không tải được Android SDK.

## 6. Kết quả kiểm thử và giới hạn
- Đã chạy: kiểm thử lõi TypeScript, kiểm thử Java với máy chủ OAuth/Responses **giả lập**, biên dịch lớp Android với **API giả**, và kiểm thử giao diện trên Chromium giả lập điện thoại (xem `TEST_REPORT.md`).
- **Chưa làm:** build APK thật, chạy trên điện thoại thật, đăng nhập ChatGPT thật, một yêu cầu AI thật, thông báo thật khi app đóng, chế độ tiết kiệm pin, khởi động lại máy, đổi múi giờ trên thiết bị. Chưa đạt các tiêu chí nghiệm thu cần máy thật.
- WebKit/iOS chưa được kiểm thử. “iPhone 14” chỉ là Chromium với kích thước màn hình và user-agent của iPhone.
- Xuất dữ liệu trên Android ghi vào thư mục Documents. Hành vi này cần kiểm tra trên từng phiên bản Android.
