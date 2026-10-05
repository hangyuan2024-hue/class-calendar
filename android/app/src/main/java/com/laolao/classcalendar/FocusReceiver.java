package com.laolao.classcalendar;

import android.content.*;

public class FocusReceiver extends BroadcastReceiver {
  static void restore(Context c) {
    try {
      org.json.JSONObject t = NativeData.load(c).optJSONObject("timer");
      if (t == null || t.optLong("end") <= System.currentTimeMillis()) return;
      android.app.AlarmManager a =
          (android.app.AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
      android.app.PendingIntent p =
          android.app.PendingIntent.getBroadcast(
              c,
              902,
              new Intent(c, FocusReceiver.class),
              android.app.PendingIntent.FLAG_UPDATE_CURRENT
                  | android.app.PendingIntent.FLAG_IMMUTABLE);
      a.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, t.optLong("end"), p);
    } catch (Exception ignored) {
    }
  }

  @Override
  public void onReceive(Context c, Intent i) {
    Reminders.show(c, 902, "星轨冲刺完成", "回到捞捞记录这一段专注，休息一下。", "native-focus");
  }
}
