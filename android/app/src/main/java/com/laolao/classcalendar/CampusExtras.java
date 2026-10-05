package com.laolao.classcalendar;

import android.widget.*;
import java.util.*;
import java.util.zip.GZIPInputStream;
import org.json.*;

/** Additional plugins discovered in the live published catalog, reimplemented as native screens. */
final class CampusExtras {
  static JSONObject oracle;

  static boolean handles(String p) {
    return Arrays.asList("time-master", "words", "oracle", "draw").contains(p);
  }

  static void render(CampusActivity a, String p) {
    if (p.equals("words")) CampusWords.render(a);
    else if (p.equals("time-master")) time(a);
    else if (p.equals("draw")) draw(a);
    else oracle(a);
  }

  static void time(CampusActivity a) {
    CampusUi u = a.ui;
    String day = a.store.string("native_frog_day", DateMath.today()),
        kind = a.store.string("native_frog_scope", "每天"),
        slot = kind.equals("每周") ? CampusCourses.monday(day) : day,
        key = kind + ":" + slot;
    u.title(a.content, "时间管理大师", "先吃掉最重要的三只青蛙，再把专注留给当下。");
    u.actionRow(
        a.content,
        new String[] {kind + "三只青蛙 ▾", "选择日期"},
        new Runnable[] {
          () ->
              u.choose(
                  "规划范围",
                  new String[] {"每天", "每周"},
                  i -> {
                    a.store.set("native_frog_scope", i == 0 ? "每天" : "每周");
                    a.build();
                  }),
          () ->
              u.form(
                  "计划日期",
                  CampusJson.obj("date", day),
                  v -> {
                    a.store.set("native_frog_day", v.optString("date"));
                    a.build();
                  },
                  CampusUi.f("date", "日期", "date"))
        });
    u.section(a.content, slot + " · 重要任务");
    JSONArray rows = CampusJson.arr(a.store.object("native_frogs").opt(key));
    for (int i = 0; i < rows.length(); i++) {
      JSONObject x = rows.optJSONObject(i);
      if (x == null) continue;
      final int index = i;
      LinearLayout c = u.card(a.content);
      c.addView(
          u.pill(
              x.optString("priority", "重要不紧急") + " · " + (x.optBoolean("done") ? "已完成" : "进行中")));
      u.gap(c, 10);
      c.addView(u.text((i + 1) + ". " + x.optString("title"), 19, u.ink, true));
      u.gap(c, 8);
      c.addView(
          u.text(
              "预计 "
                  + x.optInt("planMin")
                  + "分钟 · 实际专注 "
                  + x.optInt("actualMin")
                  + "分钟 · "
                  + x.optInt("stars")
                  + "星",
              12,
              u.muted,
              false));
      u.gap(c, 14);
      u.actionRow(
          c,
          new String[] {"为它开始专注", x.optBoolean("done") ? "撤销完成" : "完成这只青蛙"},
          new Runnable[] {
            () -> {
              JSONObject timer = a.store.object(CampusPlanner.TIMER);
              if (timer.optBoolean("running")) {
                a.toast("已有计时运行中，请先结束或暂停");
                a.open("pomo");
                return;
              }
              a.store.set(
                  CampusPlanner.TIMER,
                  CampusJson.obj(
                      "id",
                      CampusJson.id(),
                      "phase",
                      "focus",
                      "remaining",
                      a.store.object("native_pomo_config").optInt("focus", 25) * 60000L,
                      "running",
                      false,
                      "frog_key",
                      key,
                      "frog_id",
                      x.optString("id"),
                      "title",
                      x.optString("title")));
              a.open("pomo");
              CampusPlanner.toggle(a);
            },
            () -> {
              CampusJson.put(x, "done", !x.optBoolean("done"));
              try {
                rows.put(index, x);
              } catch (Exception e) {
                a.error(e);
              }
              a.store.entry("native_frogs", key, rows);
              a.build();
            }
          });
      c.addView(
          u.button(
              "编辑 / 删除",
              () ->
                  u.choose(
                      x.optString("title"),
                      new String[] {"编辑", "删除"},
                      j -> {
                        if (j == 0) frogForm(a, key, rows, index, x);
                        else
                          u.confirm(
                              "删除任务？",
                              x.optString("title"),
                              () -> {
                                rows.remove(index);
                                a.store.entry("native_frogs", key, rows);
                                a.build();
                              });
                      }),
              false));
    }
    if (rows.length() < 3)
      a.content.addView(
          u.button(
              "＋ 添加第 " + (rows.length() + 1) + "只青蛙",
              () -> frogForm(a, key, rows, -1, null),
              true));
    u.section(a.content, "专注与统计");
    u.actionRow(
        a.content,
        new String[] {"番茄计时与设置", "真实学习周报"},
        new Runnable[] {() -> a.open("pomo"), () -> a.open("report")});
    u.actionRow(
        a.content,
        new String[] {"任务待办池", "数据备份"},
        new Runnable[] {() -> a.open("plan"), () -> a.open("backup")});
  }

  static void frogForm(CampusActivity a, String key, JSONArray rows, int index, JSONObject x) {
    a.ui.form(
        "重要任务",
        x == null
            ? CampusJson.obj(
                "id",
                CampusJson.id(),
                "planMin",
                25,
                "actualMin",
                0,
                "stars",
                1,
                "priority",
                "重要不紧急",
                "done",
                false)
            : x,
        v -> {
          if (v.optInt("stars") > 5
              || v.optInt("stars") < 0
              || v.optInt("planMin") < 1
              || v.optInt("planMin") > 10080)
            throw new IllegalArgumentException("星级0—5，预计分钟1—10080");
          if (index < 0) rows.put(v);
          else rows.put(index, v);
          a.store.entry("native_frogs", key, rows);
          a.build();
        },
        CampusUi.f("title", "任务名称"),
        CampusUi.choice("priority", "优先级", "重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急"),
        CampusUi.f("planMin", "预计分钟", "number"),
        CampusUi.f("stars", "重要程度（0—5星）", "number"),
        new CampusUi.Field("note", "备注与复盘", "multiline", false));
  }

  static void draw(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "随机抽签器", "选人、定顺序、做分组，公平随机。");
    u.actionRow(
        a.content,
        new String[] {"＋ 添加选项", "批量添加"},
        new Runnable[] {
          () ->
              u.form(
                  "添加抽签选项",
                  new JSONObject(),
                  v -> {
                    a.store.add(
                        "native_draw_pool",
                        CampusJson.obj("id", CampusJson.id(), "title", v.optString("title")));
                    a.build();
                  },
                  CampusUi.f("title", "选项 / 姓名")),
          () ->
              u.form(
                  "批量添加抽签选项",
                  new JSONObject(),
                  v -> {
                    for (String line : v.optString("text").split("\n"))
                      if (!line.trim().isEmpty())
                        a.store.add(
                            "native_draw_pool",
                            CampusJson.obj("id", CampusJson.id(), "title", line.trim()));
                    a.build();
                  },
                  CampusUi.f("text", "每行一个选项", "multiline"))
        });
    List<JSONObject> pool = CampusJson.rows(a.store.list("native_draw_pool"));
    u.actionRow(
        a.content,
        new String[] {"开始抽一个", "随机排序 / 分组"},
        new Runnable[] {
          () -> {
            if (pool.isEmpty()) {
              a.toast("先添加抽签选项");
              return;
            }
            JSONObject x = pool.get(new java.security.SecureRandom().nextInt(pool.size()));
            a.store.add(
                "native_draw_history",
                CampusJson.obj("at", System.currentTimeMillis(), "result", x.optString("title")));
            CampusManage.message(a, "抽签结果", x.optString("title"));
          },
          () ->
              u.form(
                  "随机分组",
                  CampusJson.obj("size", 3),
                  v -> {
                    int size = v.optInt("size");
                    if (size < 1 || size > 100) throw new IllegalArgumentException("每组人数1—100");
                    List<JSONObject> rows = new ArrayList<>(pool);
                    Collections.shuffle(rows, new java.security.SecureRandom());
                    StringBuilder text = new StringBuilder();
                    for (int i = 0; i < rows.size(); i++) {
                      if (i % size == 0) text.append("\n第 ").append(i / size + 1).append(" 组：\n");
                      text.append(rows.get(i).optString("title")).append("  ");
                    }
                    a.store.add(
                        "native_draw_history",
                        CampusJson.obj(
                            "at", System.currentTimeMillis(), "result", text.toString()));
                    CampusManage.message(
                        a,
                        "随机分组结果",
                        text.toString(),
                        new String[] {"分享结果"},
                        i -> CampusPhone.shareText(a, text.toString()));
                  },
                  CampusUi.f("size", "每组人数（1即随机顺序）", "number"))
        });
    u.section(a.content, "抽签池 · " + pool.size() + "个选项");
    for (JSONObject x : pool) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("title"), 16, u.ink, true));
      c.setOnClickListener(
          v ->
              u.confirm(
                  "删除选项？",
                  x.optString("title"),
                  () -> {
                    a.store.replace("native_draw_pool", x.optString("id"), null);
                    a.build();
                  }));
    }
    u.actionRow(
        a.content,
        new String[] {"历史结果", "清空抽签池"},
        new Runnable[] {
          () -> CampusManage.records(a, "抽签历史", a.store.list("native_draw_history")),
          () ->
              u.confirm(
                  "清空抽签池？",
                  "历史结果保留。",
                  () -> {
                    a.store.set("native_draw_pool", new JSONArray());
                    a.build();
                  })
        });
  }

  static void oracle(CampusActivity a) {
    if (oracle == null) {
      a.ui.title(a.content, "神谕阁", "正在载入答案之书与78张牌的文字…");
      a.background(
          "载入神谕阁",
          () -> {
            try (GZIPInputStream in =
                new GZIPInputStream(a.getResources().openRawResource(R.raw.campus_oracle))) {
              oracle = new JSONObject(CampusApi.read(in, 500000));
            }
            return null;
          },
          r -> {
            if (a.page.equals("oracle")) a.build();
          });
      return;
    }
    CampusUi u = a.ui;
    u.title(a.content, "神谕阁", "答案之书与牌卡灵感，留一点空间给自我反思。");
    u.actionRow(
        a.content,
        new String[] {"翻开答案之书", "按页查阅答案"},
        new Runnable[] {
          () ->
              u.form(
                  "心里的问题",
                  new JSONObject(),
                  v -> {
                    JSONArray answers = oracle.optJSONArray("answers");
                    int at = new java.security.SecureRandom().nextInt(answers.length());
                    showAnswer(a, at, v.optString("question"));
                  },
                  CampusUi.optional("question", "问题（可留空）")),
          () ->
              u.form(
                  "查阅答案",
                  CampusJson.obj("page", 1),
                  v -> {
                    int page = v.optInt("page");
                    if (page < 1 || page > oracle.optJSONArray("answers").length())
                      throw new IllegalArgumentException(
                          "页码1—" + oracle.optJSONArray("answers").length());
                    showAnswer(a, page - 1, "");
                  },
                  CampusUi.f("page", "页码", "number"))
        });
    u.section(a.content, "牌卡灵感");
    List<JSONObject> spreads = CampusJson.rows(oracle.opt("spreads"));
    for (JSONObject s : spreads) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(s.optString("name"), 18, u.ink, true));
      u.gap(c, 7);
      c.addView(u.text(s.optString("desc"), 12, u.muted, false));
      u.gap(c, 13);
      c.addView(
          u.button(
              "抽取 " + s.optInt("n") + " 张牌",
              () ->
                  u.form(
                      "牌卡问题",
                      new JSONObject(),
                      v -> tarot(a, s, v.optString("question")),
                      CampusUi.optional("question", "想思考的问题")),
              false));
    }
    u.actionRow(
        a.content,
        new String[] {"今日牌卡", "历史记录"},
        new Runnable[] {
          () -> {
            JSONObject daily = a.store.object("native_oracle_daily");
            if (!daily.optString("date").equals(DateMath.today())) {
              List<JSONObject> deck = deck();
              Random rnd = new java.security.SecureRandom();
              daily =
                  CampusJson.obj(
                      "date",
                      DateMath.today(),
                      "card",
                      deck.get(rnd.nextInt(deck.size())),
                      "reversed",
                      rnd.nextBoolean());
              a.store.set("native_oracle_daily", daily);
            }
            JSONObject card = daily.optJSONObject("card");
            CampusManage.message(
                a, "今日牌卡 · " + DateMath.today(), reading(card, daily.optBoolean("reversed")));
          },
          () -> CampusManage.records(a, "神谕阁历史", a.store.list("native_oracle_history"))
        });
  }

  static void showAnswer(CampusActivity a, int page, String q) {
    String text = oracle.optJSONArray("answers").optString(page);
    a.store.add(
        "native_oracle_history",
        CampusJson.obj(
            "date",
            DateMath.today(),
            "question",
            q,
            "kind",
            "答案之书",
            "page",
            page + 1,
            "result",
            text));
    CampusManage.message(
        a,
        "答案之书 · 第" + (page + 1) + "页",
        (q.isEmpty() ? "" : q + "\n\n") + text,
        new String[] {"分享这页"},
        i -> CampusPhone.shareText(a, text));
  }

  static List<JSONObject> deck() {
    List<JSONObject> cards = CampusJson.rows(oracle.opt("major"));
    JSONObject suits = oracle.optJSONObject("suits");
    for (String key : CampusJson.keys(suits)) {
      JSONObject s = suits.optJSONObject(key);
      for (JSONObject r : CampusJson.rows(oracle.opt("ranks"))) {
        JSONObject up =
            CampusJson.obj(
                "kw",
                new JSONArray()
                    .put(s.optString("element"))
                    .put(s.optString("area"))
                    .put(r.optString("kw")),
                "core",
                s.optString("upWord") + "。" + r.optString("up"),
                "adv",
                r.optString("adv"));
        JSONObject rev =
            CampusJson.obj(
                "kw",
                up.opt("kw"),
                "core",
                s.optString("revWord") + "。" + r.optString("rev"),
                "adv",
                r.optString("adv"));
        cards.add(
            CampusJson.obj(
                "name",
                s.optString("name") + r.optString("name"),
                "up",
                up,
                "rev",
                rev,
                "suit",
                key));
      }
    }
    return cards;
  }

  static String reading(JSONObject card, boolean reverse) {
    JSONObject d = card.optJSONObject(reverse ? "rev" : "up");
    return card.optString("name")
        + (reverse ? " · 逆位" : " · 正位")
        + "\n\n"
        + CampusManage.readable(d == null ? card : d);
  }

  static void tarot(CampusActivity a, JSONObject spread, String q) {
    List<JSONObject> deck = deck();
    Collections.shuffle(deck, new java.security.SecureRandom());
    Random rnd = new java.security.SecureRandom();
    StringBuilder text = new StringBuilder(q.isEmpty() ? "" : q + "\n\n");
    JSONArray positions = CampusJson.arr(spread.opt("positions"));
    for (int i = 0; i < spread.optInt("n"); i++)
      text.append(positions.optJSONObject(i).optString("name"))
          .append("\n")
          .append(reading(deck.get(i), rnd.nextBoolean()))
          .append("\n\n");
    a.store.add(
        "native_oracle_history",
        CampusJson.obj(
            "date",
            DateMath.today(),
            "kind",
            spread.optString("name"),
            "question",
            q,
            "result",
            text.toString()));
    CampusManage.message(
        a,
        spread.optString("name"),
        text.toString(),
        new String[] {"分享牌卡文字"},
        i -> CampusPhone.shareText(a, text.toString()));
  }
}
