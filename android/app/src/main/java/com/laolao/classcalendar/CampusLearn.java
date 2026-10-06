package com.laolao.classcalendar;

import android.content.*;
import android.graphics.*;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Native learning workspace; each module persists real records, with no sample results. */
final class CampusLearn {
  static boolean handles(String p) {
    return Arrays.asList(
            "countdown",
            "ledger",
            "wrongbook",
            "diary",
            "plan",
            "growth",
            "farm",
            "meta",
            "pomo",
            "search",
            "cards",
            "review",
            "checklist",
            "report",
            "rank")
        .contains(p);
  }

  static void render(CampusActivity a, String p) {
    switch (p) {
      case "plan":
        CampusPlanner.render(a);
        break;
      case "pomo":
        CampusPlanner.pomo(a);
        break;
      case "countdown":
        exams(a);
        break;
      case "ledger":
        ledger(a);
        break;
      case "wrongbook":
        wrong(a);
        break;
      case "diary":
        diary(a);
        break;
      case "growth":
        growth(a);
        break;
      case "farm":
        farm(a);
        break;
      case "meta":
        meta(a);
        break;
      case "cards":
      case "review":
        cards(a, p.equals("review"));
        break;
      case "checklist":
        pack(a);
        break;
      case "report":
        report(a);
        break;
      case "search":
        search(a);
        break;
      case "rank":
        rank(a);
        break;
    }
  }

  static String money(long cents) {
    return String.format(Locale.CHINA, "¥%.2f", cents / 100.0);
  }

  static long cents(Object value) {
    try {
      java.math.BigDecimal amount = new java.math.BigDecimal(String.valueOf(value));
      if (amount.signum() <= 0 || amount.compareTo(new java.math.BigDecimal("10000000")) > 0)
        throw new IllegalArgumentException();
      long result =
          amount.setScale(2, java.math.RoundingMode.HALF_UP).movePointRight(2).longValueExact();
      if (result < 1) throw new IllegalArgumentException();
      return result;
    } catch (Exception e) {
      throw new IllegalArgumentException("金额应大于0，最多一千万元");
    }
  }

  static void changed(CampusActivity a) {
    a.build();
    a.syncSoon();
  }

  static void exams(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "考试倒计时", "把目标拆小，让准备每天推进一点。");
    u.actionRow(
        a.content,
        new String[] {"＋ 添加考试", "复习清单"},
        new Runnable[] {() -> examForm(a, null), () -> a.open("wrongbook")});
    List<JSONObject> rows = CampusJson.rows(a.store.list("native_exams"));
    rows.sort(Comparator.comparing(x -> x.optString("date")));
    if (rows.isEmpty()) u.empty(a.content, "下一站，准备充分", "添加考试时间，记录复习目标和完成进度。");
    for (JSONObject x : rows) {
      LinearLayout c = u.card(a.content);
      long days = DateMath.days(x.optString("date"));
      c.addView(u.pill(days < 0 ? "已结束" : days == 0 ? "就是今天" : "距离考试"));
      u.gap(c, 12);
      c.addView(
          u.text(
              days < 0 ? "已过去 " + Math.abs(days) + " 天" : days == 0 ? "今天" : days + " 天",
              34,
              u.accent,
              true));
      u.gap(c, 7);
      c.addView(u.text(x.optString("title"), 19, u.ink, true));
      c.addView(
          u.text(
              x.optString("date") + " " + x.optString("time") + " · " + x.optString("location"),
              12,
              u.muted,
              false));
      List<JSONObject> goals = CampusJson.rows(x.opt("goals"));
      long done = goals.stream().filter(g -> g.optBoolean("done")).count();
      if (!goals.isEmpty()) {
        u.gap(c, 10);
        c.addView(u.text("复习进度 " + done + " / " + goals.size(), 12, u.accent, true));
      }
      u.gap(c, 14);
      u.actionRow(
          c,
          new String[] {"复习目标", "编辑 / 更多"},
          new Runnable[] {
            () -> examGoals(a, x),
            () ->
                u.choose(
                    x.optString("title"),
                    new String[] {"编辑考试", "设置考试提醒", "加入系统日历", "删除考试"},
                    i -> {
                      if (i == 0) examForm(a, x);
                      else if (i == 1)
                        CampusPhone.reminderForm(
                            a,
                            CampusJson.obj(
                                "_key",
                                "exam-" + x.optString("id"),
                                "subject",
                                x.optString("title"),
                                "event_time",
                                x.optString("date") + " " + x.optString("time", "09:00")));
                      else if (i == 2)
                        CampusSchool.systemCalendar(
                            a,
                            x.optString("title"),
                            x.optString("date"),
                            x.optString("time"),
                            "",
                            x.optString("location"),
                            x.optString("note"));
                      else
                        u.confirm(
                            "删除考试？",
                            x.optString("title"),
                            () -> {
                              a.store.replace("native_exams", x.optString("id"), null);
                              changed(a);
                            });
                    })
          });
    }
  }

  static void examForm(CampusActivity a, JSONObject x) {
    a.ui.form(
        x == null ? "添加考试" : "编辑考试",
        x == null
            ? CampusJson.obj(
                "id",
                CampusJson.id(),
                "date",
                DateMath.today(),
                "time",
                "09:00",
                "goals",
                new JSONArray())
            : x,
        v -> {
          a.store.replace("native_exams", v.optString("id"), v);
          changed(a);
        },
        CampusUi.f("title", "考试名称 / 科目"),
        CampusUi.f("date", "考试日期", "date"),
        CampusUi.f("time", "开始时间", "time"),
        CampusUi.optional("location", "考试地点"),
        new CampusUi.Field("note", "准备与要求", "multiline", false));
  }

  static void examGoals(CampusActivity a, JSONObject x) {
    List<JSONObject> goals = CampusJson.rows(x.opt("goals"));
    List<String> opts = new ArrayList<>();
    for (JSONObject g : goals) opts.add((g.optBoolean("done") ? "✓ " : "○ ") + g.optString("text"));
    opts.add("＋ 添加复习目标");
    a.ui.choose(
        "复习目标 · " + x.optString("title"),
        opts.toArray(new String[0]),
        i -> {
          if (i < goals.size()) {
            JSONObject g = goals.get(i);
            CampusJson.put(g, "done", !g.optBoolean("done"));
            CampusJson.put(x, "goals", new JSONArray(goals));
            a.store.replace("native_exams", x.optString("id"), x);
            changed(a);
            examGoals(a, x);
          } else
            a.ui.form(
                "添加复习目标",
                new JSONObject(),
                v -> {
                  goals.add(CampusJson.obj("text", v.optString("text"), "done", false));
                  CampusJson.put(x, "goals", new JSONArray(goals));
                  a.store.replace("native_exams", x.optString("id"), x);
                  changed(a);
                },
                CampusUi.f("text", "目标内容"));
        });
  }

  static void ledger(CampusActivity a) {
    CampusUi u = a.ui;
    String month = a.store.string("native_ledger_month", DateMath.today().substring(0, 7));
    u.title(a.content, "校园花销记账", month + " · 每笔小钱，都有去处。");
    long out = 0, in = 0;
    Map<String, Long> cats = new LinkedHashMap<>();
    List<JSONObject> rows = new ArrayList<>();
    for (JSONObject x : CampusJson.rows(a.store.list("native_ledger")))
      if (x.optString("date").startsWith(month)) {
        rows.add(x);
        long value = x.optLong("cents");
        if (x.optString("kind").equals("收入")) in += value;
        else {
          out += value;
          cats.put(x.optString("category"), cats.getOrDefault(x.optString("category"), 0L) + value);
        }
      }
    long budget = a.store.object("native_budgets").optLong(month);
    LinearLayout sum = u.card(a.content);
    sum.addView(u.pill("本月支出"));
    u.gap(sum, 10);
    sum.addView(u.text(money(out), 35, u.ink, true));
    u.gap(sum, 10);
    sum.addView(u.text("收入 " + money(in) + " · 结余 " + money(in - out), 13, u.muted, false));
    if (budget > 0) {
      u.gap(sum, 8);
      sum.addView(
          u.text(
              "预算 "
                  + money(budget)
                  + " · "
                  + (budget < out ? "已超出 " + money(out - budget) : "剩余 " + money(budget - out)),
              13,
              budget < out ? 0xffd45868 : u.accent,
              true));
    }
    u.gap(sum, 16);
    u.actionRow(
        sum,
        new String[] {"＋ 记一笔", "设置月预算"},
        new Runnable[] {
          () -> expense(a, null),
          () ->
              u.form(
                  "月预算",
                  CampusJson.obj("amount", budget / 100.0),
                  v -> {
                    a.store.entry("native_budgets", month, cents(v.opt("amount")));
                    changed(a);
                  },
                  CampusUi.f("amount", "本月预算（元）", "decimal"))
        });
    u.actionRow(
        a.content,
        new String[] {"切换月份", "导出账单"},
        new Runnable[] {
          () ->
              u.form(
                  "查看月份",
                  CampusJson.obj("date", month + "-01"),
                  v -> {
                    a.store.set("native_ledger_month", v.optString("date").substring(0, 7));
                    a.build();
                  },
                  CampusUi.f("date", "选择月份中的一天", "date")),
          () -> exportLedger(a, rows, month)
        });
    if (!cats.isEmpty()) {
      u.section(a.content, "分类花销");
      final long total = out;
      cats.entrySet().stream()
          .sorted((p, q) -> Long.compare(q.getValue(), p.getValue()))
          .forEach(
              e -> {
                LinearLayout c = u.card(a.content);
                c.addView(u.text(e.getKey() + "  " + money(e.getValue()), 14, u.ink, true));
                u.gap(c, 8);
                ProgressBar bar =
                    new ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal);
                bar.setMax(100);
                bar.setProgress(total == 0 ? 0 : (int) (e.getValue() * 100 / total));
                bar.setProgressTintList(android.content.res.ColorStateList.valueOf(u.accent));
                c.addView(bar);
              });
    }
    u.section(a.content, "收支明细");
    rows.sort((p, q) -> q.optString("date").compareTo(p.optString("date")));
    if (rows.isEmpty()) u.empty(a.content, "这个月还没有账单", "记录餐饮、交通、学习资料与生活用品。");
    for (JSONObject x : rows) {
      LinearLayout c = u.card(a.content);
      c.addView(
          u.text(
              x.optString("title")
                  + "  "
                  + (x.optString("kind").equals("收入") ? "＋" : "−")
                  + money(x.optLong("cents")),
              17,
              u.ink,
              true));
      c.addView(
          u.text(
              x.optString("date") + " · " + x.optString("category") + " · " + x.optString("note"),
              12,
              u.muted,
              false));
      c.setOnClickListener(
          v ->
              u.choose(
                  "账单操作",
                  new String[] {"编辑", "删除"},
                  i -> {
                    if (i == 0) expense(a, x);
                    else
                      u.confirm(
                          "删除账单？",
                          x.optString("title"),
                          () -> {
                            a.store.replace("native_ledger", x.optString("id"), null);
                            changed(a);
                          });
                  }));
    }
  }

  static void expense(CampusActivity a, JSONObject x) {
    JSONObject init =
        x == null
            ? CampusJson.obj(
                "id", CampusJson.id(), "date", DateMath.today(), "kind", "支出", "category", "餐饮")
            : CampusJson.copy(x);
    if (x != null) CampusJson.put(init, "amount", x.optLong("cents") / 100.0);
    a.ui.form(
        x == null ? "记一笔" : "编辑账单",
        init,
        v -> {
          CampusJson.put(v, "cents", cents(v.opt("amount")));
          v.remove("amount");
          a.store.replace("native_ledger", v.optString("id"), v);
          changed(a);
        },
        CampusUi.f("title", "消费 / 收入名称"),
        CampusUi.f("amount", "金额（元）", "decimal"),
        CampusUi.choice("kind", "收支类型", "支出", "收入"),
        CampusUi.choice(
            "category", "类别", "餐饮", "交通", "学习", "购物", "住宿", "娱乐", "奖学金", "兼职", "生活费", "其他"),
        CampusUi.f("date", "记账日期", "date"),
        CampusUi.optional("note", "备注"));
  }

  static String csv(String s) {
    return "\""
        + (java.util.regex.Pattern.compile("^[\\s\\uFEFF]*[=+@-]").matcher(s).find() ? "'" : "")
        + s.replace("\"", "\"\"")
        + "\"";
  }

  static void exportLedger(CampusActivity a, List<JSONObject> rows, String month) {
    StringBuilder b = new StringBuilder("\ufeff日期,名称,类型,分类,金额（元）,备注\r\n");
    for (JSONObject x : rows)
      b.append(csv(x.optString("date")))
          .append(',')
          .append(csv(x.optString("title")))
          .append(',')
          .append(csv(x.optString("kind")))
          .append(',')
          .append(csv(x.optString("category")))
          .append(',')
          .append(String.format(Locale.US, "%.2f", x.optLong("cents") / 100.0))
          .append(',')
          .append(csv(x.optString("note")))
          .append("\r\n");
    a.export("校园账单-" + month + ".csv", b.toString(), "text/csv");
  }

  static void wrong(CampusActivity a) {
    CampusUi u = a.ui;
    String subject = a.store.string("native_wrong_subject", "全部"),
        mode = a.store.string("native_wrong_mode", "全部");
    u.title(a.content, "错题记录本", "拍照归档、写清原因、按间隔复习。");
    u.actionRow(
        a.content,
        new String[] {"＋ 记录错题", "拍照录入"},
        new Runnable[] {
          () -> wrongForm(a, null, ""), () -> CampusPhone.photo(a, id -> wrongForm(a, null, id))
        });
    Set<String> subjects = new TreeSet<>();
    subjects.add("全部");
    for (JSONObject x : CampusJson.rows(a.store.list("native_wrong")))
      subjects.add(x.optString("subject"));
    u.actionRow(
        a.content,
        new String[] {subject + " ▾", mode + " ▾"},
        new Runnable[] {
          () ->
              u.choose(
                  "筛选科目",
                  subjects.toArray(new String[0]),
                  i -> {
                    a.store.set("native_wrong_subject", subjects.toArray(new String[0])[i]);
                    a.build();
                  }),
          () ->
              u.choose(
                  "复习状态",
                  new String[] {"全部", "到期复习", "已掌握"},
                  i -> {
                    a.store.set("native_wrong_mode", new String[] {"全部", "到期复习", "已掌握"}[i]);
                    a.build();
                  })
        });
    int n = 0;
    for (JSONObject x : CampusJson.rows(a.store.list("native_wrong"))) {
      if (!subject.equals("全部") && !subject.equals(x.optString("subject"))) continue;
      if (mode.equals("已掌握") && !x.optBoolean("mastered")) continue;
      if (mode.equals("到期复习")
          && (x.optBoolean("mastered") || DateMath.days(x.optString("due", DateMath.today())) > 0))
        continue;
      n++;
      LinearLayout c = u.card(a.content);
      c.addView(
          u.pill(
              x.optString("subject")
                  + " · "
                  + (x.optBoolean("mastered")
                      ? "已掌握"
                      : DateMath.days(x.optString("due", DateMath.today())) <= 0
                          ? "可以复习"
                          : "下次 " + x.optString("due"))));
      u.gap(c, 10);
      c.addView(u.text(x.optString("title"), 18, u.ink, true));
      CampusPhone.image(a, c, x.optString("photo"));
      u.gap(c, 9);
      c.addView(u.text(x.optString("question"), 13, u.muted, false));
      u.gap(c, 14);
      u.actionRow(
          c,
          new String[] {"查看解析 / 复习", "编辑 / 更多"},
          new Runnable[] {
            () -> wrongReview(a, x),
            () ->
                u.choose(
                    x.optString("title"),
                    new String[] {"编辑错题", "更换照片", "删除错题"},
                    i -> {
                      if (i == 0) wrongForm(a, x, x.optString("photo"));
                      else if (i == 1)
                        CampusPhone.photo(
                            a,
                            id -> {
                              CampusJson.put(x, "photo", id);
                              a.store.replace("native_wrong", x.optString("id"), x);
                              changed(a);
                            });
                      else
                        u.confirm(
                            "删除错题？",
                            x.optString("title"),
                            () -> {
                              a.store.replace("native_wrong", x.optString("id"), null);
                              changed(a);
                            });
                    })
          });
    }
    if (n == 0) u.empty(a.content, "这个分类还没有错题", "把错误留下，把方法带走。");
  }

  static void wrongForm(CampusActivity a, JSONObject x, String photo) {
    JSONObject init =
        x == null
            ? CampusJson.obj(
                "id",
                CampusJson.id(),
                "subject",
                "高数",
                "date",
                DateMath.today(),
                "due",
                DateMath.today(),
                "reviews",
                new JSONArray(),
                "mastered",
                false)
            : CampusJson.copy(x);
    CampusJson.put(init, "photo", photo);
    a.ui.form(
        x == null ? "记录错题" : "编辑错题",
        init,
        v -> {
          a.store.replace("native_wrong", v.optString("id"), v);
          changed(a);
        },
        CampusUi.f("title", "题目名称"),
        CampusUi.f("subject", "科目"),
        new CampusUi.Field("question", "题干（有照片可留空）", "multiline", false),
        CampusUi.f("answer", "正确答案", "multiline"),
        new CampusUi.Field("analysis", "解题过程与分析", "multiline", false),
        new CampusUi.Field("reason", "错因与关键提醒", "multiline", false),
        CampusUi.f("date", "记录日期", "date"),
        CampusUi.f("due", "下次复习", "date"));
  }

  static void wrongReview(CampusActivity a, JSONObject x) {
    CampusManage.message(
        a,
        x.optString("title"),
        "答案：\n"
            + x.optString("answer")
            + "\n\n解题过程：\n"
            + x.optString("analysis")
            + "\n\n错因：\n"
            + x.optString("reason"),
        new String[] {"再练一次", "基本理解", "已经掌握", "复习历史"},
        i -> {
          if (i == 3) {
            CampusManage.records(a, "复习历史", x.opt("reviews"));
            return;
          }
          JSONArray history = CampusJson.arr(x.opt("reviews"));
          history.put(
              CampusJson.obj(
                  "date", DateMath.today(), "result", new String[] {"再练一次", "基本理解", "已经掌握"}[i]));
          CampusJson.put(x, "reviews", history);
          CampusJson.put(x, "due", DateMath.plus(DateMath.today(), i == 0 ? 1 : i == 1 ? 3 : 7));
          CampusJson.put(x, "mastered", i == 2);
          a.store.replace("native_wrong", x.optString("id"), x);
          changed(a);
        });
  }

  static void diary(CampusActivity a) {
    CampusUi u = a.ui;
    if (a.store.bool("native_diary_lock", false) && !a.unlocked) {
      u.title(a.content, "我的私密日记", "用设备验证打开你的日记。照片与文字保存在本机。");
      a.content.addView(u.button("验证并打开日记", () -> CampusPhone.unlock(a), true));
      return;
    }
    String day = a.store.string("native_diary_day", DateMath.today());
    u.title(a.content, "把日子，写下来。", day + " · 一段文字，一点心情。");
    u.actionRow(
        a.content,
        new String[] {"‹ 前一天", "选择日期", "后一天 ›"},
        new Runnable[] {
          () -> diaryDay(a, DateMath.plus(day, -1)),
          () ->
              u.form(
                  "选择日记日期",
                  CampusJson.obj("date", day),
                  v -> diaryDay(a, v.optString("date")),
                  CampusUi.f("date", "日期", "date")),
          () -> diaryDay(a, DateMath.plus(day, 1))
        });
    JSONObject entry = a.store.object("native_diary").optJSONObject(day);
    if (entry == null)
      entry =
          CampusJson.obj(
              "date", day, "text", "", "mood", "平静", "weather", "晴", "photos", new JSONArray());
    final JSONObject row = entry;
    LinearLayout c = u.card(a.content);
    c.addView(u.pill(entry.optString("mood") + " · " + entry.optString("weather")));
    u.gap(c, 14);
    EditText editor = new EditText(u.dialog());
    editor.setTextColor(u.ink);
    editor.setTextSize(16);
    editor.setHint("今天发生了什么？也可以先从一句话写起。");
    editor.setHintTextColor(u.muted);
    editor.setBackgroundTintList(null);
    editor.setBackground(u.shape(u.surface, 12, 0));
    editor.setPadding(0, u.dp(8), 0, u.dp(12));
    editor.setLineSpacing(u.dp(6), 1.15f);
    editor.setMinLines(8);
    editor.setGravity(Gravity.TOP);
    editor.setText(entry.optString("text"));
    c.addView(editor, new LinearLayout.LayoutParams(-1, -2));
    TextView status = u.text("文字修改后自动保存到本机", 11, u.muted, false);
    c.addView(status);
    editor.addTextChangedListener(
        new android.text.TextWatcher() {
          public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

          public void onTextChanged(CharSequence text, int start, int before, int count) {
            CampusJson.put(row, "text", text.toString());
            CampusJson.put(row, "updatedAt", System.currentTimeMillis());
            try {
              a.store.entry("native_diary", day, row);
              status.setText("已保存到本机");
            } catch (Exception e) {
              status.setText("保存失败：" + e.getMessage());
            }
          }

          public void afterTextChanged(android.text.Editable e) {}
        });
    for (int i = 0; i < CampusJson.arr(row.opt("photos")).length(); i++) {
      final int n = i;
      String id = CampusJson.arr(row.opt("photos")).optString(i);
      CampusPhone.image(a, c, id);
      TextView remove =
          u.button(
              "移除这张照片",
              () ->
                  u.confirm(
                      "移除照片？",
                      "将从此篇日记移除。",
                      () -> {
                        JSONArray photos = CampusJson.arr(row.opt("photos"));
                        photos.remove(n);
                        a.store.entry("native_diary", day, row);
                        a.build();
                      }),
              false);
      c.addView(remove);
      u.gap(c, 8);
    }
    u.actionRow(
        a.content,
        new String[] {"心情与天气", "＋ 添加照片"},
        new Runnable[] {
          () ->
              u.form(
                  "今日心情",
                  row,
                  v -> {
                    CampusJson.put(row, "mood", v.optString("mood"));
                    CampusJson.put(row, "weather", v.optString("weather"));
                    a.store.entry("native_diary", day, row);
                    a.store.entry(
                        "mood_log_v1",
                        day,
                        CampusJson.obj(
                            "mood",
                            v.optString("mood"),
                            "weather",
                            v.optString("weather"),
                            "at",
                            System.currentTimeMillis()));
                    changed(a);
                  },
                  CampusUi.choice("mood", "心情", "开心", "平静", "疲惫", "低落", "期待", "焦虑"),
                  CampusUi.choice("weather", "天气", "晴", "多云", "阴", "雨", "雪")),
          () ->
              CampusPhone.photo(
                  a,
                  id -> {
                    JSONArray photos = CampusJson.arr(row.opt("photos"));
                    photos.put(id);
                    CampusJson.put(row, "photos", photos);
                    a.store.entry("native_diary", day, row);
                    a.build();
                  })
        });
    u.section(a.content, "写过的日子");
    JSONObject all = a.store.object("native_diary");
    List<String> dates = new ArrayList<>(CampusJson.keys(all));
    dates.sort(Collections.reverseOrder());
    for (String d : dates) {
      JSONObject e = all.optJSONObject(d);
      if (e == null) continue;
      LinearLayout card = u.card(a.content);
      card.addView(u.text(d + " · " + e.optString("mood"), 15, u.ink, true));
      String text = e.optString("text");
      card.addView(u.text(text.substring(0, Math.min(70, text.length())), 12, u.muted, false));
      card.setOnClickListener(v -> diaryDay(a, d));
      card.setOnLongClickListener(
          v -> {
            u.confirm(
                "删除这篇日记？",
                d,
                () -> {
                  a.store.entry("native_diary", d, null);
                  a.build();
                });
            return true;
          });
    }
  }

  static void diaryDay(CampusActivity a, String day) {
    a.store.set("native_diary_day", day);
    a.build();
  }

  static int habitToday(CampusStore s) {
    int n = 0;
    JSONObject log = s.object("habit_log_v1");
    for (String id : CampusJson.keys(log))
      if (log.optJSONObject(id) != null && log.optJSONObject(id).optBoolean(DateMath.today())) n++;
    return n;
  }

  static int streak(JSONObject log, String day) {
    int n = 0;
    for (int i = 0; i < 3660; i++) {
      String d = DateMath.plus(day, -i);
      if (log.optBoolean(d)) n++;
      else if (i == 0) continue;
      else break;
    }
    return n;
  }

  static void habitToggle(CampusActivity a, JSONObject h, String day) {
    JSONObject all = a.store.object("habit_log_v1"), log = all.optJSONObject(h.optString("id"));
    if (log == null) log = new JSONObject();
    boolean on = !log.optBoolean(day);
    if (on) CampusJson.put(log, day, true);
    else log.remove(day);
    CampusJson.put(all, h.optString("id"), log);
    a.store.set("habit_log_v1", all);
    a.growth("habit", h.optString("id") + "|" + day, !on);
    changed(a);
  }

  static void growth(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "让成长，有迹可循。", "今天已经打卡 " + habitToday(a.store) + " 项习惯。");
    u.actionRow(
        a.content,
        new String[] {"＋ 新建习惯", "班级成长榜"},
        new Runnable[] {() -> habitForm(a, null), () -> loadRank(a, "week")});
    JSONObject all = a.store.object("habit_log_v1");
    for (JSONObject h : CampusJson.rows(a.store.list("habits_v1"))) {
      JSONObject log = all.optJSONObject(h.optString("id"));
      if (log == null) log = new JSONObject();
      final JSONObject finalLog = log;
      LinearLayout c = u.card(a.content);
      c.addView(u.text(h.optString("icon", "✦") + " " + h.optString("name"), 18, u.ink, true));
      u.gap(c, 6);
      c.addView(
          u.text(
              "连续 " + streak(log, DateMath.today()) + " 天 · 累计 " + log.length() + " 天",
              12,
              u.muted,
              false));
      u.gap(c, 12);
      u.actionRow(
          c,
          new String[] {log.optBoolean(DateMath.today()) ? "✓ 今日已打卡" : "今日打卡", "历史与编辑"},
          new Runnable[] {
            () -> habitToggle(a, h, DateMath.today()),
            () ->
                u.choose(
                    h.optString("name"),
                    new String[] {"补记 / 撤销日期打卡", "编辑习惯", "删除习惯"},
                    i -> {
                      if (i == 0)
                        u.form(
                            "记录打卡日期",
                            CampusJson.obj("date", DateMath.today()),
                            v -> {
                              String date = v.optString("date");
                              if (DateMath.days(date) > 0)
                                throw new IllegalArgumentException("不能提前打卡");
                              habitToggle(a, h, date);
                            },
                            CampusUi.f("date", "日期", "date"));
                      else if (i == 1) habitForm(a, h);
                      else
                        u.confirm(
                            "删除习惯？",
                            "历史打卡仍会保留在备份中。",
                            () -> {
                              a.store.replace("habits_v1", h.optString("id"), null);
                              changed(a);
                            });
                    })
          });
      c.addView(new Heat(a, finalLog), new LinearLayout.LayoutParams(-1, u.dp(85)));
    }
    if (a.store.list("habits_v1").length() == 0)
      u.empty(a.content, "每天一点点，就是进步", "建立阅读、运动、复习或早睡习惯。");
    u.section(a.content, "真实学习统计");
    LinearLayout c = u.card(a.content);
    c.addView(u.text("完成事项 " + a.store.object("done_log_v1").length() + " 次", 16, u.ink, true));
    u.gap(c, 10);
    int cycles = 0;
    for (String d : CampusJson.keys(a.store.object("pomo_log_v1")))
      cycles += a.store.object("pomo_log_v1").optInt(d);
    c.addView(
        u.text(
            "完成番茄 " + cycles + " 轮 · 错题 " + a.store.list("native_wrong").length() + " 条",
            13,
            u.muted,
            false));
  }

  static void habitForm(CampusActivity a, JSONObject h) {
    a.ui.form(
        h == null ? "新建习惯" : "编辑习惯",
        h == null ? CampusJson.obj("id", CampusJson.id(), "icon", "✦") : h,
        v -> {
          a.store.replace("habits_v1", v.optString("id"), v);
          changed(a);
        },
        CampusUi.f("name", "习惯名称"),
        CampusUi.optional("icon", "标记（一个符号或表情）"));
  }

  static long food(CampusActivity a) {
    long total = 0;
    Map<String, Integer> completed = new HashMap<>();
    for (String id : CampusJson.keys(a.store.object("done_log_v1"))) {
      String day = a.store.object("done_log_v1").optString(id);
      boolean homework =
          a.items().stream()
              .anyMatch(
                  x -> x.optString("_key").equals(id) && x.optString("msg_type").equals("作业"));
      total += homework ? 10 : 5;
      completed.put(day, completed.getOrDefault(day, 0) + 1);
    }
    Map<String, Integer> hs = new HashMap<>();
    JSONObject log = a.store.object("habit_log_v1");
    for (String id : CampusJson.keys(log)) {
      JSONObject h = log.optJSONObject(id);
      if (h != null)
        for (String day : CampusJson.keys(h))
          if (h.optBoolean(day)) hs.put(day, hs.getOrDefault(day, 0) + 1);
    }
    for (int n : hs.values()) total += Math.min(5, n) * 3;
    JSONObject pomo = a.store.object("pomo_log_v1");
    for (String day : CampusJson.keys(pomo)) total += Math.min(12, pomo.optInt(day)) * 2;
    for (Map.Entry<String, Integer> e : completed.entrySet()) if (e.getValue() >= 3) total += 5;
    Set<String> activity = new TreeSet<>(completed.keySet());
    activity.addAll(hs.keySet());
    activity.addAll(CampusJson.keys(pomo));
    String previous = "";
    int run = 0;
    for (String d : activity) {
      try {
        DateMath.parse(d);
        run = !previous.isEmpty() && DateMath.plus(previous, 1).equals(d) ? run + 1 : 1;
        previous = d;
        if (run >= 3) total += 3;
      } catch (Exception ignored) {
      }
    }
    return total;
  }

  static void farm(CampusActivity a) {
    CampusUi u = a.ui;
    JSONObject pet = a.store.object("farm_v1");
    if (pet.length() == 0)
      pet =
          CampusJson.obj("pet", "cloud", "name", "小云朵", "level", 1, "exp", 0, "spent", 0, "fed", 0);
    final JSONObject x = pet;
    int lv = pet.optInt("level", 1), need = 80 + (lv - 1) * 40;
    long stock = Math.max(0, food(a) - pet.optLong("spent"));
    u.title(a.content, pet.optString("name", "我的云宠"), "每天的真实进步，都是云宠的养分。");
    LinearLayout c = u.card(a.content);
    c.addView(new Pet(a, pet.optString("pet"), lv), new LinearLayout.LayoutParams(-1, u.dp(235)));
    c.addView(
        u.pill(
            "Lv."
                + lv
                + " · "
                + (lv < 2 ? "初生" : lv < 4 ? "幼崽" : lv < 7 ? "成长" : lv < 10 ? "进阶" : "传奇")));
    u.gap(c, 14);
    c.addView(
        u.text("经验 " + pet.optInt("exp") + " / " + need + " · 养料 " + stock, 14, u.muted, false));
    u.gap(c, 18);
    c.addView(
        u.button(
            "喂养云宠 · 10养料",
            () -> {
              if (stock < 10) {
                a.toast("养料不足：完成事项、打卡或完成番茄可获得养料");
                return;
              }
              CampusJson.put(x, "spent", x.optLong("spent") + 10);
              CampusJson.put(x, "fed", x.optInt("fed") + 1);
              int xp = x.optInt("exp") + 20, level = x.optInt("level", 1);
              while (xp >= 80 + (level - 1) * 40) {
                xp -= 80 + (level - 1) * 40;
                level++;
              }
              CampusJson.put(x, "exp", xp);
              CampusJson.put(x, "level", level);
              CampusJson.put(x, "at", System.currentTimeMillis());
              a.store.set("farm_v1", x);
              changed(a);
            },
            true));
    u.actionRow(
        a.content,
        new String[] {"给云宠起名", "换一种云宠"},
        new Runnable[] {
          () ->
              u.form(
                  "云宠名字",
                  x,
                  v -> {
                    a.store.set("farm_v1", v);
                    changed(a);
                  },
                  CampusUi.f("name", "名字")),
          () ->
              u.choose(
                  "选择云宠",
                  new String[] {"云朵精灵", "草莓精灵", "米粒精灵", "面包精灵", "奶油猫咪", "树苗精灵"},
                  i -> {
                    CampusJson.put(
                        x,
                        "pet",
                        new String[] {"cloud", "berry", "rice", "bread", "cat", "sprout"}[i]);
                    a.store.set("farm_v1", x);
                    changed(a);
                  })
        });
    a.content.addView(
        u.button(
            "喂养到下一级",
            () -> {
              int level = x.optInt("level", 1),
                  missing = 80 + (level - 1) * 40 - x.optInt("exp"),
                  feeds = (missing + 19) / 20;
              long available = Math.max(0, food(a) - x.optLong("spent"));
              if (available < feeds * 10L) {
                a.toast("升到下一级还需 " + (feeds * 10) + " 养料，目前有 " + available);
                return;
              }
              CampusJson.put(x, "spent", x.optLong("spent") + feeds * 10L);
              CampusJson.put(x, "fed", x.optInt("fed") + feeds);
              CampusJson.put(x, "exp", x.optInt("exp") + feeds * 20 - (80 + (level - 1) * 40));
              CampusJson.put(x, "level", level + 1);
              CampusJson.put(x, "at", System.currentTimeMillis());
              a.store.set("farm_v1", x);
              changed(a);
            },
            false));
    u.section(a.content, "今日的养料来源");
    u.empty(a.content, "做一点，就会长一点", "完成作业10养料，其他事项5养料；每日最多5项习惯各3养料，最多12轮番茄各2养料；每日完成3项再得5养料。");
    a.content.addView(u.button("去打卡成长", () -> a.open("growth"), false));
  }

  static void meta(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "捞捞元宇宙", "每一次努力，都在点亮你的学习星系。");
    LinearLayout c = u.card(a.content);
    android.graphics.drawable.GradientDrawable space =
        new android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
            new int[] {u.theme.heroStart, u.theme.heroEnd});
    space.setCornerRadius(u.dp(26));
    space.setStroke(u.dp(1), CampusUi.blend(u.accent, u.theme.heroEnd, .28f));
    c.setBackground(space);
    LinearLayout top = u.row(), identity = u.column();
    CampusWorld.identity(a, identity);
    top.addView(identity, new LinearLayout.LayoutParams(0, -2, 1));
    if (a.getResources().getConfiguration().fontScale <= 1.25f)
      top.addView(new CampusVisual.Orbit(a), new LinearLayout.LayoutParams(u.dp(110), u.dp(122)));
    c.addView(top);
    long done = a.store.object("done_log_v1").length(),
        cards = a.store.list("native_cards").length();
    u.gap(c, 18);
    LinearLayout stats = u.row();
    String[]
        values = {String.valueOf(done), String.valueOf(cards), String.valueOf(habitToday(a.store))},
        labels = {"已完成事项", "记忆晶片", "今日打卡"};
    for (int i = 0; i < values.length; i++) {
      LinearLayout stat = u.column();
      stat.setGravity(Gravity.CENTER);
      TextView count = u.text(values[i], 23, u.theme.heroInk, true);
      count.setGravity(Gravity.CENTER);
      stat.addView(count);
      u.gap(stat, 6);
      TextView label = u.text(labels[i], 11, u.theme.heroMuted, false);
      label.setGravity(Gravity.CENTER);
      stat.addView(label);
      stats.addView(stat, new LinearLayout.LayoutParams(0, -2, 1));
    }
    c.addView(stats);
    u.gap(c, 16);
    c.addView(u.button("进入星轨冲刺", () -> a.open("pomo"), true));
    u.section(a.content, "十个学习模组");
    u.tileGrid(
        a.content,
        new String[][] {
          {"pomo", "星轨冲刺", "专注计时与休息周期"},
          {"plan", "任务航线", "四象限与目标推进"},
          {"cards", "记忆晶片", "问题、答案与间隔复习"},
          {"countdown", "倒计时信标", "考试与复习目标"},
          {"review", "复习雷达", "找出今日到期晶片"},
          {"ledger", "能量补给", "校园支出与月预算"},
          {"courses", "课程导航", "周次、时间与教室"},
          {"diary", "心情黑匣子", "图文、心情与隐私锁"},
          {"checklist", "校园装备", "出门前的清单检查"},
          {"report", "时空回放", "真实数据的学习周报"}
        });
    u.section(a.content, "已解锁的成长徽章");
    List<String> medals = new ArrayList<>();
    if (done >= 1) medals.add("起航 · 完成第一件事");
    if (done >= 10) medals.add("持续推进 · 完成十件事");
    if (cards >= 5) medals.add("记忆工匠 · 创建五枚晶片");
    if (a.store.list("native_wrong").length() >= 1) medals.add("纠错者 · 留下第一道错题");
    if (medals.isEmpty()) u.empty(a.content, "第一枚徽章，等你点亮", "完成事项、制作晶片或记录错题，就会解锁徽章。");
    else for (String s : medals) a.content.addView(u.pill("✦ " + s));
    CampusWorld.details(a);
  }

  static void cards(CampusActivity a, boolean dueOnly) {
    CampusUi u = a.ui;
    u.title(
        a.content, dueOnly ? "复习雷达" : "记忆晶片", dueOnly ? "按到期日复习，答完再安排下一次。" : "把知识变成问答，把记忆留得更久。");
    u.actionRow(
        a.content,
        new String[] {"＋ 创建晶片", dueOnly ? "全部晶片" : "今日复习"},
        new Runnable[] {() -> cardForm(a, null), () -> a.open(dueOnly ? "cards" : "review")});
    int n = 0;
    for (JSONObject x : CampusJson.rows(a.store.list("native_cards"))) {
      if (dueOnly && DateMath.days(x.optString("due", DateMath.today())) > 0) continue;
      n++;
      LinearLayout c = u.card(a.content);
      c.addView(
          u.pill(x.optString("subject", "知识") + " · 下次 " + x.optString("due", DateMath.today())));
      u.gap(c, 11);
      c.addView(u.text(x.optString("question"), 17, u.ink, true));
      u.gap(c, 15);
      u.actionRow(
          c,
          new String[] {"翻面复习", "编辑 / 删除"},
          new Runnable[] {
            () ->
                CampusManage.message(
                    a,
                    "答案",
                    x.optString("answer"),
                    new String[] {"没记住", "想起来了", "很熟悉"},
                    i -> {
                      int level =
                          i == 0 ? 0 : Math.min(7, x.optInt("level") + 1 + (i == 2 ? 1 : 0));
                      int[] interval = {1, 2, 4, 7, 14, 30, 60, 90};
                      CampusJson.put(x, "level", level);
                      CampusJson.put(x, "due", DateMath.plus(DateMath.today(), interval[level]));
                      CampusJson.put(x, "reviewedAt", DateMath.today());
                      a.store.replace("native_cards", x.optString("id"), x);
                      changed(a);
                    }),
            () ->
                u.choose(
                    "晶片操作",
                    new String[] {"编辑", "删除"},
                    i -> {
                      if (i == 0) cardForm(a, x);
                      else
                        u.confirm(
                            "删除晶片？",
                            x.optString("question"),
                            () -> {
                              a.store.replace("native_cards", x.optString("id"), null);
                              changed(a);
                            });
                    })
          });
    }
    if (n == 0)
      u.empty(
          a.content,
          dueOnly ? "今天没有到期晶片" : "第一枚晶片，从一个问题开始",
          dueOnly ? "可以去看看错题本，或准备下一组晶片。" : "写下问题与答案，系统会记录复习日期。");
  }

  static void cardForm(CampusActivity a, JSONObject x) {
    a.ui.form(
        x == null ? "创建记忆晶片" : "编辑记忆晶片",
        x == null ? CampusJson.obj("id", CampusJson.id(), "due", DateMath.today(), "level", 0) : x,
        v -> {
          a.store.replace("native_cards", v.optString("id"), v);
          changed(a);
        },
        CampusUi.f("question", "问题", "multiline"),
        CampusUi.f("answer", "答案", "multiline"),
        CampusUi.optional("subject", "科目 / 标签"));
  }

  static void pack(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "校园装备清单", "出门前轻轻勾一下，把遗忘留在门内。");
    u.actionRow(
        a.content,
        new String[] {"＋ 添加装备", "开始新一天"},
        new Runnable[] {
          () ->
              u.form(
                  "添加装备",
                  CampusJson.obj("id", CampusJson.id(), "done", false),
                  v -> {
                    a.store.add("native_pack", v);
                    changed(a);
                  },
                  CampusUi.f("title", "名称"),
                  CampusUi.optional("scene", "使用场景")),
          () -> {
            JSONArray all = a.store.list("native_pack");
            for (JSONObject x : CampusJson.rows(all)) CampusJson.put(x, "done", false);
            a.store.set("native_pack", all);
            changed(a);
          }
        });
    for (JSONObject x : CampusJson.rows(a.store.list("native_pack"))) {
      LinearLayout c = u.card(a.content);
      CheckBox b = new CheckBox(u.dialog());
      b.setText(x.optString("title") + "  " + x.optString("scene"));
      b.setTextColor(u.ink);
      b.setChecked(x.optBoolean("done"));
      b.setOnCheckedChangeListener(
          (v, on) -> {
            CampusJson.put(x, "done", on);
            a.store.replace("native_pack", x.optString("id"), x);
          });
      c.addView(b);
      c.setOnLongClickListener(
          v -> {
            u.confirm(
                "删除装备？",
                x.optString("title"),
                () -> {
                  a.store.replace("native_pack", x.optString("id"), null);
                  changed(a);
                });
            return true;
          });
    }
    if (a.store.list("native_pack").length() == 0)
      u.empty(a.content, "给下一次出门准备一张清单", "可以记录学生证、钥匙、充电器或运动装备。");
  }

  static void report(CampusActivity a) {
    CampusUi u = a.ui;
    String start = DateMath.plus(DateMath.today(), -6);
    u.title(a.content, "时空回放", start + " — " + DateMath.today() + " · 最近七天的真实记录。");
    StringBuilder text = new StringBuilder("我的校园周报\n");
    int tasks = 0, habits = 0, pomos = 0, journals = 0;
    JSONObject done = a.store.object("done_log_v1"),
        habit = a.store.object("habit_log_v1"),
        pomo = a.store.object("pomo_log_v1");
    for (String id : CampusJson.keys(done))
      if (done.optString(id).compareTo(start) >= 0
          && done.optString(id).compareTo(DateMath.today()) <= 0) tasks++;
    for (String id : CampusJson.keys(habit)) {
      JSONObject days = habit.optJSONObject(id);
      if (days != null)
        for (String d : CampusJson.keys(days))
          if (d.compareTo(start) >= 0 && d.compareTo(DateMath.today()) <= 0 && days.optBoolean(d))
            habits++;
    }
    for (String d : CampusJson.keys(pomo))
      if (d.compareTo(start) >= 0 && d.compareTo(DateMath.today()) <= 0) pomos += pomo.optInt(d);
    for (String d : CampusJson.keys(a.store.object("native_diary")))
      if (d.compareTo(start) >= 0 && d.compareTo(DateMath.today()) <= 0) journals++;
    String[] labels = {
      "完成事项 " + tasks + " 项",
      "习惯打卡 " + habits + " 次",
      "完成番茄 " + pomos + " 轮",
      "日记记录 " + journals + " 天"
    };
    for (String s : labels) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(s, 23, u.ink, true));
      text.append(s).append('\n');
    }
    a.content.addView(u.button("分享我的周报", () -> CampusPhone.shareText(a, text.toString()), true));
  }

  static void search(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "全局搜索", "在课程、事项、考试、错题与晶片中寻找。");
    EditText field = new EditText(u.dialog());
    field.setHint("输入关键词");
    field.setTextColor(u.ink);
    field.setText(a.store.string("native_search", ""));
    a.content.addView(field);
    u.gap(a.content, 15);
    a.content.addView(
        u.button(
            "搜索",
            () -> {
              a.store.set("native_search", field.getText().toString().trim());
              a.build();
            },
            true));
    String q = a.store.string("native_search", "").toLowerCase(Locale.ROOT);
    if (q.isEmpty()) return;
    u.section(a.content, "搜索结果");
    int n = 0;
    for (JSONObject x : a.items())
      if ((x.optString("subject") + x.optString("summary") + x.optString("note"))
          .toLowerCase(Locale.ROOT)
          .contains(q)) {
        itemSearch(
            a, x.optString("subject"), x.optString("event_time"), () -> CampusSchool.detail(a, x));
        n++;
      }
    String[]
        keys =
            {
              CampusCourses.COURSES, "native_exams", "native_wrong", "native_cards", "native_ledger"
            },
        routes = {"courses", "countdown", "wrongbook", "cards", "ledger"};
    for (int i = 0; i < keys.length; i++) {
      final String route = routes[i];
      for (JSONObject x : CampusJson.rows(a.store.list(keys[i])))
        if (x.toString().toLowerCase(Locale.ROOT).contains(q)) {
          itemSearch(
              a,
              x.optString("title", x.optString("name", x.optString("question"))),
              route,
              () -> a.open(route));
          n++;
        }
    }
    if (n == 0) u.empty(a.content, "没有找到相关记录", "换一个科目、标题或地点试试。");
  }

  static void itemSearch(CampusActivity a, String title, String note, Runnable action) {
    LinearLayout c = a.ui.card(a.content);
    c.addView(a.ui.text(title, 17, a.ui.ink, true));
    c.addView(a.ui.text(note, 12, a.ui.muted, false));
    c.setOnClickListener(v -> action.run());
  }

  static void loadRank(CampusActivity a, String period) {
    if (!a.needClass()) return;
    a.background(
        "读取成长榜",
        () -> {
          JSONArray ids = new JSONArray();
          for (JSONObject x : a.items())
            if (!x.optBoolean("_mine") && a.done(x))
              ids.put(CampusJson.numericId(x.optString("id")));
          if (ids.length() > 0)
            a.api.rpc("growth_sync_done", CampusJson.obj("cid", a.cid(), "ids", ids));
          return a.api.rpc("growth_board", CampusJson.obj("cid", a.cid(), "period", period));
        },
        r -> {
          a.store.set("cache_rank", r);
          a.store.set("native_rank_period", period);
          a.open("rank");
        });
  }

  static void rank(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "班级成长榜", "用同一套真实成长记录，互相鼓励。");
    u.actionRow(
        a.content,
        new String[] {"本周", "全部", "展示方式"},
        new Runnable[] {
          () -> loadRank(a, "week"),
          () -> loadRank(a, "all"),
          () ->
              u.choose(
                  "我的成长榜展示",
                  new String[] {"显示姓名", "匿名显示", "不参与排名"},
                  i ->
                      a.rpc(
                          "rank_set_pref",
                          CampusJson.obj(
                              "cid", a.cid(), "m", new String[] {"show", "anon", "off"}[i]),
                          r -> loadRank(a, a.store.string("native_rank_period", "week"))))
        });
    Object cached = a.store.get("cache_rank", null);
    JSONObject data = CampusJson.object(cached);
    JSONArray rows = data.optJSONArray("rows");
    if (rows == null) rows = CampusJson.arr(cached);
    if (rows.length() == 0) u.empty(a.content, "暂时没有成长记录", "完成事项、习惯和番茄后再刷新。");
    for (JSONObject x : CampusJson.rows(rows)) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("name", x.optString("display_name", "同学")), 17, u.ink, true));
      c.addView(u.text("成长值 " + x.optInt("score", x.optInt("points")), 13, u.accent, true));
    }
  }

  static int activityValue(JSONObject log, String day) {
    Object value = log.opt(day);
    if (value instanceof Boolean) return (Boolean) value ? 1 : 0;
    if (value instanceof Number) return Math.max(0, ((Number) value).intValue());
    return Math.max(0, log.optInt(day));
  }

  static final class Heat extends View {
    final JSONObject log;
    final CampusActivity a;
    final int columns;

    Heat(CampusActivity a, JSONObject l) {
      this(a, l, 12);
    }

    Heat(CampusActivity a, JSONObject l, int columns) {
      super(a);
      this.a = a;
      log = l;
      this.columns = columns;
      int count = 0;
      for (int i = 0; i < columns * 7; i++)
        if (activityValue(log, DateMath.plus(DateMath.today(), -i)) > 0) count++;
      setContentDescription("最近" + columns + "周成长热力图，" + count + "天有记录");
    }

    protected void onDraw(Canvas c) {
      Paint p = new Paint(3);
      float size = Math.min(getWidth() / (float) columns, getHeight() / 7f), s = size * .73f;
      int max = 1;
      for (int i = 0; i < columns * 7; i++)
        max = Math.max(max, activityValue(log, DateMath.plus(DateMath.today(), -i)));
      for (int i = 0; i < columns * 7; i++) {
        String day = DateMath.plus(DateMath.today(), i - columns * 7 + 1);
        int value = activityValue(log, day);
        float weight = value == 0 ? 0 : Math.max(.3f, value / (float) max);
        int lo = a.ui.soft, hi = a.ui.accent;
        p.setColor(
            Color.rgb(
                Math.round(Color.red(lo) + (Color.red(hi) - Color.red(lo)) * weight),
                Math.round(Color.green(lo) + (Color.green(hi) - Color.green(lo)) * weight),
                Math.round(Color.blue(lo) + (Color.blue(hi) - Color.blue(lo)) * weight)));
        float x = (i / 7) * size, y = (i % 7) * size;
        c.drawRoundRect(x, y, x + s, y + s, 3, 3, p);
      }
    }
  }

  static final class Pet extends View {
    final CampusActivity a;
    final String kind;
    final int level;
    final Paint p = new Paint(3);

    Pet(CampusActivity a, String k, int lv) {
      super(a);
      this.a = a;
      kind = k;
      level = lv;
      setContentDescription(k + "云宠，等级" + lv);
    }

    protected void onDraw(Canvas c) {
      float scale = Math.min(getWidth() / 260f, getHeight() / 230f);
      c.save();
      c.translate((getWidth() - 260 * scale) / 2, 0);
      c.scale(scale, scale);
      int col =
          kind.equals("berry")
              ? 0xffffa8bf
              : kind.equals("sprout")
                  ? 0xff97d6ac
                  : kind.equals("rice")
                      ? 0xffffe8b8
                      : kind.equals("bread")
                          ? 0xffedc282
                          : kind.equals("cat") ? 0xffffd9b8 : 0xffc6d8ff;
      p.setShader(
          new RadialGradient(
              130, 70, 160, new int[] {0xffffffff, col}, null, Shader.TileMode.CLAMP));
      if (level < 2) c.drawOval(72, 30, 190, 205, p);
      else {
        if (kind.equals("cat")) {
          Path q = new Path();
          q.moveTo(72, 70);
          q.lineTo(60, 23);
          q.lineTo(105, 54);
          q.moveTo(168, 54);
          q.lineTo(208, 23);
          q.lineTo(193, 78);
          c.drawPath(q, p);
        }
        c.drawCircle(95, 90, 48, p);
        c.drawCircle(150, 76, 57, p);
        c.drawCircle(180, 110, 42, p);
        c.drawRoundRect(79, 98, 199, 194, 48, 48, p);
        if (level >= 4) {
          c.drawOval(55, 135, 94, 160, p);
          c.drawOval(181, 135, 220, 160, p);
          c.drawOval(96, 182, 124, 211, p);
          c.drawOval(154, 182, 182, 211, p);
        }
      }
      p.setShader(null);
      p.setColor(0xff30354c);
      c.drawOval(105, 102, 114, 115, p);
      c.drawOval(157, 102, 166, 115, p);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(3);
      c.drawArc(128, 110, 146, 125, 0, 180, false, p);
      p.setStyle(Paint.Style.FILL);
      p.setColor(0xffffb3c6);
      c.drawOval(93, 119, 111, 129, p);
      c.drawOval(168, 119, 186, 129, p);
      if (kind.equals("sprout")) {
        p.setColor(0xff54a474);
        c.drawOval(108, 15, 136, 42, p);
        c.drawOval(134, 12, 166, 40, p);
      }
      if (kind.equals("berry")) {
        p.setColor(0xff67ac7f);
        c.drawOval(113, 17, 156, 36, p);
      }
      if (level >= 7) {
        p.setColor(a.ui.accent);
        c.drawCircle(215, 153, 16, p);
        p.setColor(0xffffffff);
        p.setTextSize(20);
        c.drawText("✦", 206, 161, p);
      }
      if (level >= 10) {
        p.setColor(0xffeec664);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(4);
        c.drawOval(96, 8, 174, 28, p);
        p.setStyle(Paint.Style.FILL);
      }
      c.restore();
    }
  }

  static final class Galaxy extends View {
    Galaxy(Context c) {
      super(c);
      setContentDescription("学习星系");
    }

    protected void onDraw(Canvas c) {
      Paint p = new Paint(3);
      float x = getWidth() / 2f, y = getHeight() / 2f, r = Math.min(x, y) * .75f;
      Random rnd = new Random(42);
      p.setColor(0xff9ab5d9);
      for (int i = 0; i < 38; i++)
        c.drawCircle(
            rnd.nextFloat() * getWidth(),
            rnd.nextFloat() * getHeight(),
            1 + rnd.nextFloat() * 2,
            p);
      p.setColor(0xff335578);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(1.5f);
      c.drawOval(x - r * 1.5f, y - r * .48f, x + r * 1.5f, y + r * .48f, p);
      c.drawCircle(x, y, r, p);
      p.setStyle(Paint.Style.FILL);
      p.setShader(
          new RadialGradient(
              x - r * .2f,
              y - r * .3f,
              r,
              new int[] {0xffadf5fa, 0xff4377b8, 0xff182b4e},
              null,
              Shader.TileMode.CLAMP));
      c.drawCircle(x, y, r * .6f, p);
      p.setShader(null);
      p.setColor(0xff61e1e7);
      c.drawCircle(x + r * .93f, y - r * .35f, r * .11f, p);
      p.setColor(0xffcbabff);
      c.drawCircle(x - r * 1.2f, y + r * .2f, r * .08f, p);
    }
  }
}
