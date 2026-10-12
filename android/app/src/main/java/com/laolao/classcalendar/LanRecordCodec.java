package com.laolao.classcalendar;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** The website's cc-lan wire format. No backup, session, cloud outbox or native device data. */
final class LanRecordCodec {
  static final String SEP = "\u0001";
  static final int CHUNK_CHARS = 60000;
  static final int MAX_MESSAGE_BYTES = 16000000;
  static final int MAX_ROWS = 20000;
  static final Map<String, String> KINDS;

  static {
    Map<String, String> kinds = new LinkedHashMap<>();
    for (String key :
        new String[] {"personal_events_v1", "habits_v1", "quad_todos_v1", "countdown_v1"})
      kinds.put(key, "list");
    for (String key :
        new String[] {
          "course_view_v1",
          "personal_marks_v1",
          "done_log_v1",
          "quad_v1",
          "pomo_log_v1",
          "plan_notes_v1",
          "mood_log_v1"
        }) kinds.put(key, "map");
    kinds.put("habit_log_v1", "map2");
    for (String key :
        new String[] {
          "course_rev_v1",
          "kn_rev_v1",
          "mm_rev_v1",
          "fun_opts_v1",
          "home_layout_v1",
          "ui_skin_v1",
          "ui_palette_v1",
          "plugins_enabled_v1",
          "home_quick_tools_v1",
          "profile_v1",
          "farm_v1",
          "island_v1"
        }) kinds.put(key, "one");
    KINDS = Collections.unmodifiableMap(kinds);
  }

  static final class Scan {
    final JSONObject meta;
    final JSONArray delta;
    final JSONArray snapshot;
    final int count;

    Scan(JSONObject meta, JSONArray delta, JSONArray snapshot, int count) {
      this.meta = meta;
      this.delta = delta;
      this.snapshot = snapshot;
      this.count = count;
    }
  }

  static final class Merge {
    final JSONObject updates, meta;
    final JSONArray localDelta;
    final int accepted, conflicts;

    Merge(JSONObject updates, JSONObject meta, JSONArray localDelta, int accepted, int conflicts) {
      this.updates = updates;
      this.meta = meta;
      this.localDelta = localDelta;
      this.accepted = accepted;
      this.conflicts = conflicts;
    }
  }

  /** Java and JS both hash UTF-16 code units; unsigned overflow is intentional. */
  static String hash(String text) {
    int h = 0x811c9dc5;
    for (int i = 0; i < text.length(); i++) h = (h ^ text.charAt(i)) * 16777619;
    return Long.toString(Integer.toUnsignedLong(h), 36) + Integer.toString(text.length(), 36);
  }

  static JSONObject records(String key, Object value, boolean localMode) {
    JSONObject result = new JSONObject();
    String kind = KINDS.get(key);
    if ("list".equals(kind)) {
      for (JSONObject item : CampusJson.rows(value)) {
        String id = item.optString("id");
        if (safeId(id) && (localMode || item.optBoolean("local"))) CampusJson.put(result, id, item);
      }
    } else if (localMode && "one".equals(kind)) {
      if (value != null && value != JSONObject.NULL) CampusJson.put(result, "_", value);
    } else if (localMode && value instanceof JSONObject) {
      JSONObject object = (JSONObject) value;
      for (String id : CampusJson.keys(object)) {
        if (!safeId(id)) continue;
        if ("map2".equals(kind)) {
          JSONObject child = object.optJSONObject(id);
          for (String sub : CampusJson.keys(child))
            if (safeId(sub)) CampusJson.put(result, id + SEP + sub, child.opt(sub));
        } else CampusJson.put(result, id, object.opt(id));
      }
    }
    return result;
  }

  static Scan scan(JSONObject data, JSONObject previousMeta, boolean localMode, long now) {
    JSONObject meta = cleanMeta(previousMeta),
        hashes = meta.optJSONObject("h"),
        times = meta.optJSONObject("t");
    JSONArray delta = new JSONArray(), snapshot = new JSONArray();
    int count = 0;
    for (String key : KINDS.keySet()) {
      JSONObject recs = records(key, data.opt(key), localMode),
          h = child(hashes, key),
          t = child(times, key);
      for (String id : CampusJson.keys(recs)) {
        Object value = recs.opt(id);
        try {
          validateValue(key, id, value);
        } catch (IllegalArgumentException invalid) {
          continue;
        }
        String fingerprint = hash(json(value));
        if (!fingerprint.equals(h.optString(id))) {
          long stamp = Math.max(now, t.optLong(id) + 1);
          CampusJson.put(h, id, fingerprint);
          CampusJson.put(t, id, stamp);
          delta.put(row(key, id, value, stamp));
        }
        count++;
      }
      for (String id : new ArrayList<>(CampusJson.keys(h))) {
        if (!recs.has(id) && !"-".equals(h.optString(id))) {
          long stamp = Math.max(now, t.optLong(id) + 1);
          CampusJson.put(h, id, "-");
          CampusJson.put(t, id, stamp);
          delta.put(row(key, id, null, stamp));
        }
      }
      for (String id : CampusJson.keys(t)) {
        Object value = "-".equals(h.optString(id)) ? null : recs.opt(id);
        if (value != null || "-".equals(h.optString(id))) {
          try {
            validateValue(key, id, value);
          } catch (IllegalArgumentException invalid) {
            continue;
          }
          snapshot.put(row(key, id, value, t.optLong(id)));
        }
      }
    }
    return new Scan(meta, delta, snapshot, count);
  }

  /**
   * Scan before merge protects edits that were made since the last send. Changes are recordwise.
   */
  static Merge merge(
      JSONObject data, JSONObject previousMeta, JSONArray incoming, boolean localMode, long now) {
    if (incoming == null || incoming.length() > MAX_ROWS)
      throw new IllegalArgumentException("局域网记录数量超限");
    Scan fresh = scan(data, previousMeta, localMode, now);
    JSONObject meta = fresh.meta,
        updates = new JSONObject(),
        hashes = meta.optJSONObject("h"),
        times = meta.optJSONObject("t");
    int accepted = 0, conflicts = 0;
    for (int index = 0; index < incoming.length(); index++) {
      JSONObject x = incoming.optJSONObject(index);
      if (x == null) continue;
      String key = x.optString("k"), id = x.optString("r"), kind = KINDS.get(key);
      Object time = x.opt("t");
      if (kind == null || !safeRecordId(kind, id) || !(time instanceof Number)) continue;
      double precise = ((Number) time).doubleValue();
      if (!Double.isFinite(precise)
          || precise < 1
          || precise > 9007199254740991L
          || precise != Math.floor(precise)) continue;
      long stamp = ((Number) time).longValue();
      if (stamp > now + 300000L) {
        conflicts++;
        continue;
      }
      Object value = x.opt("v");
      if (value == JSONObject.NULL) value = null;
      try {
        validateValue(key, id, value);
      } catch (IllegalArgumentException invalid) {
        conflicts++;
        continue;
      }
      JSONObject t = child(times, key), h = child(hashes, key);
      if (t.optLong(id) >= stamp) continue;
      Object current = updates.has(key) ? updates.opt(key) : data.opt(key);
      if ("list".equals(kind)) {
        JSONArray existing = CampusJson.arr(current), next = new JSONArray();
        boolean found = false, collision = false;
        for (int i = 0; i < existing.length(); i++) {
          JSONObject item = existing.optJSONObject(i);
          if (item != null && id.equals(item.optString("id"))) {
            if (!localMode && !item.optBoolean("local")) {
              collision = true;
              break;
            }
            found = true;
          }
        }
        if (collision) {
          conflicts++;
          continue;
        }
        JSONObject rec = value == null ? null : CampusJson.copy((JSONObject) value);
        if (rec != null && !localMode) CampusJson.put(rec, "local", true);
        for (int i = 0; i < existing.length(); i++) {
          JSONObject item = existing.optJSONObject(i);
          if (item != null && id.equals(item.optString("id"))) {
            if (rec != null) next.put(rec);
          } else next.put(existing.opt(i));
        }
        if (!found && rec != null) next.put(rec);
        value = rec;
        CampusJson.put(updates, key, next);
      } else if ("one".equals(kind)) CampusJson.put(updates, key, value);
      else {
        JSONObject next = CampusJson.copy(CampusJson.object(current));
        if ("map2".equals(kind)) {
          String[] parts = id.split(SEP, -1);
          JSONObject sub = child(next, parts[0]);
          if (value == null) sub.remove(parts[1]);
          else CampusJson.put(sub, parts[1], value);
          if (sub.length() == 0) next.remove(parts[0]);
        } else if (value == null) next.remove(id);
        else CampusJson.put(next, id, value);
        CampusJson.put(updates, key, next);
      }
      CampusJson.put(t, id, stamp);
      CampusJson.put(h, id, value == null ? "-" : hash(json(value)));
      accepted++;
    }
    return new Merge(updates, meta, fresh.delta, accepted, conflicts);
  }

  static JSONObject row(String key, String id, Object value, long timestamp) {
    return CampusJson.obj("k", key, "r", id, "v", value, "t", timestamp);
  }

  static JSONObject envelope(String type, JSONArray list) {
    if (!"hello".equals(type) && !"delta".equals(type))
      throw new IllegalArgumentException("局域网消息类型无效");
    return CampusJson.obj("type", type, "list", list);
  }

  static List<String> encode(JSONObject envelope) {
    String text = envelope.toString();
    if (text.getBytes(StandardCharsets.UTF_8).length > MAX_MESSAGE_BYTES)
      throw new IllegalArgumentException("局域网消息超过16MB");
    if (text.length() < CHUNK_CHARS) return Collections.singletonList(text);
    List<String> segments = new ArrayList<>();
    for (int begin = 0; begin < text.length(); ) {
      int end = Math.min(begin + CHUNK_CHARS, text.length());
      if (end < text.length() && Character.isHighSurrogate(text.charAt(end - 1))) end--;
      segments.add(text.substring(begin, end));
      begin = end;
    }
    String id = UUID.randomUUID().toString();
    List<String> packets = new ArrayList<>();
    for (int i = 0; i < segments.size(); i++)
      packets.add(
          CampusJson.obj("chunk", id, "i", i, "n", segments.size(), "d", segments.get(i))
              .toString());
    return packets;
  }

  /** Per-peer bounded reassembly, including out-of-order chunks from the web implementation. */
  static final class Decoder {
    private final Map<String, Parts> pending = new LinkedHashMap<>();
    private int buffered;

    private static final class Parts {
      final String[] values;
      final long created;
      int bytes, count;

      Parts(int n, long now) {
        values = new String[n];
        created = now;
      }
    }

    JSONObject accept(String packet, long now) {
      expire(now);
      if (packet.getBytes(StandardCharsets.UTF_8).length > 400000)
        throw new IllegalArgumentException("局域网分片过大");
      JSONObject message;
      try {
        message = new JSONObject(packet);
      } catch (JSONException e) {
        throw new IllegalArgumentException("局域网消息格式无效");
      }
      if (message.has("chunk")) {
        String id = message.optString("chunk");
        int i = message.optInt("i", -1), n = message.optInt("n", 0);
        Object segment = message.opt("d");
        if (!id.matches("[A-Za-z0-9_-]{1,80}")
            || n < 1
            || n > 1024
            || i < 0
            || i >= n
            || !(segment instanceof String)
            || ((String) segment).length() > CHUNK_CHARS)
          throw new IllegalArgumentException("局域网分片编号无效");
        Parts parts = pending.get(id);
        if (parts == null) {
          if (pending.size() >= 4) throw new IllegalArgumentException("局域网分片排队过多");
          parts = new Parts(n, now);
          pending.put(id, parts);
        } else if (parts.values.length != n) throw new IllegalArgumentException("局域网分片数量不一致");
        if (parts.values[i] != null && !parts.values[i].equals(segment))
          throw new IllegalArgumentException("局域网分片内容不一致");
        if (parts.values[i] == null) {
          int bytes = ((String) segment).getBytes(StandardCharsets.UTF_8).length;
          if ((long) buffered + bytes > MAX_MESSAGE_BYTES) {
            clear();
            throw new IllegalArgumentException("局域网消息超过16MB");
          }
          parts.values[i] = (String) segment;
          parts.count++;
          parts.bytes += bytes;
          buffered += bytes;
        }
        if (parts.count != n) return null;
        StringBuilder assembled = new StringBuilder();
        for (String value : parts.values) assembled.append(value);
        pending.remove(id);
        buffered -= parts.bytes;
        try {
          message = new JSONObject(assembled.toString());
        } catch (JSONException e) {
          throw new IllegalArgumentException("局域网完整消息格式无效");
        }
      }
      String type = message.optString("type");
      JSONArray list = message.optJSONArray("list");
      if ((!"hello".equals(type) && !"delta".equals(type))
          || list == null
          || list.length() > MAX_ROWS) throw new IllegalArgumentException("这不是捞捞局域网学习记录消息");
      return message;
    }

    void expire(long now) {
      Iterator<Parts> it = pending.values().iterator();
      while (it.hasNext()) {
        Parts p = it.next();
        if (now - p.created > 30000) {
          buffered -= p.bytes;
          it.remove();
        }
      }
    }

    void clear() {
      pending.clear();
      buffered = 0;
    }
  }

  static void validateValue(String key, String id, Object value) {
    String kind = KINDS.get(key);
    if (kind == null || !safeRecordId(kind, id)) throw new IllegalArgumentException("局域网记录分类无效");
    if (value == null || value == JSONObject.NULL) return;
    validateTree(value, 0);
    if ("list".equals(kind)) {
      if (!(value instanceof JSONObject) || !id.equals(((JSONObject) value).optString("id")))
        throw new IllegalArgumentException("局域网记录编号不匹配");
      JSONObject item = (JSONObject) value;
      if (item.has("local") && !(item.opt("local") instanceof Boolean))
        throw new IllegalArgumentException("局域网记录本机标记无效");
      for (String date : new String[] {"date", "due"})
        if (!item.optString(date).isEmpty()) DateMath.parse(item.optString(date));
      if ("personal_events_v1".equals(key) && !item.optString("event_time").isEmpty())
        CampusJson.eventTime(item.optString("event_time"));
      if ("countdown_v1".equals(key)
          && (item.optString("title").trim().isEmpty() || item.optString("date").isEmpty()))
        throw new IllegalArgumentException("倒数日名称或日期缺失");
    }
    if (("plugins_enabled_v1".equals(key) || "home_quick_tools_v1".equals(key))
        && !(value instanceof JSONArray)) throw new IllegalArgumentException("工具偏好格式无效");
    if ("ui_skin_v1".equals(key) && !(value instanceof String))
      throw new IllegalArgumentException("外观偏好格式无效");
    if ("ui_palette_v1".equals(key)) {
      if (!(value instanceof JSONObject)
          || !((JSONObject) value).optString("p").matches("#[0-9a-fA-F]{6}"))
        throw new IllegalArgumentException("外观配色格式无效");
    }
  }

  private static void validateTree(Object value, int depth) {
    if (depth > 16) throw new IllegalArgumentException("局域网记录层级过深");
    if (value instanceof JSONObject) {
      JSONObject o = (JSONObject) value;
      if (o.length() > MAX_ROWS) throw new IllegalArgumentException("局域网记录字段过多");
      for (String key : CampusJson.keys(o)) {
        String lower = key.toLowerCase(Locale.ROOT);
        if (!safeId(key)
            || lower.contains("password")
            || lower.contains("token")
            || lower.contains("secret")
            || lower.equals("session")
            || lower.equals("apikey")
            || lower.equals("authorization")) throw new IllegalArgumentException("局域网传输不包含登录凭据");
        validateTree(o.opt(key), depth + 1);
      }
    } else if (value instanceof JSONArray) {
      JSONArray a = (JSONArray) value;
      if (a.length() > MAX_ROWS) throw new IllegalArgumentException("局域网记录过多");
      for (int i = 0; i < a.length(); i++) validateTree(a.opt(i), depth + 1);
    } else if (value instanceof String && ((String) value).length() > 2000000)
      throw new IllegalArgumentException("单条局域网记录超过2MB");
    else if (value instanceof Number && !Double.isFinite(((Number) value).doubleValue()))
      throw new IllegalArgumentException("局域网数字无效");
  }

  private static boolean safeId(String id) {
    return id != null
        && !id.isEmpty()
        && id.length() <= 200
        && id.indexOf(SEP) < 0
        && !id.equals("__proto__")
        && !id.equals("constructor")
        && !id.equals("prototype");
  }

  private static boolean safeRecordId(String kind, String id) {
    if ("one".equals(kind)) return "_".equals(id);
    if ("map2".equals(kind)) {
      String[] parts = id.split(SEP, -1);
      return parts.length == 2 && safeId(parts[0]) && safeId(parts[1]);
    }
    return safeId(id);
  }

  private static JSONObject cleanMeta(JSONObject meta) {
    JSONObject result = CampusJson.copy(meta == null ? new JSONObject() : meta);
    if (result.optJSONObject("h") == null) CampusJson.put(result, "h", new JSONObject());
    if (result.optJSONObject("t") == null) CampusJson.put(result, "t", new JSONObject());
    for (String group : new String[] {"h", "t"})
      for (String key : new ArrayList<>(CampusJson.keys(result.optJSONObject(group)))) {
        if (!KINDS.containsKey(key)) result.optJSONObject(group).remove(key);
        else {
          JSONObject entries = child(result.optJSONObject(group), key);
          for (String id : new ArrayList<>(CampusJson.keys(entries)))
            if (!safeRecordId(KINDS.get(key), id)) entries.remove(id);
        }
      }
    return result;
  }

  private static JSONObject child(JSONObject parent, String key) {
    JSONObject child = parent.optJSONObject(key);
    if (child == null) {
      child = new JSONObject();
      CampusJson.put(parent, key, child);
    }
    return child;
  }

  private static String json(Object value) {
    return value instanceof String ? JSONObject.quote((String) value) : String.valueOf(value);
  }
}
