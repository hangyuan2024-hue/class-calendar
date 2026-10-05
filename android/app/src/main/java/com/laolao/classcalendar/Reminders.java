package com.laolao.classcalendar;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** 到点提醒：网页算好「几点提醒什么」，这里交给系统闹钟；手机重启后从存档里重新排上。 */
final class Reminders {
  static final String CH = "remind";
  private static final String PREF = "reminders", KEY = "list";

  private Reminders() {}

  private static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }

  private static PendingIntent pi(Context c, int code, Intent it, int extra) {
    return PendingIntent.getBroadcast(c, code, it, PendingIntent.FLAG_IMMUTABLE | extra);
  }

  private static Intent intentFor(Context c, JSONObject r) {
    return new Intent(c, ReminderReceiver.class)
        .setAction("cc.remind." + r.optString("id"))
        .putExtra("id", r.optString("id"))
        .putExtra("title", r.optString("title"))
        .putExtra("body", r.optString("body"))
        .putExtra("go", r.optString("go", null));
  }

  /** 用新的列表替换掉以前排好的提醒，返回排上了几条 */
  static synchronized int replaceAll(Context c, String json) {
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    try {
      JSONArray old = new JSONArray(prefs(c).getString(KEY, "[]"));
      for (int i = 0; i < old.length(); i++) {
        JSONObject r = old.getJSONObject(i);
        PendingIntent p =
            pi(c, r.optString("id").hashCode(), intentFor(c, r), PendingIntent.FLAG_NO_CREATE);
        if (p != null) {
          am.cancel(p);
          p.cancel();
        }
      }
    } catch (Exception ignored) {
    }
    JSONArray keep = new JSONArray();
    int n = 0;
    try {
      JSONArray list = new JSONArray(json == null ? "[]" : json);
      long now = System.currentTimeMillis();
      for (int i = 0; i < list.length() && n < 60; i++) {
        JSONObject r = list.getJSONObject(i);
        long at = r.optLong("at");
        if (at <= now || at > now + 15L * 86400000L || r.optString("id").isEmpty()) continue;
        schedule(c, am, r, at);
        keep.put(r);
        n++;
      }
    } catch (Exception ignored) {
    }
    prefs(c).edit().putString(KEY, keep.toString()).apply();
    return n;
  }

  private static void schedule(Context c, AlarmManager am, JSONObject r, long at) {
    PendingIntent p =
        pi(c, r.optString("id").hashCode(), intentFor(c, r), PendingIntent.FLAG_UPDATE_CURRENT);
    // 不需要精确到秒：用省电的方式排（休眠时可能晚几分钟）
    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
  }

  /** 开机后重新排 */
  static void restore(Context c) {
    try {
      replaceAll(c, prefs(c).getString(KEY, "[]"));
    } catch (Exception ignored) {
    }
  }

  static void ensureChannel(Context c) {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationManager nm = c.getSystemService(NotificationManager.class);
      if (nm.getNotificationChannel(CH) == null) {
        NotificationChannel ch =
            new NotificationChannel(CH, "作业和日程提醒", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("作业截止、班会活动开始前提醒你");
        nm.createNotificationChannel(ch);
      }
    }
  }

  static void show(Context c, int id, String title, String body, String go) {
    show(c, id, title, body, go, true);
  }

  static void show(Context c, int id, String title, String body, String go, boolean sound) {
    ensureChannel(c);
    String channel = sound ? CH : "campus-silent";
    if (!sound && Build.VERSION.SDK_INT >= 26) {
      NotificationChannel quiet =
          new NotificationChannel(channel, "无声专注提醒", NotificationManager.IMPORTANCE_LOW);
      quiet.setSound(null, null);
      c.getSystemService(NotificationManager.class).createNotificationChannel(quiet);
    }
    Intent open =
        new Intent(c, CampusActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if (go != null && !go.isEmpty()) open.putExtra("go", go);
    PendingIntent tap =
        PendingIntent.getActivity(
            c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder b =
        Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(c, channel)
            : new Notification.Builder(c);
    b.setSmallIcon(R.drawable.ic_stat)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new Notification.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setContentIntent(tap)
        .setColor(0xFF1E8CFF)
        .setWhen(System.currentTimeMillis())
        .setShowWhen(true);
    if (Build.VERSION.SDK_INT < 26)
      b.setPriority(Notification.PRIORITY_HIGH).setDefaults(sound ? Notification.DEFAULT_ALL : 0);
    try {
      c.getSystemService(NotificationManager.class).notify(id, b.build());
    } catch (SecurityException ignored) {
    }
  }
}
