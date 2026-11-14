package vn.nhipsong.app.siwc;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Lõi "Sign in with ChatGPT" theo giao thức công khai của OpenAI (open-source client flow):
 * OIDC + PKCE S256, callback HTTP loopback 127.0.0.1, đăng ký động qua dynamic_agent_client,
 * refresh token xoay vòng, thu hồi, và gọi Responses API bằng access token của người dùng.
 *
 * Thuần Java để kiểm thử được ngoài Android. Token chỉ tồn tại trong lớp này và kho bảo mật;
 * không trả token ra tầng giao diện, không ghi log.
 */
public final class SiwcCore {

    public static final String CALLBACK_PATH = "/auth/callback";
    public static final String SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    public static final String PLAN_SCOPE = "chatgpt.tokens.use.direct";
    public static final String DYNAMIC_CLIENT = "dynamic_agent_client";

    /** Kho bí mật (Android: Keystore AES-GCM). Lưu một khối JSON đã mã hóa. */
    public interface SecretStore { String load(); void save(String json); void clear(); }
    /** Kho thường (không bí mật) cho host id cố định của lần cài. */
    public interface Prefs { String get(String key); void put(String key, String value); }
    public interface BrowserOpener { void open(String url) throws Exception; }

    public static final class Config {
        public String issuer = "https://auth.openai.com";
        public String resource = "https://api.openai.com/v1";
        public String apiBase = "https://api.openai.com/v1";
        public String appName = "Nhip Song";
        public int preferredPort = 1455;
        public long authTimeoutMs = 5 * 60_000L;
        public int httpTimeoutMs = 30_000;
        public int responseTimeoutMs = 180_000;
        /** Chỉ dùng trong kiểm thử với máy chủ giả. */
        public boolean allowHttpForTests = false;
    }

    public static final class SiwcException extends Exception {
        public final String code; public final boolean retryable; public final int status;
        public SiwcException(String code, String message, boolean retryable, int status) { super(message); this.code = code; this.retryable = retryable; this.status = status; }
        public SiwcException(String code, String message) { this(code, message, false, 0); }
    }

    private final Config cfg;
    private final SecretStore store;
    private final Prefs prefs;
    private final SecureRandom rnd = new SecureRandom();
    private Map<String, Object> discovery;
    private final Object lock = new Object();
    private final AtomicBoolean busy = new AtomicBoolean(false);

    public SiwcCore(Config cfg, SecretStore store, Prefs prefs) { this.cfg = cfg; this.store = store; this.prefs = prefs; }

    // ------------------------------------------------------------------ trạng thái

    /** Trạng thái an toàn để đưa lên giao diện: không chứa token. */
    public Map<String, Object> status() {
        Map<String, Object> c = loadConn();
        Map<String, Object> out = new LinkedHashMap<>();
        if (c == null) { out.put("status", "chua-ket-noi"); out.put("planUsage", false); out.put("scopes", new ArrayList<>()); return out; }
        boolean hasCreds = MiniJson.str(c, "accessToken") != null;
        out.put("status", hasCreds ? "da-ket-noi" : "can-ket-noi-lai");
        out.put("email", MiniJson.str(c, "email"));
        out.put("scopes", splitScopes(MiniJson.str(c, "scope")));
        out.put("planUsage", hasCreds && splitScopes(MiniJson.str(c, "scope")).contains(PLAN_SCOPE));
        out.put("connectedAt", MiniJson.num(c, "connectedAt", 0));
        return out;
    }

    public String hostId() {
        String h = prefs.get("ext_agent_host_id");
        if (h == null) { h = "urn:uuid:" + UUID.randomUUID(); prefs.put("ext_agent_host_id", h); }
        return h;
    }

    // ------------------------------------------------------------------ đăng nhập

    public Map<String, Object> connect(BrowserOpener browser, AtomicBoolean cancel) throws SiwcException {
        if (!busy.compareAndSet(false, true)) throw new SiwcException("busy", "Đang có một lần kết nối khác.");
        try { return doConnect(browser, cancel); } finally { busy.set(false); }
    }

    private Map<String, Object> doConnect(BrowserOpener browser, AtomicBoolean cancel) throws SiwcException {
        Map<String, Object> d = discover();
        Map<String, Object> prev = loadConn();
        String prevClient = prev == null ? null : MiniJson.str(prev, "clientId");
        String state = random(), nonce = random(), verifier = random();
        String challenge = b64url(sha256(verifier.getBytes(StandardCharsets.US_ASCII)));
        try (ServerSocket server = bindLoopback()) {
            String redirect = "http://127.0.0.1:" + server.getLocalPort() + CALLBACK_PATH;
            Map<String, String> q = new LinkedHashMap<>();
            q.put("client_id", prevClient != null ? prevClient : DYNAMIC_CLIENT);
            q.put("response_type", "code");
            q.put("redirect_uri", redirect);
            q.put("scope", SCOPES);
            q.put("resource", cfg.resource);
            q.put("state", state);
            q.put("nonce", nonce);
            q.put("code_challenge_method", "S256");
            q.put("code_challenge", challenge);
            q.put("ext_agent_host_id", hostId());
            if (prevClient == null) q.put("agent_name_hint", cfg.appName);
            if (prev != null && MiniJson.str(prev, "email") != null) q.put("login_hint", MiniJson.str(prev, "email"));
            String url = MiniJson.str(d, "authorization_endpoint") + "?" + form(q);
            try { browser.open(url); } catch (Exception e) { throw new SiwcException("browser_unavailable", "Không mở được trình duyệt."); }
            Map<String, String> cb = awaitCallback(server, state, cancel);
            if (cb.containsKey("error")) {
                if ("access_denied".equals(cb.get("error"))) throw new SiwcException("access_denied", "Bạn đã từ chối cấp quyền.");
                throw new SiwcException("authorize_error", "ChatGPT trả lỗi: " + safe(cb.get("error")));
            }
            String code = cb.get("code");
            String returned = cb.get("client_id");
            String clientId = returned != null ? returned : prevClient;
            if (code == null || clientId == null || DYNAMIC_CLIENT.equals(clientId) || !clientId.matches("[A-Za-z0-9_-]{1,200}")
                    || (prevClient != null && returned != null && !prevClient.equals(returned))) {
                throw new SiwcException("registration_incomplete", "ChatGPT chưa hoàn tất đăng ký app. Hãy thử lại.");
            }
            // Lưu client_id được cấp TRƯỚC khi đổi code để không đăng ký trùng nếu code hết hạn.
            Map<String, Object> pending = prev != null ? new LinkedHashMap<>(prev) : new LinkedHashMap<>();
            pending.put("clientId", clientId);
            pending.remove("accessToken"); pending.remove("refreshToken");
            saveConn(pending);

            Map<String, String> body = new LinkedHashMap<>();
            body.put("grant_type", "authorization_code");
            body.put("client_id", clientId);
            body.put("code", code);
            body.put("code_verifier", verifier);
            body.put("redirect_uri", redirect);
            body.put("resource", cfg.resource);
            Map<String, Object> tok = tokenRequest(body);
            String idToken = MiniJson.str(tok, "id_token");
            if (idToken == null) throw new SiwcException("invalid_id_token", "ChatGPT không trả danh tính xác minh được.");
            Map<String, Object> claims = verifyIdToken(idToken, clientId, nonce);
            String sub = MiniJson.str(claims, "sub");
            String prevSub = prev == null ? null : MiniJson.str(prev, "sub");
            if (prevSub != null && !prevSub.equals(sub)) throw new SiwcException("account_mismatch", "Bạn đăng nhập một tài khoản ChatGPT khác với tài khoản đã kết nối trước đó.");
            Map<String, Object> conn = new LinkedHashMap<>(pending);
            conn.put("sub", sub);
            if (MiniJson.str(claims, "email") != null) conn.put("email", MiniJson.str(claims, "email"));
            applyTokenFields(conn, tok, false);
            conn.put("connectedAt", System.currentTimeMillis());
            saveConn(conn);
            return status();
        } catch (IOException e) {
            throw new SiwcException("network_error", "Không kết nối được tới ChatGPT.", true, 0);
        }
    }

    private ServerSocket bindLoopback() throws IOException {
        InetAddress lo = InetAddress.getByName("127.0.0.1");
        ServerSocket s = new ServerSocket();
        s.setReuseAddress(true);
        try { s.bind(new InetSocketAddress(lo, cfg.preferredPort), 4); }
        catch (IOException busyPort) { s.close(); s = new ServerSocket(); s.bind(new InetSocketAddress(lo, 0), 4); }
        s.setSoTimeout(1000);
        return s;
    }

    private Map<String, String> awaitCallback(ServerSocket server, String state, AtomicBoolean cancel) throws SiwcException, IOException {
        long deadline = System.currentTimeMillis() + cfg.authTimeoutMs;
        int port = server.getLocalPort();
        while (System.currentTimeMillis() < deadline) {
            if (cancel != null && cancel.get()) throw new SiwcException("cancelled", "Đã hủy kết nối.");
            Socket sock;
            try { sock = server.accept(); } catch (SocketTimeoutException t) { continue; }
            try (Socket c = sock) {
                c.setSoTimeout(10_000);
                BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.US_ASCII));
                String line = in.readLine();
                String host = null;
                for (String h; (h = in.readLine()) != null && !h.isEmpty(); ) if (h.toLowerCase().startsWith("host:")) host = h.substring(5).trim();
                if (line == null) continue;
                String[] parts = line.split(" ");
                if (parts.length < 2 || !"GET".equals(parts[0]) || !("127.0.0.1:" + port).equals(host)) { reply(c, 404, "Not found"); continue; }
                String target = parts[1];
                int qi = target.indexOf('?');
                String path = qi < 0 ? target : target.substring(0, qi);
                if (!CALLBACK_PATH.equals(path)) { reply(c, 404, "Not found"); continue; }
                Map<String, List<String>> params = parseQuery(qi < 0 ? "" : target.substring(qi + 1));
                List<String> st = params.get("state");
                if (st == null || st.size() != 1 || !MessageDigest.isEqual(st.get(0).getBytes(StandardCharsets.UTF_8), state.getBytes(StandardCharsets.UTF_8))) {
                    // Yêu cầu lạ không được làm hỏng giao dịch đang chờ
                    reply(c, 400, "Trạng thái đăng nhập không hợp lệ.");
                    continue;
                }
                for (String k : new String[]{"code", "client_id"}) if (params.containsKey(k) && params.get(k).size() > 1) throw new SiwcException("registration_incomplete", "Callback không hợp lệ.");
                replyHtml(c);
                Map<String, String> out = new LinkedHashMap<>();
                for (Map.Entry<String, List<String>> e : params.entrySet()) out.put(e.getKey(), e.getValue().get(0));
                return out;
            }
        }
        throw new SiwcException("timeout", "Hết thời gian chờ đăng nhập.", true, 0);
    }

    private static void reply(Socket c, int code, String msg) throws IOException {
        byte[] b = msg.getBytes(StandardCharsets.UTF_8);
        OutputStream o = c.getOutputStream();
        o.write(("HTTP/1.1 " + code + " X\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + b.length + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        o.write(b); o.flush();
    }

    private static void replyHtml(Socket c) throws IOException {
        String html = "<!doctype html><html lang=\"vi\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Quay lại Nhịp Sống</title>"
                + "<style>body{font:18px system-ui;max-width:28rem;margin:15vh auto;padding:24px;color:#23403a;text-align:center}a{display:inline-block;margin-top:24px;padding:14px 22px;border-radius:14px;background:#3E8E7E;color:#fff;text-decoration:none}</style>"
                + "<h1>🌱 Đã nhận kết nối</h1><p>Nhịp Sống đang kiểm tra quyền. Bạn có thể quay lại app.</p><a href=\"nhipsong://auth-done\">Quay lại Nhịp Sống</a>"
                + "<script>history.replaceState(null,'','/auth/complete');</script></html>";
        byte[] b = html.getBytes(StandardCharsets.UTF_8);
        OutputStream o = c.getOutputStream();
        o.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + b.length + "\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        o.write(b); o.flush();
    }

    // ------------------------------------------------------------------ token

    private void applyTokenFields(Map<String, Object> conn, Map<String, Object> tok, boolean refresh) throws SiwcException {
        String scope = MiniJson.str(tok, "scope");
        if (scope == null && refresh) scope = MiniJson.str(conn, "scope");
        if (scope == null) throw new SiwcException("invalid_token_response", "ChatGPT không xác nhận quyền đã cấp.");
        String at = MiniJson.str(tok, "access_token");
        String type = MiniJson.str(tok, "token_type");
        long exp = MiniJson.num(tok, "expires_in", -1);
        String rt = MiniJson.str(tok, "refresh_token");
        List<String> scopes = splitScopes(scope);
        if (at == null || type == null || !"bearer".equalsIgnoreCase(type) || exp <= 0 || (scopes.contains("offline_access") && rt == null)) {
            throw new SiwcException("invalid_token_response", "ChatGPT trả thông tin đăng nhập chưa đầy đủ.");
        }
        conn.put("scope", scope);
        conn.put("accessToken", at);
        conn.put("refreshToken", rt);
        conn.put("expiresAt", System.currentTimeMillis() + exp * 1000);
    }

    private Map<String, Object> tokenRequest(Map<String, String> body) throws SiwcException {
        HttpResult r = http("POST", MiniJson.str(discover(), "token_endpoint"), form(body), "application/x-www-form-urlencoded", null, "application/json");
        Map<String, Object> data;
        try { data = MiniJson.obj(r.body); } catch (RuntimeException e) { throw new SiwcException("invalid_token_response", "Phản hồi token không hợp lệ.", true, r.status); }
        if (r.status >= 400) throw mapError(data, r.status);
        return data;
    }

    /** Trả access token còn hạn; tự làm mới khi sắp hết hạn. Chỉ dùng nội bộ. */
    private String accessToken() throws SiwcException {
        synchronized (lock) {
            Map<String, Object> c = loadConn();
            if (c == null || MiniJson.str(c, "accessToken") == null) throw new SiwcException("not_connected", "Chưa kết nối ChatGPT.");
            long exp = MiniJson.num(c, "expiresAt", 0);
            if (exp - 60_000 > System.currentTimeMillis()) return MiniJson.str(c, "accessToken");
            return refreshLocked(c);
        }
    }

    private String refreshLocked(Map<String, Object> c) throws SiwcException {
        String rt = MiniJson.str(c, "refreshToken");
        if (rt == null) { dropCredentials(c); throw new SiwcException("reauth_required", "Phiên ChatGPT đã hết hạn. Hãy kết nối lại."); }
        Map<String, String> body = new LinkedHashMap<>();
        body.put("grant_type", "refresh_token");
        body.put("client_id", MiniJson.str(c, "clientId"));
        body.put("refresh_token", rt);
        body.put("resource", cfg.resource);
        Map<String, Object> tok;
        try { tok = tokenRequest(body); }
        catch (SiwcException e) {
            if ("invalid_grant".equals(e.code) || e.status == 400 || e.status == 401) { dropCredentials(c); throw new SiwcException("reauth_required", "Quyền đã bị thu hồi hoặc hết hạn. Hãy kết nối lại ChatGPT."); }
            throw e;
        }
        String idToken = MiniJson.str(tok, "id_token");
        if (idToken != null) {
            Map<String, Object> claims = verifyIdToken(idToken, MiniJson.str(c, "clientId"), null);
            if (!MiniJson.str(claims, "sub").equals(MiniJson.str(c, "sub"))) { dropCredentials(c); throw new SiwcException("account_mismatch", "Danh tính sau khi làm mới không khớp. Hãy kết nối lại."); }
        }
        Map<String, Object> next = new LinkedHashMap<>(c);
        applyTokenFields(next, tok, true); // thay access token, hạn, scope và refresh token xoay vòng cùng lúc
        saveConn(next);
        return MiniJson.str(next, "accessToken");
    }

    private void dropCredentials(Map<String, Object> c) {
        Map<String, Object> n = new LinkedHashMap<>(c);
        n.remove("accessToken"); n.remove("refreshToken"); n.remove("expiresAt");
        saveConn(n); // giữ clientId/sub để kết nối lại không đăng ký trùng
    }

    /** Ngắt kết nối: thu hồi refresh token (nếu được) rồi xóa thông tin xác thực cục bộ. Lịch không bị ảnh hưởng. */
    public Map<String, Object> disconnect() {
        Map<String, Object> c = loadConn();
        Map<String, Object> out = new LinkedHashMap<>();
        boolean remote = false;
        if (c != null && MiniJson.str(c, "refreshToken") != null) {
            try {
                String rev = MiniJson.str(discover(), "revocation_endpoint");
                if (rev != null) {
                    Map<String, String> b = new LinkedHashMap<>();
                    b.put("token", MiniJson.str(c, "refreshToken"));
                    b.put("token_type_hint", "refresh_token");
                    b.put("client_id", MiniJson.str(c, "clientId"));
                    remote = http("POST", rev, form(b), "application/x-www-form-urlencoded", null, null).status == 200;
                }
            } catch (Exception ignored) { /* vẫn xóa cục bộ */ }
        }
        store.clear();
        out.put("remoteRevoked", remote);
        out.put("status", "chua-ket-noi");
        return out;
    }

    // ------------------------------------------------------------------ AI

    public List<String> listModels() throws SiwcException {
        String at = requirePlan();
        HttpResult r = http("GET", cfg.apiBase + "/models", null, null, at, "application/json");
        if (r.status == 401) { forceRefreshOnce(); r = http("GET", cfg.apiBase + "/models", null, null, accessToken(), "application/json"); }
        Map<String, Object> data;
        try { data = MiniJson.obj(r.body); } catch (RuntimeException e) { throw new SiwcException("invalid_response", "Danh sách model không hợp lệ.", true, r.status); }
        if (r.status >= 400) throw mapError(data, r.status);
        List<String> ids = new ArrayList<>();
        Object arr = data.get("data");
        if (arr instanceof List) for (Object o : (List<?>) arr) if (o instanceof Map) { Object id = ((Map<?, ?>) o).get("id"); if (id instanceof String) ids.add((String) id); }
        return ids;
    }

    /** Gửi một yêu cầu Responses (store:false, stream:true) và trả văn bản sau response.completed. */
    public String respond(String model, String instructions, String userText, AtomicBoolean cancel) throws SiwcException {
        if (model == null || !model.matches("[A-Za-z0-9._:-]{1,100}")) throw new SiwcException("invalid_request", "Model không hợp lệ.");
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("role", "user"); msg.put("content", userText);
        List<Object> input = new ArrayList<>(); input.add(msg);
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("model", model);
        if (instructions != null) req.put("instructions", instructions);
        req.put("input", input);
        req.put("store", Boolean.FALSE);
        req.put("stream", Boolean.TRUE);
        String body = MiniJson.write(req);
        String at = requirePlan();
        try {
            return stream(at, body, cancel);
        } catch (SiwcException e) {
            if (e.status != 401) throw e;
            forceRefreshOnce();
            return stream(accessToken(), body, cancel);
        }
    }

    private String requirePlan() throws SiwcException {
        String at = accessToken();
        Map<String, Object> c = loadConn();
        if (!splitScopes(MiniJson.str(c, "scope")).contains(PLAN_SCOPE)) throw new SiwcException("plan_not_granted", "Tài khoản đã đăng nhập nhưng chưa được cấp quyền dùng gói ChatGPT cho AI.");
        return at;
    }

    private void forceRefreshOnce() throws SiwcException {
        synchronized (lock) {
            Map<String, Object> c = loadConn();
            if (c == null) throw new SiwcException("not_connected", "Chưa kết nối ChatGPT.");
            refreshLocked(c);
        }
    }

    private String stream(String token, String body, AtomicBoolean cancel) throws SiwcException {
        HttpURLConnection conn = null;
        try {
            conn = open(cfg.apiBase + "/responses", "POST", cfg.responseTimeoutMs);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "text/event-stream");
            conn.setDoOutput(true);
            try (OutputStream o = conn.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            int st = conn.getResponseCode();
            if (st >= 400) {
                String err = readAll(conn.getErrorStream());
                Map<String, Object> data;
                try { data = MiniJson.obj(err); } catch (RuntimeException e) { data = new LinkedHashMap<>(); }
                throw mapError(data, st);
            }
            String ct = conn.getContentType();
            if (ct != null && !ct.toLowerCase().startsWith("text/event-stream")) throw new SiwcException("invalid_stream", "ChatGPT không trả luồng phản hồi như mong đợi.", true, st);
            StringBuilder text = new StringBuilder();
            boolean completed = false;
            long deadline = System.currentTimeMillis() + cfg.responseTimeoutMs;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                StringBuilder data = new StringBuilder();
                for (String line; (line = r.readLine()) != null; ) {
                    if (cancel != null && cancel.get()) throw new SiwcException("cancelled", "Đã hủy yêu cầu.");
                    if (System.currentTimeMillis() > deadline) throw new SiwcException("timeout", "AI phản hồi quá lâu.", true, 0);
                    if (line.startsWith("data:")) { data.append(line.substring(5).trim()); continue; }
                    if (!line.isEmpty() || data.length() == 0) continue;
                    String payload = data.toString(); data.setLength(0);
                    if ("[DONE]".equals(payload)) break;
                    Map<String, Object> ev;
                    try { ev = MiniJson.obj(payload); } catch (RuntimeException e) { throw new SiwcException("invalid_stream", "Luồng phản hồi có sự kiện không hợp lệ.", true, st); }
                    String type = MiniJson.str(ev, "type");
                    if ("response.output_text.delta".equals(type)) {
                        String delta = MiniJson.str(ev, "delta");
                        if (delta != null) text.append(delta);
                        if (text.length() > 1_000_000) throw new SiwcException("response_too_large", "Phản hồi quá lớn.");
                    } else if ("response.failed".equals(type) || "error".equals(type)) {
                        Object detail = "response.failed".equals(type) ? ev.get("response") : ev;
                        @SuppressWarnings("unchecked") Map<String, Object> dm = detail instanceof Map ? (Map<String, Object>) detail : new LinkedHashMap<>();
                        throw mapError(dm, st);
                    } else if ("response.incomplete".equals(type)) {
                        throw new SiwcException("response_incomplete", "AI dừng trước khi hoàn tất.", true, st);
                    } else if ("response.completed".equals(type)) { completed = true; break; }
                }
            }
            if (!completed) throw new SiwcException("stream_interrupted", "Kết nối bị ngắt trước khi AI trả lời xong.", true, st);
            return text.toString();
        } catch (SocketTimeoutException e) {
            throw new SiwcException("timeout", "AI phản hồi quá lâu.", true, 0);
        } catch (IOException e) {
            throw new SiwcException("network_error", "Không kết nối được tới ChatGPT. Kiểm tra mạng và thử lại.", true, 0);
        } finally { if (conn != null) conn.disconnect(); }
    }

    static SiwcException mapError(Map<String, Object> data, int status) {
        String code = null;
        Object err = data.get("error");
        if (err instanceof String) code = (String) err;
        else if (err instanceof Map) { Object c = ((Map<?, ?>) err).get("code"); if (c instanceof String) code = (String) c; if (code == null) { Object t = ((Map<?, ?>) err).get("type"); if (t instanceof String) code = (String) t; } }
        if (code == null) code = MiniJson.str(data, "code");
        if ("invalid_grant".equals(code)) return new SiwcException("invalid_grant", "Phiên đã hết hạn.", false, status);
        if (code != null && code.contains("usage_limit")) return new SiwcException("usage_limit", "Đã chạm hạn mức dùng gói ChatGPT. Xem mục Usage trong cài đặt ChatGPT.", false, status);
        if (code != null && code.contains("not_enabled")) return new SiwcException("client_not_enabled", "App chưa được bật quyền dùng gói ChatGPT.", false, status);
        if (status == 429) return new SiwcException("rate_limited", "Quá nhiều yêu cầu. Đợi một chút rồi thử lại.", true, status);
        if (status == 401) return new SiwcException("unauthorized", "ChatGPT không chấp nhận phiên hiện tại.", false, status);
        if (status == 403) return new SiwcException("forbidden", "Chính sách hoặc quyền của ChatGPT chặn yêu cầu này (có thể do khu vực hoặc loại tài khoản).", false, status);
        if (status >= 500) return new SiwcException("server_error", "Máy chủ ChatGPT đang lỗi. Thử lại sau.", true, status);
        return new SiwcException(code != null ? safe(code) : "request_failed", "Yêu cầu tới ChatGPT không thành công (" + status + ").", false, status);
    }

    // ------------------------------------------------------------------ OIDC

    private Map<String, Object> discover() throws SiwcException {
        if (discovery != null) return discovery;
        HttpResult r = http("GET", cfg.issuer + "/.well-known/openid-configuration", null, null, null, "application/json");
        Map<String, Object> d;
        try { d = MiniJson.obj(r.body); } catch (RuntimeException e) { throw new SiwcException("discovery_failed", "Không xác minh được cấu hình đăng nhập ChatGPT.", true, r.status); }
        if (r.status != 200 || !cfg.issuer.equals(MiniJson.str(d, "issuer"))) throw new SiwcException("discovery_failed", "Không xác minh được cấu hình đăng nhập ChatGPT.", true, r.status);
        for (String k : new String[]{"authorization_endpoint", "token_endpoint", "jwks_uri"}) {
            String v = MiniJson.str(d, k);
            if (v == null || !v.startsWith(cfg.issuer + "/")) throw new SiwcException("discovery_failed", "Cấu hình đăng nhập không hợp lệ.", true, 0);
        }
        String rev = MiniJson.str(d, "revocation_endpoint");
        if (rev != null && !rev.startsWith(cfg.issuer + "/")) d.remove("revocation_endpoint");
        discovery = d;
        return d;
    }

    Map<String, Object> verifyIdToken(String jwt, String clientId, String nonce) throws SiwcException {
        String[] p = jwt.split("\\.");
        if (p.length != 3) throw new SiwcException("invalid_id_token", "ID token không hợp lệ.");
        Map<String, Object> header, claims;
        try {
            header = MiniJson.obj(new String(Base64.getUrlDecoder().decode(p[0]), StandardCharsets.UTF_8));
            claims = MiniJson.obj(new String(Base64.getUrlDecoder().decode(p[1]), StandardCharsets.UTF_8));
        } catch (RuntimeException e) { throw new SiwcException("invalid_id_token", "ID token không hợp lệ."); }
        if (!"RS256".equals(MiniJson.str(header, "alg"))) throw new SiwcException("invalid_id_token", "Thuật toán ký không được hỗ trợ.");
        PublicKey key = jwk(MiniJson.str(header, "kid"));
        try {
            Signature v = Signature.getInstance("SHA256withRSA");
            v.initVerify(key);
            v.update((p[0] + "." + p[1]).getBytes(StandardCharsets.US_ASCII));
            if (!v.verify(Base64.getUrlDecoder().decode(p[2]))) throw new SiwcException("invalid_id_token", "Chữ ký ID token sai.");
        } catch (SiwcException e) { throw e; } catch (Exception e) { throw new SiwcException("invalid_id_token", "Không kiểm tra được chữ ký."); }
        long now = System.currentTimeMillis() / 1000;
        if (!cfg.issuer.equals(MiniJson.str(claims, "iss"))) throw new SiwcException("invalid_id_token", "Sai issuer.");
        Object aud = claims.get("aud");
        boolean audOk = clientId.equals(aud) || (aud instanceof List && ((List<?>) aud).contains(clientId));
        if (!audOk) throw new SiwcException("invalid_id_token", "Sai audience.");
        if (MiniJson.num(claims, "exp", 0) + 120 < now) throw new SiwcException("invalid_id_token", "ID token đã hết hạn.");
        if (nonce != null && !nonce.equals(MiniJson.str(claims, "nonce"))) throw new SiwcException("invalid_id_token", "Sai nonce.");
        if (MiniJson.str(claims, "sub") == null) throw new SiwcException("invalid_id_token", "Thiếu định danh.");
        return claims;
    }

    private PublicKey jwk(String kid) throws SiwcException {
        HttpResult r = http("GET", MiniJson.str(discover(), "jwks_uri"), null, null, null, "application/json");
        if (r.status != 200) throw new SiwcException("identity_verification_unavailable", "Tạm thời chưa xác minh được danh tính. Thử lại sau.", true, r.status);
        try {
            Object keys = MiniJson.obj(r.body).get("keys");
            for (Object k : (List<?>) keys) {
                @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) k;
                if (!"RSA".equals(MiniJson.str(m, "kty"))) continue;
                if (kid != null && !kid.equals(MiniJson.str(m, "kid"))) continue;
                BigInteger n = new BigInteger(1, Base64.getUrlDecoder().decode(MiniJson.str(m, "n")));
                BigInteger e = new BigInteger(1, Base64.getUrlDecoder().decode(MiniJson.str(m, "e")));
                return KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(n, e));
            }
        } catch (Exception ex) { throw new SiwcException("identity_verification_unavailable", "Bộ khóa xác minh không hợp lệ.", true, 0); }
        throw new SiwcException("invalid_id_token", "Không tìm thấy khóa xác minh.");
    }

    // ------------------------------------------------------------------ tiện ích

    private Map<String, Object> loadConn() {
        String s = store.load();
        if (s == null || s.isEmpty()) return null;
        try { return MiniJson.obj(s); } catch (RuntimeException e) { store.clear(); return null; }
    }

    private void saveConn(Map<String, Object> c) { store.save(MiniJson.write(c)); }

    static final class HttpResult { int status; String body; }

    private HttpURLConnection open(String url, String method, int timeout) throws IOException {
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol()) && !(cfg.allowHttpForTests && "http".equals(u.getProtocol()))) throw new IOException("Chỉ cho phép HTTPS");
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setInstanceFollowRedirects(false);
        c.setRequestMethod(method);
        c.setConnectTimeout(Math.min(timeout, 15_000));
        c.setReadTimeout(timeout);
        c.setUseCaches(false);
        return c;
    }

    private HttpResult http(String method, String url, String body, String contentType, String bearer, String accept) throws SiwcException {
        HttpURLConnection c = null;
        try {
            c = open(url, method, cfg.httpTimeoutMs);
            if (accept != null) c.setRequestProperty("Accept", accept);
            if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", contentType);
                try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            HttpResult r = new HttpResult();
            r.status = c.getResponseCode();
            r.body = readAll(r.status >= 400 ? c.getErrorStream() : c.getInputStream());
            return r;
        } catch (SocketTimeoutException e) {
            throw new SiwcException("timeout", "Hết thời gian chờ mạng.", true, 0);
        } catch (IOException e) {
            throw new SiwcException("network_error", "Không kết nối được tới ChatGPT. Kiểm tra mạng và thử lại.", true, 0);
        } finally { if (c != null) c.disconnect(); }
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream i = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = i.read(buf)) > 0; ) { b.write(buf, 0, n); if (b.size() > 2_000_000) break; }
            return new String(b.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    static String form(Map<String, String> m) {
        StringBuilder b = new StringBuilder();
        try {
            for (Map.Entry<String, String> e : m.entrySet()) {
                if (b.length() > 0) b.append('&');
                b.append(URLEncoder.encode(e.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8").replace("+", "%20"));
            }
        } catch (IOException ignored) { }
        return b.toString();
    }

    static Map<String, List<String>> parseQuery(String q) {
        Map<String, List<String>> m = new LinkedHashMap<>();
        if (q.isEmpty()) return m;
        for (String kv : q.split("&")) {
            int i = kv.indexOf('=');
            try {
                String k = URLDecoder.decode(i < 0 ? kv : kv.substring(0, i), "UTF-8");
                String v = i < 0 ? "" : URLDecoder.decode(kv.substring(i + 1), "UTF-8");
                m.computeIfAbsent(k, x -> new ArrayList<>()).add(v);
            } catch (IOException | IllegalArgumentException ignored) { }
        }
        return m;
    }

    static List<String> splitScopes(String s) {
        List<String> l = new ArrayList<>();
        if (s != null) for (String x : s.trim().split("\\s+")) if (!x.isEmpty()) l.add(x);
        return l;
    }

    private String random() { byte[] b = new byte[32]; rnd.nextBytes(b); return b64url(b); }
    static String b64url(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    static byte[] sha256(byte[] b) { try { return MessageDigest.getInstance("SHA-256").digest(b); } catch (Exception e) { throw new IllegalStateException(e); } }
    private static String safe(String s) { return s == null ? "" : s.replaceAll("[^A-Za-z0-9_.-]", "").substring(0, Math.min(60, s.replaceAll("[^A-Za-z0-9_.-]", "").length())); }
}
