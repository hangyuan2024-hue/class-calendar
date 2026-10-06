package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.provider.CalendarContract;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Native agenda, personal/class records and role-aware class/group management. */
final class CampusSchool {
  static boolean handles(String p) {
    return Arrays.asList(
            "calendar",
            "homework",
            "class",
            "groups",
            "courses",
            "ocr-review",
            "members",
            "class-features")
        .contains(p);
  }

  static void render(CampusActivity a, String p) {
    switch (p) {
      case "courses":
        CampusCourses.render(a);
        break;
      case "ocr-review":
        CampusCourses.review(a);
        break;
      case "calendar":
        calendar(a);
        break;
      case "homework":
        homework(a);
        break;
      case "class":
        classes(a);
        break;
      case "groups":
        groups(a);
        break;
      case "members":
        members(a);
        break;
      case "class-features":
        features(a);
        break;
    }
  }

  static boolean hidden(CampusActivity a, JSONObject x) {
    JSONObject marks = a.store.object("personal_marks_v1").optJSONObject(x.optString("_key"));
    return marks != null && marks.optBoolean("hidden");
  }

  static boolean editAllowed(CampusActivity a, JSONObject x) {
    if (a.teacher()
        || a.can("can_edit")
        || a.store.object("cache_class_opts").optBoolean("members_can_edit")) return true;
    for (JSONObject g : CampusJson.rows(a.store.list("cache_groups")))
      if (g.optString("id").equals(x.optString("group_id")) && g.optBoolean("lead")) return true;
    return false;
  }

  static void calendar(CampusActivity a) {
    CampusUi u = a.ui;
    String selected = a.selectedDay;
    int[] parts = DateMath.parts(selected);
    String first = DateMath.date(parts[0], parts[1], 1);
    Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    c.setTime(DateMath.parse(first));
    int start = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7,
        days = c.getActualMaximum(Calendar.DAY_OF_MONTH);
    u.title(a.content, "校园日程", parts[0] + "年 " + parts[1] + "月 · 课程和待办，都在这里。");
    u.actionRow(
        a.content,
        new String[] {"‹ 上个月", "今天", "下个月 ›"},
        new Runnable[] {
          () -> month(a, -1),
          () -> {
            a.selectedDay = DateMath.today();
            a.build();
          },
          () -> month(a, 1)
        });
    LinearLayout block = u.card(a.content);
    block.setPadding(u.dp(12), u.dp(12), u.dp(12), u.dp(12));
    LinearLayout labels = u.row();
    for (String d : new String[] {"一", "二", "三", "四", "五", "六", "日"}) {
      TextView t = u.text(d, 11, u.muted, false);
      t.setGravity(Gravity.CENTER);
      labels.addView(t, new LinearLayout.LayoutParams(0, u.dp(28), 1));
    }
    block.addView(labels);
    Map<String, Integer> counts = new HashMap<>();
    for (JSONObject x : a.items()) {
      String d = CampusJson.date(x.optString("event_time"));
      if (!d.isEmpty() && visible(a, x)) counts.put(d, counts.getOrDefault(d, 0) + 1);
    }
    for (int i = 0; i < start + days; i += 7) {
      LinearLayout row = u.row();
      for (int j = 0; j < 7; j++) {
        int n = i + j - start + 1;
        if (n < 1 || n > days) {
          row.addView(new View(a), new LinearLayout.LayoutParams(0, u.dp(48), 1));
          continue;
        }
        String d = DateMath.date(parts[0], parts[1], n);
        boolean picked = d.equals(selected), today = d.equals(DateMath.today());
        boolean occupied =
            counts.getOrDefault(d, 0) > 0 || !CampusCourses.onDay(a.store, d).isEmpty();
        TextView t =
            u.text(
                String.valueOf(n) + "\n" + (occupied ? "•" : " "),
                14,
                picked ? u.onAccent() : today ? u.accent : u.ink,
                picked || today);
        t.setGravity(Gravity.CENTER);
        u.touch(t, picked ? u.accent : u.surface, 16, 0);
        t.setContentDescription(
            d + "，" + (counts.getOrDefault(d, 0) + CampusCourses.onDay(a.store, d).size()) + "项安排");
        t.setOnClickListener(
            v -> {
              a.selectedDay = d;
              a.build();
            });
        row.addView(t, new LinearLayout.LayoutParams(0, u.dp(48), 1));
      }
      block.addView(row);
    }
    u.actionRow(
        a.content,
        new String[] {"＋ 个人事项", "日历导出 / 订阅"},
        new Runnable[] {() -> personalForm(a, null), () -> calendarOptions(a)});
    int[] chosen = DateMath.parts(selected);
    u.section(
        a.content,
        (selected.equals(DateMath.today()) ? "今天" : chosen[1] + "月" + chosen[2] + "日") + "的安排");
    for (JSONObject x : CampusCourses.onDay(a.store, selected)) {
      LinearLayout card = u.card(a.content);
      LinearLayout course = u.row(), time = u.column(), info = u.column();
      time.addView(u.text(x.optString("t0"), 15, u.accent, true));
      u.gap(time, 5);
      time.addView(u.text(x.optString("t1"), 11, u.muted, false));
      course.addView(time, new LinearLayout.LayoutParams(u.dp(57), -2));
      info.addView(u.text(x.optString("name"), 16, u.ink, true));
      u.gap(info, 6);
      info.addView(u.text("课程 · " + x.optString("location", "教室待定"), 11, u.muted, false));
      LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1);
      cp.leftMargin = u.dp(12);
      course.addView(info, cp);
      course.addView(u.text("›", 22, u.muted, false));
      card.addView(course);
      card.setOnClickListener(v -> CampusCourses.detail(a, x));
    }
    boolean any = false;
    for (JSONObject x : a.items())
      if (selected.equals(CampusJson.date(x.optString("event_time"))) && visible(a, x)) {
        item(a, a.content, x);
        any = true;
      }
    if (!any && CampusCourses.onDay(a.store, selected).isEmpty())
      u.empty(a.content, "今天留有空白", "可以添加个人事项，也可以把空白留给休息。");
    List<JSONObject> undecided = new ArrayList<>();
    for (JSONObject x : a.items())
      if (CampusJson.date(x.optString("event_time")).isEmpty() && !a.done(x) && !hidden(a, x))
        undecided.add(x);
    if (!undecided.isEmpty()) {
      u.section(a.content, "时间待确认");
      for (JSONObject x : undecided) item(a, a.content, x);
    }
  }

  static void month(CampusActivity a, int delta) {
    Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    c.setTime(DateMath.parse(a.selectedDay));
    c.set(Calendar.DAY_OF_MONTH, 1);
    c.add(Calendar.MONTH, delta);
    a.selectedDay = DateMath.date(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, 1);
    a.build();
  }

  static boolean visible(CampusActivity a, JSONObject x) {
    return !hidden(a, x) && (!a.store.object("fun_opts_v1").optBoolean("hideDone") || !a.done(x));
  }

  static void homework(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "我的作业", "按截止日期排序，完成后计入成长记录。");
    String filter = a.store.string("native_hw_filter", "待完成");
    u.actionRow(
        a.content,
        new String[] {"待完成", "已完成", "全部"},
        new Runnable[] {() -> filter(a, "待完成"), () -> filter(a, "已完成"), () -> filter(a, "全部")});
    if (!a.cid().isEmpty() && a.can("can_ingest"))
      a.content.addView(u.button("发布班级作业", () -> classForm(a, null), true));
    List<JSONObject> rows = new ArrayList<>();
    for (JSONObject x : a.items())
      if (x.optString("msg_type").equals("作业")
          && !hidden(a, x)
          && (filter.equals("全部") || a.done(x) == filter.equals("已完成"))) rows.add(x);
    rows.sort(Comparator.comparing(x -> x.optString("event_time", "9999")));
    if (rows.isEmpty())
      u.empty(
          a.content,
          filter + "作业为空",
          a.api.logged() ? "刷新班级数据后，作业会自动出现在这里。" : "登录并加入班级后查看老师布置的作业。");
    for (JSONObject x : rows) item(a, a.content, x);
  }

  static void filter(CampusActivity a, String f) {
    a.store.set("native_hw_filter", f);
    a.build();
  }

  static void item(CampusActivity a, LinearLayout parent, JSONObject x) {
    CampusUi u = a.ui;
    LinearLayout box = u.card(parent);
    LinearLayout top = u.row();
    top.addView(u.pill(x.optBoolean("_mine") ? "我的事项" : x.optString("msg_type", "班级安排")));
    TextView state =
        u.text(
            a.done(x) ? "  已完成" : x.optBoolean("need_confirm") ? "  时间待确认" : "",
            11,
            u.muted,
            false);
    top.addView(state);
    box.addView(top);
    u.gap(box, 8);
    TextView title = u.text(x.optString("subject", "未命名事项"), 16, u.ink, true);
    if (a.done(x))
      title.setPaintFlags(title.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
    box.addView(title);
    String summary = x.optString("summary", x.optString("note"));
    if (!summary.isEmpty()) {
      u.gap(box, 6);
      box.addView(u.text(summary, 13, u.muted, false));
    }
    u.gap(box, 10);
    String d = x.optString("event_time");
    String location = x.optString("location");
    box.addView(
        u.text(
            (d.isEmpty() ? "时间待确认" : d) + (location.isEmpty() ? "" : "  ·  " + location),
            12,
            u.muted,
            false));
    u.gap(box, 14);
    u.actionRow(
        box,
        new String[] {a.done(x) ? "撤销完成" : "标记完成", "详情 / 更多"},
        new Runnable[] {() -> a.mark(CampusJson.copy(x)), () -> detail(a, x)});
  }

  static void personalForm(CampusActivity a, JSONObject x) {
    JSONObject init =
        x == null
            ? CampusJson.obj(
                "id", CampusJson.id(), "date", a.selectedDay, "time", "", "done", false)
            : CampusJson.copy(x);
    if (x != null) {
      String at = x.optString("event_time");
      CampusJson.put(init, "date", CampusJson.date(at));
      CampusJson.put(init, "time", at.length() >= 16 ? at.substring(11, 16) : "");
    }
    a.ui.form(
        x == null ? "记一件事" : "编辑个人事项",
        init,
        v -> {
          String date = v.optString("date"), time = v.optString("time");
          CampusJson.put(v, "event_time", date + (time.isEmpty() ? "" : " " + time));
          v.remove("date");
          v.remove("time");
          v.remove("_key");
          v.remove("_mine");
          a.store.replace("personal_events_v1", v.optString("id"), v);
          a.build();
          a.syncSoon();
        },
        CampusUi.f("subject", "事项名称"),
        new CampusUi.Field("date", "日期（可留空）", "date", false),
        new CampusUi.Field("time", "时间（可留空）", "time", false),
        CampusUi.optional("location", "地点"),
        new CampusUi.Field("note", "私人备注", "multiline", false));
  }

  static void detail(CampusActivity a, JSONObject x) {
    CampusUi u = a.ui;
    boolean mine = x.optBoolean("_mine");
    List<String> labels =
        new ArrayList<>(
            Arrays.asList("私人备注", "加入系统日历", "设置手机提醒", hidden(a, x) ? "取消隐藏" : "隐藏这条事项"));
    if (mine || editAllowed(a, x)) labels.add("编辑事项");
    if (mine || a.can("can_delete")) labels.add("删除事项");
    if (!mine) labels.add("查看修改记录");
    labels.add("查看原消息");
    u.choose(
        x.optString("subject"),
        labels.toArray(new String[0]),
        i -> {
          String label = labels.get(i), key = x.optString("_key");
          switch (label) {
            case "私人备注":
              JSONObject marks = a.store.object("personal_marks_v1").optJSONObject(key);
              if (marks == null) marks = new JSONObject();
              final JSONObject mm = marks;
              u.form(
                  "我的备注",
                  mm,
                  v -> {
                    a.store.entry("personal_marks_v1", key, v);
                    a.syncSoon();
                  },
                  new CampusUi.Field("note", "仅自己可见", "multiline", false));
              break;
            case "加入系统日历":
              String at = x.optString("event_time"), date = CampusJson.date(at);
              if (date.isEmpty()) {
                a.toast("请先确认事项日期");
                return;
              }
              systemCalendar(
                  a,
                  x.optString("subject"),
                  date,
                  at.length() >= 16 ? at.substring(11, 16) : "",
                  "",
                  x.optString("location"),
                  x.optString("summary") + "\n" + x.optString("prepare"));
              break;
            case "设置手机提醒":
              CampusPhone.reminderForm(a, x);
              break;
            case "取消隐藏":
            case "隐藏这条事项":
              JSONObject m = a.store.object("personal_marks_v1").optJSONObject(key);
              if (m == null) m = new JSONObject();
              CampusJson.put(m, "hidden", !hidden(a, x));
              a.store.entry("personal_marks_v1", key, m);
              a.build();
              a.syncSoon();
              break;
            case "编辑事项":
              if (mine) personalForm(a, x);
              else classForm(a, x);
              break;
            case "删除事项":
              u.confirm(
                  "删除这条事项？",
                  mine ? "删除个人事项可通过之前的备份恢复。" : "全班或组内成员将看不到这条安排。",
                  () -> {
                    if (mine) {
                      a.store.replace("personal_events_v1", x.optString("id"), null);
                      a.build();
                      a.syncSoon();
                    } else
                      a.rpc(
                          "class_item_delete",
                          CampusJson.obj("iid", CampusJson.numericId(x.optString("id"))),
                          r -> reloadItems(a));
                  });
              break;
            case "查看修改记录":
              a.rpc(
                  "class_item_history",
                  CampusJson.obj("iid", CampusJson.numericId(x.optString("id"))),
                  r -> CampusManage.records(a, "修改记录", r));
              break;
            case "查看原消息":
              CampusManage.message(a, "原消息", x.optString("original", x.optString("note", "暂无原消息")));
              break;
          }
        });
  }

  static void classForm(CampusActivity a, JSONObject x) {
    if (!a.needClass()) return;
    JSONObject init =
        x == null
            ? CampusJson.obj("msg_type", "作业", "date", a.selectedDay, "time", "", "group", "全班")
            : CampusJson.copy(x);
    if (x != null) {
      String at = x.optString("event_time");
      CampusJson.put(init, "date", CampusJson.date(at));
      CampusJson.put(init, "time", at.length() >= 16 ? at.substring(11, 16) : "");
    }
    List<JSONObject> gs = CampusJson.rows(a.store.list("cache_groups"));
    List<String> names = new ArrayList<>();
    names.add("全班");
    for (JSONObject g : gs)
      if (a.teacher() || a.can("can_edit") || g.optBoolean("lead")) names.add(g.optString("name"));
    for (JSONObject g : gs)
      if (g.optString("id").equals(init.optString("group_id")))
        CampusJson.put(init, "group", g.optString("name"));
    a.ui.form(
        x == null ? "发布班级事项" : "修改班级事项",
        init,
        v -> {
          String date = v.optString("date"), time = v.optString("time");
          JSONObject rec =
              CampusJson.obj(
                  "msg_type",
                  v.optString("msg_type"),
                  "subject",
                  v.optString("subject"),
                  "summary",
                  v.optString("summary"),
                  "event_time",
                  date + (time.isEmpty() ? "" : " " + time),
                  "location",
                  v.optString("location"),
                  "prepare",
                  v.optString("prepare"),
                  "need_confirm",
                  v.optBoolean("need_confirm") || date.isEmpty(),
                  "group_id",
                  JSONObject.NULL);
          for (JSONObject g : gs)
            if (g.optString("name").equals(v.optString("group")))
              CampusJson.put(rec, "group_id", CampusJson.numericId(g.optString("id")));
          if (x == null) {
            CampusJson.put(rec, "publish_date", DateMath.today());
            CampusJson.put(rec, "original", "（由" + a.me.optString("display_name", "同学") + "手动发布）");
          }
          a.store.set("draft_class_item", rec);
          a.rpc(
              "class_item_save",
              CampusJson.obj(
                  "cid",
                  a.cid(),
                  "iid",
                  x == null ? JSONObject.NULL : CampusJson.numericId(x.optString("id")),
                  "rec",
                  rec),
              r -> {
                a.store.set("draft_class_item", new JSONObject());
                reloadItems(a);
              });
        },
        CampusUi.choice("msg_type", "类型", "作业", "通知", "考试", "活动", "其他"),
        CampusUi.f("subject", "科目 / 标题"),
        new CampusUi.Field("summary", "内容摘要", "multiline", false),
        new CampusUi.Field("date", "日期", "date", false),
        new CampusUi.Field("time", "时间", "time", false),
        CampusUi.optional("location", "地点"),
        CampusUi.optional("prepare", "需要准备"),
        CampusUi.f("need_confirm", "需要确认时间", "boolean"),
        CampusUi.choice("group", "发布范围", names.toArray(new String[0])));
  }

  static void reloadItems(CampusActivity a) {
    if (!a.needClass()) return;
    final String cid = a.cid();
    a.rpc(
        "class_ctx",
        CampusJson.obj("cid", cid),
        r -> {
          if (!cid.equals(a.cid())) return;
          JSONObject ctx = CampusJson.object(r);
          a.store.set("cache_items", ctx.opt("items"));
          a.store.set("cache_groups", ctx.opt("groups"));
          a.store.set("cache_class_opts", ctx.opt("class_opts"));
          a.build();
          CampusPhone.refresh(a);
        });
  }

  static void calendarOptions(CampusActivity a) {
    a.ui.choose(
        "日历导出与订阅",
        new String[] {"导出全部未完成事项与课程 .ics", "复制班级日历订阅链接", "重置班级订阅链接", "查看隐藏事项", "生成临时日历分享链接"},
        i -> {
          if (i == 0) a.export("捞捞校园安排.ics", CampusCourses.ics(a, false), "text/calendar");
          else if (i == 4 && a.requireLogin()) {
            a.ui.confirm(
                "生成日历分享链接？",
                "将把当前未完成事项与课程上传为日历文件；拿到链接的人可读取文件。链接约2小时后失效。",
                () ->
                    a.rpc(
                        "ics_put",
                        CampusJson.obj("body", CampusCourses.ics(a, false)),
                        r -> {
                          String id =
                              r instanceof String
                                  ? (String) r
                                  : CampusJson.object(r).optString("id");
                          if (id.isEmpty()) {
                            a.toast("服务没有返回分享编号");
                            return;
                          }
                          CampusManage.copy(
                              a,
                              "临时日历链接",
                              a.api.base
                                  + "/rest/v1/rpc/ics_get?id="
                                  + CampusJson.enc(id)
                                  + "&apikey="
                                  + CampusJson.enc(a.api.anon));
                          a.toast("临时日历链接已复制");
                        }));
          } else if (i == 3) {
            a.ui.choose(
                "隐藏事项",
                a.items().stream()
                    .filter(x -> hidden(a, x))
                    .map(x -> x.optString("subject"))
                    .toArray(String[]::new),
                j -> {
                  List<JSONObject> rows = new ArrayList<>();
                  for (JSONObject x : a.items()) if (hidden(a, x)) rows.add(x);
                  if (j < rows.size()) detail(a, rows.get(j));
                });
          } else if (a.requireLogin()) {
            Runnable run =
                () ->
                    a.rpc(
                        "ics_my_feed",
                        CampusJson.obj("reset", i == 2),
                        r -> {
                          String token = CampusJson.object(r).optString("token");
                          if (token.isEmpty()) {
                            a.toast("未取得订阅链接");
                            return;
                          }
                          String url =
                              a.api.base
                                  + "/rest/v1/rpc/ics_feed?t="
                                  + CampusJson.enc(token)
                                  + "&apikey="
                                  + CampusJson.enc(a.api.anon);
                          CampusManage.copy(a, "日历订阅", url);
                          a.toast("私有订阅链接已复制，请粘贴到支持订阅的日历");
                        });
            if (i == 2) a.ui.confirm("重置订阅？", "旧链接将失效，其他设备需要重新订阅。", run);
            else run.run();
          }
        });
  }

  static void systemCalendar(
      CampusActivity a,
      String title,
      String date,
      String time,
      String end,
      String location,
      String note) {
    try {
      long start = CampusJson.at(date, time.isEmpty() ? "09:00" : time);
      Intent i =
          new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
              .putExtra(CalendarContract.Events.TITLE, title)
              .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
              .putExtra(CalendarContract.Events.DESCRIPTION, note)
              .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
              .putExtra(
                  CalendarContract.EXTRA_EVENT_END_TIME,
                  end.isEmpty() ? start + 3600000 : CampusJson.at(date, end))
              .putExtra(CalendarContract.Events.ALL_DAY, time.isEmpty());
      a.startActivity(i);
    } catch (ActivityNotFoundException e) {
      a.toast("没有可用的系统日历，可导出 .ics 文件");
    }
  }

  static void classes(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(
        a.content,
        "我的班级",
        a.cid().isEmpty()
            ? "加入班级，与老师和同学保持同步。"
            : a.currentClass.optString("nickname", a.currentClass.optString("name")));
    if (!a.api.logged()) {
      a.content.addView(u.button("登录原账号", () -> a.open("login"), true));
      return;
    }
    u.actionRow(
        a.content,
        new String[] {"输入班级码", "刷新班级"},
        new Runnable[] {
          () ->
              u.form(
                  "申请加入班级",
                  new JSONObject(),
                  v -> {
                    String code = v.optString("ccode").trim().toUpperCase(Locale.ROOT);
                    if (!code.matches("[A-Z0-9]{6}"))
                      throw new IllegalArgumentException("班级码为6位字母或数字");
                    a.rpc(
                        "join_class",
                        CampusJson.obj("ccode", code),
                        r -> {
                          a.toast("申请已提交，请查看老师审批状态");
                          a.refreshCloud();
                        });
                  },
                  CampusUi.f("ccode", "班级码")),
          a::refreshCloud
        });
    if (a.me.optString("role").equals("teacher") || a.me.optString("role").equals("admin"))
      a.content.addView(
          u.button(
              "创建新班级",
              () ->
                  u.form(
                      "创建班级",
                      new JSONObject(),
                      v ->
                          a.rpc(
                              "create_class",
                              CampusJson.obj("cname", v.optString("name")),
                              r -> a.refreshCloud()),
                      CampusUi.f("name", "班级名称")),
              false));
    u.section(a.content, "已加入与待审批");
    for (JSONObject c : CampusJson.rows(a.store.list("cache_classes"))) {
      LinearLayout box = u.card(a.content);
      box.addView(u.text(c.optString("name"), 18, u.ink, true));
      u.gap(box, 8);
      boolean usable = c.optBoolean("is_teacher") || c.optString("status").equals("approved");
      box.addView(
          u.text(
              c.optBoolean("is_teacher")
                  ? "班级老师"
                  : usable ? CampusActivity.roleName(c.optString("member_role")) : "等待老师批准",
              12,
              u.muted,
              false));
      u.gap(box, 12);
      if (usable)
        box.addView(
            u.button(
                c.optString("id").equals(a.cid()) ? "当前班级 · 管理" : "切换到此班级",
                () -> select(a, c),
                false));
    }
    if (!a.cid().isEmpty()) {
      u.section(a.content, "班级工作台");
      u.tileGrid(
          a.content,
          new String[][] {
            {"homework", "班级作业", "截止日期与完成状态"},
            {"wall", "班级墙", "通知、讨论与评论"},
            {"groups", "班级分组", "加入、管理与组员"},
            {"people", "同学通讯录", "成员资料与主页"}
          });
      u.actionRow(
          a.content,
          new String[] {"班级名称与昵称", "班级邀请语"},
          new Runnable[] {
            () -> identity(a),
            () ->
                CampusManage.copy(
                    a,
                    "班级邀请",
                    "加入「"
                        + a.currentClass.optString("name")
                        + "」：班级码 "
                        + a.currentClass.optString("code", "请向老师索取"))
          });
      if (a.can("can_ingest") || a.teacher())
        u.actionRow(
            a.content,
            new String[] {"发布事项", "整理班群消息"},
            new Runnable[] {() -> classForm(a, null), () -> a.open("ask")});
      if (a.teacher()) {
        u.actionRow(
            a.content,
            new String[] {"成员审批与权限", "学生功能开关"},
            new Runnable[] {() -> loadMembers(a), () -> loadFeatures(a)});
        a.content.addView(u.button("班级高级管理", () -> advanced(a), false));
      } else
        a.content.addView(
            u.button(
                "退出此班级",
                () ->
                    u.confirm(
                        "退出班级？",
                        "退出后将无法读取班级与组内消息。",
                        () ->
                            a.background(
                                "退出班级",
                                () ->
                                    a.api.rest(
                                        "class_members?class_id=eq."
                                            + CampusJson.enc(a.cid())
                                            + "&user_id=eq."
                                            + CampusJson.enc(a.api.uid()),
                                        "DELETE",
                                        null),
                                r -> {
                                  a.store.set("native_class_id", "");
                                  a.store.set("cache_items", new JSONArray());
                                  a.refreshCloud();
                                })),
                false));
    }
  }

  static void select(CampusActivity a, JSONObject c) {
    if (c.optString("id").equals(a.cid())) {
      a.ui.choose(
          c.optString("name"),
          new String[] {"查看日历", "班级分组", "班级成员"},
          i -> a.open(i == 0 ? "calendar" : i == 1 ? "groups" : "people"));
      return;
    }
    a.currentClass = c;
    a.store.set("cache_class", c);
    a.store.set("native_class_id", c.optString("id"));
    a.store.set("cache_items", new JSONArray());
    a.store.set("cache_groups", new JSONArray());
    a.store.set("cache_wall", new JSONArray());
    for (String key :
        new String[] {
          "cache_people", "cache_members", "cache_rank", "cache_features", "cache_class_opts"
        }) a.store.set(key, new JSONObject());
    a.build();
    a.refreshCloud();
  }

  static void identity(CampusActivity a) {
    a.ui.form(
        "班级展示",
        CampusJson.obj(
            "cname",
            a.currentClass.optString("name"),
            "nick",
            a.currentClass.optString("nickname"),
            "mot",
            a.currentClass.optString("motto")),
        v ->
            a.rpc(
                "set_class_identity",
                CampusJson.obj(
                    "cid",
                    a.cid(),
                    "cname",
                    a.teacher() ? v.optString("cname") : "",
                    "nick",
                    v.optString("nick"),
                    "mot",
                    v.optString("mot")),
                r -> a.refreshCloud()),
        CampusUi.f("cname", "正式名称（老师可修改）"),
        CampusUi.optional("nick", "班级昵称"),
        CampusUi.optional("mot", "班级寄语"));
  }

  static void advanced(CampusActivity a) {
    a.ui.choose(
        "班级管理",
        new String[] {"重置班级码", "转交班级", "允许全体同学添加和修改事项", "查看全校班级（管理员）"},
        i -> {
          if (i == 0)
            a.ui.confirm(
                "重置班级码？",
                "旧的班级码将立即失效。",
                () ->
                    a.rpc(
                        "regenerate_class_code",
                        CampusJson.obj("cid", a.cid()),
                        r -> a.refreshCloud()));
          else if (i == 1)
            a.ui.form(
                "转交班级",
                new JSONObject(),
                v ->
                    a.ui.confirm(
                        "确认转交班级？",
                        "转交后接收老师负责管理本班。",
                        () ->
                            a.rpc(
                                "transfer_class",
                                CampusJson.obj("cid", a.cid(), "acct", v.optString("acct")),
                                r -> a.refreshCloud())),
                CampusUi.f("acct", "接收老师账号"));
          else if (i == 2)
            a.ui.form(
                "全员编辑权限",
                CampusJson.obj(
                    "p_on", a.store.object("cache_class_opts").optBoolean("members_can_edit")),
                v ->
                    a.rpc(
                        "class_set_members_can_edit",
                        CampusJson.obj("cid", a.cid(), "p_on", v.optBoolean("p_on")),
                        r -> reloadItems(a)),
                CampusUi.f("p_on", "全体同学可添加和修改事项", "boolean"));
          else if (a.me.optString("role").equals("admin"))
            a.background(
                "读取全校班级",
                () ->
                    a.api.rest(
                        "classes?select=id,name,code,teacher_id,created_at&order=created_at.asc"),
                r -> CampusManage.records(a, "全校班级", r));
          else a.toast("此功能需要管理员权限");
        });
  }

  static void loadMembers(CampusActivity a) {
    if (!a.needClass()) return;
    final String cid = a.cid();
    a.rpc(
        "class_roster",
        CampusJson.obj("cid", cid),
        r -> {
          if (!cid.equals(a.cid())) return;
          a.store.set("cache_roster", CampusJson.arr(r));
          a.open("members");
        });
  }

  static void members(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "成员审批与权限", a.currentClass.optString("name"));
    a.content.addView(u.button("刷新名单", () -> loadMembers(a), false));
    for (JSONObject m : CampusJson.rows(a.store.list("cache_roster"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(m.optString("name", m.optString("display_name")), 18, u.ink, true));
      c.addView(
          u.text(
              m.optString("account")
                  + " · "
                  + (m.optString("status").equals("pending")
                      ? "等待批准"
                      : CampusActivity.roleName(m.optString("member_role"))),
              12,
              u.muted,
              false));
      u.gap(c, 12);
      if (a.teacher()) {
        if (m.optString("status").equals("pending"))
          u.actionRow(
              c,
              new String[] {"批准", "拒绝"},
              new Runnable[] {
                () ->
                    a.rpc(
                        "review_member",
                        CampusJson.obj(
                            "cid", a.cid(), "uid", m.optString("user_id"), "approve", true),
                        r -> loadMembers(a)),
                () ->
                    a.rpc(
                        "review_member",
                        CampusJson.obj(
                            "cid", a.cid(), "uid", m.optString("user_id"), "approve", false),
                        r -> loadMembers(a))
              });
        else
          u.actionRow(
              c,
              new String[] {"角色与权限", "移出班级"},
              new Runnable[] {
                () -> memberForm(a, m),
                () ->
                    u.confirm(
                        "移出成员？",
                        m.optString("name"),
                        () ->
                            a.background(
                                "移出成员",
                                () ->
                                    a.api.rest(
                                        "class_members?class_id=eq."
                                            + CampusJson.enc(a.cid())
                                            + "&user_id=eq."
                                            + CampusJson.enc(m.optString("user_id")),
                                        "DELETE",
                                        null),
                                r -> loadMembers(a)))
              });
      }
    }
  }

  static void memberForm(CampusActivity a, JSONObject m) {
    CampusJson.put(m, "role_label", m.optString("member_role").equals("monitor") ? "班委" : "学生");
    a.ui.form(
        "成员权限",
        m,
        v ->
            a.rpc(
                "set_member",
                CampusJson.obj(
                    "cid",
                    a.cid(),
                    "uid",
                    m.optString("user_id"),
                    "mrole",
                    v.optString("role_label").equals("班委") ? "monitor" : "student",
                    "p_ingest",
                    v.optBoolean("can_ingest"),
                    "p_edit",
                    v.optBoolean("can_edit"),
                    "p_delete",
                    v.optBoolean("can_delete"),
                    "p_view",
                    v.optBoolean("can_view_members")),
                r -> loadMembers(a)),
        CampusUi.choice("role_label", "成员身份", "学生", "班委"),
        CampusUi.f("can_ingest", "整理并发布班群消息", "boolean"),
        CampusUi.f("can_edit", "编辑班级事项", "boolean"),
        CampusUi.f("can_delete", "删除班级事项", "boolean"),
        CampusUi.f("can_view_members", "查看成员名单", "boolean"));
  }

  static void groups(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "班级分组", "组内事项与消息，只发给需要看到的人。");
    if (!a.needClass()) return;
    u.actionRow(
        a.content,
        new String[] {"刷新分组", a.teacher() || a.monitor() ? "新建分组" : "班级成员"},
        new Runnable[] {
          () -> reloadGroups(a),
          () -> {
            if (a.teacher() || a.monitor()) groupForm(a, null);
            else a.open("people");
          }
        });
    List<JSONObject> groups = CampusJson.rows(a.store.list("cache_groups"));
    if (groups.isEmpty()) u.empty(a.content, "还没有分组", "老师或班委可创建课程小组、项目小组。");
    for (JSONObject g : groups) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(g.optString("name"), 18, u.ink, true));
      u.gap(c, 8);
      c.addView(
          u.text(
              g.optString("note")
                  + " · "
                  + CampusJson.arr(g.opt("members")).length()
                  + "人"
                  + (g.optBoolean("lead") ? " · 我是组长" : g.optBoolean("mine") ? " · 已加入" : ""),
              12,
              u.muted,
              false));
      u.gap(c, 13);
      u.actionRow(
          c,
          new String[] {g.optBoolean("mine") ? "退出分组" : "加入分组", "组员与管理"},
          new Runnable[] {
            () -> {
              Runnable run =
                  () ->
                      a.rpc(
                          g.optBoolean("mine") ? "class_group_leave" : "class_group_join",
                          CampusJson.obj("gid", CampusJson.numericId(g.optString("id"))),
                          r -> reloadGroups(a));
              if (g.optBoolean("mine")) u.confirm("退出分组？", g.optString("name"), run);
              else run.run();
            },
            () -> groupMembers(a, g)
          });
    }
  }

  static void reloadGroups(CampusActivity a) {
    final String cid = a.cid();
    a.rpc(
        "class_groups_get",
        CampusJson.obj("cid", cid),
        r -> {
          if (!cid.equals(a.cid())) return;
          a.store.set("cache_groups", CampusJson.arr(r));
          a.build();
        });
  }

  static void groupForm(CampusActivity a, JSONObject g) {
    a.ui.form(
        g == null ? "新建分组" : "编辑分组",
        g == null ? new JSONObject() : g,
        v ->
            a.rpc(
                "class_group_save",
                CampusJson.obj(
                    "cid",
                    a.cid(),
                    "gid",
                    g == null ? JSONObject.NULL : CampusJson.numericId(g.optString("id")),
                    "p_name",
                    v.optString("name"),
                    "p_note",
                    v.optString("note")),
                r -> reloadGroups(a)),
        CampusUi.f("name", "分组名称"),
        CampusUi.optional("note", "分组说明"));
  }

  static void groupMembers(CampusActivity a, JSONObject g) {
    List<JSONObject> members = CampusJson.rows(g.opt("members"));
    List<String> options = new ArrayList<>();
    for (JSONObject m : members)
      options.add(m.optString("name") + (m.optBoolean("leader") ? " · 组长" : ""));
    boolean manager = a.teacher() || a.monitor() || g.optBoolean("lead");
    if (manager) options.add("＋ 添加成员");
    if (a.teacher() || a.monitor()) {
      options.add("修改分组");
      options.add("删除分组");
    }
    a.ui.choose(
        g.optString("name"),
        options.toArray(new String[0]),
        i -> {
          if (i < members.size()) {
            JSONObject m = members.get(i);
            if (manager)
              a.ui.choose(
                  m.optString("name"),
                  a.teacher() || a.monitor()
                      ? new String[] {m.optBoolean("leader") ? "取消组长" : "设为组长", "移出分组"}
                      : new String[] {"移出分组"},
                  j -> {
                    boolean leader = (a.teacher() || a.monitor()) && j == 0;
                    a.rpc(
                        "class_group_member_set",
                        CampusJson.obj(
                            "gid",
                            CampusJson.numericId(g.optString("id")),
                            "uid",
                            m.optString("user_id"),
                            "p_in",
                            leader,
                            "p_leader",
                            leader && !m.optBoolean("leader")),
                        r -> reloadGroups(a));
                  });
          } else if (options.get(i).equals("＋ 添加成员"))
            a.rpc(
                "class_roster",
                CampusJson.obj("cid", a.cid()),
                r -> {
                  List<JSONObject> pool = new ArrayList<>();
                  for (JSONObject m : CampusJson.rows(r))
                    if (m.optString("status").equals("approved")
                        && members.stream()
                            .noneMatch(y -> y.optString("user_id").equals(m.optString("user_id"))))
                      pool.add(m);
                  a.ui.choose(
                      "选择组员",
                      pool.stream().map(m -> m.optString("name")).toArray(String[]::new),
                      j ->
                          a.rpc(
                              "class_group_member_set",
                              CampusJson.obj(
                                  "gid",
                                  CampusJson.numericId(g.optString("id")),
                                  "uid",
                                  pool.get(j).optString("user_id"),
                                  "p_in",
                                  true,
                                  "p_leader",
                                  false),
                              v -> reloadGroups(a)));
                });
          else if (options.get(i).equals("修改分组")) groupForm(a, g);
          else
            a.ui.confirm(
                "删除分组？",
                g.optString("name"),
                () ->
                    a.rpc(
                        "class_group_delete",
                        CampusJson.obj("gid", CampusJson.numericId(g.optString("id"))),
                        r -> reloadGroups(a)));
        });
  }

  static void loadFeatures(CampusActivity a) {
    a.rpc(
        "class_features_get",
        CampusJson.obj("cid", a.cid()),
        r -> {
          a.store.set("cache_class_features", r);
          a.open("class-features");
        });
  }

  static void features(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "班级功能开关", "控制学生与班委的功能访问。服务器会再次核验权限。");
    for (JSONObject f : CampusJson.rows(a.store.get("cache_class_features", null))) {
      LinearLayout c = u.card(a.content);
      c.addView(
          u.text(f.optString("name", f.optString("title", f.optString("key"))), 16, u.ink, true));
      u.gap(c, 12);
      c.addView(
          u.button(
              "修改开放对象",
              () ->
                  u.form(
                      "功能权限",
                      f,
                      v ->
                          a.rpc(
                              "class_set_feature",
                              CampusJson.obj(
                                  "cid",
                                  a.cid(),
                                  "k",
                                  f.optString("key"),
                                  "stu",
                                  f.optBoolean("student_ok", true)
                                      ? v.optBoolean("student")
                                      : JSONObject.NULL,
                                  "mon",
                                  v.optBoolean("monitor")),
                              r -> loadFeatures(a)),
                      CampusUi.f("student", "普通学生", "boolean"),
                      CampusUi.f("monitor", "班委", "boolean")),
              false));
    }
  }
}
