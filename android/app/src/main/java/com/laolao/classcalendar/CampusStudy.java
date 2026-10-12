package com.laolao.classcalendar;

import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.*;
import java.util.*;
import org.json.*;

/** Native client for study.js. Never replaces the user's calendar or native backup. */
final class CampusStudy {
  static final int MAX_FILE = 5 * 1024 * 1024;
  private static final WeakHashMap<CampusActivity, Status> STATUS = new WeakHashMap<>();

  static final class Status {
    String owner, error = "";
    boolean busy;
    long fetched;
    Status(String owner) { this.owner = owner; }
  }

  static Status status(CampusActivity a) {
    Status s = STATUS.get(a);
    if (s == null || !s.owner.equals(a.store.owner)) {
      s = new Status(a.store.owner);
      STATUS.put(a, s);
    }
    return s;
  }

  static JSONObject state(CampusActivity a) {
    JSONObject d = a.store.object("kn_cache_v1");
    return a.api.logged() && a.api.uid().equals(d.optString("uid")) ? d
        : CampusJson.obj("courses", new JSONArray(), "nodes", new JSONArray(), "items", new JSONArray(), "links", new JSONArray(), "used", 0);
  }

  static boolean cached(CampusActivity a) {
    return a.api.logged() && a.api.uid().equals(a.store.object("kn_cache_v1").optString("uid"));
  }

  private static JSONObject fetched(CampusActivity a, String owner) throws Exception {
    if (!owner.equals(a.api.uid())) throw new IOException("账号已切换，请重新打开课内学习");
    JSONObject d = CampusJson.object(a.api.rpc("kn_state", CampusJson.obj()));
    if (!(d.opt("courses") instanceof JSONArray) || !(d.opt("items") instanceof JSONArray)
        || !(d.opt("nodes") instanceof JSONArray)) throw new IOException("课内学习返回的数据不完整，请重试");
    CampusJson.put(d, "links", CampusJson.arr(d.opt("links")));
    CampusJson.put(d, "uid", owner);
    CampusJson.put(d, "at", System.currentTimeMillis());
    return d;
  }

  private static void publish(CampusActivity a) {
    if (!a.isDestroyed() && !a.isFinishing()) ComposeEntry.refresh(a);
  }

  static void refresh(CampusActivity a, boolean force) {
    if (!a.api.logged()) return;
    final Status s = status(a);
    if (s.busy || (!force && cached(a) && System.currentTimeMillis() - s.fetched < 20000)) return;
    run(a, null, null, null, false);
  }

  private static String friendly(Exception e) {
    String m = e.getMessage() == null ? "读取失败，请稍后再试" : e.getMessage();
    if (m.contains("PGRST202") || m.contains("does not exist") || m.contains("Could not find the function"))
      return "课内学习服务暂未启用，请联系校园服务管理员；本机已缓存的资料仍然保留。";
    return m;
  }

  interface Work { Object run(CampusActivity a, String owner) throws Exception; }

  private static void run(CampusActivity a, Work work, String message, Runnable done, boolean changed) {
    if (!a.requireLogin()) return;
    final Status s = status(a);
    if (s.busy) { a.toast("上一项操作还在处理，请稍等"); return; }
    final CampusStore target = a.store;
    final String owner = a.api.uid();
    s.busy = true;
    s.error = "";
    publish(a);
    a.worker.execute(() -> {
      try {
        if (!owner.equals(a.api.uid()) || !owner.equals(target.owner)) return;
        if (work != null) work.run(a, owner);
        JSONObject d = fetched(a, owner);
        if (!owner.equals(a.api.uid())) return;
        target.set("kn_cache_v1", d);
        if (changed) target.set("kn_rev_v1", CampusJson.obj("t", System.currentTimeMillis(), "n", d.optJSONArray("items").length()));
        a.handler.post(() -> {
          if (!owner.equals(a.api.uid()) || a.isDestroyed()) return;
          s.busy = false;
          s.fetched = System.currentTimeMillis();
          s.error = "";
          if (message != null) a.toast(message);
          if (done != null) done.run();
          publish(a);
          if (changed) a.syncSoon();
        });
      } catch (Exception e) {
        a.handler.post(() -> {
          if (!owner.equals(a.api.uid()) || a.isDestroyed()) return;
          s.busy = false;
          s.error = friendly(e);
          if (work != null) a.toast(s.error);
          publish(a);
        });
      }
    });
  }

  static void act(CampusActivity a, String fn, JSONObject args, String message, Runnable done) {
    if (!fn.matches("kn_(course_(save|import|del)|item_del|node_(add|rename|move|del))"))
      throw new IllegalArgumentException("不支持的课内学习操作");
    run(a, (activity, owner) -> activity.api.rpc(fn, args), message, done, true);
  }

  static String fileName(CampusActivity a, Uri uri) {
    String name = "学习附件";
    try (Cursor c = a.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) name = c.getString(0);
    } catch (Exception ignored) {}
    return name == null || name.isEmpty() ? "学习附件" : name;
  }

  static void saveItem(CampusActivity a, JSONObject item, Uri attachment, Runnable done) {
    JSONObject p = CampusJson.copy(item);
    if (p.optString("title").trim().isEmpty() || p.optString("title").length() > 120) {
      a.toast("请填写 1—120 字的名称"); return;
    }
    String day = p.optString("deadline", "");
    if (!day.isEmpty() && !day.equals("null") && CampusJson.date(day).isEmpty()) {
      a.toast("截止日期请填写为 2026-10-11 这样的格式"); return;
    }
    run(a, (activity, owner) -> {
      if (attachment != null) {
        byte[] bytes;
        try (InputStream input = activity.getContentResolver().openInputStream(attachment)) {
          if (input == null) throw new IOException("文件无法读取，请重新选择");
          ByteArrayOutputStream out = new ByteArrayOutputStream();
          byte[] buffer = new byte[8192];
          int n;
          while ((n = input.read(buffer)) != -1) {
            if (out.size() + n > MAX_FILE) throw new IOException("附件最多 5 MB，请选择较小的文件");
            out.write(buffer, 0, n);
          }
          bytes = out.toByteArray();
        }
        String name = fileName(activity, attachment), mime = activity.getContentResolver().getType(attachment);
        if (mime == null) mime = "application/octet-stream";
        if (!owner.equals(activity.api.uid())) throw new IOException("账号已切换，附件未上传");
        Object id = activity.api.rpc("kn_file_put", CampusJson.obj("p_name", name, "p_mime", mime, "p_data", Base64.encodeToString(bytes, Base64.NO_WRAP)));
        CampusJson.put(p, "file_id", id);
        CampusJson.put(p, "file_type", mime);
        CampusJson.put(p, "file_name", name);
      }
      if (!owner.equals(activity.api.uid())) throw new IOException("账号已切换，记录未保存");
      return activity.api.rpc("kn_item_save", CampusJson.obj("p", p));
    }, "已保存到课内学习", done, true);
  }

  static void openFile(CampusActivity a, JSONObject item) {
    final String owner = a.api.uid();
    a.background("读取学习附件", () -> {
      JSONObject f = CampusJson.object(a.api.rpc("kn_file_get", CampusJson.obj("p_id", item.opt("file_id"))));
      if (!owner.equals(a.api.uid())) throw new IOException("账号已切换，附件读取已停止");
      String raw = f.optString("data");
      if (raw.length() > MAX_FILE * 4 / 3 + 16) throw new IOException("附件超过 5 MB");
      byte[] bytes = Base64.decode(raw, Base64.DEFAULT);
      if (bytes.length > MAX_FILE) throw new IOException("附件超过 5 MB");
      String name = f.optString("name", item.optString("file_name", "学习附件"))
          .replaceAll("[\\\\/:*?\"<>|]", "_").replace("..", "_");
      if (name.isEmpty()) name = "学习附件";
      File dir = new File(a.getCacheDir(), "study-" + owner.replaceAll("[^a-zA-Z0-9_-]", "_"));
      dir.mkdirs();
      File file = new File(dir, name);
      try (OutputStream out = new FileOutputStream(file)) { out.write(bytes); }
      return new Object[] {file, f.optString("mime", item.optString("file_type", "application/octet-stream"))};
    }, result -> {
      Object[] f = (Object[]) result;
      CampusPhone.shareFile(a, (File) f[0], (String) f[1]);
    });
  }

  /** Same id and date projection as window.studyItems() in the website. */
  static List<JSONObject> assessmentItems(CampusActivity a) {
    JSONObject d = state(a);
    List<JSONObject> out = new ArrayList<>();
    Map<Long, String> names = new HashMap<>();
    for (JSONObject c : CampusJson.rows(d.opt("courses"))) names.put(c.optLong("id"), c.optString("name"));
    for (JSONObject item : CampusJson.rows(d.opt("items"))) {
      String day = CampusJson.date(item.optString("deadline"));
      if (!item.optString("kind").equals("assessment") || day.isEmpty()) continue;
      String course = names.getOrDefault(item.optLong("course_id"), "");
      String key = "kn" + item.optLong("id");
      out.add(CampusJson.obj("_key", key, "_study", item.optLong("id"), "_studyCourse", course,
          "_mine", false, "id", key, "msg_type", "考核", "subject", (course.isEmpty() ? "" : course + " · ") + item.optString("title"),
          "summary", item.optString("requirement"), "event_time", day, "location", ""));
    }
    return out;
  }

  static boolean done(CampusActivity a, JSONObject item) {
    JSONObject mark = a.store.object("personal_marks_v1").optJSONObject(item.optString("_key"));
    return mark != null && mark.optBoolean("done");
  }

  static void mark(CampusActivity a, JSONObject item) {
    String key = item.optString("_key");
    if (!key.matches("kn[0-9]+")) throw new IllegalArgumentException("考核标识无效");
    JSONObject mark = a.store.object("personal_marks_v1").optJSONObject(key);
    if (mark == null) mark = new JSONObject();
    boolean on = !done(a, item);
    CampusJson.put(mark, "done", on);
    a.store.entry("personal_marks_v1", key, mark);
    a.store.entry("done_log_v1", key, on ? DateMath.today() : null);
    if (on) a.toast("已完成这项考核，记下今天的进步。");
    a.build();
    a.syncSoon();
  }

  static void openItem(CampusActivity a, long id) {
    a.store.set("native_study_open", Long.toString(id));
    a.open("study");
  }
}
