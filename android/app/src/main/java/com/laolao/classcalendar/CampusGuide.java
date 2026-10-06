package com.laolao.classcalendar;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Native counterpart of mascotArt, island.js and the website's local schedule assistant. */
final class CampusGuide {
  private static final String[] QUESTIONS = {
    "最急的是什么", "今天有什么课", "这周的作业", "明天有什么安排", "下节课在哪", "我今天打卡了吗"
  };

  /** Always discoverable 48 dp touch target; hiding hints does not remove this entry. */
  static View avatar(CampusActivity a) {
    Mascot face = new Mascot(a);
    a.ui.touch(face, a.ui.soft, 16, 0);
    face.setMinimumWidth(a.ui.dp(48));
    face.setMinimumHeight(a.ui.dp(48));
    face.setContentDescription("捞捞助手：查看提醒和询问安排");
    face.setOnClickListener(v -> open(a));
    return face;
  }

  /** Compact in-flow home hint; never overlays tasks, buttons, or navigation. */
  static View suggestion(CampusActivity a) {
    CampusUi u = a.ui;
    boolean visible = enabled(a);
    LinearLayout line = u.row();
    line.setPadding(u.dp(8), u.dp(6), u.dp(12), u.dp(6));
    line.setMinimumHeight(u.dp(60));
    u.touch(line, u.soft, 16, 0);
    Mascot face = new Mascot(a);
    face.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    line.addView(face, new LinearLayout.LayoutParams(u.dp(46), u.dp(46)));
    LinearLayout copy = u.column();
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1);
    cp.leftMargin = u.dp(6);
    line.addView(copy, cp);
    copy.addView(u.text(visible ? "捞捞在这儿" : "捞捞休息中", 12, u.accent, true));
    TextView hint = u.text(visible ? hint(a) : "点这里恢复首页提醒", 12, u.ink, false);
    hint.setMaxLines(a.getResources().getConfiguration().fontScale > 1.3f ? 3 : 2);
    hint.setEllipsize(android.text.TextUtils.TruncateAt.END);
    copy.addView(hint);
    TextView arrow = u.text("›", 24, u.accent, false);
    arrow.setPadding(u.dp(8), 0, 0, 0);
    arrow.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    line.addView(arrow);
    line.setContentDescription(visible ? "捞捞提醒：" + hint(a) : "恢复捞捞首页提醒");
    line.setOnClickListener(
        v -> {
          if (!visible) {
            setEnabled(a, true);
            a.build();
          }
          open(a);
        });
    return line;
  }

  static boolean enabled(CampusActivity a) {
    return a.store.object("island_v1").optBoolean("on", true);
  }

  private static void setEnabled(CampusActivity a, boolean on) {
    // Preserve web preferences such as screen, reminders, side, and configured displays.
    JSONObject prefs = a.store.object("island_v1");
    CampusJson.put(prefs, "on", on);
    a.store.set("island_v1", prefs);
    a.syncSoon();
  }

  static void settings(CampusActivity a) {
    a.ui.choose(
        "捞捞助手",
        new String[] {enabled(a) ? "关闭首页提醒，小人仍可从顶部打开" : "显示首页提醒", "打开捞捞助手"},
        which -> {
          if (which == 0) {
            setEnabled(a, !enabled(a));
            a.build();
          } else open(a);
        });
  }

  static void open(CampusActivity a) {
    if (a.isFinishing()) return;
    new Panel(a).show();
  }

  private static String hint(CampusActivity a) {
    JSONObject timer = a.store.object(CampusPlanner.TIMER);
    if (timer.optBoolean("running") && timer.optLong("deadline") > System.currentTimeMillis()) {
      long mins =
          Math.max(1, (timer.optLong("deadline") - System.currentTimeMillis() + 59999) / 60000);
      return (timer.optString("phase", "focus").equals("focus") ? "专注中" : "休息中")
          + " · 还剩 "
          + mins
          + " 分钟";
    }
    List<Entry> ranked = ranked(a);
    if (!ranked.isEmpty()) {
      Entry top = ranked.get(0);
      return top.title + " · " + top.reason + (top.location.isEmpty() ? "" : " · " + top.location);
    }
    Entry next = nextCourse(a);
    if (next != null) return next.title + " · " + dayName(next.day) + " " + next.time;
    return "没有要赶的事，点我查看课程、作业和打卡。";
  }

  static final class Entry {
    JSONObject source;
    String title, day, time, location, reason, type;
    boolean course;
    double score, minutes;
  }

  /** Same urgency weights and seven-day overdue window as island-core.js. */
  static List<Entry> ranked(CampusActivity a) {
    List<Entry> out = new ArrayList<>();
    long now = System.currentTimeMillis();
    for (JSONObject item : a.items()) {
      if (a.done(item) || CampusSchool.hidden(a, item)) continue;
      Entry entry = itemEntry(item, now);
      if (entry != null) out.add(entry);
    }
    for (JSONObject c : CampusCourses.onDay(a.store, DateMath.today())) {
      Entry entry = courseEntry(c, DateMath.today());
      long start = millis(entry.day, entry.time), end = millis(entry.day, c.optString("t1"));
      if (end <= now) continue;
      double toStart = (start - now) / 60000., toEnd = (end - now) / 60000.;
      entry.minutes = toStart;
      entry.score = toStart <= 0 ? 96 : toStart <= 180 ? 110 / (1 + toStart / 60) : 0;
      if (entry.score == 0) continue;
      entry.reason =
          toStart <= 0
              ? "正在上课 · " + Math.max(1, Math.round(toEnd)) + " 分钟后下课"
              : Math.max(1, Math.round(toStart)) + " 分钟后上课";
      out.add(entry);
    }
    out.sort(Comparator.comparingDouble((Entry e) -> e.score).reversed());
    return out;
  }

  static Entry itemEntry(JSONObject item, long now) {
    Entry e = new Entry();
    e.source = item;
    e.title = item.optString("subject", item.optString("summary", "事项"));
    if (e.title.trim().isEmpty()) e.title = "事项";
    e.type = item.optString("msg_type", "个人");
    e.day = CampusJson.date(item.optString("event_time"));
    Matcher hm = Pattern.compile("(?:T|\\s)(\\d{2}:\\d{2})").matcher(item.optString("event_time"));
    e.time = hm.find() ? hm.group(1) : "";
    e.location = item.optString("location");
    double weight =
        e.type.equals("作业")
            ? 1.45
            : e.type.equals("会议")
                ? 1.15
                : e.type.equals("通知") ? .8 : e.type.equals("个人") ? 1.05 : 1;
    if (Pattern.compile("考试|测验|测试|小测|期中|期末|月考|考核|答辩")
        .matcher(e.title + item.optString("summary"))
        .find()) weight = 1.7;
    if (e.day.isEmpty()) {
      e.score = 4 * weight;
      e.reason = "时间待确认";
      e.minutes = Double.NaN;
    } else {
      long due = millis(e.day, e.time.isEmpty() ? "23:59" : e.time);
      if (due == Long.MIN_VALUE) return null;
      e.minutes = (due - now) / 60000.;
      double hours = e.minutes / 60;
      if (e.minutes < 0) {
        if (DateMath.days(e.day) < -7) return null;
        e.score = (e.type.equals("作业") ? 150 : 60) - Math.min(-hours / 24, 7) * 8;
      } else e.score = 100 / (1 + hours / 12);
      e.score *= weight;
      if (!e.type.equals("作业") && e.minutes < -120) e.score *= .2;
      e.reason = left(e.minutes);
    }
    if (item.optBoolean("need_confirm")) e.score += 3;
    return e;
  }

  static Entry courseEntry(JSONObject c, String day) {
    Entry e = new Entry();
    e.source = c;
    e.course = true;
    e.type = "课程";
    e.title = c.optString("name");
    e.day = day;
    e.time = c.optString("t0");
    e.location = c.optString("location");
    e.reason = c.optString("t0") + "–" + c.optString("t1");
    return e;
  }

  static Entry nextCourse(CampusActivity a) {
    String today = DateMath.today();
    String current = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
    for (int i = 0; i < 8; i++) {
      String day = DateMath.plus(today, i);
      for (JSONObject c : CampusCourses.onDay(a.store, day)) {
        if (i == 0 && c.optString("t1").compareTo(current) <= 0) continue;
        return courseEntry(c, day);
      }
    }
    return null;
  }

  private static long millis(String day, String time) {
    try {
      int[] p = DateMath.parts(day), hm = DateMath.time(time);
      Calendar c = Calendar.getInstance();
      c.clear();
      c.set(p[0], p[1] - 1, p[2], hm[0], hm[1]);
      return c.getTimeInMillis();
    } catch (Exception ignored) {
      return Long.MIN_VALUE;
    }
  }

  private static String left(double minutes) {
    if (minutes < 0) {
      double late = -minutes;
      if (late < 60) return "刚过 " + Math.max(1, Math.round(late)) + " 分钟";
      if (late < 1440) return "已过 " + Math.round(late / 60) + " 小时";
      return "过期 " + (int) Math.floor(late / 1440) + " 天";
    }
    if (minutes < 60) return "还剩 " + Math.max(1, Math.round(minutes)) + " 分钟";
    if (minutes < 1440) return "还剩 " + Math.round(minutes / 60) + " 小时";
    return "还剩 " + Math.round(minutes / 1440) + " 天";
  }

  private static String dayName(String day) {
    long n = DateMath.days(day);
    if (n == 0) return "今天";
    if (n == 1) return "明天";
    if (n == 2) return "后天";
    int[] d = DateMath.parts(day);
    return d[1] + "月" + d[2] + "日";
  }

  static final class Reply {
    String text, action = "";
    final List<Entry> entries = new ArrayList<>();

    Reply(String text) {
      this.text = text;
    }
  }

  /** Queries inspect saved native records directly; no web engine or pretend AI response. */
  static Reply answer(CampusActivity a, String question) {
    String q = question.trim();
    if (q.contains("粘贴") || q.contains("导入消息") || q.contains("整理消息")) {
      Reply r = new Reply("先复制班群消息，在日历点“粘贴导入”，核对发布日期和识别结果后再保存。也可以点下面的按钮直接开始。");
      r.action = "paste";
      return r;
    }
    if (q.contains("下节课") || q.contains("下一节") || q.contains("哪个教室") || q.contains("在哪上课")) {
      Entry next = nextCourse(a);
      boolean inClass =
          next != null
              && next.day.equals(DateMath.today())
              && millis(next.day, next.time) <= System.currentTimeMillis();
      Reply r =
          new Reply(
              next == null
                  ? "最近一周没有记录的课程。请确认课表、周次和学期设置。"
                  : inClass
                      ? "现在正在上「"
                          + next.title
                          + "」，"
                          + next.source.optString("t1")
                          + " 下课"
                          + (next.location.isEmpty() ? "。" : "，在 " + next.location + "。")
                      : "下节课是"
                          + dayName(next.day)
                          + " "
                          + next.time
                          + " 的「"
                          + next.title
                          + "」"
                          + (next.location.isEmpty() ? "。" : "，在 " + next.location + "。"));
      if (next != null) r.entries.add(next);
      else if (a.store.list(CampusCourses.COURSES).length() == 0) r.action = "courses";
      return r;
    }
    if (q.contains("打卡") || q.contains("成长")) {
      int total = a.store.list("habits_v1").length(), done = CampusLearn.habitToday(a.store);
      Reply r =
          new Reply(
              total == 0
                  ? "你还没有设置习惯，可以到成长里添加。"
                  : "今天已打卡 "
                      + done
                      + "/"
                      + total
                      + " 个习惯。"
                      + (done == total ? "今天的打卡都完成啦！" : "还有 " + (total - done) + " 个习惯等你。"));
      r.action = "growth";
      return r;
    }
    if (q.contains("急") || q.contains("先做") || q.contains("接下来")) {
      Reply r = new Reply("我按轻重缓急排好了：");
      List<Entry> list = ranked(a);
      r.entries.addAll(list.subList(0, Math.min(6, list.size())));
      if (list.isEmpty()) r.text = "没有要赶的事，可以安心安排自己的学习。";
      return r;
    }
    String day = parseDay(q);
    boolean
        week =
            q.matches(".*(这周|本周|下周|这星期|下星期).*")
                && !Pattern.compile("(?:周|星期|礼拜)[一二三四五六日天1-7]").matcher(q).find(),
        nextWeek = q.contains("下周") || q.contains("下星期");
    String first = week ? CampusCourses.monday(DateMath.today()) : day;
    if (week && nextWeek) first = DateMath.plus(first, 7);
    String last = week ? DateMath.plus(first, 6) : day;
    if (q.contains("课") && !q.contains("作业")) {
      if (a.store.list(CampusCourses.COURSES).length() == 0) {
        Reply r = new Reply("你还没有导入课表，先在课程表中导入或添加课程，再问我哪天有什么课。");
        r.action = "courses";
        return r;
      }
      Reply r = new Reply((week ? nextWeek ? "下周" : "本周" : dayName(day)) + "的课程：");
      for (int i = 0; i < (week ? 7 : 1); i++) {
        String date = DateMath.plus(first, i);
        for (JSONObject course : CampusCourses.onDay(a.store, date))
          r.entries.add(courseEntry(course, date));
      }
      if (r.entries.isEmpty()) r.text = (week ? nextWeek ? "下周" : "本周" : dayName(day)) + "没有记录的课程。";
      return r;
    }
    if (q.contains("作业")
        || q.contains("安排")
        || q.contains("考试")
        || q.contains("待办")
        || q.contains("事项")) {
      boolean homework = q.contains("作业"),
          exam = q.contains("考"),
          all = q.contains("待") && !week && !q.contains("明天") && !q.contains("今天");
      Reply r =
          new Reply(
              (all ? "待完成" : week ? nextWeek ? "下周" : "本周" : dayName(day))
                  + (homework ? "的作业：" : exam ? "的考试：" : "的安排："));
      for (JSONObject item : a.items()) {
        if (a.done(item) || CampusSchool.hidden(a, item)) continue;
        Entry e = itemEntry(item, System.currentTimeMillis());
        if (e == null
            || homework && !e.type.equals("作业")
            || exam && !Pattern.compile("考试|测验|期中|期末|答辩").matcher(e.title + e.type).find())
          continue;
        if (!all && (e.day.isEmpty() || e.day.compareTo(first) < 0 || e.day.compareTo(last) > 0))
          continue;
        r.entries.add(e);
      }
      r.entries.sort(Comparator.comparing((Entry e) -> e.day).thenComparing(e -> e.time));
      if (r.entries.isEmpty()) r.text = "没有待完成的相关记录。";
      r.action = homework ? "homework" : "calendar";
      return r;
    }
    if (q.contains("是谁") || q.contains("叫什么"))
      return new Reply("我是捞捞，捞捞课程表里的学习小助手。帮你盯住课程、作业、安排和打卡，有事点我就好。");
    if (q.contains("累") || q.contains("烦") || q.contains("压力"))
      return new Reply("辛苦啦，先休息一下。把眼前的任务拆小，先做第一步，慢慢来也可以。");
    if (q.contains("谢")) return new Reply("不客气，有事随时叫我。");
    return new Reply("我会从你自己的记录里查询课程、作业、近期安排和打卡。试试问“明天有什么课”“这周的作业”“下节课在哪”。");
  }

  private static String parseDay(String q) {
    String today = DateMath.today();
    if (q.contains("大后天")) return DateMath.plus(today, 3);
    if (q.contains("后天")) return DateMath.plus(today, 2);
    if (q.contains("明天") || q.contains("明日")) return DateMath.plus(today, 1);
    if (q.contains("昨天")) return DateMath.plus(today, -1);
    Matcher m = Pattern.compile("(下下|下|上|本|这)?(?:周|星期|礼拜)([一二三四五六日天1-7])").matcher(q);
    if (m.find()) {
      String digits = "一二三四五六日";
      String c = m.group(2);
      int wd = c.equals("天") ? 6 : digits.indexOf(c);
      if (wd < 0) wd = Integer.parseInt(c) - 1;
      int offset =
          "下下".equals(m.group(1))
              ? 14
              : "下".equals(m.group(1)) ? 7 : "上".equals(m.group(1)) ? -7 : 0;
      return DateMath.plus(CampusCourses.monday(today), offset + wd);
    }
    return today;
  }

  private static final class Panel {
    final CampusActivity a;
    final CampusUi u;
    final LinearLayout root, body;
    final ScrollView scroll;
    final EditText query;
    AlertDialog dialog;
    String lastQuestion = "";

    Panel(CampusActivity a) {
      this.a = a;
      u = a.ui;
      root = u.column();
      root.setPadding(u.dp(16), u.dp(12), u.dp(16), u.dp(12));
      LinearLayout header = u.row();
      header.addView(new Mascot(a), new LinearLayout.LayoutParams(u.dp(52), u.dp(52)));
      LinearLayout title = u.column();
      title.addView(u.text("捞捞", 20, u.ink, true));
      title.addView(u.text("你的学习小助手", 12, u.muted, false));
      LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, -2, 1);
      tp.leftMargin = u.dp(8);
      header.addView(title, tp);
      TextView settings =
          headerButton(
              "设置",
              "捞捞助手设置",
              () -> {
                dialog.dismiss();
                CampusGuide.settings(a);
              });
      header.addView(settings, new LinearLayout.LayoutParams(u.dp(48), u.dp(48)));
      TextView close = headerButton("×", "收起捞捞助手", () -> dialog.dismiss());
      header.addView(close, new LinearLayout.LayoutParams(u.dp(48), u.dp(48)));
      root.addView(header);
      scroll = new ScrollView(a);
      scroll.setFillViewport(false);
      body = u.column();
      body.setPadding(u.dp(2), u.dp(10), u.dp(2), u.dp(12));
      scroll.addView(body);
      root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
      LinearLayout input = u.row();
      query = new EditText(u.dialog());
      query.setTextColor(u.ink);
      query.setHintTextColor(u.muted);
      query.setTextSize(14);
      query.setSingleLine(true);
      query.setFilters(
          new android.text.InputFilter[] {new android.text.InputFilter.LengthFilter(80)});
      query.setImeOptions(EditorInfo.IME_ACTION_SEND);
      query.setHint("问捞捞：明天有什么课？");
      query.setContentDescription("向捞捞提问");
      query.setPadding(u.dp(12), u.dp(10), u.dp(12), u.dp(10));
      query.setBackground(u.shape(u.soft, 14, 0));
      query.setMinHeight(u.dp(48));
      input.addView(query, new LinearLayout.LayoutParams(0, -2, 1));
      TextView send = u.button("发送", () -> ask(query.getText().toString()), true);
      send.setPadding(u.dp(6), u.dp(12), u.dp(6), u.dp(12));
      LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(u.dp(64), -2);
      sp.leftMargin = u.dp(8);
      input.addView(send, sp);
      query.setOnEditorActionListener(
          (v, action, event) -> {
            if (action != EditorInfo.IME_ACTION_SEND) return false;
            ask(query.getText().toString());
            return true;
          });
      root.addView(input);
      root.setFocusableInTouchMode(true);
      root.requestFocus();
      greeting();
    }

    TextView headerButton(String text, String description, Runnable action) {
      TextView b = u.text(text, text.equals("×") ? 26 : 12, u.muted, false);
      b.setGravity(Gravity.CENTER);
      u.touch(b, Color.TRANSPARENT, 16, 0);
      b.setContentDescription(description);
      b.setOnClickListener(v -> action.run());
      return b;
    }

    void show() {
      dialog = new AlertDialog.Builder(u.dialog()).setView(root).create();
      dialog.setCanceledOnTouchOutside(true);
      u.showDialog(dialog);
      Window window = dialog.getWindow();
      if (window != null) {
        int screen = a.getResources().getDisplayMetrics().heightPixels;
        window.setGravity(Gravity.BOTTOM);
        window.setLayout(
            Math.min(a.getResources().getDisplayMetrics().widthPixels - u.dp(16), u.dp(580)),
            Math.min(u.dp(700), Math.round(screen * .82f)));
        window.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
      }
    }

    void greeting() {
      String name = a.me.optString("display_name");
      body.addView(
          u.text(
              "我是捞捞" + (name.isEmpty() ? "。" : "，" + name + "。") + "今天想先搞定哪件事？", 14, u.ink, false));
      u.section(body, "先做哪件？");
      body.addView(u.text("点圆圈完成事项，点文字查看详情。", 12, u.muted, false));
      u.gap(body, 8);
      List<Entry> list = ranked(a);
      if (list.isEmpty()) body.addView(u.text("没有要赶的事。", 13, u.muted, false));
      for (Entry e : list.subList(0, Math.min(3, list.size()))) row(e);
      u.section(body, "直接问我");
      chips();
      u.gap(body, 12);
      body.addView(
          u.button(
              "AI 整理 · 粘贴班群消息",
              () -> {
                dialog.dismiss();
                CampusSocial.pasteImport(a);
              },
              false));
    }

    void chips() {
      for (int i = 0; i < QUESTIONS.length; i += 2) {
        final String first = QUESTIONS[i], second = QUESTIONS[i + 1];
        u.actionRow(
            body,
            new String[] {first, second},
            new Runnable[] {() -> ask(first), () -> ask(second)});
      }
    }

    void ask(String text) {
      String question = text.trim();
      if (question.isEmpty()) return;
      lastQuestion = question;
      InputMethodManager keyboard =
          (InputMethodManager) a.getSystemService(Context.INPUT_METHOD_SERVICE);
      if (keyboard != null) keyboard.hideSoftInputFromWindow(query.getWindowToken(), 0);
      query.setText("");
      root.requestFocus();
      Reply reply = answer(a, question);
      body.removeAllViews();
      body.addView(u.text("你：" + question, 13, u.muted, false));
      u.gap(body, 12);
      body.addView(u.text(reply.text, 15, u.ink, true));
      u.gap(body, 12);
      for (Entry e : reply.entries) row(e);
      if (!reply.action.isEmpty()) {
        u.gap(body, 8);
        String label =
            reply.action.equals("paste")
                ? "粘贴导入班群消息"
                : reply.action.equals("courses")
                    ? "打开课程表"
                    : reply.action.equals("growth")
                        ? "去成长打卡"
                        : reply.action.equals("homework") ? "打开作业" : "打开日历";
        body.addView(
            u.button(
                label,
                () -> {
                  dialog.dismiss();
                  if (reply.action.equals("paste")) CampusSocial.pasteImport(a);
                  else a.open(reply.action);
                },
                false));
      }
      u.section(body, "还可以问我");
      chips();
      scroll.post(() -> scroll.scrollTo(0, 0));
    }

    void row(Entry e) {
      LinearLayout line = u.row();
      line.setPadding(u.dp(12), u.dp(12), u.dp(12), u.dp(12));
      line.setMinimumHeight(u.dp(64));
      u.touch(line, u.soft, 12, 0);
      if (!e.course) {
        TextView complete = u.text("○", 26, u.accent, false);
        complete.setGravity(Gravity.CENTER);
        u.touch(complete, Color.TRANSPARENT, 12, 0);
        complete.setContentDescription("完成" + e.title);
        complete.setOnClickListener(
            v -> {
              a.mark(e.source);
              if (lastQuestion.isEmpty()) {
                body.removeAllViews();
                greeting();
              } else ask(lastQuestion);
            });
        LinearLayout.LayoutParams checkbox = new LinearLayout.LayoutParams(u.dp(48), u.dp(48));
        checkbox.rightMargin = u.dp(4);
        line.addView(complete, checkbox);
      }
      LinearLayout details = u.column();
      TextView title = u.text(e.title, 14, u.ink, true);
      title.setMaxLines(2);
      details.addView(title);
      String where =
          e.day.isEmpty() ? "时间待确认" : dayName(e.day) + (e.time.isEmpty() ? "" : " " + e.time);
      details.addView(
          u.text(
              e.type + " · " + where + (e.location.isEmpty() ? "" : " · " + e.location),
              12,
              u.muted,
              false));
      details.addView(u.text(e.reason, 12, u.accent, false));
      line.addView(details, new LinearLayout.LayoutParams(0, -2, 1));
      line.addView(u.text("›", 20, u.muted, false));
      line.setContentDescription("查看" + e.title + "，" + where + "，" + e.reason);
      line.setOnClickListener(
          v -> {
            dialog.dismiss();
            if (!e.day.isEmpty()) a.selectedDay = e.day;
            if (e.course)
              a.store.set(
                  "native_view_week",
                  Math.max(1, Math.min(30, CampusCourses.week(a.store, e.day))));
            a.open(e.course ? "courses" : e.type.equals("作业") ? "homework" : "calendar");
          });
      body.addView(line);
      u.gap(body, 8);
    }
  }

  /** Faithful Canvas redraw of index.html #mascotArt (the original waving calendar). */
  static final class Mascot extends View {
    final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    final boolean cyber;

    Mascot(CampusActivity a) {
      super(a);
      cyber = a.page.equals("meta") || a.store.string("ui_skin_v1", "fresh").equals("cyber");
      setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    @Override
    protected void onDraw(Canvas c) {
      super.onDraw(c);
      float scale = Math.min(getWidth(), getHeight()) / 128f;
      c.save();
      c.translate((getWidth() - 120 * scale) / 2f, (getHeight() - 120 * scale) / 2f);
      c.scale(scale, scale);
      int line = cyber ? 0xff00f0ff : 0xff0e2240;
      int body = cyber ? 0xff120c2c : Color.WHITE;
      int top = cyber ? 0xffff2bd6 : 0xffff8a3d;
      fill(cyber ? 0x4000f0ff : 0x260a325a);
      c.drawOval(30, 107, 90, 117, paint);
      Path hand = new Path();
      hand.moveTo(96, 74);
      hand.quadTo(112, 70, 114, 52);
      stroke(line, 5);
      c.drawPath(hand, paint);
      fill(body);
      c.drawCircle(114, 50, 6, paint);
      stroke(line, 4);
      c.drawCircle(114, 50, 6, paint);
      hand.reset();
      hand.moveTo(24, 78);
      hand.quadTo(12, 84, 12, 96);
      stroke(line, 5);
      c.drawPath(hand, paint);
      fill(body);
      c.drawRoundRect(new RectF(22, 28, 98, 106), 24, 24, paint);
      stroke(line, 5);
      c.drawRoundRect(new RectF(22, 28, 98, 106), 24, 24, paint);
      Path cap = new Path();
      cap.moveTo(22, 54);
      cap.lineTo(22, 52);
      cap.cubicTo(22, 38.745f, 32.745f, 28, 46, 28);
      cap.lineTo(74, 28);
      cap.cubicTo(87.255f, 28, 98, 38.745f, 98, 52);
      cap.lineTo(98, 54);
      cap.close();
      fill(top);
      c.drawPath(cap, paint);
      stroke(line, 5);
      c.drawPath(cap, paint);
      fill(line);
      c.drawRoundRect(new RectF(40, 16, 49, 38), 4.5f, 4.5f, paint);
      c.drawRoundRect(new RectF(71, 16, 80, 38), 4.5f, 4.5f, paint);
      if (cyber) {
        Path visor = new Path();
        visor.moveTo(28, 64);
        visor.lineTo(92, 64);
        visor.quadTo(96, 64, 96, 68);
        visor.lineTo(96, 78);
        visor.quadTo(96, 84, 90, 84);
        visor.lineTo(72, 84);
        visor.lineTo(66, 78);
        visor.lineTo(58, 78);
        visor.lineTo(52, 84);
        visor.lineTo(34, 84);
        visor.quadTo(28, 84, 28, 78);
        visor.lineTo(28, 68);
        visor.quadTo(28, 64, 32, 64);
        visor.close();
        fill(0xff0a0420);
        c.drawPath(visor, paint);
        stroke(line, 3);
        c.drawPath(visor, paint);
        stroke(top, 4);
        c.drawLine(34, 72, 52, 72, paint);
        c.drawLine(68, 72, 86, 72, paint);
      } else {
        fill(0xff0e2240);
        c.drawOval(40, 66.5f, 52, 81.5f, paint);
        c.drawOval(68, 66.5f, 80, 81.5f, paint);
        fill(Color.WHITE);
        c.drawCircle(48, 71, 2.2f, paint);
        c.drawCircle(76, 71, 2.2f, paint);
        fill(0xccff9db5);
        c.drawOval(30, 82.5f, 42, 89.5f, paint);
        c.drawOval(78, 82.5f, 90, 89.5f, paint);
      }
      Path smile = new Path();
      smile.moveTo(54, 88);
      smile.quadTo(60, 94, 66, 88);
      stroke(line, 4);
      c.drawPath(smile, paint);
      Path star = new Path();
      star.moveTo(104, 18);
      star.lineTo(107, 25);
      star.lineTo(114, 28);
      star.lineTo(107, 31);
      star.lineTo(104, 38);
      star.lineTo(101, 31);
      star.lineTo(94, 28);
      star.lineTo(101, 25);
      star.close();
      fill(cyber ? 0xff39ffa5 : 0xffffd23f);
      c.drawPath(star, paint);
      c.restore();
    }

    void fill(int color) {
      paint.setColor(color);
      paint.setStyle(Paint.Style.FILL);
    }

    void stroke(int color, float width) {
      paint.setColor(color);
      paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(width);
      paint.setStrokeCap(Paint.Cap.ROUND);
      paint.setStrokeJoin(Paint.Join.ROUND);
    }
  }
}
