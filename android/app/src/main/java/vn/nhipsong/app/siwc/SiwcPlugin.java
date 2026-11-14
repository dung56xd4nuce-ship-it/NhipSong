package vn.nhipsong.app.siwc;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Cầu nối Capacitor cho Sign in with ChatGPT. Giao diện web chỉ nhận trạng thái và văn bản trả lời,
 * không bao giờ nhận access/refresh token.
 */
@CapacitorPlugin(name = "Siwc")
public class SiwcPlugin extends Plugin {
    private SiwcCore core;
    private final ExecutorService authExec = Executors.newSingleThreadExecutor();
    private final ExecutorService aiExec = Executors.newSingleThreadExecutor(); // tuần tự ⇒ không gửi trùng
    private final AtomicBoolean cancelAuth = new AtomicBoolean(false);
    private final AtomicBoolean cancelAi = new AtomicBoolean(false);

    @Override
    public void load() {
        Context ctx = getContext().getApplicationContext();
        final SharedPreferences p = ctx.getSharedPreferences("nhip_siwc", Context.MODE_PRIVATE);
        SiwcCore.Config cfg = new SiwcCore.Config();
        cfg.appName = "Nhip Song";
        core = new SiwcCore(cfg, new KeystoreSecretStore(ctx), new SiwcCore.Prefs() {
            public String get(String k) { return p.getString(k, null); }
            public void put(String k, String v) { p.edit().putString(k, v).apply(); }
        });
    }

    private static JSObject js(Map<String, Object> m) {
        JSObject o = new JSObject();
        for (Map.Entry<String, Object> e : m.entrySet()) {
            Object v = e.getValue();
            if (v instanceof List) { JSArray a = new JSArray(); for (Object x : (List<?>) v) a.put(x); o.put(e.getKey(), a); }
            else o.put(e.getKey(), v);
        }
        return o;
    }

    private static void fail(PluginCall call, SiwcCore.SiwcException e) {
        JSObject data = new JSObject();
        data.put("retryable", e.retryable);
        data.put("status", e.status);
        call.reject(e.getMessage(), e.code, data);
    }

    @PluginMethod
    public void status(PluginCall call) { authExec.execute(() -> call.resolve(js(core.status()))); }

    @PluginMethod
    public void connect(PluginCall call) {
        cancelAuth.set(false);
        authExec.execute(() -> {
            try {
                Map<String, Object> st = core.connect(url -> {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addCategory(Intent.CATEGORY_BROWSABLE);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                }, cancelAuth);
                call.resolve(js(st));
            } catch (SiwcCore.SiwcException e) { fail(call, e); }
            catch (Exception e) { call.reject("Lỗi không mong đợi khi kết nối.", "unexpected"); }
        });
    }

    @PluginMethod
    public void cancelConnect(PluginCall call) { cancelAuth.set(true); call.resolve(); }

    @PluginMethod
    public void disconnect(PluginCall call) { authExec.execute(() -> call.resolve(js(core.disconnect()))); }

    @PluginMethod
    public void listModels(PluginCall call) {
        aiExec.execute(() -> {
            try {
                JSArray a = new JSArray();
                for (String id : core.listModels()) a.put(id);
                JSObject o = new JSObject(); o.put("models", a); call.resolve(o);
            } catch (SiwcCore.SiwcException e) { fail(call, e); }
            catch (Exception e) { call.reject("Lỗi không mong đợi.", "unexpected"); }
        });
    }

    @PluginMethod
    public void respond(PluginCall call) {
        final String model = call.getString("model");
        final String instructions = call.getString("instructions");
        final String input = call.getString("input");
        if (input == null || input.length() > 200_000) { call.reject("Nội dung gửi AI không hợp lệ.", "invalid_request"); return; }
        cancelAi.set(false);
        aiExec.execute(() -> {
            try {
                String text = core.respond(model, instructions, input, cancelAi);
                JSObject o = new JSObject(); o.put("text", text); call.resolve(o);
            } catch (SiwcCore.SiwcException e) { fail(call, e); }
            catch (Exception e) { call.reject("Lỗi không mong đợi.", "unexpected"); }
        });
    }

    @PluginMethod
    public void cancelRespond(PluginCall call) { cancelAi.set(true); call.resolve(); }
}
