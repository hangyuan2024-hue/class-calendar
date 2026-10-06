package com.laolao.classcalendar;

import android.graphics.*;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Familiar website tasks, arranged once for a native phone screen. */
final class CampusDashboard {
  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    Calendar now = Calendar.getInstance();
    LinearLayout heading = u.row();
    LinearLayout date = u.column();
    String[] days = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
    date.addView(
        u.text(
            (now.get(Calendar.MONTH) + 1)
                + "月"
                + now.get(Calendar.DAY_OF_MONTH)
                + "日  "
                + days[now.get(Calendar.DAY_OF_WEEK) - 1],
            23,
            u.ink,
            true));
    u.gap(date, 6);
    String name = a.api.logged() ? a.me.optString("display_name", "同学") : "同学";
    date.addView(u.text("你好，" + name + "。今天的安排都在这里。", 12, u.muted, false));
    heading.addView(date, new LinearLayout.LayoutParams(0, -2, 1));
    if (a.getResources().getConfiguration().fontScale <= 1.25f) {
      TextView focus = u.button("开始专注", () -> a.open("pomo"), false);
      focus.setTextSize(12);
      heading.addView(focus);
    }
    a.content.addView(heading);
    u.gap(a.content, 14);
    a.content.addView(CampusGuide.suggestion(a));
    u.gap(a.content, 14);
    // A saved website layout replaces the default cards; it is never added underneath a second
    // dashboard.
    if (a.store.object("home_layout_v1").optJSONArray("home") != null) {
      CampusHome.render(a);
    } else {
      today(a);
      weekProgress(a);
      shortcuts(a);
      growth(a);
    }
    String photo = a.store.string("native_home_photo", "");
    if (!photo.isEmpty()) CampusPhone.image(a, a.content, photo);
    LinearLayout sync = u.row();
    sync.setPadding(u.dp(2), u.dp(12), u.dp(2), u.dp(4));
    String status =
        !a.api.logged()
            ? "登录网站原账号，同步班级与作业"
            : a.loading ? "正在同步…" : a.cloudError.isEmpty() ? "班级与个人记录" : "离线记录可用";
    TextView state = u.text(status, 11, u.muted, false);
    sync.addView(state, new LinearLayout.LayoutParams(0, -2, 1));
    TextView action =
        u.button(
            a.api.logged() ? "刷新" : "登录",
            () -> {
              if (a.api.logged()) a.refreshCloud();
              else a.open("login");
            },
            false);
    action.setTextSize(12);
    sync.addView(action);
    a.content.addView(sync);
    if (!a.cloudError.isEmpty()) a.content.addView(u.text(a.cloudError, 11, u.muted, false));
  }

  static void today(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout card = u.card(a.content);
    LinearLayout head = u.row();
    head.addView(u.text("今天的安排", 17, u.ink, true), new LinearLayout.LayoutParams(0, -2, 1));
    TextView timetable = u.button("课表 ›", () -> a.open("courses"), false);
    timetable.setTextSize(12);
    u.touch(timetable, Color.TRANSPARENT, 12, 0);
    head.addView(timetable);
    card.addView(head);
    String time =
        String.format(
            Locale.ROOT,
            "%02d:%02d",
            Calendar.getInstance().get(Calendar.HOUR_OF_DAY),
            Calendar.getInstance().get(Calendar.MINUTE));
    List<JSONObject> courses = CampusCourses.onDay(a.store, DateMath.today());
    if (courses.isEmpty()) {
      LinearLayout blank = u.column();
      blank.setPadding(u.dp(14), u.dp(13), u.dp(14), u.dp(13));
      blank.setBackground(u.shape(u.soft, 14, 0));
      blank.addView(u.text("今天没有课程", 14, u.ink, true));
      u.gap(blank, 5);
      TextView importHint = u.text("还没录入课表？点击这里导入或添加。", 12, u.accent, false);
      blank.addView(importHint);
      blank.setMinimumHeight(u.dp(64));
      blank.setOnClickListener(v -> a.open("courses"));
      blank.setContentDescription("打开课程表，导入或添加课程");
      card.addView(blank);
    } else {
      for (JSONObject course : courses.subList(0, Math.min(3, courses.size())))
        courseRow(a, card, course, time);
      if (courses.size() > 3) {
        TextView more =
            u.button(
                "查看今天全部 " + courses.size() + " 节课",
                () -> {
                  a.selectedDay = DateMath.today();
                  a.open("calendar");
                },
                false);
        card.addView(more);
      }
    }
    List<JSONObject> tasks = new ArrayList<>();
    for (JSONObject x : a.items())
      if (!a.done(x)
          && !CampusSchool.hidden(a, x)
          && DateMath.today().equals(CampusJson.date(x.optString("event_time")))) tasks.add(x);
    tasks.sort(Comparator.comparing(x -> x.optString("event_time", "9999")));
    if (!tasks.isEmpty()) {
      u.gap(card, 12);
      card.addView(u.text("待办事项", 12, u.muted, true));
      u.gap(card, 4);
      for (JSONObject x : tasks.subList(0, Math.min(2, tasks.size()))) taskRow(a, card, x);
      if (tasks.size() > 2)
        card.addView(
            u.button(
                "查看全部 " + tasks.size() + " 项待办",
                () -> {
                  a.selectedDay = DateMath.today();
                  a.open("calendar");
                },
                false));
    }
    u.gap(card, 12);
    TextView add =
        u.button(
            "＋ 记一件事",
            () -> {
              a.selectedDay = DateMath.today();
              CampusSchool.personalForm(a, null);
            },
            true);
    add.setContentDescription("记一件事");
    card.addView(add);
  }

  static void courseRow(CampusActivity a, LinearLayout parent, JSONObject x, String now) {
    CampusUi u = a.ui;
    boolean current =
        x.optString("t0").compareTo(now) <= 0 && x.optString("t1").compareTo(now) >= 0;
    LinearLayout row = u.row();
    row.setPadding(u.dp(12), u.dp(12), u.dp(10), u.dp(12));
    uiRow(u, row, current ? u.soft : u.surface);
    LinearLayout times = u.column();
    times.addView(u.text(x.optString("t0"), 14, current ? u.accent : u.ink, true));
    u.gap(times, 6);
    times.addView(u.text(x.optString("t1"), 11, u.muted, false));
    row.addView(times, new LinearLayout.LayoutParams(u.dp(56), -2));
    View bar = new View(a);
    bar.setBackground(u.shape(current ? u.accent : u.border, 2, 0));
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(u.dp(3), u.dp(33));
    bp.rightMargin = u.dp(12);
    row.addView(bar, bp);
    LinearLayout body = u.column();
    TextView title = u.text(x.optString("name"), 16, u.ink, true);
    title.setMaxLines(2);
    body.addView(title);
    u.gap(body, 6);
    body.addView(
        u.text((current ? "正在上课 · " : "") + x.optString("location", "教室待定"), 11, u.muted, false));
    row.addView(body, new LinearLayout.LayoutParams(0, -2, 1));
    row.addView(u.text("›", 21, u.muted, false));
    row.setOnClickListener(v -> CampusCourses.detail(a, x));
    row.setContentDescription("查看课程：" + x.optString("name"));
    parent.addView(row);
  }

  static void taskRow(CampusActivity a, LinearLayout parent, JSONObject x) {
    CampusUi u = a.ui;
    LinearLayout row = u.row();
    row.setMinimumHeight(u.dp(56));
    String at = x.optString("event_time");
    TextView time = u.text(at.length() >= 16 ? at.substring(11, 16) : "全天", 12, u.muted, false);
    row.addView(time, new LinearLayout.LayoutParams(u.dp(56), -2));
    TextView name = u.text(x.optString("subject", "个人事项"), 14, u.ink, false);
    name.setMaxLines(2);
    name.setEllipsize(TextUtils.TruncateAt.END);
    LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(0, -2, 1);
    np.leftMargin = u.dp(15);
    row.addView(name, np);
    TextView done = u.button("✓", () -> a.mark(CampusJson.copy(x)), false);
    done.setContentDescription("完成：" + x.optString("subject"));
    u.touch(done, Color.TRANSPARENT, 12, 0);
    done.setTextSize(17);
    row.addView(done, new LinearLayout.LayoutParams(u.dp(48), u.dp(48)));
    row.setOnClickListener(v -> CampusSchool.detail(a, x));
    parent.addView(row);
  }

  static int[] counts(CampusActivity a) {
    int[] result = new int[6];
    String mon = CampusCourses.monday(DateMath.today()), sun = DateMath.plus(mon, 6);
    for (JSONObject x : a.items()) {
      if (CampusSchool.hidden(a, x)) continue;
      String date = CampusJson.date(x.optString("event_time"));
      if (date.compareTo(mon) < 0 || date.compareTo(sun) > 0) continue;
      result[3]++;
      if (a.done(x)) result[2]++;
      if (x.optString("msg_type").equals("作业")) {
        result[1]++;
        if (a.done(x)) result[0]++;
      }
    }
    result[4] = CampusLearn.habitToday(a.store);
    result[5] = a.store.list("habits_v1").length();
    return result;
  }

  static void weekProgress(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout card = u.card(a.content);
    card.addView(u.text("学习进度", 16, u.ink, true));
    u.gap(card, 16);
    LinearLayout row = u.row();
    row.setGravity(Gravity.TOP);
    int[] stats = counts(a);
    String[] labels = {"本周作业", "本周事项", "今日打卡"}, routes = {"homework", "calendar", "growth"};
    boolean stacked = a.getResources().getConfiguration().fontScale > 1.3f;
    if (stacked) row.setOrientation(LinearLayout.VERTICAL);
    for (int i = 0; i < 3; i++) {
      final String route = routes[i];
      int done = stats[i * 2], total = stats[i * 2 + 1];
      LinearLayout cell = stacked ? u.row() : u.column();
      cell.setGravity(stacked ? Gravity.CENTER_VERTICAL : Gravity.CENTER);
      cell.setPadding(u.dp(4), u.dp(5), u.dp(4), u.dp(5));
      u.touch(cell, Color.TRANSPARENT, 12, 0);
      cell.addView(
          new Progress(a, done, total, u.tone(route)),
          new LinearLayout.LayoutParams(u.dp(44), u.dp(44)));
      if (!stacked) u.gap(cell, 10);
      LinearLayout words = u.column();
      TextView label = u.text(labels[i], 11, u.muted, false);
      label.setGravity(stacked ? Gravity.LEFT : Gravity.CENTER);
      words.addView(label);
      u.gap(words, 6);
      TextView value = u.text(done + " / " + total, 15, u.ink, true);
      value.setGravity(stacked ? Gravity.LEFT : Gravity.CENTER);
      words.addView(value);
      LinearLayout.LayoutParams wp =
          new LinearLayout.LayoutParams(stacked ? 0 : -1, -2, stacked ? 1 : 0);
      if (stacked) wp.leftMargin = u.dp(15);
      cell.addView(words, wp);
      cell.setContentDescription(labels[i] + "，" + done + "/" + total);
      cell.setOnClickListener(v -> a.open(route));
      row.addView(cell, new LinearLayout.LayoutParams(stacked ? -1 : 0, -2, stacked ? 0 : 1));
    }
    card.addView(row);
  }

  static void shortcuts(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout card = u.card(a.content);
    LinearLayout head = u.row();
    head.addView(u.text("常用工具", 16, u.ink, true), new LinearLayout.LayoutParams(0, -2, 1));
    TextView add = u.button("＋", () -> CampusToolbox.editPinned(a), false);
    add.setTextSize(21);
    add.setPadding(0, 0, 0, 0);
    add.setContentDescription("选择首页常用工具");
    u.touch(add, Color.TRANSPARENT, 12, 0);
    head.addView(add, new LinearLayout.LayoutParams(u.dp(48), u.dp(48)));
    TextView all = u.button("全部 ›", () -> a.open("tools"), false);
    all.setTextSize(12);
    u.touch(all, Color.TRANSPARENT, 12, 0);
    head.addView(all);
    card.addView(head);
    JSONArray pinned = CampusToolbox.pinned(a);
    List<String[]> items = new ArrayList<>();
    for (int i = 0; i < pinned.length(); i++)
      items.add(new String[] {pinned.optString(i), CampusToolbox.name(pinned.optString(i))});
    if (items.isEmpty())
      card.addView(u.button("选择想放在这里的工具", () -> CampusToolbox.editPinned(a), false));
    else u.dock(card, items.toArray(new String[0][]));
  }

  static void growth(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout card = u.card(a.content);
    JSONObject pet = a.store.object("farm_v1");
    LinearLayout row = u.row();
    row.addView(u.badge("farm"), new LinearLayout.LayoutParams(u.dp(42), u.dp(42)));
    LinearLayout body = u.column();
    body.addView(
        u.text(pet.optString("name", "小云朵") + " · Lv." + pet.optInt("level", 1), 14, u.ink, true));
    u.gap(body, 5);
    body.addView(
        u.text(
            "养料 " + Math.max(0, CampusLearn.food(a) - pet.optLong("spent")) + " · 完成事项和打卡即可获得",
            11,
            u.muted,
            false));
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, -2, 1);
    bp.leftMargin = u.dp(12);
    row.addView(body, bp);
    row.addView(u.text("›", 22, u.muted, false));
    card.addView(row);
    card.setOnClickListener(v -> a.open("farm"));
    card.setContentDescription("打开云宠农场");
  }

  static void uiRow(CampusUi u, View row, int colour) {
    u.touch(row, colour, 14, 0);
  }

  static final class Progress extends View {
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    final CampusUi u;
    final int done, total, colour;

    Progress(CampusActivity a, int done, int total, int colour) {
      super(a);
      u = a.ui;
      this.done = done;
      this.total = total;
      this.colour = colour;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas c) {
      float s = Math.min(getWidth(), getHeight());
      float inset = u.dp(3);
      RectF r = new RectF(inset, inset, s - inset, s - inset);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(u.dp(4));
      p.setStrokeCap(Paint.Cap.ROUND);
      p.setColor(u.soft);
      c.drawArc(r, 0, 360, false, p);
      p.setColor(colour);
      if (total > 0) c.drawArc(r, -90, 360f * Math.min(done, total) / total, false, p);
      p.setStyle(Paint.Style.FILL);
      p.setTextSize(u.dp(10));
      p.setTypeface(Typeface.DEFAULT_BOLD);
      p.setTextAlign(Paint.Align.CENTER);
      p.setColor(u.muted);
      String value = total > 0 ? Math.round(100f * Math.min(done, total) / total) + "%" : "—";
      c.drawText(value, s / 2, s / 2 - (p.ascent() + p.descent()) / 2, p);
    }
  }
}
