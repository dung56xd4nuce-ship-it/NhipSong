package vn.nhipsong.app.siwc;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Bộ đọc/ghi JSON tối giản, thuần Java (để lõi kiểm thử được ngoài Android). */
public final class MiniJson {
    private final String s;
    private int i;

    private MiniJson(String s) { this.s = s; }

    public static Object parse(String text) {
        MiniJson p = new MiniJson(text);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i != p.s.length()) throw new IllegalArgumentException("JSON thừa ký tự");
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(String text) {
        Object o = parse(text);
        if (!(o instanceof Map)) throw new IllegalArgumentException("JSON không phải object");
        return (Map<String, Object>) o;
    }

    private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

    private Object value() {
        if (i >= s.length()) throw new IllegalArgumentException("JSON kết thúc sớm");
        char c = s.charAt(i);
        switch (c) {
            case '{': return object();
            case '[': return array();
            case '"': return string();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default: return number();
        }
    }

    private void expect(String w) {
        if (!s.startsWith(w, i)) throw new IllegalArgumentException("JSON sai tại " + i);
        i += w.length();
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++; ws();
        if (s.charAt(i) == '}') { i++; return m; }
        while (true) {
            ws(); String k = string(); ws();
            if (s.charAt(i++) != ':') throw new IllegalArgumentException("Thiếu ':'");
            ws(); m.put(k, value()); ws();
            char c = s.charAt(i++);
            if (c == '}') return m;
            if (c != ',') throw new IllegalArgumentException("Thiếu ','");
        }
    }

    private List<Object> array() {
        List<Object> a = new ArrayList<>();
        i++; ws();
        if (s.charAt(i) == ']') { i++; return a; }
        while (true) {
            ws(); a.add(value()); ws();
            char c = s.charAt(i++);
            if (c == ']') return a;
            if (c != ',') throw new IllegalArgumentException("Thiếu ','");
        }
    }

    private String string() {
        if (s.charAt(i) != '"') throw new IllegalArgumentException("Thiếu chuỗi");
        i++;
        StringBuilder b = new StringBuilder();
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c == '\\') {
                char e = s.charAt(i++);
                switch (e) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                    default: b.append(e);
                }
            } else b.append(c);
        }
    }

    private Object number() {
        int st = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        String n = s.substring(st, i);
        if (n.isEmpty()) throw new IllegalArgumentException("JSON sai tại " + st);
        if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
        long l = Long.parseLong(n);
        return l;
    }

    // ---------- ghi ----------
    public static String write(Object v) { StringBuilder b = new StringBuilder(); w(b, v); return b.toString(); }

    @SuppressWarnings("unchecked")
    private static void w(StringBuilder b, Object v) {
        if (v == null) b.append("null");
        else if (v instanceof String) quote(b, (String) v);
        else if (v instanceof Number || v instanceof Boolean) b.append(v);
        else if (v instanceof Map) {
            b.append('{'); boolean first = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) v).entrySet()) {
                if (!first) b.append(','); first = false;
                quote(b, e.getKey()); b.append(':'); w(b, e.getValue());
            }
            b.append('}');
        } else if (v instanceof List) {
            b.append('['); boolean first = true;
            for (Object o : (List<Object>) v) { if (!first) b.append(','); first = false; w(b, o); }
            b.append(']');
        } else quote(b, v.toString());
    }

    private static void quote(StringBuilder b, String s) {
        b.append('"');
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        b.append('"');
    }

    public static String str(Map<String, Object> m, String k) { Object o = m.get(k); return o instanceof String ? (String) o : null; }
    public static long num(Map<String, Object> m, String k, long def) { Object o = m.get(k); return o instanceof Number ? ((Number) o).longValue() : def; }
}
