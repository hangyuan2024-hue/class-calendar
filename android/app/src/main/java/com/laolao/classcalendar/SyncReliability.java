package com.laolao.classcalendar;

import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Pure protocol checks shared by native persistence and regression tests. */
final class SyncReliability {
  private static long serverMillis, sampledNanos;
  static synchronized void calibrate(long server, long requestMillis) {
    if (server <= 0 || requestMillis < 0 || requestMillis > 30000) return;
    serverMillis = server + requestMillis / 2;
    sampledNanos = System.nanoTime();
  }
  static synchronized long now() {
    if (serverMillis == 0) return System.currentTimeMillis();
    return serverMillis + TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - sampledNanos);
  }
  static long stamp(long now, long previous) {
    if (previous == Long.MAX_VALUE) throw new IllegalStateException("同步时间戳异常，请先导出备份");
    return Math.max(now, previous + 1);
  }
  static JSONObject pull(Object raw, long since) {
    if (!(raw instanceof JSONObject)) throw new IllegalStateException("同步响应不完整，未更新本地进度");
    JSONObject r = (JSONObject) raw;
    if (!(r.opt("rows") instanceof JSONArray) || !(r.opt("rev") instanceof Number)
        || r.optLong("rev") < since || (r.optBoolean("more") && r.optLong("rev") <= since))
      throw new IllegalStateException("同步进度无效，保留本地数据并等待重试");
    for (Object value : CampusJson.rows(r.opt("rows"))) {
      JSONObject row = (JSONObject) value;
      if (row.optString("ns").isEmpty() || row.optString("k").isEmpty()
          || !(row.opt("t") instanceof Number) || row.optLong("t") <= 0 || !row.has("v"))
        throw new IllegalStateException("同步记录不完整，保留本地数据");
    }
    if (CampusJson.rows(r.opt("rows")).size() != ((JSONArray) r.opt("rows")).length())
      throw new IllegalStateException("同步记录格式错误");
    return r;
  }
  static boolean acknowledged(JSONObject current, JSONObject sent) {
    return current != null && current.optLong("t") == sent.optLong("t")
        && String.valueOf(current.opt("v")).equals(String.valueOf(sent.opt("v")));
  }
}