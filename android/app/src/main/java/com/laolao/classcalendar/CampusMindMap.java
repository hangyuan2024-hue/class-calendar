package com.laolao.classcalendar;

import android.net.Uri;
import java.io.*;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Durable native mind maps; same mm_* RPC/version contract as mindmap.js. */
final class CampusMindMap {
  static final String INDEX = "mm_index_v1";
  private static final WeakHashMap<CampusActivity, Status> STATUS = new WeakHashMap<>();
  static final class Status {
    final String owner;
    boolean busy;
    String message = "", error = "";
    long fetched;
    Runnable scheduled;
    Status(String owner) { this.owner = owner; }
  }
  static Status status(CampusActivity a) {
    Status s = STATUS.get(a);
    if (s == null || !s.owner.equals(a.store.owner)) { s = new Status(a.store.owner); STATUS.put(a, s); }
    return s;
  }
  static JSONArray index(CampusActivity a) { return a.store.list(INDEX); }
  static JSONObject localMap(CampusActivity a, String id) { return a.store.object("mm_map_" + id); }
  private static JSONObject entry(CampusStore store, String id) {
    for (JSONObject e : CampusJson.rows(store.list(INDEX))) if (e.optString("id").equals(id)) return e;
    return new JSONObject();
  }
  private static void putEntry(CampusStore store, JSONObject e) { store.replace(INDEX, e.optString("id"), e); }
  private static void removeEntry(CampusStore store, String id) {
    JSONArray next = new JSONArray();
    for (JSONObject e : CampusJson.rows(store.list(INDEX))) if (!e.optString("id").equals(id)) next.put(e);
    store.set(INDEX, next);
    store.set("mm_map_" + id, null);
  }
  private static void publish(CampusActivity a) { if (!a.isDestroyed() && !a.isFinishing()) ComposeEntry.refresh(a); }

  static JSONObject create(CampusActivity a, JSONObject document) {
    JSONObject m = MindMapDocument.normalize(document, true);
    save(a, m);
    return m;
  }

  static void save(CampusActivity a, JSONObject document) {
    JSONObject m = MindMapDocument.normalize(document, false);
    CampusStore store = a.store;
    synchronized (store) {
      JSONObject e = entry(store, m.optString("id"));
      if (e.optBoolean("deleted")) throw new IllegalArgumentException("这张导图已删除，请另存为新导图");
      CampusJson.put(e, "id", m.optString("id"));
      CampusJson.put(e, "title", m.optString("title"));
      CampusJson.put(e, "updated", System.currentTimeMillis());
      CampusJson.put(e, "nodes", MindMapDocument.count(m.optJSONObject("root")));
      CampusJson.put(e, "edit", e.optLong("edit") + 1);
      CampusJson.put(e, "local", e.optBoolean("local", !e.has("version")));
      CampusJson.put(e, "dirty", true);
      CampusJson.put(e, "version", e.optLong("version"));
      store.set("mm_map_" + m.optString("id"), m);
      putEntry(store, e);
    }
    Status s = status(a);
    s.message = a.api.logged() ? "已保存在本机 · 等待账号同步" : "已保存在这台设备";
    s.error = "";
    publish(a);
    schedule(a, 1200);
  }

  private static void schedule(CampusActivity a, long delay) {
    if (!a.api.logged()) return;
    Status s = status(a);
    if (s.scheduled != null) a.handler.removeCallbacks(s.scheduled);
    String owner = a.store.owner;
    s.scheduled = () -> { if (!a.isDestroyed() && owner.equals(a.api.uid())) refresh(a, true); };
    a.handler.postDelayed(s.scheduled, delay);
  }

  static void onLeave(CampusActivity a) {
    if (a.api.logged()) schedule(a, 0);
  }

  private static void check(CampusActivity a, String owner) throws IOException {
    if (!owner.equals(a.api.uid()) || a.isDestroyed()) throw new IOException("账号已切换，导图同步已停止");
  }

  static void refresh(CampusActivity a, boolean force) {
    if (!a.api.logged()) { status(a).message = "已保存在这台设备 · 登录后可同步"; return; }
    Status status = status(a);
    if (status.busy) { if (force) schedule(a, 3000); return; }
    if (!force && System.currentTimeMillis() - status.fetched < 20000) return;
    CampusStore target = a.store;
    String owner = a.api.uid();
    if (!owner.equals(target.owner)) return;
    status.busy = true; status.message = "正在同步账号…"; status.error = "";
    publish(a);
    a.worker.execute(() -> {
      try {
        check(a, owner);
        List<JSONObject> pending;
        synchronized (target) { pending = CampusJson.rows(target.list(INDEX)); }
        for (JSONObject sent : pending) {
          if (!sent.optBoolean("dirty")) continue;
          check(a, owner);
          String id = sent.optString("id");
          if (sent.optBoolean("deleted")) {
            if (!sent.optBoolean("local")) a.api.rpc("mm_del", CampusJson.obj("p_id", id));
            check(a, owner);
            synchronized (target) { if (entry(target, id).optBoolean("deleted")) removeEntry(target, id); }
            continue;
          }
          JSONObject m;
          synchronized (target) { m = target.object("mm_map_" + id); sent = entry(target, id); }
          if (m.optJSONObject("root") == null) continue;
          long edit = sent.optLong("edit");
          JSONObject response = CampusJson.object(a.api.rpc("mm_save", CampusJson.obj("p_id", id, "p_title", m.optString("title"), "p_data", m, "p_base", sent.optBoolean("local") ? null : sent.optLong("version"), "p_nodes", MindMapDocument.count(m.optJSONObject("root")))));
          check(a, owner);
          if (response.optBoolean("ok")) {
            synchronized (target) {
              JSONObject current = entry(target, id);
              if (!current.optBoolean("deleted")) putEntry(target, MindMapSyncRules.acknowledge(current, edit, response.optLong("version")));
            }
          } else if (response.optBoolean("conflict")) {
            JSONObject remote = CampusJson.object(a.api.rpc("mm_get", CampusJson.obj("p_id", id)));
            check(a, owner);
            synchronized (target) {
              JSONObject current = entry(target, id);
              if (current.optBoolean("deleted")) continue;
              JSONObject copy = MindMapDocument.normalize(target.object("mm_map_" + id), true);
              CampusJson.put(copy, "title", copy.optString("title") + "（冲突副本）");
              String copyId = copy.optString("id");
              target.set("mm_map_" + copyId, copy);
              putEntry(target, CampusJson.obj("id", copyId, "title", copy.optString("title"), "nodes", MindMapDocument.count(copy.optJSONObject("root")), "updated", System.currentTimeMillis(), "local", true, "dirty", true, "edit", 1, "version", 0));
              cacheRemote(target, remote);
            }
            a.handler.post(() -> { if (owner.equals(a.api.uid())) a.toast("别的设备也改过这张图；你的内容已另存为「冲突副本」，没有覆盖任何一份。"); });
          } else throw new IOException("导图暂未同步成功，本机改动已保留");
        }
        check(a, owner);
        Object rows = a.api.rpc("mm_list", CampusJson.obj());
        if (!(rows instanceof JSONArray)) throw new IOException("账号导图列表读取失败");
        check(a, owner);
        synchronized (target) { target.set(INDEX, MindMapSyncRules.merge(target.list(INDEX), (JSONArray) rows)); }
        target.set("mm_rev_v1", CampusJson.obj("t", System.currentTimeMillis()));
        a.handler.post(() -> {
          if (!owner.equals(a.api.uid()) || a.isDestroyed()) return;
          status.busy = false; status.fetched = System.currentTimeMillis(); status.error = ""; status.message = "已同步到账号";
          publish(a); a.syncSoon();
          boolean dirty = CampusJson.rows(target.list(INDEX)).stream().anyMatch(e -> e.optBoolean("dirty"));
          if (dirty) schedule(a, 3000);
        });
      } catch (Exception e) {
        a.handler.post(() -> {
          if (!owner.equals(a.api.uid()) || a.isDestroyed()) return;
          status.busy = false;
          status.error = e.getMessage() == null ? "网络暂不可用，本机改动已保留" : e.getMessage();
          if (status.error.contains("PGRST202") || status.error.contains("does not exist") || status.error.contains("Could not find the function")) status.error = "思维导图云服务暂未启用，本机导图可继续使用。";
          status.message = "已保存在本机 · 暂未同步";
          publish(a);
        });
      }
    });
  }

  private static JSONObject cacheRemote(CampusStore target, JSONObject response) {
    JSONObject raw = CampusJson.copy(CampusJson.object(response.opt("data")));
    CampusJson.put(raw, "id", response.optString("id"));
    CampusJson.put(raw, "title", response.optString("title"));
    JSONObject m = MindMapDocument.normalize(raw, false);
    target.set("mm_map_" + m.optString("id"), m);
    JSONObject e = entry(target, m.optString("id"));
    CampusJson.put(e, "id", m.optString("id")); CampusJson.put(e, "title", m.optString("title"));
    CampusJson.put(e, "nodes", MindMapDocument.count(m.optJSONObject("root")));
    CampusJson.put(e, "version", response.optLong("version")); CampusJson.put(e, "server", response.optLong("version"));
    CampusJson.put(e, "local", false); CampusJson.put(e, "dirty", false); CampusJson.put(e, "edit", e.optLong("edit") + 1);
    putEntry(target, e);
    return m;
  }

  static void open(CampusActivity a, String id, Consumer<JSONObject> done) {
    CampusStore target = a.store;
    JSONObject local = localMap(a, id), e = entry(target, id);
    boolean remote = a.api.logged() && !e.optBoolean("dirty") && (local.optJSONObject("root") == null || e.optLong("server") > e.optLong("version"));
    if (!remote) {
      if (local.optJSONObject("root") == null) { a.toast("这张导图尚未下载到本机，联网后重试"); return; }
      done.accept(local); return;
    }
    String owner = a.api.uid();
    a.background("读取导图", () -> {
      JSONObject response = CampusJson.object(a.api.rpc("mm_get", CampusJson.obj("p_id", id)));
      check(a, owner);
      synchronized (target) {
        JSONObject current = entry(target, id);
        return current.optBoolean("dirty") ? target.object("mm_map_" + id) : cacheRemote(target, response);
      }
    }, result -> { done.accept((JSONObject) result); publish(a); });
  }

  static void delete(CampusActivity a, String id) {
    CampusStore store = a.store;
    synchronized (store) {
      JSONObject e = entry(store, id);
      if (e.length() == 0) return;
      if (e.optBoolean("local") || !a.api.logged()) removeEntry(store, id);
      else { CampusJson.put(e, "deleted", true); CampusJson.put(e, "dirty", true); CampusJson.put(e, "edit", e.optLong("edit") + 1); putEntry(store, e); }
    }
    a.toast("已删除导图"); publish(a); schedule(a, 0);
  }

  static void importFile(CampusActivity a, Uri uri, Consumer<JSONObject> done) {
    a.background("读取导图文件", () -> {
      String text;
      try (InputStream in = a.getContentResolver().openInputStream(uri)) {
        if (in == null) throw new IOException("文件无法读取");
        text = CampusApi.read(in, MindMapDocument.MAX_BYTES);
      }
      String name = CampusStudy.fileName(a, uri);
      return name.toLowerCase(Locale.ROOT).endsWith(".json") ? MindMapDocument.normalize(new JSONObject(text), true) : MindMapDocument.parseText(text);
    }, result -> done.accept(create(a, (JSONObject) result)));
  }
}
