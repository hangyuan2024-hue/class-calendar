package com.laolao.classcalendar;

import java.util.*;
import org.json.*;

/** Explicit website-record adapters, rather than passing a LAN envelope to restoreBackup. */
final class NativeLanRecordAdapter {
  static final String META = "native_lan_meta_v1";
  private final CampusStore store;

  NativeLanRecordAdapter(CampusStore store) {
    this.store = store;
  }

  boolean localMode() {
    return store.bool("native_sync_local", false);
  }

  JSONObject capture() {
    JSONObject data = new JSONObject();
    for (String key : LanRecordCodec.KINDS.keySet()) {
      Object value = store.get(key, null);
      if (value != null) CampusJson.put(data, key, value);
    }
    // Native exams are device records. The desktop's countdown namespace has the same
    // id/title/date.
    // Preserve all extra fields (goals, time, location) so a round trip never loses review
    // progress.
    JSONArray countdowns = mergeExams(new JSONArray(), store.list("native_exams"));
    CampusJson.put(data, "countdown_v1", countdowns);
    return data;
  }

  LanRecordCodec.Scan scan(long now) {
    LanRecordCodec.Scan scan = LanRecordCodec.scan(capture(), store.object(META), localMode(), now);
    store.set(META, scan.meta);
    return scan;
  }

  LanRecordCodec.Merge apply(JSONArray list, long now) {
    LanRecordCodec.Merge merged =
        LanRecordCodec.merge(capture(), store.object(META), list, localMode(), now);
    JSONObject updates = CampusJson.copy(merged.updates);
    if (updates.has("countdown_v1")) {
      CampusJson.put(
          updates,
          "native_exams",
          nativeExams(CampusJson.arr(updates.opt("countdown_v1")), store.list("native_exams")));
      // One authoritative collection: retaining a second mirror would resurrect a native deletion.
      updates.remove("countdown_v1");
    }
    // Validate complete affected namespaces before the single durable write; all other data stays
    // put.
    CampusStore.validateBackup(updates);
    CampusJson.put(updates, META, merged.meta);
    store.batch(updates);
    return merged;
  }

  int localCount() {
    JSONObject data = capture();
    int count = 0;
    for (String key : LanRecordCodec.KINDS.keySet())
      count += LanRecordCodec.records(key, data.opt(key), localMode()).length();
    return count;
  }

  static JSONArray mergeExams(JSONArray web, JSONArray nativeRows) {
    Map<String, JSONObject> records = new LinkedHashMap<>();
    for (JSONObject item : CampusJson.rows(web))
      if (!item.optString("id").isEmpty()) records.put(item.optString("id"), CampusJson.copy(item));
    for (JSONObject item : CampusJson.rows(nativeRows)) {
      String id = item.optString("id");
      if (id.isEmpty()) continue;
      JSONObject combined = records.get(id);
      if (combined == null) combined = new JSONObject();
      for (String key : CampusJson.keys(item)) CampusJson.put(combined, key, item.opt(key));
      CampusJson.put(combined, "local", true);
      records.put(id, combined);
    }
    return new JSONArray(records.values());
  }

  static JSONArray nativeExams(JSONArray incoming, JSONArray oldNative) {
    Map<String, JSONObject> old = new LinkedHashMap<>();
    for (JSONObject item : CampusJson.rows(oldNative)) old.put(item.optString("id"), item);
    JSONArray result = new JSONArray();
    for (JSONObject item : CampusJson.rows(incoming)) {
      JSONObject combined =
          old.containsKey(item.optString("id"))
              ? CampusJson.copy(old.get(item.optString("id")))
              : new JSONObject();
      for (String key : CampusJson.keys(item)) CampusJson.put(combined, key, item.opt(key));
      if (!combined.has("time")) CampusJson.put(combined, "time", "09:00");
      if (combined.optJSONArray("goals") == null)
        CampusJson.put(combined, "goals", new JSONArray());
      result.put(combined);
    }
    return result;
  }
}
