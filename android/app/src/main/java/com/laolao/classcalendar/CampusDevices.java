package com.laolao.classcalendar;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.*;
import org.json.*;

/** Logged-in device registry: report on resume, list and revoke other sessions. */
public final class CampusDevices {
  private static final String KEY = "cc_device_id_v1";
  private static long last;

  static String id(Context c) {
    SharedPreferences p = c.getSharedPreferences("campus_device", 0);
    String v = p.getString(KEY, "");
    if (v.isEmpty()) {
      v = "and-" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
      p.edit().putString(KEY, v).commit();
    }
    return v;
  }

  static void forget(Context c) {
    c.getSharedPreferences("campus_device", 0).edit().remove(KEY).commit();
  }

  static String name() {
    String b = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
    String m = Build.MODEL == null ? "安卓手机" : Build.MODEL;
    return (m.toLowerCase(Locale.ROOT).startsWith(b.toLowerCase(Locale.ROOT)) ? m : b + " " + m).trim()
        + " · 安卓App";
  }

  /** Called from onResume; silently ignores a backend without device management. */
  static void touch(CampusActivity a) {
    if (!a.api.logged() || System.currentTimeMillis() - last < 60000) return;
    last = System.currentTimeMillis();
    final String owner = a.api.uid();
    a.worker.execute(
        () -> {
          try {
            JSONObject r =
                CampusJson.object(
                    a.api.rpc(
                        "device_touch",
                        CampusJson.obj(
                            "p_device", id(a), "p_name", name(), "p_platform", "android")));
            if (!r.optBoolean("revoked") || !owner.equals(a.api.uid())) return;
            forget(a);
            try {
              a.api.logout();
            } catch (Exception ignored) {
            }
            a.handler.post(
                () -> {
                  if (a.isFinishing()) return;
                  a.switchAccount();
                  new AlertDialog.Builder(a)
                      .setTitle("已在其他设备退出")
                      .setMessage("你的账号在别的设备上把这台手机退出登录了。本机记录仍然保留，请重新登录。")
                      .setPositiveButton("去登录", (d, w) -> a.open("login"))
                      .setCancelable(false)
                      .show();
                });
          } catch (Exception ignored) {
          }
        });
  }

  public static void show(CampusActivity a) {
    if (!a.api.logged()) {
      a.open("login");
      return;
    }
    a.background(
        "读取登录设备",
        () -> a.api.rpc("device_list", CampusJson.obj("p_device", id(a))),
        v -> {
          List<JSONObject> rows = CampusJson.rows(v);
          List<String> labels = new ArrayList<>();
          for (JSONObject d : rows)
            labels.add(
                d.optString("name")
                    + (d.optBoolean("current") ? "（本机）" : "")
                    + "\n最近使用 "
                    + d.optString("last_seen").replace('T', ' ').replaceAll("\\..*$", ""));
          AlertDialog.Builder b =
              new AlertDialog.Builder(a)
                  .setTitle("登录设备 · 点一台可踢出")
                  .setNegativeButton("关闭", null);
          if (rows.isEmpty()) b.setMessage("暂时没有记录。如果一直为空，请让管理员在后台执行设备管理安装命令。");
          else
            b.setItems(
                labels.toArray(new String[0]),
                (d, i) -> {
                  JSONObject dev = rows.get(i);
                  if (dev.optBoolean("current")) {
                    a.toast("这是本机，请用「退出当前账号」");
                    return;
                  }
                  confirm(a, "把「" + dev.optString("name") + "」退出登录？", dev.optString("id"), false);
                });
          if (rows.size() > 1)
            b.setPositiveButton("退出其他所有设备", (d, w) -> confirm(a, "除了这台手机，其它设备全部退出登录？", null, true));
          b.show();
        });
  }

  private static void confirm(CampusActivity a, String msg, String devId, boolean all) {
    new AlertDialog.Builder(a)
        .setMessage(msg)
        .setNegativeButton("取消", null)
        .setPositiveButton(
            "踢出",
            (d, w) ->
                a.background(
                    "踢出设备",
                    () ->
                        a.api.rpc(
                            "device_revoke",
                            CampusJson.obj(
                                "p_id", devId == null ? JSONObject.NULL : devId,
                                "p_all", all,
                                "p_device", id(a))),
                    v -> {
                      a.toast("已踢出");
                      show(a);
                    }))
        .show();
  }
}
