package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.os.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Five planning methods and a resumable Android alarm-backed Pomodoro. */
final class CampusPlanner {
  static final String[] METHODS = {"四象限", "PDCA", "SMART", "常春藤六件事", "番茄专注"};

  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    String method = a.store.object("plan_notes_v1").optString("cur", "quad");
    int active = Arrays.asList("quad", "pdca", "smart", "ivy", "pomo").indexOf(method);
    if (active < 0) active = 0;
    final int idx = active;
    u.title(a.content, "给重要的事，留出时间。", METHODS[active] + " · 选择适合你当下的方法。");
    u.actionRow(
        a.content,
        new String[] {METHODS[active] + " ▾", "方法说明"},
        new Runnable[] {
          () ->
              u.choose(
                  "选择规划方法",
                  METHODS,
                  i -> {
                    a.store.entry(
                        "plan_notes_v1",
                        "cur",
                        new String[] {"quad", "pdca", "smart", "ivy", "pomo"}[i]);
                    a.build();
                    a.syncSoon();
                  }),
          () -> intro(a, idx)
        });
    switch (active) {
      case 0:
        quad(a);
        break;
      case 1:
        pdca(a);
        break;
      case 2:
        smart(a);
        break;
      case 3:
        ivy(a);
        break;
      default:
        pomoBody(a);
    }
  }

  static void intro(CampusActivity a, int i) {
    String[] ids = {"quad", "pdca", "smart", "ivy", "pomo"},
        text =
            {
              "重要且紧急：优先处理。重要不紧急：安排时间。紧急不重要：尽可能委派。不重要不紧急：适度减少。",
              "计划（Plan）→执行（Do）→检查（Check）→调整（Act），逐轮复盘改进。",
              "明确具体、可衡量、可实现、相关、有时限的目标。目标期限会同步到个人事项。",
              "每天最多列出六件重要事项，按顺序专心完成，再处理下一件。",
              "交替安排专注和休息。每次完成一个专注周期，记录一次真实番茄。"
            };
    String key = "intro:" + ids[i];
    CampusManage.message(
        a,
        METHODS[i],
        a.store.object("plan_notes_v1").optString(key, text[i]),
        new String[] {"编辑我的方法说明"},
        j ->
            a.ui.form(
                "方法说明",
                CampusJson.obj("text", a.store.object("plan_notes_v1").optString(key, text[i])),
                v -> {
                  a.store.entry("plan_notes_v1", key, v.optString("text"));
                  a.syncSoon();
                },
                CampusUi.f("text", "说明", "multiline")));
  }

  static void quad(CampusActivity a) {
    CampusUi u = a.ui;
    u.actionRow(
        a.content,
        new String[] {"＋ 添加待办", "查看全部事项"},
        new Runnable[] {() -> CampusSchool.personalForm(a, null), () -> a.open("calendar")});
    String[] names = {"重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急"};
    int[] colors = {0xffda6876, 0xff677de1, 0xffbc9244, 0xff6f9992};
    JSONObject map = a.store.object("quad_v1");
    for (int q = 1; q <= 4; q++) {
      final int chosen = q;
      LinearLayout c = u.card(a.content);
      c.addView(u.text(names[q - 1], 17, colors[q - 1], true));
      u.gap(c, 12);
      int n = 0;
      for (JSONObject x : a.items()) {
        if (a.done(x) || CampusSchool.hidden(a, x)) continue;
        int assigned = map.optInt(x.optString("_key"), defaultQuad(x));
        if (assigned != q) continue;
        n++;
        TextView b =
            u.button(
                x.optString("subject"),
                () ->
                    u.choose(
                        x.optString("subject"),
                        new String[] {"标记完成", "调整象限", "事项详情"},
                        i -> {
                          if (i == 0) a.mark(CampusJson.copy(x));
                          else if (i == 1)
                            u.choose(
                                "移到哪个象限",
                                names,
                                j -> {
                                  a.store.entry("quad_v1", x.optString("_key"), j + 1);
                                  a.build();
                                  a.syncSoon();
                                });
                          else CampusSchool.detail(a, x);
                        }),
                false);
        c.addView(b);
        u.gap(c, 7);
      }
      if (n == 0) c.addView(u.text("留空也很好", 12, u.muted, false));
    }
  }

  static int defaultQuad(JSONObject x) {
    String date = CampusJson.date(x.optString("event_time"));
    boolean urgent = !date.isEmpty() && DateMath.days(date) <= 3;
    boolean important =
        x.optString("msg_type").equals("作业") || x.optString("msg_type").equals("考试");
    return important ? (urgent ? 1 : 2) : (urgent ? 3 : 4);
  }

  static void pdca(CampusActivity a) {
    CampusUi u = a.ui;
    a.content.addView(u.button("＋ 新建改进计划", () -> pdcaForm(a, null), true));
    JSONObject notes = a.store.object("plan_notes_v1");
    boolean any = false;
    for (String key : CampusJson.keys(notes))
      if (key.startsWith("pdca:")) {
        JSONObject x = notes.optJSONObject(key);
        if (x == null) continue;
        any = true;
        int stage = x.optInt("stage");
        LinearLayout c = u.card(a.content);
        c.addView(
            u.pill(
                "第 "
                    + x.optInt("round", 1)
                    + " 轮 · "
                    + new String[] {"计划 P", "执行 D", "检查 C", "调整 A"}
                        [Math.max(0, Math.min(3, stage))]));
        u.gap(c, 11);
        c.addView(u.text(x.optString("title"), 19, u.ink, true));
        for (String k : new String[] {"p", "d", "c", "a"}) {
          u.gap(c, 7);
          c.addView(u.text(k.toUpperCase(Locale.ROOT) + "  " + x.optString(k), 12, u.muted, false));
        }
        u.gap(c, 16);
        u.actionRow(
            c,
            new String[] {stage < 3 ? "进入下一阶段" : "开始下一轮", "编辑 / 删除"},
            new Runnable[] {
              () -> {
                CampusJson.put(x, "stage", (stage + 1) % 4);
                if (stage == 3) CampusJson.put(x, "round", x.optInt("round", 1) + 1);
                a.store.entry("plan_notes_v1", key, x);
                CampusLearn.changed(a);
              },
              () ->
                  u.choose(
                      x.optString("title"),
                      new String[] {"编辑计划", "删除计划"},
                      i -> {
                        if (i == 0) pdcaForm(a, CampusJson.obj("_id", key, "value", x));
                        else
                          u.confirm(
                              "删除计划？",
                              x.optString("title"),
                              () -> {
                                a.store.entry("plan_notes_v1", key, null);
                                CampusLearn.changed(a);
                              });
                      })
            });
      }
    if (!any) u.empty(a.content, "先写计划，再逐轮改善", "每个阶段都可以记录做法和复盘。");
  }

  static void pdcaForm(CampusActivity a, JSONObject holder) {
    String id = holder == null ? "pdca:" + CampusJson.id() : holder.optString("_id");
    JSONObject init =
        holder == null
            ? CampusJson.obj("stage", 0, "round", 1, "at", System.currentTimeMillis())
            : holder.optJSONObject("value");
    a.ui.form(
        "PDCA 计划",
        init,
        v -> {
          a.store.entry("plan_notes_v1", id, v);
          CampusLearn.changed(a);
        },
        CampusUi.f("title", "计划名称"),
        new CampusUi.Field("p", "P · 计划", "multiline", false),
        new CampusUi.Field("d", "D · 执行", "multiline", false),
        new CampusUi.Field("c", "C · 检查", "multiline", false),
        new CampusUi.Field("a", "A · 调整", "multiline", false));
  }

  static void smart(CampusActivity a) {
    CampusUi u = a.ui;
    a.content.addView(u.button("＋ 新建 SMART 目标", () -> smartForm(a, null), true));
    JSONObject notes = a.store.object("plan_notes_v1");
    boolean any = false;
    for (String id : CampusJson.keys(notes))
      if (id.startsWith("smart:")) {
        JSONObject x = notes.optJSONObject(id);
        if (x == null) continue;
        any = true;
        LinearLayout c = u.card(a.content);
        c.addView(u.pill(x.optBoolean("done") ? "已完成" : "期限 " + x.optString("t")));
        u.gap(c, 10);
        c.addView(u.text(x.optString("title"), 19, u.ink, true));
        String[] keys = {"s", "m", "a", "r"}, labels = {"具体", "衡量", "可实现", "相关"};
        for (int i = 0; i < keys.length; i++) {
          u.gap(c, 7);
          c.addView(u.text(labels[i] + " · " + x.optString(keys[i]), 12, u.muted, false));
        }
        u.gap(c, 16);
        u.actionRow(
            c,
            new String[] {x.optBoolean("done") ? "撤销完成" : "目标完成", "编辑 / 删除"},
            new Runnable[] {
              () -> {
                CampusJson.put(x, "done", !x.optBoolean("done"));
                saveSmart(a, id, x);
              },
              () ->
                  u.choose(
                      "目标操作",
                      new String[] {"编辑目标", "删除目标"},
                      i -> {
                        if (i == 0) smartForm(a, CampusJson.obj("_id", id, "value", x));
                        else
                          u.confirm(
                              "删除目标？",
                              x.optString("title"),
                              () -> {
                                a.store.entry("plan_notes_v1", id, null);
                                a.store.replace("personal_events_v1", "g" + id.substring(6), null);
                                CampusLearn.changed(a);
                              });
                      })
            });
      }
    if (!any) u.empty(a.content, "让目标具体到能行动", "填写五个维度，截止日期自动加入个人日历。");
  }

  static void smartForm(CampusActivity a, JSONObject holder) {
    String id = holder == null ? "smart:" + CampusJson.id() : holder.optString("_id");
    JSONObject init =
        holder == null
            ? CampusJson.obj(
                "t",
                DateMath.plus(DateMath.today(), 7),
                "done",
                false,
                "at",
                System.currentTimeMillis())
            : holder.optJSONObject("value");
    a.ui.form(
        "SMART 目标",
        init,
        v -> saveSmart(a, id, v),
        CampusUi.f("title", "目标名称"),
        CampusUi.f("s", "S · 具体要做什么", "multiline"),
        CampusUi.f("m", "M · 如何衡量完成", "multiline"),
        CampusUi.f("a", "A · 资源与可行性", "multiline"),
        CampusUi.f("r", "R · 与我的计划有什么关联", "multiline"),
        CampusUi.f("t", "T · 完成期限", "date"));
  }

  static void saveSmart(CampusActivity a, String id, JSONObject v) {
    a.store.entry("plan_notes_v1", id, v);
    a.store.replace(
        "personal_events_v1",
        "g" + id.substring(6),
        CampusJson.obj(
            "id",
            "g" + id.substring(6),
            "subject",
            v.optString("title"),
            "event_time",
            v.optString("t"),
            "location",
            "",
            "note",
            v.optString("s") + "\n" + v.optString("m"),
            "done",
            v.optBoolean("done")));
    CampusLearn.changed(a);
  }

  static void ivy(CampusActivity a) {
    CampusUi u = a.ui;
    String day = a.store.string("native_ivy_day", DateMath.today()), key = "ivy:" + day;
    u.actionRow(
        a.content,
        new String[] {"今天", "明天", "选择日期"},
        new Runnable[] {
          () -> {
            a.store.set("native_ivy_day", DateMath.today());
            a.build();
          },
          () -> {
            a.store.set("native_ivy_day", DateMath.plus(DateMath.today(), 1));
            a.build();
          },
          () ->
              u.form(
                  "选择计划日期",
                  CampusJson.obj("date", day),
                  v -> {
                    a.store.set("native_ivy_day", v.optString("date"));
                    a.build();
                  },
                  CampusUi.f("date", "日期", "date"))
        });
    u.section(a.content, day + " · 重要的六件事");
    JSONArray rows = CampusJson.arr(a.store.object("plan_notes_v1").opt(key));
    for (int i = 0; i < rows.length(); i++) {
      JSONObject x = rows.optJSONObject(i);
      if (x == null) continue;
      final int n = i;
      LinearLayout c = u.card(a.content);
      c.addView(
          u.text(
              (i + 1) + ". " + x.optString("text") + (x.optBoolean("done") ? "  ✓" : ""),
              17,
              u.ink,
              true));
      u.gap(c, 12);
      u.actionRow(
          c,
          new String[] {x.optBoolean("done") ? "撤销" : "完成", "调整顺序 / 删除"},
          new Runnable[] {
            () -> {
              CampusJson.put(x, "done", !x.optBoolean("done"));
              a.store.entry("plan_notes_v1", key, rows);
              CampusLearn.changed(a);
            },
            () ->
                u.choose(
                    "调整计划",
                    new String[] {"上移", "下移", "删除"},
                    j -> {
                      if (j == 2) rows.remove(n);
                      else {
                        int to = j == 0 ? n - 1 : n + 1;
                        if (to >= 0 && to < rows.length()) {
                          Object other = rows.opt(to);
                          CampusJson.put(x, "_order", to);
                          try {
                            rows.put(to, x);
                            rows.put(n, other);
                          } catch (Exception e) {
                            a.error(e);
                          }
                        }
                      }
                      a.store.entry("plan_notes_v1", key, rows);
                      CampusLearn.changed(a);
                    })
          });
    }
    if (rows.length() < 6)
      a.content.addView(
          u.button(
              "＋ 添加第 " + (rows.length() + 1) + " 件事",
              () ->
                  u.form(
                      "重要事项",
                      new JSONObject(),
                      v -> {
                        rows.put(CampusJson.obj("text", v.optString("text"), "done", false));
                        a.store.entry("plan_notes_v1", key, rows);
                        CampusLearn.changed(a);
                      },
                      CampusUi.f("text", "事项名称")),
              true));
  }

  static final String TIMER = "native_pomo_timer";

  static void pomo(CampusActivity a) {
    a.ui.title(a.content, "星轨冲刺", "一次只做一件事，让专注有始有终。");
    pomoBody(a);
  }

  static void pomoBody(CampusActivity a) {
    CampusUi u = a.ui;
    settle(a, a.store);
    JSONObject timer = a.store.object(TIMER), cfg = a.store.object("native_pomo_config");
    long left =
        timer.optBoolean("running")
            ? Math.max(0, timer.optLong("deadline") - System.currentTimeMillis())
            : timer.optLong("remaining", cfg.optInt("focus", 25) * 60000L);
    boolean rest = timer.optString("phase", "focus").equals("break");
    LinearLayout c = u.card(a.content);
    c.addView(u.pill(rest ? (timer.optBoolean("longBreak") ? "长休息轨道" : "休息轨道") : "专注轨道"));
    if (!timer.optString("title").isEmpty())
      c.addView(u.text(timer.optString("title"), 16, u.ink, true));
    u.gap(c, 15);
    long duration = timer.optLong("duration", cfg.optInt("focus", 25) * 60000L);
    CampusVisual.FocusRing ring = new CampusVisual.FocusRing(a, left, duration);
    FrameLayout timerFace = new FrameLayout(a);
    timerFace.addView(ring, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout face = u.column();
    face.setGravity(android.view.Gravity.CENTER);
    TextView clock = u.text(duration(left), 46, u.ink, true);
    clock.setTypeface(
        android.graphics.Typeface.create("sans-serif-light", android.graphics.Typeface.NORMAL));
    clock.setGravity(android.view.Gravity.CENTER);
    face.addView(clock);
    u.gap(face, 10);
    TextView length = u.text("本轮 " + Math.max(1, duration / 60000) + " 分钟", 12, u.muted, false);
    length.setGravity(android.view.Gravity.CENTER);
    face.addView(length);
    timerFace.addView(face, new FrameLayout.LayoutParams(-1, -2, android.view.Gravity.CENTER));
    c.addView(timerFace, new LinearLayout.LayoutParams(-1, u.dp(222)));
    u.gap(c, 10);
    TextView state =
        u.text(timer.optBoolean("running") ? "正在计时 · 关闭页面也会保留" : "准备好以后，轻轻开始。", 12, u.muted, false);
    state.setGravity(android.view.Gravity.CENTER);
    c.addView(state);
    u.gap(c, 24);
    u.actionRow(
        c,
        new String[] {timer.optBoolean("running") ? "暂停" : "开始" + (rest ? "休息" : "专注"), "结束本轮"},
        new Runnable[] {
          () -> toggle(a),
          () ->
              u.confirm(
                  "结束这轮计时？",
                  "未完成的专注不会计入番茄次数。",
                  () -> {
                    a.store.set(TIMER, new JSONObject());
                    cancel(a, a.store.owner);
                    a.build();
                  })
        });
    u.actionRow(
        a.content,
        new String[] {"专注 / 休息设置", "通知与提醒"},
        new Runnable[] {
          () ->
              u.form(
                  "计时设置",
                  CampusJson.obj(
                      "focus",
                      cfg.optInt("focus", 25),
                      "break",
                      cfg.optInt("break", 5),
                      "longBreak",
                      cfg.optInt("longBreak", 15),
                      "every",
                      cfg.optInt("every", 4),
                      "autoBreak",
                      cfg.optBoolean("autoBreak"),
                      "autoNext",
                      cfg.optBoolean("autoNext"),
                      "sound",
                      cfg.optBoolean("sound", true)),
                  v -> {
                    if (v.optInt("focus") < 1
                        || v.optInt("focus") > 180
                        || v.optInt("break") < 1
                        || v.optInt("break") > 60
                        || v.optInt("longBreak") < 1
                        || v.optInt("longBreak") > 60
                        || v.optInt("every") < 2
                        || v.optInt("every") > 12)
                      throw new IllegalArgumentException("专注1—180分钟，休息1—60分钟，长休息间隔2—12轮");
                    a.store.set("native_pomo_config", v);
                    if (!a.store.object(TIMER).optBoolean("running"))
                      a.store.set(TIMER, new JSONObject());
                    a.build();
                  },
                  CampusUi.f("focus", "专注分钟", "number"),
                  CampusUi.f("break", "短休息分钟", "number"),
                  CampusUi.f("longBreak", "长休息分钟", "number"),
                  CampusUi.f("every", "每几轮长休息一次", "number"),
                  CampusUi.f("autoBreak", "完成后自动休息", "boolean"),
                  CampusUi.f("autoNext", "休息后自动专注", "boolean"),
                  CampusUi.f("sound", "使用有声提醒通道", "boolean")),
          () -> a.open("reminders")
        });
    u.section(a.content, "最近的专注");
    JSONObject logs = a.store.object("pomo_log_v1");
    List<String> days = new ArrayList<>(CampusJson.keys(logs));
    days.sort(Collections.reverseOrder());
    for (String day : days.subList(0, Math.min(14, days.size()))) {
      LinearLayout r = u.card(a.content);
      r.addView(u.text(day + " · " + logs.optInt(day) + "轮", 15, u.ink, true));
    }
    if (days.isEmpty()) u.empty(a.content, "第一轮专注，等你开始", "完成专注时段后才会记录。");
    if (timer.optBoolean("running")) {
      String route = a.page;
      int generation = a.buildGeneration;
      Runnable pulse =
          new Runnable() {
            public void run() {
              if (a.isDestroyed()
                  || generation != a.buildGeneration
                  || !a.page.equals(route)
                  || !a.store.object(TIMER).optBoolean("running")) return;
              settle(a, a.store);
              JSONObject t = a.store.object(TIMER);
              if (!t.optBoolean("running")) {
                a.build();
                return;
              }
              long remaining = Math.max(0, t.optLong("deadline") - System.currentTimeMillis());
              clock.setText(duration(remaining));
              ring.update(remaining, t.optLong("duration", duration));
              a.handler.postDelayed(this, 1000);
            }
          };
      a.handler.postDelayed(pulse, 1000);
    }
  }

  static String duration(long n) {
    long seconds = (n + 999) / 1000;
    return String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60);
  }

  static void toggle(CampusActivity a) {
    JSONObject t = a.store.object(TIMER), cfg = a.store.object("native_pomo_config");
    if (t.optBoolean("running")) {
      CampusJson.put(
          t, "remaining", Math.max(0, t.optLong("deadline") - System.currentTimeMillis()));
      CampusJson.put(t, "running", false);
      cancel(a, a.store.owner);
    } else {
      if (t.optString("id").isEmpty()) CampusJson.put(t, "id", CampusJson.id());
      long remaining = t.optLong("remaining", cfg.optInt("focus", 25) * 60000L);
      if (!t.has("duration")) CampusJson.put(t, "duration", remaining);
      CampusJson.put(t, "deadline", System.currentTimeMillis() + remaining);
      CampusJson.put(t, "remaining", remaining);
      CampusJson.put(t, "running", true);
      if (!t.has("phase")) CampusJson.put(t, "phase", "focus");
      schedule(a, a.store.owner, t.optLong("deadline"));
    }
    a.store.set(TIMER, t);
    a.build();
    if (Build.VERSION.SDK_INT >= 33)
      a.request(android.Manifest.permission.POST_NOTIFICATIONS, () -> {});
  }

  static synchronized void settle(Context c, CampusStore s) {
    JSONObject timer = s.object(TIMER);
    if (!timer.optBoolean("running") || timer.optLong("deadline") > System.currentTimeMillis())
      return;
    JSONObject updates = new JSONObject();
    boolean rest = timer.optString("phase", "focus").equals("break");
    String day =
        new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US)
            .format(new Date(timer.optLong("deadline")));
    if (!rest) {
      JSONObject log = s.object("pomo_log_v1");
      CampusJson.put(log, day, log.optInt(day) + 1);
      CampusJson.put(updates, "pomo_log_v1", log);
      JSONArray sessions = s.list("native_focus_sessions");
      int minutes =
          (int) Math.max(1, Math.min(180, timer.optLong("duration", 25 * 60000L) / 60000));
      sessions.put(
          CampusJson.obj(
              "id",
              timer.optString("id"),
              "day",
              day,
              "minutes",
              minutes,
              "title",
              timer.optString("title"),
              "finishedAt",
              timer.optLong("deadline")));
      CampusJson.put(updates, "native_focus_sessions", sessions);
      JSONObject frogs = s.object("native_frogs");
      JSONArray rows = frogs.optJSONArray(timer.optString("frog_key"));
      if (rows != null)
        for (JSONObject frog : CampusJson.rows(rows))
          if (frog.optString("id").equals(timer.optString("frog_id"))) {
            CampusJson.put(frog, "actualMin", Math.min(1440, frog.optInt("actualMin") + minutes));
            CampusJson.put(updates, "native_frogs", frogs);
          }
      String cid = s.string("native_class_id", "");
      if (!cid.isEmpty()) {
        JSONObject queue = s.object("native_growth_queue");
        CampusJson.put(
            queue,
            cid + "|pomo|" + day + "|" + log.optInt(day),
            CampusJson.obj(
                "cid",
                cid,
                "k",
                "pomo",
                "r",
                day + "|" + log.optInt(day),
                "undo",
                false,
                "stamp",
                CampusJson.id()));
        CampusJson.put(updates, "native_growth_queue", queue);
      }
    }
    JSONObject cfg = s.object("native_pomo_config");
    int cycle = timer.optInt("cycle") + (rest ? 0 : 1);
    boolean longBreak = !rest && cycle % Math.max(2, cfg.optInt("every", 4)) == 0;
    long duration =
        cfg.optInt(
                rest ? "focus" : longBreak ? "longBreak" : "break", rest ? 25 : longBreak ? 15 : 5)
            * 60000L;
    boolean auto = cfg.optBoolean(rest ? "autoNext" : "autoBreak");
    String current = c.getSharedPreferences("campus_active_scope", 0).getString("owner", "guest");
    auto = auto && current.equals(s.owner);
    JSONObject next =
        CampusJson.obj(
            "id",
            CampusJson.id(),
            "phase",
            rest ? "focus" : "break",
            "remaining",
            duration,
            "duration",
            duration,
            "running",
            auto,
            "cycle",
            cycle,
            "longBreak",
            longBreak,
            "deadline",
            System.currentTimeMillis() + duration);
    for (String field : new String[] {"frog_key", "frog_id", "title"})
      if (timer.has(field)) CampusJson.put(next, field, timer.opt(field));
    CampusJson.put(updates, TIMER, next);
    s.batch(updates);
    cancel(c, s.owner);
    if (auto) schedule(c, s.owner, next.optLong("deadline"));
    if (current.equals(s.owner))
      Reminders.show(
          c,
          701,
          rest ? "休息结束，可以继续下一轮" : "这一轮专注完成了",
          auto ? "已按你的设置进入下一阶段。" : rest ? "准备好后手动开始，给自己一点缓冲。" : "已记录一次番茄。伸个懒腰，喝一点水。",
          "pomo",
          cfg.optBoolean("sound", true));
  }

  static PendingIntent intent(Context c, String owner, int flags) {
    return PendingIntent.getBroadcast(
        c,
        owner.hashCode(),
        new Intent(c, CampusPlannerReceiver.class)
            .setAction("campus.pomo." + owner)
            .putExtra("owner", owner),
        PendingIntent.FLAG_IMMUTABLE | flags);
  }

  static void schedule(Context c, String owner, long when) {
    ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE))
        .setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP, when, intent(c, owner, PendingIntent.FLAG_UPDATE_CURRENT));
  }

  static void cancel(Context c, String owner) {
    PendingIntent p = intent(c, owner, PendingIntent.FLAG_NO_CREATE);
    if (p != null) {
      ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE)).cancel(p);
      p.cancel();
    }
  }

  static void restore(Context c) {
    String owner = c.getSharedPreferences("campus_active_scope", 0).getString("owner", "guest");
    CampusStore s = new CampusStore(c, owner);
    settle(c, s);
    JSONObject t = s.object(TIMER);
    if (t.optBoolean("running")) schedule(c, owner, t.optLong("deadline"));
  }
}
