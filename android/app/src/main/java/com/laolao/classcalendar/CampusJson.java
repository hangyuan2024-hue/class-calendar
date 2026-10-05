package com.laolao.classcalendar;

import java.util.*;
import org.json.*;

/** JSON helpers shared by the native screens and the documented website RPC contract. */
final class CampusJson {
  static String join(String separator, Iterable<String> values) {
    StringBuilder result = new StringBuilder();
    boolean first = true;
    for (String value : values) {
      if (!first) result.append(separator);
      result.append(value);
      first = false;
    }
    return result.toString();
  }

  static java.util.Set<String> keys(JSONObject x) {
    java.util.Set<String> result = new java.util.LinkedHashSet<>();
    if (x != null) {
      java.util.Iterator<String> it = x.keys();
      while (it.hasNext()) result.add(it.next());
    }
    return result;
  }

  static JSONObject obj(Object... values) {
    JSONObject o = new JSONObject();
    try {
      for (int i = 0; i < values.length; i += 2)
        o.put(String.valueOf(values[i]), values[i + 1] == null ? JSONObject.NULL : values[i + 1]);
    } catch (JSONException e) {
      throw new IllegalArgumentException(e);
    }
    return o;
  }

  static void put(JSONObject o, String k, Object v) {
    try {
      o.put(k, v == null ? JSONObject.NULL : v);
    } catch (JSONException e) {
      throw new IllegalArgumentException(e);
    }
  }

  static JSONObject copy(JSONObject o) {
    try {
      return new JSONObject(o.toString());
    } catch (JSONException e) {
      throw new IllegalArgumentException(e);
    }
  }

  static JSONArray arr(Object v) {
    return v instanceof JSONArray ? (JSONArray) v : new JSONArray();
  }

  static JSONObject object(Object v) {
    return v instanceof JSONObject ? (JSONObject) v : new JSONObject();
  }

  static List<JSONObject> rows(Object v) {
    List<JSONObject> out = new ArrayList<>();
    JSONArray a = arr(v);
    for (int i = 0; i < a.length(); i++)
      if (a.optJSONObject(i) != null) out.add(a.optJSONObject(i));
    return out;
  }

  static JSONArray array(Collection<?> v) {
    return new JSONArray(v);
  }

  static String id() {
    return UUID.randomUUID().toString();
  }

  static String s(JSONObject o, String k) {
    return o == null ? "" : o.optString(k, "");
  }

  static Object nullable(String s) {
    return s == null || s.trim().isEmpty() ? JSONObject.NULL : s;
  }

  static Object numericId(Object o) {
    String s = String.valueOf(o);
    try {
      return Long.parseLong(s);
    } catch (Exception e) {
      return o;
    }
  }

  static String enc(String s) {
    try {
      return java.net.URLEncoder.encode(s, "UTF-8");
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }

  static String date(String s) {
    if (s == null || s.length() < 10) return "";
    String d = s.substring(0, 10);
    try {
      DateMath.parse(d);
      return d;
    } catch (Exception e) {
      return "";
    }
  }

  static long at(String day, String time) {
    int[] d = DateMath.parts(day),
        t = DateMath.time(time == null || time.isEmpty() ? "23:59" : time);
    Calendar c = Calendar.getInstance();
    c.set(d[0], d[1] - 1, d[2], t[0], t[1], 0);
    c.set(Calendar.MILLISECOND, 0);
    return c.getTimeInMillis();
  }

  static void eventTime(String value) {
    if (!value.matches("\\d{4}-\\d{2}-\\d{2}([ T]\\d{2}:\\d{2})?"))
      throw new IllegalArgumentException("事项时间格式错误");
    DateMath.parse(value.substring(0, 10));
    if (value.length() > 10) DateMath.time(value.substring(11));
  }
}
