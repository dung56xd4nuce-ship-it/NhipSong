import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import vn.nhipsong.app.siwc.MiniJson;
import vn.nhipsong.app.siwc.SiwcCore;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Kiểm thử lõi SIWC với máy chủ OAuth/Responses giả lập cục bộ. Không gọi dịch vụ thật. */
public class SiwcCoreTest {
    static int passed = 0, failed = 0;
    static HttpServer srv; static String issuer; static KeyPair kp;
    static String grantedScope = SiwcCore.SCOPES;
    static int accessTtl = 3600;
    static boolean refreshRevoked = false, usageLimit = false, tamper = false, denyConsent = false;
    static String lastAuthorizeClientId; static String lastRefreshToken = null;
    static AtomicInteger refreshCount = new AtomicInteger(), rt = new AtomicInteger();
    static List<String> logs = new ArrayList<>();
    static String pendingNonce;

    public static void main(String[] a) throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA"); g.initialize(2048); kp = g.generateKeyPair();
        srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        issuer = "http://127.0.0.1:" + srv.getAddress().getPort();
        srv.createContext("/", SiwcCoreTest::handle);
        srv.start();
        try {
            test("Kết nối đầy đủ: đăng ký động, PKCE, xác minh ID token, có quyền dùng gói", SiwcCoreTest::fullConnect);
            test("Một yêu cầu AI (Responses SSE) trả văn bản", SiwcCoreTest::respond);
            test("Token hết hạn ⇒ tự làm mới, refresh token xoay vòng", SiwcCoreTest::refresh);
            test("Kết nối lại dùng client_id đã cấp, không đăng ký trùng", SiwcCoreTest::reuseClient);
            test("Quyền bị thu hồi ⇒ yêu cầu kết nối lại, giữ client_id", SiwcCoreTest::revoked);
            test("Chỉ có quyền danh tính ⇒ không coi là AI đã hoạt động", SiwcCoreTest::identityOnly);
            test("Hết hạn mức ⇒ báo usage_limit", SiwcCoreTest::usage);
            test("Từ chối cấp quyền ⇒ access_denied, không đổi code", SiwcCoreTest::denied);
            test("ID token bị sửa chữ ký ⇒ từ chối", SiwcCoreTest::tampered);
            test("Callback sai state bị bỏ qua, không làm hỏng giao dịch", SiwcCoreTest::badStateIgnored);
            test("Ngắt kết nối: thu hồi và xóa thông tin xác thực", SiwcCoreTest::disconnect);
        } finally { srv.stop(0); }
        System.out.println("\nKết quả Java: " + passed + " đạt, " + failed + " lỗi");
        if (failed > 0) System.exit(1);
    }

    interface T { void run() throws Exception; }
    static void test(String name, T t) {
        reset();
        try { t.run(); passed++; System.out.println("  ✓ " + name); }
        catch (Throwable e) { failed++; System.out.println("  ✗ " + name + " — " + e); e.printStackTrace(System.out); }
    }
    static void check(boolean c, String m) { if (!c) throw new AssertionError(m); }
    static void reset() { grantedScope = SiwcCore.SCOPES; accessTtl = 3600; refreshRevoked = usageLimit = tamper = denyConsent = false; }

    // ---------- kho ----------
    static class MemStore implements SiwcCore.SecretStore { String v; public String load() { return v; } public void save(String j) { v = j; } public void clear() { v = null; } }
    static class MemPrefs implements SiwcCore.Prefs { Map<String, String> m = new HashMap<>(); public String get(String k) { return m.get(k); } public void put(String k, String v) { m.put(k, v); } }

    static SiwcCore core(MemStore s, MemPrefs p) {
        SiwcCore.Config c = new SiwcCore.Config();
        c.issuer = issuer; c.resource = "https://api.openai.com/v1"; c.apiBase = issuer + "/v1";
        c.allowHttpForTests = true; c.authTimeoutMs = 10_000; c.preferredPort = 0;
        return new SiwcCore(c, s, p);
    }

    /** Trình duyệt giả: mở authorize, nhận 302 và đi theo tới loopback của app. */
    static SiwcCore.BrowserOpener browser(boolean sendJunkFirst) {
        return url -> new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(false);
                String loc = c.getHeaderField("Location");
                if (sendJunkFirst) {
                    String junk = loc.replaceAll("state=[^&]+", "state=sai");
                    HttpURLConnection j = (HttpURLConnection) new URL(junk).openConnection();
                    check(j.getResponseCode() == 400, "callback sai state phải bị từ chối");
                }
                HttpURLConnection cb = (HttpURLConnection) new URL(loc).openConnection();
                cb.getResponseCode();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    static void fullConnect() throws Exception {
        MemStore s = new MemStore(); MemPrefs p = new MemPrefs();
        SiwcCore c = core(s, p);
        Map<String, Object> st = c.connect(browser(false), new AtomicBoolean());
        check("da-ket-noi".equals(st.get("status")), "status " + st);
        check(Boolean.TRUE.equals(st.get("planUsage")), "planUsage");
        check("dynamic_agent_client".equals(lastAuthorizeClientId), "lần đầu phải dùng dynamic_agent_client");
        check(p.get("ext_agent_host_id").startsWith("urn:uuid:"), "host id");
        check(!MiniJson.write(st).contains("access-"), "status không được chứa token");
        check(s.v.contains("oaiapp_test"), "client_id phải được lưu");
    }

    static SiwcCore connected(MemStore s, MemPrefs p) throws Exception { SiwcCore c = core(s, p); c.connect(browser(false), new AtomicBoolean()); return c; }

    static void respond() throws Exception {
        SiwcCore c = connected(new MemStore(), new MemPrefs());
        check(c.listModels().contains("gpt-test"), "listModels");
        String out = c.respond("gpt-test", "Trả JSON", "Xin chào", new AtomicBoolean());
        check(out.equals("{\"ok\":true}"), "text=" + out);
    }

    static void refresh() throws Exception {
        accessTtl = 30; // < 60s ⇒ coi như sắp hết hạn
        MemStore s = new MemStore();
        SiwcCore c = connected(s, new MemPrefs());
        String before = MiniJson.str(MiniJson.obj(s.v), "refreshToken");
        int n = refreshCount.get();
        c.respond("gpt-test", null, "hi", new AtomicBoolean());
        check(refreshCount.get() == n + 1, "phải làm mới 1 lần");
        String after = MiniJson.str(MiniJson.obj(s.v), "refreshToken");
        check(!before.equals(after), "refresh token phải xoay vòng");
    }

    static void reuseClient() throws Exception {
        MemStore s = new MemStore(); MemPrefs p = new MemPrefs();
        connected(s, p);
        core(s, p).connect(browser(false), new AtomicBoolean());
        check("oaiapp_test".equals(lastAuthorizeClientId), "lần sau phải dùng client_id đã cấp");
    }

    static void revoked() throws Exception {
        accessTtl = 30;
        MemStore s = new MemStore();
        SiwcCore c = connected(s, new MemPrefs());
        refreshRevoked = true;
        try { c.respond("gpt-test", null, "hi", new AtomicBoolean()); throw new AssertionError("phải lỗi"); }
        catch (SiwcCore.SiwcException e) { check("reauth_required".equals(e.code), e.code); }
        check("can-ket-noi-lai".equals(c.status().get("status")), "status");
        check(s.v.contains("oaiapp_test") && !s.v.contains("accessToken"), "giữ client_id, xóa token");
    }

    static void identityOnly() throws Exception {
        grantedScope = "openid profile email offline_access";
        SiwcCore c = connected(new MemStore(), new MemPrefs());
        check(Boolean.FALSE.equals(c.status().get("planUsage")), "không có quyền dùng gói");
        try { c.respond("gpt-test", null, "hi", new AtomicBoolean()); throw new AssertionError("phải lỗi"); }
        catch (SiwcCore.SiwcException e) { check("plan_not_granted".equals(e.code), e.code); }
    }

    static void usage() throws Exception {
        SiwcCore c = connected(new MemStore(), new MemPrefs());
        usageLimit = true;
        try { c.respond("gpt-test", null, "hi", new AtomicBoolean()); throw new AssertionError("phải lỗi"); }
        catch (SiwcCore.SiwcException e) { check("usage_limit".equals(e.code), e.code); }
    }

    static void denied() throws Exception {
        denyConsent = true;
        try { core(new MemStore(), new MemPrefs()).connect(browser(false), new AtomicBoolean()); throw new AssertionError("phải lỗi"); }
        catch (SiwcCore.SiwcException e) { check("access_denied".equals(e.code), e.code); }
    }

    static void tampered() throws Exception {
        tamper = true;
        MemStore s = new MemStore();
        try { core(s, new MemPrefs()).connect(browser(false), new AtomicBoolean()); throw new AssertionError("phải lỗi"); }
        catch (SiwcCore.SiwcException e) { check("invalid_id_token".equals(e.code), e.code); }
        check(s.v == null || !s.v.contains("accessToken"), "không lưu token khi danh tính sai");
    }

    static void badStateIgnored() throws Exception {
        SiwcCore c = core(new MemStore(), new MemPrefs());
        check("da-ket-noi".equals(c.connect(browser(true), new AtomicBoolean()).get("status")), "vẫn kết nối được");
    }

    static void disconnect() throws Exception {
        MemStore s = new MemStore();
        SiwcCore c = connected(s, new MemPrefs());
        Map<String, Object> r = c.disconnect();
        check(Boolean.TRUE.equals(r.get("remoteRevoked")), "thu hồi");
        check(s.v == null, "xóa cục bộ");
        check("chua-ket-noi".equals(c.status().get("status")), "status");
    }

    // ---------- máy chủ giả ----------
    static String b64(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    static String jwt(Map<String, Object> claims) throws Exception {
        String h = b64("{\"alg\":\"RS256\",\"kid\":\"k1\"}".getBytes(StandardCharsets.UTF_8));
        String p = b64(MiniJson.write(claims).getBytes(StandardCharsets.UTF_8));
        Signature s = Signature.getInstance("SHA256withRSA"); s.initSign(kp.getPrivate()); s.update((h + "." + p).getBytes(StandardCharsets.US_ASCII));
        byte[] sig = s.sign(); if (tamper) sig[5] ^= 1;
        return h + "." + p + "." + b64(sig);
    }
    static Map<String, String> q(String s) throws Exception {
        Map<String, String> m = new HashMap<>(); if (s == null) return m;
        for (String kv : s.split("&")) { int i = kv.indexOf('='); m.put(URLDecoder.decode(kv.substring(0, i), "UTF-8"), URLDecoder.decode(kv.substring(i + 1), "UTF-8")); }
        return m;
    }
    static void send(HttpExchange x, int st, String ct, String body) throws java.io.IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        if (ct != null) x.getResponseHeaders().set("Content-Type", ct);
        x.sendResponseHeaders(st, b.length == 0 ? -1 : b.length);
        if (b.length > 0) try (OutputStream o = x.getResponseBody()) { o.write(b); }
        x.close();
    }
    static Map<String, Object> tokenResp(String clientId) throws Exception {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", issuer); claims.put("aud", clientId); claims.put("sub", "user-123"); claims.put("email", "nguoi.dung@example.com");
        claims.put("exp", System.currentTimeMillis() / 1000 + 3600); if (pendingNonce != null) claims.put("nonce", pendingNonce);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("access_token", "access-" + rt.incrementAndGet()); r.put("token_type", "Bearer"); r.put("expires_in", (long) accessTtl);
        r.put("refresh_token", "refresh-" + rt.get()); r.put("scope", grantedScope); r.put("id_token", jwt(claims));
        return r;
    }

    static void handle(HttpExchange x) {
        try {
            String path = x.getRequestURI().getPath();
            String body; try (InputStream in = x.getRequestBody()) { body = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
            switch (path) {
                case "/.well-known/openid-configuration": {
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("issuer", issuer); d.put("authorization_endpoint", issuer + "/api/accounts/authorize");
                    d.put("token_endpoint", issuer + "/api/accounts/oauth/token"); d.put("jwks_uri", issuer + "/.well-known/jwks.json");
                    d.put("revocation_endpoint", issuer + "/oauth/revoke");
                    send(x, 200, "application/json", MiniJson.write(d)); return;
                }
                case "/.well-known/jwks.json": {
                    RSAPublicKey pk = (RSAPublicKey) kp.getPublic();
                    String n = b64(strip(pk.getModulus().toByteArray())), e = b64(strip(pk.getPublicExponent().toByteArray()));
                    send(x, 200, "application/json", "{\"keys\":[{\"kty\":\"RSA\",\"kid\":\"k1\",\"alg\":\"RS256\",\"n\":\"" + n + "\",\"e\":\"" + e + "\"}]}"); return;
                }
                case "/api/accounts/authorize": {
                    Map<String, String> p = q(x.getRequestURI().getRawQuery());
                    lastAuthorizeClientId = p.get("client_id");
                    for (String k : new String[]{"ext_agent_host_id", "code_challenge", "nonce", "state", "resource", "scope", "redirect_uri"}) check(p.get(k) != null, "thiếu " + k);
                    check("S256".equals(p.get("code_challenge_method")), "S256");
                    check(p.get("redirect_uri").startsWith("http://127.0.0.1:") && p.get("redirect_uri").endsWith("/auth/callback"), "redirect_uri loopback");
                    pendingNonce = p.get("nonce");
                    String loc = p.get("redirect_uri") + "?state=" + p.get("state") + (denyConsent ? "&error=access_denied" : "&code=code-xyz&client_id=oaiapp_test");
                    x.getResponseHeaders().set("Location", loc); send(x, 302, null, ""); return;
                }
                case "/api/accounts/oauth/token": {
                    Map<String, String> f = q(body);
                    if ("authorization_code".equals(f.get("grant_type"))) {
                        check(f.get("code_verifier") != null && "oaiapp_test".equals(f.get("client_id")), "đổi code");
                        send(x, 200, "application/json", MiniJson.write(tokenResp(f.get("client_id")))); return;
                    }
                    if ("refresh_token".equals(f.get("grant_type"))) {
                        refreshCount.incrementAndGet();
                        if (refreshRevoked) { send(x, 400, "application/json", "{\"error\":\"invalid_grant\"}"); return; }
                        pendingNonce = null;
                        Map<String, Object> r = tokenResp(f.get("client_id")); r.put("expires_in", 3600L);
                        send(x, 200, "application/json", MiniJson.write(r)); return;
                    }
                    send(x, 400, "application/json", "{\"error\":\"unsupported_grant_type\"}"); return;
                }
                case "/oauth/revoke": send(x, 200, null, ""); return;
                case "/v1/models": send(x, 200, "application/json", "{\"data\":[{\"id\":\"gpt-test\"}]}"); return;
                case "/v1/responses": {
                    String auth = x.getRequestHeaders().getFirst("Authorization");
                    check(auth != null && auth.startsWith("Bearer access-"), "Bearer");
                    Map<String, Object> req = MiniJson.obj(body);
                    check(Boolean.FALSE.equals(req.get("store")) && Boolean.TRUE.equals(req.get("stream")), "store:false stream:true");
                    if (usageLimit) { send(x, 429, "application/json", "{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}"); return; }
                    String sse = "event: response.created\ndata: {\"type\":\"response.created\"}\n\n"
                            + "data: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"ok\\\"\"}\n\n"
                            + "data: {\"type\":\"response.output_text.delta\",\"delta\":\":true}\"}\n\n"
                            + "data: {\"type\":\"response.completed\"}\n\n";
                    send(x, 200, "text/event-stream", sse); return;
                }
                default: send(x, 404, null, "");
            }
        } catch (Throwable e) { logs.add(e.toString()); e.printStackTrace(); try { send(x, 500, null, "err"); } catch (Exception ignored) { } }
    }
    static byte[] strip(byte[] b) { return b.length > 1 && b[0] == 0 ? Arrays.copyOfRange(b, 1, b.length) : b; }
}
