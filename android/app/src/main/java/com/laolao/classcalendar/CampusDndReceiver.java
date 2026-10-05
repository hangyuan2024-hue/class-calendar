package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import java.util.*;
import org.json.*;

/** Opt-in timetable-driven Do Not Disturb, restoring only the state changed by this app. */
public class CampusDndReceiver extends BroadcastReceiver {
  public void onReceive(Context c, Intent i) {
    String owner = c.getSharedPreferences("campus_active_scope", 0).getString("owner", "guest");
    scheduleNext(c, new CampusStore(c, owner));
  }

  static PendingIntent pi(Context c, int flags) {
    return PendingIntent.getBroadcast(
        c,
        830,
        new Intent(c, CampusDndReceiver.class).setAction("campus.dnd"),
        PendingIntent.FLAG_IMMUTABLE | flags);
  }

  static void restoreFilter(Context c) {
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    android.content.SharedPreferences p = c.getSharedPreferences("campus_dnd", 0);
    if (p.getBoolean("changed", false) && nm.isNotificationPolicyAccessGranted()) {
      if (nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        nm.setInterruptionFilter(p.getInt("previous", NotificationManager.INTERRUPTION_FILTER_ALL));
      p.edit().remove("changed").remove("previous").apply();
    }
    PendingIntent pending = pi(c, PendingIntent.FLAG_NO_CREATE);
    if (pending != null) {
      ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE)).cancel(pending);
      pending.cancel();
    }
  }

  static void scheduleNext(Context c, CampusStore s) {
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    if (!s.bool("native_quiet", false) || !nm.isNotificationPolicyAccessGranted()) {
      restoreFilter(c);
      return;
    }
    long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
    boolean inside = false;
    for (int i = 0; i < 14; i++) {
      String day = DateMath.plus(DateMath.today(), i);
      for (JSONObject x : CampusCourses.onDay(s, day)) {
        long start = CampusJson.at(day, x.optString("t0")),
            end = CampusJson.at(day, x.optString("t1"));
        if (start <= now && now < end) {
          inside = true;
          next = Math.min(next, end);
        } else if (start > now) next = Math.min(next, start);
      }
    }
    android.content.SharedPreferences p = c.getSharedPreferences("campus_dnd", 0);
    if (inside) {
      if (!p.getBoolean("changed", false)) {
        int current = nm.getCurrentInterruptionFilter();
        if (current == NotificationManager.INTERRUPTION_FILTER_ALL) {
          p.edit().putInt("previous", current).putBoolean("changed", true).apply();
          nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        }
      }
    } else restoreFilter(c);
    if (next != Long.MAX_VALUE)
      ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE))
          .setAndAllowWhileIdle(
              AlarmManager.RTC_WAKEUP, next, pi(c, PendingIntent.FLAG_UPDATE_CURRENT));
  }
}
