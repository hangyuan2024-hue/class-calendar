package com.laolao.classcalendar;

import android.widget.*;
import java.util.*;
import org.json.*;

/** The original metaverse XP, levels, daily missions and badges, calculated from saved work. */
final class CampusWorld {
  static JSONObject stats(CampusStore s) {
    String today = DateMath.today();
    JSONObject done = s.object("done_log_v1"),
        logs = s.object("habit_log_v1"),
        pomos = s.object("pomo_log_v1"),
        notes = s.object("plan_notes_v1");
    int doneToday = 0,
        checks = 0,
        checksToday = 0,
        best = 0,
        pomo = 0,
        goals = 0,
        goalsDone = 0,
        pdca = 0,
        ivy = 0;
    for (String id : CampusJson.keys(done)) if (today.equals(done.optString(id))) doneToday++;
    for (JSONObject h : CampusJson.rows(s.list("habits_v1"))) {
      JSONObject log = logs.optJSONObject(h.optString("id"));
      if (log == null) continue;
      for (String day : CampusJson.keys(log)) if (log.optBoolean(day)) checks++;
      if (log.optBoolean(today)) checksToday++;
      best = Math.max(best, CampusLearn.streak(log, today));
    }
    for (String day : CampusJson.keys(pomos)) pomo += Math.max(0, pomos.optInt(day));
    for (String id : CampusJson.keys(notes)) {
      JSONObject x = notes.optJSONObject(id);
      if (id.startsWith("smart:") && x != null) {
        goals++;
        if (x.optBoolean("done")) goalsDone++;
      }
      if (id.startsWith("pdca:") && x != null)
        pdca += Math.max(0, x.optInt("round", 1) - 1) + (x.optInt("stage") == 3 ? 1 : 0);
      if (id.startsWith("ivy:"))
        for (JSONObject item : CampusJson.rows(notes.opt(id)))
          if (!item.optString("text").isEmpty() && item.optBoolean("done")) ivy++;
    }
    long exp =
        done.length() * 10L + checks * 5L + pomo * 15L + goalsDone * 30L + pdca * 20L + ivy * 5L;
    int level = (int) Math.sqrt(exp / 40.0) + 1;
    String title = "新手旅人";
    int[] levels = {1, 2, 3, 5, 8, 12, 18};
    String[] names = {"新手旅人", "见习探索者", "时间猎手", "自律骑士", "星际学霸", "银河指挥官", "元宇宙传奇"};
    for (int i = 0; i < levels.length; i++) if (level >= levels[i]) title = names[i];
    return CampusJson.obj(
        "doneAll",
        done.length(),
        "doneToday",
        doneToday,
        "checks",
        checks,
        "checksToday",
        checksToday,
        "bestStreak",
        best,
        "pomos",
        pomo,
        "pomosToday",
        pomos.optInt(today),
        "goals",
        goals,
        "goalsDone",
        goalsDone,
        "pdcaRounds",
        pdca,
        "ivyDone",
        ivy,
        "exp",
        exp,
        "level",
        level,
        "lo",
        40L * (level - 1) * (level - 1),
        "hi",
        40L * level * level,
        "title",
        title);
  }

  static void identity(CampusActivity a, LinearLayout c) {
    CampusUi u = a.ui;
    JSONObject s = stats(a.store);
    c.addView(u.text("Lv." + s.optInt("level"), 34, u.theme.heroInk, true));
    u.gap(c, 7);
    c.addView(u.text(s.optString("title"), 13, u.theme.heroMuted, false));
    u.gap(c, 8);
    ProgressBar bar = new ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(1000);
    bar.setProgress(
        (int)
            ((s.optLong("exp") - s.optLong("lo"))
                * 1000
                / Math.max(1, s.optLong("hi") - s.optLong("lo"))));
    bar.setProgressTintList(android.content.res.ColorStateList.valueOf(u.accent));
    bar.setProgressBackgroundTintList(
        android.content.res.ColorStateList.valueOf(
            CampusUi.blend(u.accent, u.theme.heroEnd, .16f)));
    c.addView(bar, new LinearLayout.LayoutParams(-1, u.dp(5)));
    u.gap(c, 8);
    c.addView(
        u.text(s.optLong("exp") + " / " + s.optLong("hi") + " XP", 11, u.theme.heroMuted, false));
  }

  static void details(CampusActivity a) {
    CampusUi u = a.ui;
    JSONObject s = stats(a.store);
    u.section(a.content, "今日任务");
    String[] labels = {"完成一件事", "打卡一个习惯", "完成一轮专注"},
        keys = {"doneToday", "checksToday", "pomosToday"},
        routes = {"calendar", "growth", "pomo"};
    int[] xp = {10, 5, 15};
    for (int i = 0; i < labels.length; i++) {
      final int at = i;
      LinearLayout c = u.card(a.content);
      c.setOrientation(LinearLayout.HORIZONTAL);
      c.setGravity(android.view.Gravity.CENTER_VERTICAL);
      c.addView(u.badge(routes[i]), new LinearLayout.LayoutParams(u.dp(38), u.dp(38)));
      LinearLayout copy = u.column();
      copy.addView(u.text(labels[i], 15, u.ink, true));
      u.gap(copy, 6);
      copy.addView(
          u.text(Math.min(1, s.optInt(keys[i])) + " / 1 · +" + xp[i] + " EXP", 12, u.muted, false));
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
      p.leftMargin = u.dp(12);
      c.addView(copy, p);
      if (s.optInt(keys[i]) == 0) c.addView(u.button("去完成", () -> a.open(routes[at]), false));
      else c.addView(u.pill("已完成"));
    }
    String[]
        names =
            {
              "初次接入", "第一步", "十全十美", "百事通", "小火苗", "一周不断", "番茄新手", "专注大师", "神射手", "螺旋上升", "云端旅人",
              "课表达人"
            },
        requirements =
            {
              "进入元宇宙空间",
              "完成1件事",
              "累计完成10件事",
              "累计完成100件事",
              "任意习惯连续3天",
              "任意习惯连续7天",
              "完成1个番茄",
              "累计25个番茄",
              "达成1个SMART目标",
              "完成一轮PDCA",
              "开启账号同步",
              "已保存课程表"
            };
    boolean[] unlocked = {
      true,
      s.optInt("doneAll") >= 1,
      s.optInt("doneAll") >= 10,
      s.optInt("doneAll") >= 100,
      s.optInt("bestStreak") >= 3,
      s.optInt("bestStreak") >= 7,
      s.optInt("pomos") >= 1,
      s.optInt("pomos") >= 25,
      s.optInt("goalsDone") >= 1,
      s.optInt("pdcaRounds") >= 1,
      a.api.logged() && !a.store.bool("native_sync_local", false),
      a.store.list(CampusCourses.COURSES).length() > 0
    };
    int count = 0;
    for (boolean on : unlocked) if (on) count++;
    u.section(a.content, "成长徽章 · " + count + " / " + names.length);
    int columns = a.getResources().getConfiguration().fontScale > 1.3f ? 1 : 2;
    for (int i = 0; i < names.length; i += columns) {
      LinearLayout row = u.row();
      row.setGravity(android.view.Gravity.TOP);
      for (int j = i; j < Math.min(i + columns, names.length); j++) {
        LinearLayout holder = u.column();
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
        if (j > i) p.leftMargin = u.dp(10);
        row.addView(holder, p);
        LinearLayout c = u.card(holder);
        c.addView(u.text(unlocked[j] ? "✦" : "◇", 25, unlocked[j] ? u.accent : u.muted, true));
        u.gap(c, 10);
        c.addView(u.text(names[j], 15, unlocked[j] ? u.ink : u.muted, true));
        u.gap(c, 7);
        c.addView(u.text(requirements[j], 12, u.muted, false));
        c.setContentDescription(
            names[j] + "，" + (unlocked[j] ? "已解锁" : "未解锁") + "，" + requirements[j]);
      }
      a.content.addView(row);
    }
    u.section(a.content, "元宇宙小百科");
    for (String[] item : WIKI)
      a.content.addView(u.button(item[0], () -> CampusManage.message(a, item[0], item[1]), false));
  }

  static final String[][] WIKI = {
    {"什么是元宇宙", "元宇宙（Metaverse）指和现实世界平行、又互相连通的虚拟空间。人们可以用虚拟形象在里面学习、社交、工作和创作。这个词最早出自1992年的科幻小说《雪崩》。"},
    {"虚拟现实 VR", "VR用头戴设备把视野换成电脑生成的世界，转头、走动时画面跟着变。常用于游戏、模拟驾驶、虚拟实验室。"},
    {"增强现实 AR", "AR把虚拟内容叠加到真实画面上，比如手机扫课本出现立体模型、导航箭头画在路面上，给现实加一层信息。"},
    {"数字孪生", "给真实工厂、城市或校园在电脑里建立数字模型，同步真实数据。改方案前先在虚拟世界里试验。"},
    {"虚拟形象与数字人", "虚拟形象是你在元宇宙里的化身；数字人是能说话、有表情的虚拟人物，用于新闻播报、客服和虚拟主播。"},
    {"元宇宙里的学习", "在虚拟空间里可以走进细胞内部、站在古罗马街头、模拟危险的化学实验，让抽象知识更直观。"},
    {"安全小贴士", "保护个人信息，不随便透露真实姓名、学校和住址。遇到让你不舒服的人或内容，及时离开并告诉信任的老师或家长。"}
  };
}
