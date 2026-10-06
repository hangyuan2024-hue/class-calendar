package com.laolao.classcalendar;

import android.widget.*;
import java.util.*;
import org.json.*;

/** Website-compatible home card order and sizes, presented in a readable native phone grid. */
final class CampusHome {
  static final String[][] WIDGETS = {
    {"w:pins", "学习工作台", "calendar"}, {"w:hw", "我的作业", "homework"},
    {"w:cal", "日历安排", "calendar"}, {"w:encourage", "每日鼓励", ""},
    {"w:plan", "四象限规划", "plan"}, {"w:rings", "本周进度", "growth"},
    {"w:farm", "云宠农场", "farm"}, {"w:quick", "快捷工具", "tools"},
    {"w:habits", "今日打卡", "growth"}, {"w:pomo", "番茄专注", "pomo"},
    {"w:rank", "班级成长榜", "rank"}, {"w:course", "今日课程", "courses"},
    {"w:meta", "元宇宙身份", "meta"}
  };
  static final String[] QUOTES = {
    "每一次认真，都会留下进步。",
    "把目标拆小，今天就能向前一步。",
    "允许自己慢一点，也记得继续。",
    "休息好，才能走得更远。",
    "你比想象中更强大。",
    "完成一件小事，也是值得记住的一天。"
  };

  static JSONObject layout(CampusStore s) {
    JSONObject saved = s.object("home_layout_v1");
    if (saved.optJSONArray("home") != null) return saved;
    JSONArray cards = new JSONArray();
    for (String id :
        new String[] {
          "w:pins", "w:hw", "w:cal", "w:encourage", "w:plan", "w:rings", "w:farm", "w:quick"
        })
      cards.put(
          CampusJson.obj(
              "id",
              id,
              "w",
              id.equals("w:hw") || id.equals("w:cal") || id.equals("w:farm") ? 2 : 4,
              "h",
              1));
    return CampusJson.obj(
        "home",
        cards,
        "rail",
        new JSONArray(),
        "planCard",
        true,
        "encCard",
        true,
        "farmCard",
        true);
  }

  static String name(String id) {
    for (String[] w : WIDGETS) if (w[0].equals(id)) return w[1];
    return CampusManage.homeName(route(id));
  }

  static String route(String id) {
    for (String[] w : WIDGETS) if (w[0].equals(id)) return w[2];
    if (id.startsWith("t:")) return id.substring(2);
    String[]
        ids =
            {
              "course-schedule",
              "personal-diary",
              "exam-countdown",
              "campus-account-book",
              "error-notebook",
              "time-master",
              "word-buddy",
              "oracle",
              "random-draw"
            },
        routes =
            {
              "courses",
              "diary",
              "countdown",
              "ledger",
              "wrongbook",
              "time-master",
              "words",
              "oracle",
              "draw"
            };
    for (int i = 0; i < ids.length; i++) if (id.contains(ids[i])) return routes[i];
    return "plugins";
  }

  static boolean render(CampusActivity a) {
    JSONObject config = a.store.object("home_layout_v1");
    if (config.optJSONArray("home") == null) return false;
    CampusUi u = a.ui;
    if (!a.api.logged()) a.content.addView(u.button("登录账号，连接班级", () -> a.open("login"), true));
    else a.content.addView(u.button(a.loading ? "正在刷新…" : "刷新校园数据", a::refreshCloud, false));
    LinearLayout row = null;
    for (JSONObject widget : CampusJson.rows(config.opt("home"))) {
      String id = widget.optString("id");
      boolean wide =
          widget.optInt("w", 4) > 2 || a.getResources().getConfiguration().fontScale > 1.3f;
      JSONObject opts = a.store.object("fun_opts_v1");
      String preference =
          id.equals("w:rings")
              ? "rings"
              : id.equals("w:habits")
                  ? "habits"
                  : id.equals("w:plan") || id.equals("w:pomo")
                      ? "plan"
                      : id.equals("w:farm") ? "farm" : "";
      if (!preference.isEmpty() && !opts.optBoolean(preference, true)) continue;
      if (wide) row = null;
      if (row == null) {
        row = u.row();
        row.setGravity(android.view.Gravity.TOP);
        a.content.addView(row);
        u.gap(a.content, 12);
      }
      LinearLayout cell = u.column();
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
      if (row.getChildCount() > 0) p.leftMargin = u.dp(10);
      row.addView(cell, p);
      LinearLayout card = u.card(cell);
      card.setMinimumHeight(u.dp(110 * Math.max(1, Math.min(3, widget.optInt("h", 1)))));
      card.addView(u.text(name(id), 15, u.ink, true));
      u.gap(card, 10);
      body(a, card, id, wide);
      if (wide || row.getChildCount() == 2) row = null;
    }
    JSONArray rail = config.optJSONArray("rail");
    if (rail != null && rail.length() > 0) {
      u.section(a.content, "常用入口");
      for (int i = 0; i < rail.length(); i++) {
        String id = rail.optString(i);
        a.content.addView(u.button(name(id), () -> a.open(route(id)), false));
      }
    }
    a.content.addView(u.button("调整首页卡片与顺序", () -> edit(a), false));
    return true;
  }

  static void body(CampusActivity a, LinearLayout c, String id, boolean wide) {
    CampusUi u = a.ui;
    String route = route(id);
    List<JSONObject> pending = new ArrayList<>();
    for (JSONObject x : a.items()) if (!a.done(x) && !CampusSchool.hidden(a, x)) pending.add(x);
    pending.sort(Comparator.comparing(x -> x.optString("event_time", "9999")));
    if (id.equals("w:encourage")) {
      int at =
          Math.floorMod(a.store.number("native_quote", DateMath.today().hashCode()), QUOTES.length);
      c.addView(u.text(QUOTES[at], wide ? 20 : 15, u.accent, true));
      u.gap(c, 10);
      c.addView(
          u.button(
              "换一句",
              () -> {
                a.store.set("native_quote", at + 1);
                a.build();
              },
              false));
      return;
    }
    if (id.equals("w:pins") || id.equals("w:course")) {
      List<JSONObject> courses = CampusCourses.onDay(a.store, DateMath.today());
      c.addView(u.text(courses.size() + " 节课程", 24, u.accent, true));
      for (JSONObject x : courses.subList(0, Math.min(wide ? 3 : 1, courses.size())))
        c.addView(u.text(x.optString("t0") + "  " + x.optString("name"), 12, u.muted, false));
      if (courses.isEmpty()) c.addView(u.text("今天没有已安排课程", 12, u.muted, false));
    } else if (id.equals("w:hw") || id.equals("w:cal") || id.equals("w:plan")) {
      List<JSONObject> rows = new ArrayList<>();
      for (JSONObject x : pending)
        if (!id.equals("w:hw") || x.optString("msg_type").equals("作业")) rows.add(x);
      c.addView(u.text(rows.size() + " 项待办", 24, u.accent, true));
      for (JSONObject x : rows.subList(0, Math.min(wide ? 3 : 1, rows.size())))
        c.addView(u.button(x.optString("subject"), () -> CampusSchool.detail(a, x), false));
    } else if (id.equals("w:farm")) {
      JSONObject pet = a.store.object("farm_v1");
      c.addView(
          u.text(
              pet.optString("name", "小云朵") + " · Lv." + pet.optInt("level", 1),
              18,
              u.accent,
              true));
      c.addView(
          u.text(
              "养料 " + Math.max(0, CampusLearn.food(a) - pet.optLong("spent")), 13, u.muted, false));
    } else if (id.equals("w:rings")) {
      int done = 0;
      for (String key : CampusJson.keys(a.store.object("done_log_v1")))
        try {
          String day = a.store.object("done_log_v1").optString(key);
          if (day.compareTo(CampusCourses.monday(DateMath.today())) >= 0) done++;
        } catch (Exception ignored) {
        }
      c.addView(u.text("本周完成 " + done + " 项", 24, u.accent, true));
      c.addView(u.text("今日打卡 " + CampusLearn.habitToday(a.store) + " 次", 13, u.muted, false));
    } else if (id.equals("w:habits")) {
      for (JSONObject h : CampusJson.rows(a.store.list("habits_v1")))
        c.addView(
            u.button(
                h.optString("name"), () -> CampusLearn.habitToggle(a, h, DateMath.today()), false));
      if (a.store.list("habits_v1").length() == 0)
        c.addView(u.text("添加一个想坚持的小习惯", 12, u.muted, false));
    } else if (id.equals("w:pomo")) {
      JSONObject t = a.store.object(CampusPlanner.TIMER);
      c.addView(
          u.text(
              CampusPlanner.duration(
                  t.optBoolean("running")
                      ? Math.max(0, t.optLong("deadline") - System.currentTimeMillis())
                      : t.optLong("remaining", 25 * 60000L)),
              32,
              u.accent,
              true));
    } else if (id.equals("w:meta"))
      c.addView(
          u.text(
              "已完成 "
                  + a.store.object("done_log_v1").length()
                  + " 项 · 记忆晶片 "
                  + a.store.list("native_cards").length(),
              14,
              u.accent,
              true));
    else if (id.equals("w:quick")) {
      c.addView(u.button("＋ 记一件事", () -> CampusSchool.personalForm(a, null), true));
      u.gap(c, 8);
      c.addView(u.button("整理班群消息", () -> a.open("ask"), false));
    } else c.addView(u.text("点击进入原生工具", 12, u.muted, false));
    u.gap(c, 10);
    c.addView(u.button("打开", () -> a.open(route), false));
  }

  static void save(CampusActivity a, JSONObject data) {
    a.store.set("home_layout_v1", data);
    a.build();
    a.syncSoon();
  }

  static void edit(CampusActivity a) {
    JSONObject data = layout(a.store);
    JSONArray rows = data.optJSONArray("home");
    List<String> options = new ArrayList<>();
    for (JSONObject x : CampusJson.rows(rows))
      options.add(
          (options.size() + 1)
              + ". "
              + name(x.optString("id"))
              + " · "
              + (x.optInt("w", 4) > 2 ? "整行" : "半行"));
    options.add("＋ 添加首页卡片");
    options.add("使用默认卡片");
    options.add("恢复初始手机首页");
    a.ui.choose(
        "首页排版",
        options.toArray(new String[0]),
        i -> {
          if (i < rows.length()) {
            JSONObject x = rows.optJSONObject(i);
            a.ui.choose(
                name(x.optString("id")),
                new String[] {"上移", "下移", "整行 / 半行", "卡片高度", "从首页移除"},
                j -> {
                  if (j == 4) rows.remove(i);
                  else if (j == 2) CampusJson.put(x, "w", x.optInt("w", 4) > 2 ? 2 : 4);
                  else if (j == 3) {
                    a.ui.choose(
                        "高度",
                        new String[] {"紧凑", "标准", "展开"},
                        n -> {
                          CampusJson.put(x, "h", n + 1);
                          save(a, data);
                        });
                    return;
                  } else {
                    int to = i + (j == 0 ? -1 : 1);
                    if (to >= 0 && to < rows.length())
                      try {
                        Object other = rows.opt(to);
                        rows.put(to, x);
                        rows.put(i, other);
                      } catch (JSONException e) {
                        a.error(e);
                      }
                  }
                  save(a, data);
                });
          } else if (i == rows.length())
            a.ui.choose(
                "添加卡片",
                Arrays.stream(WIDGETS).map(w -> w[1]).toArray(String[]::new),
                n -> {
                  rows.put(CampusJson.obj("id", WIDGETS[n][0], "w", 4, "h", 1));
                  save(a, data);
                });
          else if (i == rows.length() + 1) {
            a.store.set("home_layout_v1", new JSONObject());
            save(a, layout(a.store));
          } else save(a, new JSONObject());
        });
  }
}
