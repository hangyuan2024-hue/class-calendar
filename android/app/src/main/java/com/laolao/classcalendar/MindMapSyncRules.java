package com.laolao.classcalendar;

import java.util.*;
import org.json.*;

/** Optimistic-save acknowledgements must not clear edits made while an HTTP call was in flight. */
final class MindMapSyncRules {
  static JSONObject acknowledge(JSONObject current, long sentEdit, long serverVersion) {
    JSONObject e = CampusJson.copy(current);
    CampusJson.put(e, "version", serverVersion);
    CampusJson.put(e, "server", serverVersion);
    CampusJson.put(e, "local", false);
    CampusJson.put(e, "dirty", e.optLong("edit") != sentEdit);
    return e;
  }

  static JSONArray merge(JSONArray local, JSONArray remote) {
    Map<String, JSONObject> incoming = new LinkedHashMap<>();
    for (JSONObject r : CampusJson.rows(remote)) incoming.put(r.optString("id"), r);
    List<JSONObject> result = new ArrayList<>();
    for (JSONObject row : CampusJson.rows(local)) {
      JSONObject e = CampusJson.copy(row), r = incoming.remove(e.optString("id"));
      if (r == null && !e.optBoolean("local") && !e.optBoolean("dirty") && !e.optBoolean("deleted")) continue;
      if (r != null) {
        CampusJson.put(e, "server", r.optLong("version"));
        if (!e.optBoolean("dirty") && !e.optBoolean("deleted")) {
          CampusJson.put(e, "title", r.optString("title"));
          CampusJson.put(e, "nodes", r.optInt("nodes", 1));
          CampusJson.put(e, "updated_at", r.optString("updated_at"));
        }
      }
      result.add(e);
    }
    for (JSONObject r : incoming.values()) result.add(CampusJson.obj("id", r.optString("id"), "title", r.optString("title"), "nodes", r.optInt("nodes", 1), "version", 0, "server", r.optLong("version"), "updated_at", r.optString("updated_at"), "updated", 0, "local", false, "dirty", false, "edit", 0));
    return new JSONArray(result);
  }
}
