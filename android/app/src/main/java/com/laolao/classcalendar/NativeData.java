package com.laolao.classcalendar;

import android.content.Context;
import java.util.*;
import org.json.*;

/** Independent native records. Backups share the web laboratory schema, never claim cloud sync. */
final class NativeData {
  static final String[] TYPES = {
    "focus", "task", "card", "exam", "review", "expense", "course", "diary", "pack", "stats"
  };

  static String today() {
    return DateMath.today();
  }

  static long days(String date) {
    return DateMath.days(date);
  }

  static JSONObject empty() {
    try {
      return new JSONObject("{\"schema\":1,\"items\":[],\"logs\":[],\"budget\":0,\"timer\":null}");
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static JSONObject load(Context c) {
    String raw = c.getSharedPreferences("native_campus_v1", 0).getString("data", null);
    if (raw == null) return empty();
    try {
      return new JSONObject(raw);
    } catch (Exception e) {
      throw new IllegalStateException("本地记录无法读取，请先导出原始备份再处理。", e);
    }
  }

  static void save(Context c, JSONObject d) {
    if (!c.getSharedPreferences("native_campus_v1", 0)
        .edit()
        .putString("data", d.toString())
        .commit()) throw new IllegalStateException("存储空间不足，记录未保存");
  }

  static List<JSONObject> items(JSONObject d, String type) {
    List<JSONObject> out = new ArrayList<>();
    JSONArray a = d.optJSONArray("items");
    for (int i = 0; i < a.length(); i++) {
      JSONObject x = a.optJSONObject(i);
      if (type.equals(x.optString("type"))) out.add(x);
    }
    return out;
  }

  static void log(JSONObject d, String kind, double n) {
    try {
      JSONObject l = new JSONObject();
      l.put("day", today()).put("kind", kind).put("n", n);
      d.getJSONArray("logs").put(l);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static void add(JSONObject d, JSONObject x) {
    try {
      x.put("id", UUID.randomUUID().toString()).put("done", false);
      d.getJSONArray("items").put(x);
      log(d, "create", 1);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static void remove(JSONObject d, String id) {
    try {
      JSONArray a = d.getJSONArray("items"), keep = new JSONArray();
      for (int i = 0; i < a.length(); i++)
        if (!id.equals(a.getJSONObject(i).optString("id"))) keep.put(a.get(i));
      d.put("items", keep);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static double sum(JSONObject d, String kind) {
    double n = 0;
    JSONArray a = d.optJSONArray("logs");
    for (int i = 0; i < a.length(); i++) {
      JSONObject l = a.optJSONObject(i);
      if (kind.equals(l.optString("kind"))) n += l.optDouble("n", 0);
    }
    return n;
  }

  static void validateItem(JSONObject x) {
    String t = x.optString("type"), title = x.optString("title");
    if (!Arrays.asList(TYPES).contains(t)
        || !(x.opt("title") instanceof String)
        || title.trim().isEmpty()
        || title.length() > 1000
        || !(x.opt("id") instanceof String)
        || !x.optString("id").matches("[a-zA-Z0-9_-]{1,80}"))
      throw new IllegalArgumentException("记录格式无效");
    if (Arrays.asList("task", "exam", "expense", "diary", "card").contains(t))
      DateMath.parse(x.optString("date"));
    if ("task".equals(t)
        && (x.optInt("priority", 0) < 1
            || x.optInt("priority", 0) > 3
            || x.optDouble("priority") != Math.floor(x.optDouble("priority"))))
      throw new IllegalArgumentException("优先级请输入1到3");
    if ("course".equals(t)) {
      if (x.optInt("weekday", 0) < 1
          || x.optInt("weekday", 0) > 7
          || x.optDouble("weekday") != Math.floor(x.optDouble("weekday")))
        throw new IllegalArgumentException("星期请输入1到7");
      DateMath.time(x.optString("time"));
    }
    if ("expense".equals(t)
        && (!Double.isFinite(x.optDouble("amount")) || x.optDouble("amount") <= 0))
      throw new IllegalArgumentException("金额必须大于0");
    if ("card".equals(t)
        && (!(x.opt("answer") instanceof String)
            || x.optString("answer").trim().isEmpty()
            || x.optInt("level", 0) < 0
            || x.optInt("level", 0) > 5
            || x.optDouble("level") != Math.floor(x.optDouble("level"))))
      throw new IllegalArgumentException("晶片格式无效");
  }

  static JSONObject backup(String raw) throws Exception {
    if (raw.length() > 2000000) throw new IllegalArgumentException("备份不能超过2MB");
    JSONObject d = new JSONObject(raw);
    JSONArray a = d.getJSONArray("items"), logs = d.getJSONArray("logs");
    if (d.optInt("schema") != 1 || a.length() > 5000 || logs.length() > 20000)
      throw new IllegalArgumentException("备份格式无效");
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < a.length(); i++) {
      JSONObject x = a.getJSONObject(i);
      validateItem(x);
      if (!ids.add(x.getString("id"))) throw new IllegalArgumentException("备份包含重复记录");
    }
    for (int i = 0; i < logs.length(); i++) {
      JSONObject l = logs.getJSONObject(i);
      DateMath.parse(l.getString("day"));
      if (!(l.opt("kind") instanceof String)
          || !Double.isFinite(l.getDouble("n"))
          || l.getDouble("n") < 0) throw new IllegalArgumentException("统计记录无效");
    }
    double budget = d.optDouble("budget", 0);
    if (!Double.isFinite(budget) || budget < 0) throw new IllegalArgumentException("预算无效");
    d.put("timer", JSONObject.NULL);
    return d;
  }
}
