package com.laolao.classcalendar;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** A native daily dashboard: every date, count and preview comes from the saved campus records. */
final class CampusDashboard {
  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    Calendar now = Calendar.getInstance();
    String greeting =
        now.get(Calendar.HOUR_OF_DAY) < 12
            ? "上午好"
            : now.get(Calendar.HOUR_OF_DAY) < 18 ? "下午好" : "晚上好";
    String name = a.api.logged() ? a.me.optString("display_name", "同学") : "同学";
    LinearLayout intro = u.row();
    TextView hello = u.text(greeting + "，" + name, 12, u.muted, false);
    hello.setSingleLine(true);
    hello.setEllipsize(TextUtils.TruncateAt.END);
    intro.addView(hello, new LinearLayout.LayoutParams(0, -2, 1));
    intro.addView(
        u.pill((now.get(Calendar.MONTH) + 1) + "月" + now.get(Calendar.DAY_OF_MONTH) + "日"));
    a.content.addView(intro);
    u.gap(a.content, 8);
    a.content.addView(u.text("今日工作台", 26, u.ink, true));
    u.gap(a.content, 15);
    week(a);
    u.gap(a.content, 15);
    hero(a, now);
    metrics(a);
    String photo = a.store.string("native_home_photo", "");
    if (!photo.isEmpty()) CampusPhone.image(a, a.content, photo);
    if (a.store.object("home_layout_v1").optJSONArray("home") != null) {
      u.section(a.content, "你的学习工作台");
      CampusHome.render(a);
      return;
    }
    u.sectionLink(a.content, "常用工具", "全部工具", () -> a.open("tools"));
    JSONArray pins = a.store.list("native_home_tools");
    if (pins.length() == 0)
      pins = new JSONArray(Arrays.asList("homework", "class", "wrongbook", "ledger"));
    List<String[]> shortcuts = new ArrayList<>();
    for (int i = 0; i < pins.length(); i++)
      shortcuts.add(new String[] {pins.optString(i), CampusManage.homeName(pins.optString(i))});
    u.dock(a.content, shortcuts.toArray(new String[0][]));
    JSONObject world = CampusWorld.stats(a.store);
    int focus =
        Math.max(1, Math.min(180, a.store.object("native_pomo_config").optInt("focus", 25)));
    u.featurePair(
        a.content,
        new String[][] {
          {"pomo", "留一段专注时间", focus + " 分钟", "开始一轮番茄专注"},
          {"meta", "我的成长星系", "Lv." + world.optInt("level"), world.optLong("exp") + " 经验 · 每一步都算数"}
        });
    u.sectionLink(a.content, "接下来的安排", "查看日历", () -> a.open("calendar"));
    List<JSONObject> tasks = new ArrayList<>();
    for (JSONObject x : a.items()) if (!a.done(x) && !CampusSchool.hidden(a, x)) tasks.add(x);
    tasks.sort(Comparator.comparing(x -> x.optString("event_time", "9999")));
    if (tasks.isEmpty()) {
      LinearLayout blank = u.card(a.content);
      LinearLayout row = u.row();
      row.addView(u.badge("calendar"), new LinearLayout.LayoutParams(u.dp(38), u.dp(38)));
      LinearLayout copy = u.column();
      copy.addView(u.text("今天，留一点自由的空间", 14, u.ink, true));
      u.gap(copy, 5);
      copy.addView(u.text("新安排会出现在这里，也可以先休息一下。", 11, u.muted, false));
      LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1);
      cp.leftMargin = u.dp(12);
      row.addView(copy, cp);
      blank.addView(row);
    } else for (JSONObject x : tasks.subList(0, Math.min(3, tasks.size()))) agenda(a, a.content, x);
    u.section(a.content, "学习与生活");
    u.tileGrid(
        a.content,
        new String[][] {
          {"countdown", "考试倒计时", "让复习计划更有方向"},
          {"diary", "我的日记", "记住校园里的小瞬间"},
          {"phone", "手机助手", "录音、扫描与语音速记"},
          {"farm", "云宠农场", "用今天的进步喂养云宠"}
        });
    if (!a.api.logged())
      u.toolRows(a.content, new String[][] {{"login", "连接你的班级", "登录后同步作业、安排和班级交流"}});
    else {
      u.sectionLink(
          a.content,
          a.loading ? "正在同步校园记录" : a.cloudError.isEmpty() ? "校园记录已保留" : "离线记录可用",
          "刷新",
          a::refreshCloud);
      if (!a.cloudError.isEmpty()) a.content.addView(u.text(a.cloudError, 12, u.muted, false));
    }
  }

  static void week(CampusActivity a) {
    CampusUi u = a.ui;
    Calendar now = Calendar.getInstance();
    String today = DateMath.today(),
        mon = DateMath.plus(today, -(now.get(Calendar.DAY_OF_WEEK) + 5) % 7);
    LinearLayout line = u.row();
    boolean compact = a.getResources().getConfiguration().screenWidthDp <= 340;
    String[] labels = {"一", "二", "三", "四", "五", "六", "日"};
    for (int i = 0; i < 7; i++) {
      String date = DateMath.plus(mon, i);
      boolean on = date.equals(today);
      LinearLayout day = u.column();
      day.setGravity(Gravity.CENTER);
      day.setPadding(0, u.dp(10), 0, u.dp(8));
      u.touch(day, on ? u.accent : Color.TRANSPARENT, 15, 0);
      TextView weekday = u.text(labels[i], 10, on ? u.onAccent() : u.muted, false);
      weekday.setGravity(Gravity.CENTER);
      day.addView(weekday);
      u.gap(day, 8);
      TextView number =
          u.text(String.valueOf(DateMath.parts(date)[2]), 17, on ? u.onAccent() : u.ink, true);
      number.setGravity(Gravity.CENTER);
      day.addView(number);
      boolean occupied = !CampusCourses.onDay(a.store, date).isEmpty();
      for (JSONObject x : a.items())
        if (date.equals(CampusJson.date(x.optString("event_time"))) && !CampusSchool.hidden(a, x))
          occupied = true;
      TextView dot = u.text(occupied ? "•" : " ", 9, on ? u.onAccent() : u.accent, true);
      dot.setGravity(Gravity.CENTER);
      day.addView(dot);
      day.setContentDescription("查看 " + date + " 的日程" + (on ? "，今天" : ""));
      day.setOnClickListener(
          v -> {
            a.selectedDay = date;
            a.open("calendar");
          });
      LinearLayout.LayoutParams lp =
          new LinearLayout.LayoutParams(compact ? u.dp(48) : 0, -2, compact ? 0 : 1);
      if (i > 0) lp.leftMargin = u.dp(2);
      line.addView(day, lp);
    }
    if (compact) {
      HorizontalScrollView s = new HorizontalScrollView(a);
      s.setHorizontalScrollBarEnabled(false);
      s.addView(line);
      a.content.addView(s);
      int index = (now.get(Calendar.DAY_OF_WEEK) + 5) % 7;
      s.post(() -> s.scrollTo(u.dp(Math.max(0, index - 2) * 50), 0));
    } else a.content.addView(line);
  }

  static void hero(CampusActivity a, Calendar now) {
    CampusUi u = a.ui;
    String time =
        String.format(
            Locale.ROOT, "%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE));
    List<JSONObject> courses = CampusCourses.onDay(a.store, DateMath.today());
    JSONObject next = null;
    for (JSONObject course : courses)
      if (course.optString("t1").compareTo(time) >= 0) {
        next = course;
        break;
      }
    final JSONObject course = next;
    LinearLayout hero = u.card(a.content);
    GradientDrawable gradient =
        new GradientDrawable(
            GradientDrawable.Orientation.TL_BR, new int[] {u.theme.heroStart, u.theme.heroEnd});
    gradient.setCornerRadius(u.dp(24));
    hero.setBackground(gradient);
    hero.setPadding(u.dp(20), u.dp(18), u.dp(20), u.dp(18));
    LinearLayout top = u.row();
    String status =
        course == null ? "今日学习空间" : course.optString("t0").compareTo(time) <= 0 ? "正在上课" : "下一节课";
    TextView flag = u.text("●  " + status, 10, u.theme.heroMuted, true);
    top.addView(flag, new LinearLayout.LayoutParams(0, -2, 1));
    top.addView(
        new CampusUi.Icon(a, "courses", u.theme.heroMuted),
        new LinearLayout.LayoutParams(u.dp(18), u.dp(18)));
    hero.addView(top);
    u.gap(hero, 14);
    LinearLayout main = u.row();
    LinearLayout story = u.column();
    TextView name =
        u.text(
            course == null
                ? courses.isEmpty() ? "今天，从容一点。" : "课程结束，给自己一点时间。"
                : course.optString("name"),
            23,
            u.theme.heroInk,
            true);
    name.setMaxLines(2);
    name.setEllipsize(TextUtils.TruncateAt.END);
    story.addView(name);
    u.gap(story, 9);
    story.addView(
        u.text(
            course == null
                ? "从一件小事开始，慢慢靠近你的目标。"
                : course.optString("t0") + " — " + course.optString("t1"),
            12,
            u.theme.heroMuted,
            false));
    if (course != null && !course.optString("location").isEmpty()) {
      u.gap(story, 5);
      story.addView(u.text(course.optString("location"), 11, u.theme.heroMuted, false));
    }
    main.addView(story, new LinearLayout.LayoutParams(0, -2, 1));
    if (a.getResources().getConfiguration().fontScale <= 1.25f
        && a.getResources().getConfiguration().screenWidthDp > 340)
      main.addView(new CampusVisual.TodayArt(a), new LinearLayout.LayoutParams(u.dp(65), u.dp(76)));
    hero.addView(main);
    u.gap(hero, 15);
    LinearLayout actions = u.row();
    boolean stacked = a.getResources().getConfiguration().fontScale > 1.25f;
    if (stacked) actions.setOrientation(LinearLayout.VERTICAL);
    TextView add =
        u.button(
            course == null ? "＋ 记一件事" : "查看课程",
            () -> {
              if (course == null) CampusSchool.personalForm(a, null);
              else CampusCourses.detail(a, course);
            },
            true);
    u.touch(add, u.theme.heroInk, 12, 0);
    add.setTextColor(u.theme.heroStart);
    actions.addView(add, new LinearLayout.LayoutParams(stacked ? -1 : 0, -2, stacked ? 0 : 1));
    TextView more = u.button("完整课表 ›", () -> a.open("courses"), false);
    u.touch(more, Color.TRANSPARENT, 12, 0);
    more.setTextColor(u.theme.heroInk);
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(stacked ? -1 : 0, -2, stacked ? 0 : 1);
    if (stacked) lp.topMargin = u.dp(8);
    else lp.leftMargin = u.dp(8);
    actions.addView(more, lp);
    hero.addView(actions);
  }

  static void metrics(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout line = u.row();
    line.setPadding(0, u.dp(3), 0, u.dp(10));
    long tasks = a.items().stream().filter(x -> !a.done(x) && !CampusSchool.hidden(a, x)).count();
    String[] values = {
      String.valueOf(CampusCourses.onDay(a.store, DateMath.today()).size()),
      String.valueOf(tasks),
      String.valueOf(CampusLearn.habitToday(a.store))
    };
    String[] labels = {"今日课程", "待办事项", "今日打卡"}, routes = {"courses", "calendar", "growth"};
    for (int i = 0; i < 3; i++) {
      final String route = routes[i];
      LinearLayout cell = u.column();
      cell.setGravity(Gravity.CENTER);
      cell.setPadding(0, u.dp(8), 0, u.dp(8));
      u.touch(cell, Color.TRANSPARENT, 12, 0);
      TextView value = u.text(values[i], 25, u.ink, true);
      value.setGravity(Gravity.CENTER);
      cell.addView(value);
      u.gap(cell, 6);
      TextView label = u.text(labels[i], 10, u.muted, false);
      label.setGravity(Gravity.CENTER);
      cell.addView(label);
      cell.setContentDescription(labels[i] + "，" + values[i]);
      cell.setOnClickListener(v -> a.open(route));
      line.addView(cell, new LinearLayout.LayoutParams(0, -2, 1));
      if (i < 2) {
        View divider = new View(a);
        divider.setBackgroundColor(u.border);
        line.addView(divider, new LinearLayout.LayoutParams(u.dp(1), u.dp(25)));
      }
    }
    a.content.addView(line);
  }

  static void agenda(CampusActivity a, LinearLayout parent, JSONObject x) {
    CampusUi u = a.ui;
    LinearLayout card = u.card(parent);
    card.setPadding(u.dp(14), u.dp(14), u.dp(14), u.dp(14));
    LinearLayout row = u.row();
    String at = x.optString("event_time"), day = CampusJson.date(at);
    LinearLayout stamp = u.column();
    stamp.setGravity(Gravity.CENTER);
    stamp.setPadding(u.dp(7), u.dp(8), u.dp(7), u.dp(8));
    stamp.setBackground(u.shape(u.soft, 12, 0));
    stamp.addView(
        u.text(
            day.isEmpty()
                ? "待定"
                : day.equals(DateMath.today()) ? "今天" : day.substring(5).replace('-', '/'),
            10,
            u.accent,
            true));
    u.gap(stamp, 5);
    stamp.addView(u.text(at.length() >= 16 ? at.substring(11, 16) : "全天", 13, u.ink, true));
    row.addView(stamp, new LinearLayout.LayoutParams(u.dp(57), -2));
    LinearLayout copy = u.column();
    TextView title = u.text(x.optString("subject", "我的事项"), 14, u.ink, true);
    title.setMaxLines(2);
    title.setEllipsize(TextUtils.TruncateAt.END);
    copy.addView(title);
    u.gap(copy, 6);
    String meta = x.optBoolean("_mine") ? "个人事项" : x.optString("msg_type", "班级安排");
    if (!x.optString("location").isEmpty()) meta += " · " + x.optString("location");
    copy.addView(u.text(meta, 11, u.muted, false));
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1);
    cp.setMargins(u.dp(12), 0, u.dp(8), 0);
    row.addView(copy, cp);
    TextView complete = u.button("✓", () -> a.mark(CampusJson.copy(x)), false);
    complete.setContentDescription("完成：" + x.optString("subject", "事项"));
    complete.setTextSize(17);
    row.addView(complete, new LinearLayout.LayoutParams(u.dp(48), u.dp(48)));
    card.addView(row);
    card.setOnClickListener(v -> CampusSchool.detail(a, x));
    card.setContentDescription("查看安排：" + x.optString("subject", "事项"));
  }
}
