package com.laolao.classcalendar;
import android.app.AlarmManager;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;

/** Public Android settings only: OEM-private activities change without notice. */
final class PhoneCompatibility {
  static boolean exact(Context c) {
    AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
    return am!=null && (Build.VERSION.SDK_INT<31 || am.canScheduleExactAlarms());
  }
  static boolean unrestricted(Context c) {
    PowerManager pm=(PowerManager)c.getSystemService(Context.POWER_SERVICE);
    return pm!=null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
  }
  static void open(CampusActivity a, String kind) {
    Intent i;
    if ("exact".equals(kind)&&Build.VERSION.SDK_INT>=31)
      i=new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+a.getPackageName()));
    else if ("battery".equals(kind)) i=new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    else if ("notification".equals(kind)&&Build.VERSION.SDK_INT>=26)
      i=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,a.getPackageName());
    else i=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+a.getPackageName()));
    try { a.startActivity(i); }
    catch(Exception e) { try { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+a.getPackageName()))); } catch(Exception ex) { a.error(ex); } }
  }
}