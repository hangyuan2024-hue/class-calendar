package com.laolao.classcalendar;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.drawable.*;
import android.os.*;
import android.text.InputFilter;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.*;

/** Real native launcher and ten native tools. No WebView is instantiated on these screens. */
public class MainActivity extends Activity {
  private JSONObject data;
  private LinearLayout root, content, nav;
  private ScrollView scroll;
  private int tab = 0;
  private String tool = "", pendingExport;
  private boolean cyber;
  private long backAt;
  private TextView clock;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private int bg, card, ink, sub, accent, line;
  private static final String[] NAMES = {
    "星轨冲刺", "任务航线", "记忆晶片", "倒计时信标", "复习雷达", "能量补给", "课程导航", "心情黑匣子", "校园装备", "时空回放"
  };
  private static final String[] NOTES = {
    "专注计时与记录", "优先级与截止日", "间隔复习卡片", "考试与重要日期", "今日到期的晶片", "校园支出与预算", "课程时间与教室", "每日心情与记录",
    "出门前检查清单", "真实记录的周报"
  };
  private final Runnable pulse =
      new Runnable() {
        public void run() {
          settleTimer();
          updateClock();
          handler.postDelayed(this, 1000);
        }
      };

  private int dp(float n) {
    return Math.round(n * getResources().getDisplayMetrics().density);
  }

  @Override
  public void onCreate(Bundle saved) {
    setTheme(R.style.AppTheme);
    super.onCreate(saved);
    cyber = getPreferences(0).getBoolean("cyber", true);
    try {
      data = NativeData.load(this);
    } catch (Exception e) {
      new AlertDialog.Builder(dialogContext())
          .setTitle("本地记录读取失败")
          .setMessage(e.getMessage())
          .setPositiveButton("关闭", (d, w) -> finish())
          .setCancelable(false)
          .show();
      return;
    }
    if (saved != null) {
      tab = saved.getInt("tab");
      tool = saved.getString("tool", "");
    }
    build();
    handleIntent(getIntent());
  }

  @Override
  protected void onSaveInstanceState(Bundle s) {
    super.onSaveInstanceState(s);
    s.putInt("tab", tab);
    s.putString("tool", tool);
  }

  @Override
  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    setIntent(i);
    handleIntent(i);
  }

  private void handleIntent(Intent i) {
    if (i == null) return;
    String go = i.getStringExtra("go");
    if ("native-focus".equals(go)) {
      tab = 2;
      tool = "focus";
      build();
    } else if (go != null || i.getData() != null) {
      if (i.getData() == null
          || SiteNavigation.isInternal(BuildConfig.SITE_URL, i.getData().toString())) {
        Intent cloud = new Intent(this, CloudActivity.class);
        cloud.setData(i.getData());
        if (go != null) cloud.putExtra("go", go);
        startActivity(cloud);
      }
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (data != null) {
      FocusReceiver.restore(this);
      handler.removeCallbacks(pulse);
      handler.post(pulse);
    }
  }

  @Override
  protected void onPause() {
    handler.removeCallbacks(pulse);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }

  @Override
  public void onConfigurationChanged(android.content.res.Configuration c) {
    super.onConfigurationChanged(c);
    build();
  }

  private Context dialogContext() {
    return new ContextThemeWrapper(
        this,
        cyber
            ? android.R.style.Theme_Material_Dialog_Alert
            : android.R.style.Theme_Material_Light_Dialog_Alert);
  }

  private GradientDrawable shape(int color, int radius, int border) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(radius));
    if (border != 0) d.setStroke(dp(1), border);
    return d;
  }

  private LinearLayout vertical() {
    LinearLayout l = new LinearLayout(this);
    l.setOrientation(1);
    return l;
  }

  private TextView text(String s, int size, int color, boolean bold) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    t.setLineSpacing(dp(3), 1);
    return t;
  }

  private TextView button(String s, Runnable action, boolean primary) {
    TextView t = text(s, 13, primary ? bg : ink, true);
    t.setGravity(Gravity.CENTER);
    t.setPadding(dp(14), dp(10), dp(14), dp(10));
    t.setMinHeight(dp(46));
    t.setBackground(
        new RippleDrawable(
            android.content.res.ColorStateList.valueOf(
                primary ? 0x22000000 : ((accent & 0xffffff) | 0x22000000)),
            shape(primary ? accent : card, 12, primary ? 0 : line),
            null));
    t.setClickable(true);
    t.setFocusable(true);
    t.setOnClickListener(v -> action.run());
    return t;
  }

  private void gap(LinearLayout l, int n) {
    View v = new View(this);
    l.addView(v, new LinearLayout.LayoutParams(1, dp(n)));
  }

  private LinearLayout panel() {
    LinearLayout p = vertical();
    p.setPadding(dp(18), dp(18), dp(18), dp(18));
    p.setBackground(shape(card, 20, line));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.bottomMargin = dp(14);
    content.addView(p, lp);
    return p;
  }

  private void build() {
    bg = Color.parseColor(cyber ? "#080E1C" : "#F6F5F1");
    card = Color.parseColor(cyber ? "#111C30" : "#FFFFFF");
    ink = Color.parseColor(cyber ? "#EAF4FF" : "#172C36");
    sub = Color.parseColor(cyber ? "#A1B2CC" : "#687C85");
    accent = Color.parseColor(cyber ? "#64E5EF" : "#5366E8");
    line = Color.parseColor(cyber ? "#263959" : "#E2E6E3");
    getWindow().setStatusBarColor(bg);
    getWindow().setNavigationBarColor(bg);
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            cyber
                ? 0
                : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0));
    FrameLayout frame = new FrameLayout(this);
    frame.setBackgroundColor(bg);
    if (cyber) frame.addView(new Starfield(this), new FrameLayout.LayoutParams(-1, -1));
    root = vertical();
    frame.addView(root, new FrameLayout.LayoutParams(-1, -1));
    setContentView(frame);
    LinearLayout head = new LinearLayout(this);
    head.setGravity(Gravity.CENTER_VERTICAL);
    head.setPadding(dp(22), dp(12), dp(22), dp(12));
    TextView brand = text(cyber ? "捞捞元宇宙" : "捞捞校园", 20, ink, true);
    head.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
    head.addView(
        button(
            cyber ? "元气外观" : "元宇宙",
            () -> {
              cyber = !cyber;
              getPreferences(0).edit().putBoolean("cyber", cyber).apply();
              build();
            },
            false));
    root.addView(head);
    scroll = new ScrollView(this);
    scroll.setFillViewport(false);
    scroll.setClipToPadding(false);
    content = vertical();
    content.setPadding(dp(20), dp(6), dp(20), dp(20));
    scroll.addView(content);
    root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    clock = null;
    if (!tool.isEmpty()) renderTool();
    else if (tab == 0) home();
    else if (tab == 1) {
      tool = "task";
      renderTool();
    } else if (tab == 2) lab();
    else settings();
    nav = new LinearLayout(this);
    nav.setPadding(dp(12), dp(8), dp(12), dp(10));
    nav.setBackground(shape(card, 0, 0));
    String[] labels = {"首页", "航线", "元宇宙", "我的"};
    for (int i = 0; i < labels.length; i++) {
      final int n = i;
      TextView b =
          button(
              labels[i],
              () -> {
                tab = n;
                tool = "";
                build();
              },
              false);
      b.setTextColor(i == tab ? accent : sub);
      b.setBackground(shape(i == tab ? (cyber ? 0xff1b3047 : 0xffe9ecff) : card, 12, 0));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(52), 1);
      lp.setMargins(dp(3), 0, dp(3), 0);
      nav.addView(b, lp);
    }
    root.addView(nav);
    updateClock();
  }

  private void heading(String title, String note) {
    TextView h = text(title, 29, ink, true);
    content.addView(h);
    TextView n = text(note, 12, sub, false);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.setMargins(0, dp(7), 0, dp(22));
    content.addView(n, lp);
  }

  private void open(String id) {
    tab = 2;
    tool = id;
    build();
  }

  private int idx() {
    return Arrays.asList(NativeData.TYPES).indexOf(tool);
  }

  private void home() {
    heading("你的校园，已接入。", NativeData.today() + " · 学习空间 · 离线可用");
    LinearLayout hero = panel();
    hero.setBackground(
        new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            cyber ? new int[] {0xff203457, 0xff163746} : new int[] {0xffe9ecff, 0xffe0f0e8}));
    ((GradientDrawable) hero.getBackground()).setCornerRadius(dp(20));
    hero.addView(text("今天，推进一个小目标。", 22, ink, true));
    gap(hero, 10);
    long remaining =
        NativeData.items(data, "task").stream().filter(x -> !x.optBoolean("done")).count();
    hero.addView(
        text(
            remaining == 0 ? "没有待完成任务，给自己留一点空间。" : "还有 " + remaining + " 件事，挑最重要的一件开始。",
            13,
            sub,
            false));
    gap(hero, 20);
    hero.addView(button("＋ 记录我的任务", () -> showForm("task"), true));
    LinearLayout stats = panel();
    stats.addView(text("我的学习轨迹", 16, ink, true));
    gap(stats, 10);
    stats.addView(
        text(
            (int) NativeData.sum(data, "focus")
                + " 分钟专注    "
                + (int) NativeData.sum(data, "review")
                + " 次复习",
            18,
            accent,
            true));
    section("接下来，做什么");
    quickRow(new String[] {"星轨冲刺", "复习雷达", "课程导航"}, new String[] {"focus", "review", "course"});
    section("最近的任务");
    List<JSONObject> tasks = NativeData.items(data, "task");
    tasks.removeIf(x -> x.optBoolean("done"));
    tasks.sort(Comparator.comparingInt(x -> x.optInt("priority", 2)));
    if (tasks.isEmpty()) empty("还没有任务，点击上方按钮添加。");
    else for (JSONObject x : tasks.subList(0, Math.min(3, tasks.size()))) item(x);
    section("星际学习实验室");
    grid();
  }

  private void quickRow(String[] labels, String[] ids) {
    LinearLayout row = new LinearLayout(this);
    for (int i = 0; i < labels.length; i++) {
      final String id = ids[i];
      TextView b = button(labels[i], () -> open(id), false);
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
      lp.setMargins(0, 0, i < labels.length - 1 ? dp(8) : 0, dp(18));
      row.addView(b, lp);
    }
    content.addView(row);
  }

  private void section(String title) {
    TextView t = text(title, 18, ink, true);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.setMargins(0, dp(10), 0, dp(15));
    content.addView(t, lp);
  }

  private void lab() {
    heading("星际学习实验室", "十个实用模组，连接你的真实校园日常。");
    grid();
    TextView n = text("记录保存在此 App 内；与班级云服务独立。可在「我的」导出备份，也可与网页实验室手动交换备份。", 12, sub, false);
    content.addView(n);
  }

  private void grid() {
    int columns = getResources().getConfiguration().screenWidthDp >= 600 ? 3 : 2;
    for (int i = 0; i < NAMES.length; i += columns) {
      LinearLayout row = new LinearLayout(this);
      for (int j = i; j < Math.min(i + columns, NAMES.length); j++) {
        final String id = NativeData.TYPES[j];
        LinearLayout box = vertical();
        box.setPadding(dp(16), dp(16), dp(16), dp(16));
        box.setBackground(shape(card, 17, line));
        box.setMinimumHeight(dp(132));
        box.addView(text(String.format(Locale.ROOT, "%02d  /  模组", j + 1), 11, accent, true));
        gap(box, 19);
        box.addView(text(NAMES[j], 16, ink, true));
        gap(box, 5);
        box.addView(text(NOTES[j], 11, sub, false));
        box.setClickable(true);
        box.setFocusable(true);
        box.setContentDescription(NAMES[j] + "，" + NOTES[j]);
        box.setOnClickListener(v -> open(id));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
        lp.setMargins(0, 0, dp(9), dp(11));
        row.addView(box, lp);
      }
      if (row.getChildCount() < columns)
        row.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
      content.addView(row);
    }
  }

  private void empty(String s) {
    LinearLayout p = panel();
    p.addView(text(s, 13, sub, false));
  }

  private void renderTool() {
    int i = idx();
    if (i < 0) {
      tool = "";
      lab();
      return;
    }
    content.addView(
        button(
            "‹ 返回实验室",
            () -> {
              tool = "";
              tab = 2;
              build();
            },
            false));
    gap(content, 18);
    heading(NAMES[i], NOTES[i]);
    switch (tool) {
      case "focus":
        focus();
        break;
      case "review":
        review();
        break;
      case "stats":
        stats();
        break;
      default:
        if ("expense".equals(tool)) {
          double total = 0;
          for (JSONObject x : NativeData.items(data, tool))
            if (x.optString("date").startsWith(NativeData.today().substring(0, 7)))
              total += x.optDouble("amount");
          LinearLayout p = panel();
          p.addView(text(String.format(Locale.CHINA, "本月支出 ¥%.2f", total), 23, accent, true));
          if (data.optDouble("budget") > 0)
            p.addView(
                text(
                    String.format(Locale.CHINA, "预算余额 ¥%.2f", data.optDouble("budget") - total),
                    13,
                    sub,
                    false));
          gap(p, 12);
          p.addView(button("设置月预算", () -> showForm("budget"), false));
        }
        content.addView(button("＋ 添加记录", () -> showForm(tool), true));
        gap(content, 17);
        if ("pack".equals(tool)) {
          content.addView(
              button(
                  "重置检查状态",
                  () -> {
                    for (JSONObject x : NativeData.items(data, "pack")) put(x, "done", false);
                    persist();
                    build();
                  },
                  false));
          gap(content, 12);
        }
        List<JSONObject> list = NativeData.items(data, tool);
        if ("task".equals(tool))
          list.sort(
              Comparator.comparingInt((JSONObject x) -> x.optBoolean("done") ? 1 : 0)
                  .thenComparingInt(x -> x.optInt("priority", 2)));
        if ("exam".equals(tool)) list.sort(Comparator.comparing(x -> x.optString("date")));
        if ("course".equals(tool))
          list.sort(
              Comparator.comparingInt((JSONObject x) -> x.optInt("weekday"))
                  .thenComparing(x -> x.optString("time")));
        if (list.isEmpty()) empty("这里还没有记录，添加你的第一条。");
        else for (JSONObject x : list) item(x);
    }
  }

  private void item(JSONObject x) {
    LinearLayout p = panel();
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    LinearLayout texts = vertical();
    String t = x.optString("type"), title = x.optString("title"), note = "";
    if ("expense".equals(t))
      title += " · ¥" + String.format(Locale.CHINA, "%.2f", x.optDouble("amount"));
    if ("task".equals(t)) note = "优先级 " + x.optInt("priority") + " · 截止 " + x.optString("date");
    if ("card".equals(t))
      note = "下次复习 " + x.optString("date") + " · 已掌握 " + x.optInt("level") + " 轮";
    if ("exam".equals(t)) {
      long days = NativeData.days(x.optString("date"));
      note = days < 0 ? "已过去 " + (-days) + " 天" : "还有 " + days + " 天";
    }
    if ("expense".equals(t)) note = x.optString("date");
    if ("course".equals(t))
      note =
          "周"
              + "一二三四五六日".charAt(x.optInt("weekday") - 1)
              + " "
              + x.optString("time")
              + " · "
              + x.optString("place");
    if ("diary".equals(t)) note = x.optString("date") + " · " + x.optString("mood");
    texts.addView(text(title, 16, x.optBoolean("done") ? sub : ink, true));
    if (!note.isEmpty()) {
      gap(texts, 5);
      texts.addView(text(note, 12, sub, false));
    }
    row.addView(texts, new LinearLayout.LayoutParams(0, -2, 1));
    if ("task".equals(t) || "pack".equals(t)) {
      CheckBox check = new CheckBox(this);
      check.setButtonTintList(android.content.res.ColorStateList.valueOf(accent));
      check.setChecked(x.optBoolean("done"));
      check.setContentDescription("标记完成：" + title);
      check.setOnCheckedChangeListener(
          (b, on) -> {
            put(x, "done", on);
            if (on && "task".equals(t)) NativeData.log(data, "task", 1);
            if (!persist()) build();
          });
      row.addView(check);
    }
    p.addView(row);
    gap(p, 10);
    LinearLayout ops = new LinearLayout(this);
    ops.addView(button("编辑", () -> edit(x), false));
    View space = new View(this);
    ops.addView(space, new LinearLayout.LayoutParams(0, 1, 1));
    ops.addView(
        button(
            "删除",
            () ->
                new AlertDialog.Builder(dialogContext())
                    .setTitle("删除这条记录？")
                    .setMessage("删除后可通过先前导出的备份恢复。")
                    .setNegativeButton("取消", null)
                    .setPositiveButton(
                        "删除",
                        (d, w) -> {
                          NativeData.remove(data, x.optString("id"));
                          persist();
                          build();
                        })
                    .show(),
            false));
    p.addView(ops);
  }

  private void showForm(String type) {
    editForm(type, null);
  }

  private void edit(JSONObject x) {
    editForm(x.optString("type"), x);
  }

  private void editForm(String type, JSONObject existing) {
    String[][] fs;
    switch (type) {
      case "task":
        fs =
            new String[][] {
              {"title", "要完成的任务", "text"},
              {"date", "截止日期", "date"},
              {"priority", "优先级：1 高 / 2 中 / 3 低", "number"}
            };
        break;
      case "card":
        fs = new String[][] {{"title", "问题", "text"}, {"answer", "答案", "text"}};
        break;
      case "exam":
        fs = new String[][] {{"title", "考试或重要事项", "text"}, {"date", "日期", "date"}};
        break;
      case "expense":
        fs =
            new String[][] {
              {"title", "支出用途", "text"}, {"amount", "金额（元）", "decimal"}, {"date", "消费日期", "date"}
            };
        break;
      case "budget":
        fs = new String[][] {{"amount", "月预算（元）", "decimal"}};
        break;
      case "course":
        fs =
            new String[][] {
              {"title", "课程名称", "text"},
              {"weekday", "星期：1 到 7", "number"},
              {"time", "上课时间", "time"},
              {"place", "教室或地点", "text"}
            };
        break;
      case "diary":
        fs =
            new String[][] {
              {"date", "记录日期", "date"}, {"mood", "此刻心情", "text"}, {"title", "今天发生了什么", "text"}
            };
        break;
      case "pack":
        fs = new String[][] {{"title", "出门要带的东西", "text"}};
        break;
      default:
        return;
    }
    LinearLayout body = vertical();
    body.setPadding(dp(24), dp(14), dp(24), dp(14));
    body.setBackgroundColor(card);
    Map<String, EditText> inputs = new LinkedHashMap<>();
    for (String[] f : fs) {
      body.addView(text(f[1], 12, sub, true));
      EditText e = new EditText(dialogContext());
      e.setTextSize(16);
      e.setTextColor(ink);
      e.setBackgroundTintList(android.content.res.ColorStateList.valueOf(accent));
      e.setSingleLine(!"text".equals(f[2]));
      e.setFilters(new InputFilter[] {new InputFilter.LengthFilter(1000)});
      e.setMinHeight(dp(48));
      e.setInputType(
          "number".equals(f[2])
              ? InputType.TYPE_CLASS_NUMBER
              : "decimal".equals(f[2])
                  ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
                  : InputType.TYPE_CLASS_TEXT
                      | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                      | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
      String value =
          existing != null
              ? existing.optString(f[0], "")
              : "date".equals(f[2])
                  ? NativeData.today()
                  : "time".equals(f[2])
                      ? "08:00"
                      : "priority".equals(f[0])
                          ? "2"
                          : "weekday".equals(f[0])
                              ? "1"
                              : "budget".equals(type)
                                  ? String.valueOf(data.optDouble("budget", 0))
                                  : "";
      e.setText(value);
      if ("date".equals(f[2])) {
        e.setFocusable(false);
        e.setOnClickListener(
            v -> {
              int[] date = DateMath.parts(e.getText().toString());
              new DatePickerDialog(
                      dialogContext(),
                      (picker, y, m, d) -> e.setText(DateMath.date(y, m + 1, d)),
                      date[0],
                      date[1] - 1,
                      date[2])
                  .show();
            });
      }
      if ("time".equals(f[2])) {
        e.setFocusable(false);
        e.setOnClickListener(
            v -> {
              int[] time = DateMath.time(e.getText().toString());
              new TimePickerDialog(
                      dialogContext(),
                      (picker, h, m) -> e.setText(String.format(Locale.ROOT, "%02d:%02d", h, m)),
                      time[0],
                      time[1],
                      true)
                  .show();
            });
      }
      body.addView(e, new LinearLayout.LayoutParams(-1, -2));
      gap(body, 12);
      inputs.put(f[0], e);
    }
    TextView err = text("", 12, 0xffb43d48, false);
    body.addView(err);
    ScrollView sc = new ScrollView(this);
    sc.addView(body);
    AlertDialog dlg =
        new AlertDialog.Builder(dialogContext())
            .setTitle(existing == null ? "添加记录" : "编辑记录")
            .setView(sc)
            .setNegativeButton("取消", null)
            .setPositiveButton("保存", null)
            .create();
    dlg.setOnShowListener(
        v ->
            dlg.getButton(-1)
                .setOnClickListener(
                    b -> {
                      try {
                        JSONObject x =
                            existing == null
                                ? new JSONObject()
                                : new JSONObject(existing.toString());
                        put(x, "type", type);
                        for (Map.Entry<String, EditText> f : inputs.entrySet()) {
                          String value = f.getValue().getText().toString().trim();
                          if (value.isEmpty()) throw new IllegalArgumentException("请填写完整");
                          if (Arrays.asList("priority", "weekday", "amount").contains(f.getKey()))
                            put(x, f.getKey(), Double.parseDouble(value));
                          else put(x, f.getKey(), value);
                        }
                        if ("budget".equals(type)) {
                          double amount = x.getDouble("amount");
                          if (amount <= 0 || !Double.isFinite(amount))
                            throw new IllegalArgumentException("金额必须大于0");
                          put(data, "budget", amount);
                        } else {
                          if (existing == null) {
                            put(x, "id", UUID.randomUUID().toString());
                            if ("card".equals(type)) {
                              put(x, "date", NativeData.today());
                              put(x, "level", 0);
                            }
                          }
                          NativeData.validateItem(x);
                          if (existing == null) NativeData.add(data, x);
                          else {
                            NativeData.remove(data, existing.optString("id"));
                            data.getJSONArray("items").put(x);
                          }
                        }
                        if (!persist()) throw new IllegalStateException("记录未保存，请检查设备存储");
                        dlg.dismiss();
                        build();
                      } catch (Exception ex) {
                        err.setText(ex.getMessage());
                      }
                    }));
    dlg.show();
  }

  private JSONObject timer() {
    return data.optJSONObject("timer");
  }

  private long left() {
    JSONObject t = timer();
    if (t == null) return 1500;
    return t.optLong("end", 0) > 0
        ? Math.max(0, (t.optLong("end") - System.currentTimeMillis() + 999) / 1000)
        : t.optLong("left");
  }

  private void focus() {
    LinearLayout p = panel();
    p.addView(text("为下一件事，留一段完整的时间。", 14, sub, false));
    gap(p, 24);
    clock = text("25:00", 60, accent, true);
    clock.setGravity(Gravity.CENTER);
    clock.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
    p.addView(clock);
    gap(p, 23);
    JSONObject t = timer();
    p.addView(
        button(
            t != null && t.optLong("end") > 0 ? "暂停冲刺" : t != null ? "继续冲刺" : "开始25分钟冲刺",
            () -> toggleFocus(25),
            true));
    gap(p, 10);
    p.addView(
        button(
            "自定义时长",
            () -> {
              EditText input = new EditText(dialogContext());
              input.setInputType(InputType.TYPE_CLASS_NUMBER);
              input.setHint("1 到 180 分钟");
              AlertDialog d =
                  new AlertDialog.Builder(dialogContext())
                      .setTitle("冲刺时长")
                      .setView(input)
                      .setNegativeButton("取消", null)
                      .setPositiveButton("开始", null)
                      .create();
              d.setOnShowListener(
                  v ->
                      d.getButton(-1)
                          .setOnClickListener(
                              b -> {
                                try {
                                  int n = Integer.parseInt(input.getText().toString());
                                  if (n < 1 || n > 180) throw new Exception();
                                  if (timer() != null) {
                                    toast("请先重置当前冲刺");
                                    return;
                                  }
                                  toggleFocus(n);
                                  d.dismiss();
                                } catch (Exception ex) {
                                  input.setError("请输入1到180");
                                }
                              }));
              d.show();
            },
            false));
    gap(p, 10);
    p.addView(
        button(
            "重置",
            () -> {
              put(data, "timer", JSONObject.NULL);
              alarm(0);
              persist();
              build();
            },
            false));
    gap(p, 18);
    p.addView(text("切到后台仍按截止时间计时，完成后记录实际设定时长。系统省电模式可能延迟通知；返回 App 会自动结算。", 12, sub, false));
  }

  private void toggleFocus(int minutes) {
    try {
      JSONObject t = timer();
      if (t != null && t.optLong("end") > 0) {
        long n = left();
        put(t, "left", n);
        put(t, "end", 0);
        alarm(0);
      } else {
        if (t == null) {
          t = new JSONObject();
          t.put("duration", minutes * 60).put("left", minutes * 60);
          put(data, "timer", t);
        }
        long at = System.currentTimeMillis() + t.optLong("left") * 1000;
        t.put("end", at);
        alarm(at);
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED)
          requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 31);
      }
      persist();
      build();
    } catch (Exception e) {
      toast("计时器启动失败");
    }
  }

  private void alarm(long at) {
    AlarmManager a = (AlarmManager) getSystemService(ALARM_SERVICE);
    PendingIntent p =
        PendingIntent.getBroadcast(
            this,
            902,
            new Intent(this, FocusReceiver.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    if (at == 0) a.cancel(p);
    else a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
  }

  private void updateClock() {
    if (clock != null) {
      long n = left();
      clock.setText(String.format(Locale.ROOT, "%02d:%02d", n / 60, n % 60));
    }
  }

  private void settleTimer() {
    JSONObject t = timer();
    if (t != null && t.optLong("end") > 0 && left() == 0) {
      NativeData.log(data, "focus", t.optDouble("duration") / 60);
      put(data, "timer", JSONObject.NULL);
      alarm(0);
      persist();
      build();
      toast("冲刺完成，专注时长已记录");
    }
  }

  private void review() {
    List<JSONObject> due = NativeData.items(data, "card");
    due.removeIf(x -> x.optString("date").compareTo(NativeData.today()) > 0);
    due.sort(Comparator.comparing(x -> x.optString("date")));
    if (due.isEmpty()) {
      empty("今天没有到期晶片。先去「记忆晶片」添加你的问题和答案。");
      content.addView(button("添加记忆晶片", () -> open("card"), true));
      return;
    }
    JSONObject x = due.get(0);
    LinearLayout p = panel();
    p.addView(text("今天还有 " + due.size() + " 个晶片待复习", 12, sub, false));
    gap(p, 20);
    p.addView(text(x.optString("title"), 23, ink, true));
    gap(p, 20);
    TextView answer = text(x.optString("answer"), 18, accent, false);
    answer.setVisibility(View.GONE);
    p.addView(answer);
    gap(p, 15);
    p.addView(button("查看答案", () -> answer.setVisibility(View.VISIBLE), false));
    gap(p, 15);
    p.addView(button("还不熟，明天再看", () -> rate(x, false), false));
    gap(p, 9);
    p.addView(button("已掌握，间隔复习", () -> rate(x, true), true));
  }

  private void rate(JSONObject x, boolean ok) {
    int level = ok ? Math.min(5, x.optInt("level") + 1) : 0;
    put(x, "level", level);
    put(
        x,
        "date",
        DateMath.plus(NativeData.today(), ok ? new int[] {1, 3, 7, 14, 30, 60}[level] : 1));
    NativeData.log(data, "review", 1);
    persist();
    build();
  }

  private void stats() {
    LinearLayout p = panel();
    long completed =
        NativeData.items(data, "task").stream().filter(x -> x.optBoolean("done")).count();
    p.addView(text("我的真实记录", 17, ink, true));
    gap(p, 15);
    p.addView(text(completed + " 件已完成任务", 24, accent, true));
    p.addView(text((int) NativeData.sum(data, "focus") + " 分钟专注", 24, accent, true));
    p.addView(text((int) NativeData.sum(data, "review") + " 次复习", 24, accent, true));
    gap(p, 20);
    p.addView(text("最近七天的操作轨迹", 14, sub, false));
    JSONArray logs = data.optJSONArray("logs");
    int[] counts = new int[7];
    int max = 1;
    for (int j = 0; j < 7; j++) {
      String date = DateMath.plus(NativeData.today(), j - 6);
      for (int n = 0; n < logs.length(); n++)
        if (date.equals(logs.optJSONObject(n).optString("day"))) counts[j]++;
      max = Math.max(max, counts[j]);
    }
    for (int j = 0; j < 7; j++) {
      gap(p, 12);
      p.addView(
          text(
              DateMath.plus(NativeData.today(), j - 6) + " · " + counts[j] + " 次", 11, sub, false));
      ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
      bar.setMax(max);
      bar.setProgress(counts[j]);
      bar.setProgressTintList(android.content.res.ColorStateList.valueOf(accent));
      p.addView(bar, new LinearLayout.LayoutParams(-1, dp(7)));
    }
    gap(p, 17);
    p.addView(text("统计来自本地新增、任务完成、复习和专注记录。", 12, sub, false));
  }

  private void settings() {
    heading("我的学习空间", "原生数据仅存此 App；请定期导出备份。");
    LinearLayout p = panel();
    p.addView(text("数据与设备", 18, ink, true));
    gap(p, 18);
    p.addView(
        button(
            "导出学习备份",
            () ->
                new AlertDialog.Builder(dialogContext())
                    .setTitle("导出备份")
                    .setMessage("导出的 JSON 包含任务、日记等明文记录，请保存到你信任的位置。")
                    .setNegativeButton("取消", null)
                    .setPositiveButton(
                        "导出",
                        (d, w) -> {
                          pendingExport = data.toString();
                          Intent i =
                              new Intent(Intent.ACTION_CREATE_DOCUMENT)
                                  .setType("application/json")
                                  .addCategory(Intent.CATEGORY_OPENABLE)
                                  .putExtra(
                                      Intent.EXTRA_TITLE, "捞捞元宇宙-" + NativeData.today() + ".json");
                          startActivityForResult(i, 41);
                        })
                    .show(),
            true));
    gap(p, 10);
    p.addView(
        button(
            "导入学习备份",
            () ->
                startActivityForResult(
                    new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .setType("*/*")
                        .addCategory(Intent.CATEGORY_OPENABLE),
                    42),
            false));
    gap(p, 19);
    p.addView(text("原生学习工具无需账号与网络。原有班级账号、通知和同步由下面的兼容入口提供；它们与本地实验室独立。", 12, sub, false));
    gap(p, 12);
    p.addView(
        button("班级云服务 · 联网入口", () -> startActivity(new Intent(this, CloudActivity.class)), false));
    gap(p, 22);
    p.addView(text("版本 " + BuildConfig.VERSION_NAME + " · 校园学习空间", 12, sub, false));
  }

  @Override
  protected void onActivityResult(int request, int result, Intent intent) {
    super.onActivityResult(request, result, intent);
    if (result != RESULT_OK || intent == null || intent.getData() == null) return;
    try {
      if (request == 41) {
        try (OutputStream stream = getContentResolver().openOutputStream(intent.getData())) {
          if (stream == null) throw new IOException();
          stream.write(pendingExport.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        toast("备份已导出");
      }
      if (request == 42) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream in = getContentResolver().openInputStream(intent.getData())) {
          byte[] block = new byte[4096];
          int n;
          while ((n = in.read(block)) != -1) {
            if (bytes.size() + n > 2000000) throw new IOException("备份不能超过2MB");
            bytes.write(block, 0, n);
          }
        }
        final JSONObject imported = NativeData.backup(bytes.toString("UTF-8"));
        new AlertDialog.Builder(dialogContext())
            .setTitle("替换本地实验室记录？")
            .setMessage("请先导出当前备份。班级云服务数据不会被修改。")
            .setNegativeButton("取消", null)
            .setPositiveButton(
                "导入",
                (d, w) -> {
                  data = imported;
                  alarm(0);
                  if (persist()) {
                    build();
                    toast("备份已导入");
                  } else FocusReceiver.restore(this);
                })
            .show();
      }
    } catch (Exception e) {
      toast("操作失败，原数据保留：" + e.getMessage());
    }
  }

  private boolean persist() {
    try {
      NativeData.save(this, data);
      return true;
    } catch (Exception e) {
      toast(e.getMessage());
      try {
        data = NativeData.load(this);
      } catch (Exception ignored) {
      }
      return false;
    }
  }

  private void put(JSONObject o, String key, Object v) {
    try {
      o.put(key, v);
    } catch (JSONException e) {
      throw new IllegalArgumentException(e);
    }
  }

  private void toast(String s) {
    Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  @Override
  public void onBackPressed() {
    if (!tool.isEmpty() || tab != 0) {
      tool = "";
      tab = 0;
      build();
      return;
    }
    long now = System.currentTimeMillis();
    if (now - backAt < 2000) moveTaskToBack(true);
    else {
      backAt = now;
      toast("再按一次返回桌面");
    }
  }

  private final class Starfield extends View {
    private final Paint paint = new Paint(3);

    Starfield(Context c) {
      super(c);
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas c) {
      super.onDraw(c);
      int w = getWidth(), h = getHeight();
      paint.setShader(
          new RadialGradient(
              w * .85f,
              h * .1f,
              w * .8f,
              new int[] {0x553652a0, 0x00080e1c},
              null,
              Shader.TileMode.CLAMP));
      c.drawRect(0, 0, w, h, paint);
      paint.setShader(null);
      paint.setColor(0x445a83a7);
      for (int i = 0; i < 35; i++)
        c.drawCircle(
            (i * 71 % 997) / 997f * w,
            (i * 137 % 991) / 991f * h,
            dp(i % 3 == 0 ? 1.2f : .6f),
            paint);
      paint.setColor(0x102aa5bd);
      for (int x = 0; x < w; x += dp(38)) c.drawLine(x, h * .6f, x, h, paint);
      for (int y = (int) (h * .6f); y < h; y += dp(38)) c.drawLine(0, y, w, y, paint);
    }
  }
}
