package com.laolao.classcalendar;

import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.widget.RemoteViews;
import java.util.*;
import org.json.*;

/** Launcher widget renders native RemoteViews from the same account-isolated records. */
public class CampusWidget extends AppWidgetProvider {
  public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
    for (int id : ids) update(c, manager, id);
  }

  public void onAppWidgetOptionsChanged(
      Context c, AppWidgetManager m, int id, android.os.Bundle o) {
    update(c, m, id);
  }

  static void updateAll(Context c) {
    AppWidgetManager manager = AppWidgetManager.getInstance(c);
    for (int id : manager.getAppWidgetIds(new ComponentName(c, CampusWidget.class)))
      update(c, manager, id);
  }

  static void update(Context c, AppWidgetManager manager, int id) {
    String owner = c.getSharedPreferences("campus_active_scope", 0).getString("owner", "guest");
    CampusStore s = new CampusStore(c, owner);
    RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.campus_widget);
    v.setTextViewText(R.id.widget_date, DateMath.today() + " · 捞捞校园");
    List<JSONObject> courses = CampusCourses.onDay(s, DateMath.today());
    StringBuilder lessons = new StringBuilder();
    for (JSONObject x : courses.subList(0, Math.min(3, courses.size())))
      lessons.append(x.optString("t0")).append("  ").append(x.optString("name")).append("\n");
    v.setTextViewText(
        R.id.widget_courses, courses.isEmpty() ? "今天没有记录的课程" : lessons.toString().trim());
    int tasks = 0;
    String next = "";
    for (JSONObject x : CampusJson.rows(s.list("personal_events_v1")))
      if (!x.optBoolean("done")) {
        tasks++;
        if (next.isEmpty()) next = x.optString("subject");
      }
    JSONObject marks = s.object("personal_marks_v1");
    for (JSONObject x : CampusJson.rows(s.list("cache_items"))) {
      JSONObject m = marks.optJSONObject("c" + x.optString("id"));
      if (m == null || (!m.optBoolean("done") && !m.optBoolean("hidden"))) {
        tasks++;
        if (next.isEmpty()) next = x.optString("subject");
      }
    }
    v.setTextViewText(
        R.id.widget_tasks, "待办 " + tasks + " 项" + (next.isEmpty() ? "" : " · " + next));
    v.setOnClickPendingIntent(
        R.id.widget_root,
        PendingIntent.getActivity(
            c,
            id,
            new Intent(c, CampusActivity.class).putExtra("go", "native-widget"),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    v.setOnClickPendingIntent(
        R.id.widget_course_btn,
        PendingIntent.getActivity(
            c,
            id + 10000,
            new Intent(c, CampusActivity.class).putExtra("go", "courses"),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    v.setOnClickPendingIntent(
        R.id.widget_add_btn,
        PendingIntent.getActivity(
            c,
            id + 20000,
            new Intent(c, CampusActivity.class).putExtra("go", "quick-add"),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    manager.updateAppWidget(id, v);
  }
}
