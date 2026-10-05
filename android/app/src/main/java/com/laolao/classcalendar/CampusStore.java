package com.laolao.classcalendar;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.*;
import org.json.*;

/** Account-isolated records, durable outbox, and the website's per-record timestamp sync schema. */
final class CampusStore {
  static final Map<String, String> KINDS = new LinkedHashMap<>();

  static {
    String[] lists = {"personal_events_v1", "habits_v1", "quad_todos_v1"},
        maps =
            {
              "personal_marks_v1",
              "done_log_v1",
              "quad_v1",
              "pomo_log_v1",
              "plan_notes_v1",
              "mood_log_v1"
            },
        ones =
            {
              "fun_opts_v1",
              "home_layout_v1",
              "ui_skin_v1",
              "ui_palette_v1",
              "plugins_enabled_v1",
              "profile_v1",
              "farm_v1",
              "island_v1"
            };
    for (String s : lists) KINDS.put(s, "list");
    for (String s : maps) KINDS.put(s, "map");
    for (String s : ones) KINDS.put(s, "one");
    KINDS.put("habit_log_v1", "map2");
  }

  final String owner;
  private final SharedPreferences prefs;
  private static final Object LOCK = new Object();
  private static final Map<String, Memory> RECORDS = new HashMap<>();

  private static final class Memory {
    JSONObject value;

    Memory(JSONObject value) {
      this.value = value;
    }
  }

  private final Memory memory;

  CampusStore(Context c, String owner) {
    this.owner = owner;
    prefs = c.getSharedPreferences("campus_v4_" + owner, 0);
    synchronized (LOCK) {
      String key = c.getPackageName() + ":" + owner;
      Memory existing = RECORDS.get(key);
      if (existing == null) {
        try {
          JSONObject parsed =
              new JSONObject(
                  prefs.getString(
                      "data", "{\"data\":{},\"clock\":{},\"pending\":{},\"revision\":0}"));
          if (parsed.optJSONObject("data") == null
              || parsed.optJSONObject("clock") == null
              || parsed.optJSONObject("pending") == null)
            throw new IllegalArgumentException("数据结构损坏");
          existing = new Memory(parsed);
          RECORDS.put(key, existing);
        } catch (Exception e) {
          throw new IllegalStateException("本地学习记录读取失败，请先备份设备数据", e);
        }
      }
      memory = existing;
    }
  }

  Object get(String k, Object fallback) {
    synchronized (LOCK) {
      Object v = memory.value.optJSONObject("data").opt(k);
      if (v == null || v == JSONObject.NULL) return fallback;
      if (v instanceof JSONObject) return CampusJson.copy((JSONObject) v);
      if (v instanceof JSONArray) {
        try {
          return new JSONArray(v.toString());
        } catch (JSONException e) {
          throw new IllegalStateException(e);
        }
      }
      return v;
    }
  }

  JSONObject object(String k) {
    synchronized (LOCK) {
      return CampusJson.copy(CampusJson.object(get(k, null)));
    }
  }

  JSONArray list(String k) {
    synchronized (LOCK) {
      try {
        return new JSONArray(CampusJson.arr(get(k, null)).toString());
      } catch (Exception e) {
        throw new IllegalStateException(e);
      }
    }
  }

  String string(String k, String def) {
    synchronized (LOCK) {
      Object v = get(k, def);
      return String.valueOf(v);
    }
  }

  boolean bool(String k, boolean def) {
    synchronized (LOCK) {
      Object v = get(k, def);
      return v instanceof Boolean ? (Boolean) v : def;
    }
  }

  int number(String k, int def) {
    synchronized (LOCK) {
      Object v = get(k, def);
      return v instanceof Number ? ((Number) v).intValue() : def;
    }
  }

  private void commit(JSONObject next) {
    if (!prefs.edit().putString("data", next.toString()).commit())
      throw new IllegalStateException("记录未保存，请检查设备存储空间");
    memory.value = CampusJson.copy(next);
  }

  void set(String key, Object value) {
    synchronized (LOCK) {
      batch(CampusJson.obj(key, value));
    }
  }

  void batch(JSONObject updates) {
    synchronized (LOCK) {
      JSONObject next = CampusJson.copy(memory.value), data = next.optJSONObject("data");
      for (String key : CampusJson.keys(updates)) {
        Object value = updates.opt(key), old = data.opt(key);
        CampusJson.put(data, key, value);
        if (KINDS.containsKey(key)) {
          JSONObject before = explode(key, old),
              after = explode(key, value),
              times = next.optJSONObject("clock").optJSONObject(key);
          if (times == null) {
            times = new JSONObject();
            CampusJson.put(next.optJSONObject("clock"), key, times);
          }
          Set<String> ids = new HashSet<>(CampusJson.keys(before));
          ids.addAll(CampusJson.keys(after));
          for (String id : ids) {
            Object a = before.opt(id), b = after.opt(id);
            if (String.valueOf(a).equals(String.valueOf(b))) continue;
            long stamp = Math.max(System.currentTimeMillis(), times.optLong(id) + 1);
            CampusJson.put(times, id, stamp);
            CampusJson.put(
                next.optJSONObject("pending"),
                key + "\u0001" + id,
                CampusJson.obj("ns", key, "k", id, "v", b, "t", stamp));
          }
        }
      }
      commit(next);
    }
  }

  void entry(String key, String id, Object value) {
    synchronized (LOCK) {
      JSONObject map = object(key);
      if (value == null) map.remove(id);
      else CampusJson.put(map, id, value);
      set(key, map);
    }
  }

  void add(String key, JSONObject item) {
    synchronized (LOCK) {
      JSONArray a = list(key);
      a.put(item);
      set(key, a);
    }
  }

  void replace(String key, String id, JSONObject item) {
    synchronized (LOCK) {
      JSONArray a = list(key), out = new JSONArray();
      boolean found = false;
      for (int i = 0; i < a.length(); i++) {
        JSONObject x = a.optJSONObject(i);
        if (x != null && id.equals(x.optString("id"))) {
          if (item != null) out.put(item);
          found = true;
        } else out.put(a.opt(i));
      }
      if (!found && item != null) out.put(item);
      set(key, out);
    }
  }

  static JSONObject explode(String key, Object value) {
    JSONObject out = new JSONObject();
    String type = KINDS.get(key);
    if ("one".equals(type)) {
      if (value != null && value != JSONObject.NULL) CampusJson.put(out, "_", value);
    } else if ("list".equals(type)) {
      for (JSONObject x : CampusJson.rows(value))
        if (x.has("id") && !x.optBoolean("local")) CampusJson.put(out, x.optString("id"), x);
    } else if (value instanceof JSONObject) {
      JSONObject m = (JSONObject) value;
      for (String id : CampusJson.keys(m)) {
        if ("map2".equals(type)) {
          JSONObject child = m.optJSONObject(id);
          if (child != null)
            for (String date : CampusJson.keys(child))
              CampusJson.put(out, id + "\u0001" + date, child.opt(date));
        } else CampusJson.put(out, id, m.opt(id));
      }
    }
    return out;
  }

  static Object implode(String key, JSONObject records, Object old) {
    String type = KINDS.get(key);
    if ("one".equals(type)) return records.opt("_");
    if ("list".equals(type)) {
      JSONArray out = new JSONArray();
      Set<String> seen = new HashSet<>();
      for (JSONObject x : CampusJson.rows(old)) {
        String id = x.optString("id");
        if (x.optBoolean("local")) out.put(x);
        else if (records.has(id) && seen.add(id)) out.put(records.opt(id));
      }
      List<String> ids = new ArrayList<>(CampusJson.keys(records));
      Collections.sort(ids);
      for (String id : ids) if (seen.add(id)) out.put(records.opt(id));
      return out;
    }
    if ("map2".equals(type)) {
      JSONObject out = new JSONObject();
      for (String id : CampusJson.keys(records)) {
        String[] p = id.split("\u0001", 2);
        if (p.length != 2) continue;
        JSONObject sub = out.optJSONObject(p[0]);
        if (sub == null) {
          sub = new JSONObject();
          CampusJson.put(out, p[0], sub);
        }
        CampusJson.put(sub, p[1], records.opt(id));
      }
      return out;
    }
    return records;
  }

  int pending() {
    synchronized (LOCK) {
      return memory.value.optJSONObject("pending").length();
    }
  }

  void queueGrowth(String cid, String kind, String reference, boolean undo) {
    if (owner.equals("guest")) return;
    entry(
        "native_growth_queue",
        cid + "|" + kind + "|" + reference,
        CampusJson.obj(
            "cid", cid, "k", kind, "r", reference, "undo", undo, "stamp", CampusJson.id()));
  }

  void syncGrowth(CampusApi api) throws Exception {
    if (owner.equals("guest") || bool("native_sync_local", false) || !owner.equals(api.uid()))
      return;
    JSONObject queue = object("native_growth_queue");
    for (String key : CampusJson.keys(queue)) {
      if (!owner.equals(api.uid())) return;
      JSONObject event = queue.optJSONObject(key);
      if (event == null) continue;
      JSONObject args = CampusJson.copy(event);
      args.remove("stamp");
      api.rpc("growth_log", args);
      synchronized (LOCK) {
        JSONObject current = object("native_growth_queue").optJSONObject(key);
        if (current != null && current.optString("stamp").equals(event.optString("stamp")))
          entry("native_growth_queue", key, null);
      }
    }
  }

  static boolean deviceState(String k) {
    return Arrays.asList(
            "native_quiet",
            "native_diary_lock",
            "native_pomo_timer",
            "native_growth_queue",
            "native_ocr_job",
            "native_ingest_job",
            "native_device_error",
            "native_location",
            "native_class_id")
        .contains(k);
  }

  void sync(CampusApi api) throws Exception {
    if (owner.equals("guest") || bool("native_sync_local", false) || !owner.equals(api.uid()))
      return;
    for (int guard = 0; guard < 50; guard++) {
      long revision;
      synchronized (LOCK) {
        revision = memory.value.optLong("revision");
      }
      if (!owner.equals(api.uid())) return;
      JSONObject response =
          CampusJson.object(api.rpc("udata_pull", CampusJson.obj("since", revision)));
      synchronized (LOCK) {
        JSONObject next = CampusJson.copy(memory.value),
            data = next.optJSONObject("data"),
            clocks = next.optJSONObject("clock"),
            pending = next.optJSONObject("pending");
        Map<String, JSONObject> records = new HashMap<>();
        for (JSONObject row : CampusJson.rows(response.opt("rows"))) {
          String ns = row.optString("ns"), id = row.optString("k");
          if (!KINDS.containsKey(ns)) continue;
          JSONObject times = clocks.optJSONObject(ns);
          if (times == null) {
            times = new JSONObject();
            CampusJson.put(clocks, ns, times);
          }
          long stamp = row.optLong("t");
          if (times.optLong(id) >= stamp) continue;
          JSONObject recs = records.get(ns);
          if (recs == null) {
            recs = explode(ns, data.opt(ns));
            records.put(ns, recs);
          }
          CampusJson.put(times, id, stamp);
          Object v = row.opt("v");
          if (v == null || v == JSONObject.NULL) recs.remove(id);
          else CampusJson.put(recs, id, v);
          JSONObject queued = pending.optJSONObject(ns + "\u0001" + id);
          if (queued != null && queued.optLong("t") <= stamp) pending.remove(ns + "\u0001" + id);
        }
        for (String ns : records.keySet())
          CampusJson.put(data, ns, implode(ns, records.get(ns), data.opt(ns)));
        CampusJson.put(
            next,
            "revision",
            Math.max(next.optLong("revision"), response.optLong("rev", revision)));
        commit(next);
      }
      if (!response.optBoolean("more")) break;
    }
    for (int guard = 0; guard < 100; guard++) {
      JSONArray batch = new JSONArray();
      synchronized (LOCK) {
        for (String key : CampusJson.keys(memory.value.optJSONObject("pending"))) {
          batch.put(memory.value.optJSONObject("pending").opt(key));
          if (batch.length() == 300) break;
        }
      }
      if (batch.length() == 0 || !owner.equals(api.uid())) break;
      api.rpc("udata_push", CampusJson.obj("p", batch));
      synchronized (LOCK) {
        JSONObject next = CampusJson.copy(memory.value), pending = next.optJSONObject("pending");
        for (JSONObject row : CampusJson.rows(batch)) {
          String key = row.optString("ns") + "\u0001" + row.optString("k");
          JSONObject current = pending.optJSONObject(key);
          if (current != null && current.optLong("t") == row.optLong("t")) pending.remove(key);
        }
        commit(next);
      }
    }
    set("native_last_sync", System.currentTimeMillis());
  }

  JSONObject backup() {
    synchronized (LOCK) {
      JSONObject data = CampusJson.copy(memory.value.optJSONObject("data"));
      for (String k : new ArrayList<>(CampusJson.keys(data)))
        if (k.startsWith("cache_")
            || k.startsWith("draft_")
            || k.startsWith("native_last")
            || deviceState(k)) data.remove(k);
      return CampusJson.obj(
          "format",
          "laolao-native-v4",
          "schema",
          4,
          "exportedAt",
          System.currentTimeMillis(),
          "data",
          data);
    }
  }

  void restore(String raw) throws Exception {
    synchronized (LOCK) {
      if (raw.getBytes("UTF-8").length > 32000000) throw new IllegalArgumentException("备份超过32MB");
      JSONObject backup = new JSONObject(raw);
      if (backup.optInt("schema") != 4
          || !"laolao-native-v4".equals(backup.optString("format"))
          || backup.optJSONObject("data") == null)
        throw new IllegalArgumentException("不是完整原生版学习备份");
      JSONObject incoming = CampusJson.copy(backup.getJSONObject("data"));
      validateBackup(incoming);
      for (String k : CampusJson.keys(incoming)) {
        if (k.contains("token")
            || (k.contains("session") && !k.equals("native_focus_sessions"))
            || k.startsWith("cache_")
            || k.startsWith("draft_")
            || deviceState(k)
            || k.length() > 160) throw new IllegalArgumentException("备份包含不应导入的登录、缓存或设备状态");
        String type = KINDS.get(k);
        Object v = incoming.opt(k);
        if (("list".equals(type) && !(v instanceof JSONArray))
            || (("map".equals(type) || "map2".equals(type)) && !(v instanceof JSONObject)))
          throw new IllegalArgumentException("备份数据类型错误：" + k);
      }
      JSONObject next = CampusJson.copy(memory.value),
          data = next.getJSONObject("data"),
          old = CampusJson.copy(data);
      for (String k : new ArrayList<>(CampusJson.keys(data)))
        if (!k.startsWith("cache_")
            && !k.startsWith("draft_")
            && !k.startsWith("native_last")
            && !deviceState(k)) data.remove(k);
      for (String k : CampusJson.keys(incoming)) CampusJson.put(data, k, incoming.opt(k));
      // Import is atomic and deliberately local until the user enables cloud synchronisation.
      CampusJson.put(data, "native_sync_local", true);
      if (incoming.has(CampusCourses.COURSES)) CampusJson.put(data, "native_courses_dirty", true);
      JSONObject pending = CampusJson.copy(next.getJSONObject("pending"));
      CampusJson.put(next, "pending", pending);
      for (String k : KINDS.keySet()) {
        JSONObject before = explode(k, old.opt(k)), after = explode(k, data.opt(k));
        Set<String> ids = new HashSet<>(CampusJson.keys(before));
        ids.addAll(CampusJson.keys(after));
        JSONObject times = next.getJSONObject("clock").optJSONObject(k);
        if (times == null) {
          times = new JSONObject();
          CampusJson.put(next.getJSONObject("clock"), k, times);
        }
        for (String id : ids)
          if (!String.valueOf(before.opt(id)).equals(String.valueOf(after.opt(id)))) {
            long t = Math.max(System.currentTimeMillis(), times.optLong(id) + 1);
            CampusJson.put(times, id, t);
            CampusJson.put(
                pending,
                k + "\u0001" + id,
                CampusJson.obj("ns", k, "k", id, "v", after.opt(id), "t", t));
          }
      }
      commit(next);
    }
  }

  static void validateBackup(JSONObject data) {
    validateTree(data, 0);
    String[] lists = {
      "personal_events_v1",
      "habits_v1",
      "quad_todos_v1",
      CampusCourses.COURSES,
      "native_exams",
      "native_ledger",
      "native_wrong",
      "native_cards",
      "native_pack",
      "native_contacts",
      "native_places",
      "native_recordings",
      "native_focus_sessions",
      "native_inbox",
      "native_reminders"
    };
    for (String key : lists)
      if (data.has(key)) {
        JSONArray rows = data.optJSONArray(key);
        if (rows == null) throw new IllegalArgumentException("清单格式错误：" + key);
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
          JSONObject x = rows.optJSONObject(i);
          if (x == null || x.optString("id").isEmpty() || !ids.add(x.optString("id")))
            throw new IllegalArgumentException("记录编号缺失或重复：" + key);
          for (String date : new String[] {"date", "due"}) {
            String d = x.optString(date);
            if (!d.isEmpty()) DateMath.parse(d);
          }
          if (Arrays.asList("native_exams", "native_ledger", "native_wrong").contains(key))
            DateMath.parse(x.optString("date"));
          if (Arrays.asList("native_cards", "native_wrong").contains(key))
            DateMath.parse(x.optString("due"));
          if (key.equals("native_focus_sessions")) {
            DateMath.parse(x.optString("day"));
            if (x.optInt("minutes", -1) < 1 || x.optInt("minutes") > 180)
              throw new IllegalArgumentException("专注时长格式错误");
          }
          if (key.equals("native_ledger")
              && (x.optLong("cents", -1) < 0 || x.optLong("cents") > 10000000000L))
            throw new IllegalArgumentException("金额格式错误");
          if (key.equals("personal_events_v1") && !x.optString("event_time").isEmpty())
            CampusJson.eventTime(x.optString("event_time"));
        }
      }
    String[] maps = {
      "native_diary",
      "native_budgets",
      "native_frogs",
      "native_word_progress",
      "native_word_days",
      "native_pomo_config",
      "native_courses_meta"
    };
    for (String key : maps)
      if (data.has(key) && data.optJSONObject(key) == null)
        throw new IllegalArgumentException("数据格式错误：" + key);
    for (String key : new String[] {"native_diary_day", "native_frog_day", "native_ivy_day"})
      if (data.has(key)) DateMath.parse(data.optString(key));
    if (data.has("native_ledger_month"))
      DateMath.parse(data.optString("native_ledger_month") + "-01");
    JSONObject diary = data.optJSONObject("native_diary");
    if (diary != null)
      for (String day : CampusJson.keys(diary)) {
        DateMath.parse(day);
        if (diary.optJSONObject(day) == null) throw new IllegalArgumentException("日记格式错误");
      }
    JSONObject timer = data.optJSONObject("native_pomo_config");
    if (timer != null) {
      for (String key : new String[] {"focus", "break", "longBreak", "every"})
        if (timer.has(key)) {
          int value = timer.optInt(key);
          if (value < (key.equals("every") ? 2 : 1)
              || value > (key.equals("focus") ? 180 : key.equals("every") ? 12 : 60))
            throw new IllegalArgumentException("计时设置范围无效");
        }
    }
    if (data.has("plugins_enabled_v1") && data.optJSONArray("plugins_enabled_v1") == null)
      throw new IllegalArgumentException("工具开关格式错误");
    JSONObject notes = data.optJSONObject("plan_notes_v1");
    if (notes != null)
      for (String key : CampusJson.keys(notes)) {
        if (key.startsWith("pdca:")) {
          JSONObject x = notes.optJSONObject(key);
          if (x == null || x.optInt("stage", -1) < 0 || x.optInt("stage") > 3)
            throw new IllegalArgumentException("PDCA 阶段格式错误");
        }
      }
    if (data.has(CampusCourses.COURSES) || data.has(CampusCourses.META)) {
      JSONObject m = data.optJSONObject(CampusCourses.META);
      if (m == null)
        m =
            CampusJson.obj(
                "week1",
                "2026-09-14",
                "times",
                new JSONArray(Arrays.asList(CampusCourses.SUMMER)),
                "ics",
                true);
      CampusCourses.validateMeta(m);
      JSONArray rows = data.optJSONArray(CampusCourses.COURSES);
      if (rows != null) for (JSONObject x : CampusJson.rows(rows)) CampusCourses.validate(x, m);
    }
  }

  private static void validateTree(Object value, int depth) {
    if (depth > 24) throw new IllegalArgumentException("备份层级过深");
    if (value instanceof JSONObject) {
      JSONObject o = (JSONObject) value;
      if (o.length() > 100000) throw new IllegalArgumentException("备份记录过多");
      for (String key : CampusJson.keys(o)) {
        if (key.length() > 200) throw new IllegalArgumentException("备份字段过长");
        validateTree(o.opt(key), depth + 1);
      }
    } else if (value instanceof JSONArray) {
      JSONArray a = (JSONArray) value;
      if (a.length() > 100000) throw new IllegalArgumentException("备份记录过多");
      for (int i = 0; i < a.length(); i++) validateTree(a.opt(i), depth + 1);
    } else if (value instanceof String && ((String) value).length() > 2000000)
      throw new IllegalArgumentException("单条记录过大");
  }
}
