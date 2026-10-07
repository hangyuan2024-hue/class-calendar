package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Campus Compose launcher, retaining the established storage, API and device controllers. */
public class CampusActivity extends androidx.activity.ComponentActivity {
  CampusApi api;
  CampusStore store;
  CampusUi ui;
  LinearLayout content;
  ScrollView scroll;
  JSONObject me = new JSONObject(), currentClass = new JSONObject();
  String page = "home", selectedDay = DateMath.today();
  String toolQuery = "", toolCategory = "全部";
  final ExecutorService worker = Executors.newSingleThreadExecutor();
  final Handler handler = new Handler(Looper.getMainLooper());
  final Deque<String> history = new ArrayDeque<>();
  boolean dark, loading, unlocked;
  int buildGeneration;
  private String renderedPage = "";
  String cloudError = "";
  private String pendingExport;
  private long backAt;
  private Runnable permissionAfter;

  interface Work {
    Object run() throws Exception;
  }

  interface Done {
    void accept(Object value) throws Exception;
  }

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    setTheme(R.style.AppTheme);
    try {
      api = new CampusApi(this);
      store = new CampusStore(this, api.uid());
      activateScope();
      me = store.object("cache_me");
      currentClass = store.object("cache_class");
      dark = getPreferences(0).getBoolean("dark", false);
      if (saved != null) {
        page = saved.getString("page", "home");
        selectedDay = saved.getString("day", DateMath.today());
        toolQuery = saved.getString("toolQuery", "");
        toolCategory = saved.getString("toolCategory", "全部");
      }
      ComposeEntry.install(this);
      build();
      routeIntent(getIntent());
      if (api.logged()) refreshCloud();
    } catch (Exception e) {
      new AlertDialog.Builder(this)
          .setTitle("无法读取学习空间")
          .setMessage(e.getMessage())
          .setPositiveButton("关闭", (d, w) -> finish())
          .show();
    }
  }

  private void activateScope() {
    getSharedPreferences("campus_active_scope", 0).edit().putString("owner", api.uid()).apply();
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    out.putString("page", page);
    out.putString("day", selectedDay);
    out.putString("toolQuery", toolQuery);
    out.putString("toolCategory", toolCategory);
  }

  @Override
  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    setIntent(i);
    routeIntent(i);
  }

  private void routeIntent(Intent i) {
    if (i == null) return;
    if (Intent.ACTION_SEND.equals(i.getAction())) {
      CampusPhone.receive(this, i);
      open("inbox");
      return;
    }
    String go = i.getStringExtra("go");
    if (go != null) {
      if (go.equals("native-focus")) {
        open("pomo");
        return;
      }
      if (go.equals("wall")) open("wall");
      else if (go.equals("homework")) open("homework");
      else if (go.equals("native-widget")) open("home");
      else if (go.equals("quick-add")) {
        open("home");
        CampusSchool.personalForm(this, null);
      } else if (go.equals("home-layout")
          || CampusSchool.handles(go)
          || CampusLearn.handles(go)
          || CampusPhone.handles(go)
          || CampusExtras.handles(go)
          || CampusManage.handles(go)
          || CampusSocial.handles(go)
          || Arrays.asList("home", "tools", "me", "login", "register").contains(go)) open(go);
      else open("calendar");
    }
    Uri data = i.getData();
    if (data != null) {
      String path = data.toString();
      String fragment = data.getFragment();
      if (fragment != null && fragment.matches("unsub=[0-9a-f]{32}")) {
        String token = fragment.substring(6);
        ui.confirm(
            "退订邮件通知？",
            "确认后将关闭此链接对应账号的邮件通知。",
            () ->
                rpc(
                    "mail_unsubscribe",
                    CampusJson.obj("t", token),
                    r -> toast(Boolean.TRUE.equals(r) ? "已退订邮件通知" : "退订链接无效或已过期")));
        return;
      }
      if (fragment != null
          && Arrays.asList(
                  "home",
                  "homework",
                  "wall",
                  "calendar",
                  "plan",
                  "ask",
                  "growth",
                  "tools",
                  "me",
                  "people")
              .contains(fragment)) open(fragment);
      else if (path.contains("#plan")) open("plan");
      else if (path.contains("class.html")) open("class");
      else if (path.contains("dev.html")) open("admin");
      else open("home");
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (store != null) {
      CampusPhone.refresh(this);
      if (page.equals("diary") && store.bool("native_diary_lock", false) && !unlocked) build();
      if (!api.uid().equals(store.owner)) {
        store = new CampusStore(this, api.uid());
        activateScope();
        me = store.object("cache_me");
        currentClass = store.object("cache_class");
        build();
      }
    }
  }

  @Override
  protected void onPause() {
    super.onPause();
    unlocked = false;
    CampusPhone.cancelBiometric();
  }

  @Override
  protected void onDestroy() {
    ComposeEntry.dispose(this);
    handler.removeCallbacksAndMessages(null);
    worker.shutdownNow();
    CampusPhone.release(this);
    CampusWords.release(this);
    super.onDestroy();
  }

  @Override
  public void onConfigurationChanged(android.content.res.Configuration c) {
    super.onConfigurationChanged(c);
    build();
  }

  void open(String route) {
    if (!page.equals(route)) history.push(page);
    page = route;
    CampusToolbox.remember(this, route);
    build();
  }

  void tab(String route) {
    history.clear();
    page = route;
    build();
  }

  void build() {
    if (ComposeEntry.active(this)) {
      ui = new CampusUi(this, dark);
      ComposeEntry.refresh(this);
      return;
    }
    boolean changedPage = !renderedPage.equals(page);
    int restoreY = renderedPage.equals(page) && scroll != null ? scroll.getScrollY() : 0;
    renderedPage = page;
    buildGeneration++;
    String skin = store.string("ui_skin_v1", "fresh");
    dark =
        skin.equals("cyber")
            || skin.equals("auto") && (getResources().getConfiguration().uiMode & 48) == 32;
    if (page.equals("meta")) dark = true;
    if (page.equals("diary") || page.equals("privacy"))
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    ui = new CampusUi(this, dark);
    dark = ui.dark;
    getWindow().setStatusBarColor(ui.bg);
    getWindow().setNavigationBarColor(ui.bg);
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            dark
                ? 0
                : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0));
    LinearLayout root = ui.column();
    root.setBackgroundColor(ui.bg);
    setContentView(root);
    LinearLayout head = ui.row();
    head.setPadding(ui.dp(12), ui.dp(3), ui.dp(12), ui.dp(3));
    head.setBackgroundColor(ui.bg);
    head.setMinimumHeight(ui.dp(54));
    boolean detail =
        !Arrays.asList(
                "home",
                "homework",
                "wall",
                "calendar",
                "plan",
                "ask",
                "growth",
                "tools",
                "me",
                "class")
            .contains(page);
    FrameLayout mark = ui.badge(detail ? "back" : "menu");
    ui.touch(mark, Color.TRANSPARENT, 14, 0);
    mark.removeAllViews();
    mark.addView(
        new CampusUi.Icon(this, detail ? "back" : "menu", ui.ink),
        new FrameLayout.LayoutParams(ui.dp(23), ui.dp(23), Gravity.CENTER));
    mark.setContentDescription(detail ? "返回上一页" : "打开导航菜单");
    mark.setOnClickListener(
        v -> {
          if (detail) onBackPressed();
          else navigationMenu();
        });
    head.addView(mark, new LinearLayout.LayoutParams(ui.dp(48), ui.dp(48)));
    LinearLayout brand = ui.column();
    TextView name = ui.text("捞捞课程表", 16, ui.ink, true);
    name.setSingleLine(true);
    brand.addView(name);
    ui.gap(brand, 4);
    TextView subtitle = ui.text(pageLabel(page), 10, ui.muted, false);
    subtitle.setSingleLine(true);
    subtitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    brand.addView(subtitle);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
    p.leftMargin = ui.dp(6);
    head.addView(brand, p);
    head.addView(CampusGuide.avatar(this), new LinearLayout.LayoutParams(ui.dp(48), ui.dp(48)));
    FrameLayout add = ui.badge("plus");
    ui.touch(add, ui.soft, 14, 0);
    add.setContentDescription("记事与快捷操作");
    add.setOnClickListener(v -> quickAdd());
    LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(ui.dp(48), ui.dp(48));
    ap.leftMargin = ui.dp(4);
    head.addView(add, ap);
    root.addView(head);
    View headLine = new View(this);
    headLine.setBackgroundColor(ui.border);
    root.addView(headLine, new LinearLayout.LayoutParams(-1, ui.dp(1)));
    if (page.equals("calendar")) root.addView(CampusSchool.calendarToolbar(this));
    if (page.equals("parse-review")) root.addView(CampusSocial.reviewToolbar(this));
    scroll = new ScrollView(this);
    scroll.setClipToPadding(false);
    scroll.setFillViewport(true);
    scroll.setVerticalScrollBarEnabled(false);
    content = ui.column();
    int gutter = getResources().getConfiguration().screenWidthDp <= 340 ? 16 : 20;
    content.setPadding(ui.dp(gutter), ui.dp(10), ui.dp(gutter), ui.dp(24));
    FrameLayout canvas = new FrameLayout(this);
    int width = Math.min(getResources().getDisplayMetrics().widthPixels, ui.dp(760));
    canvas.addView(
        content, new FrameLayout.LayoutParams(width, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL));
    scroll.addView(canvas);
    root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    if (page.equals("home")) home();
    else if (page.equals("tools")) tools();
    else if (page.equals("me")) profile();
    else if (page.equals("login") || page.equals("register")) auth();
    else if (CampusExtras.handles(page)) CampusExtras.render(this, page);
    else if (CampusSchool.handles(page)) CampusSchool.render(this, page);
    else if (CampusLearn.handles(page)) CampusLearn.render(this, page);
    else if (CampusSocial.handles(page)) CampusSocial.render(this, page);
    else if (CampusPhone.handles(page)) CampusPhone.render(this, page);
    else if (CampusManage.handles(page)) CampusManage.render(this, page);
    else ui.empty(content, "暂未找到页面", "请返回学习空间。");
    FrameLayout footer = new FrameLayout(this);
    footer.setPadding(ui.dp(12), ui.dp(8), ui.dp(12), ui.dp(6));
    footer.setBackgroundColor(ui.surface);
    LinearLayout nav = ui.row();
    nav.setPadding(ui.dp(4), ui.dp(4), ui.dp(4), ui.dp(4));
    nav.setBackground(ui.shape(ui.surface, 0, 0));
    String[] ids = {"home", "homework", "calendar", "tools", "me"},
        names = {"首页", "作业", "日历", "工具", "我的"};
    String active =
        Arrays.asList(ids).contains(page)
            ? page
            : Arrays.asList(
                        "login",
                        "register",
                        "appearance",
                        "backup",
                        "about",
                        "security",
                        "mail",
                        "admin")
                    .contains(page)
                ? "me"
                : Arrays.asList("courses", "ocr-review").contains(page)
                    ? "calendar"
                    : Arrays.asList(
                                "wall", "plan", "ask", "growth", "class", "rank", "farm", "meta")
                            .contains(page)
                        ? ""
                        : "tools";
    for (int j = 0; j < 5; j++) {
      final String id = ids[j];
      boolean on = id.equals(active);
      LinearLayout cell = ui.column();
      cell.setGravity(Gravity.CENTER);
      cell.setPadding(0, ui.dp(3), 0, ui.dp(3));
      cell.setMinimumHeight(ui.dp(54));
      ui.touch(cell, ui.surface, 15, 0);
      cell.setContentDescription(names[j]);
      cell.setSelected(on);
      FrameLayout icon = new FrameLayout(this);
      icon.setBackgroundColor(Color.TRANSPARENT);
      icon.addView(
          new CampusUi.Icon(this, id, on ? ui.accent : ui.muted),
          new FrameLayout.LayoutParams(ui.dp(22), ui.dp(22), Gravity.CENTER));
      cell.addView(icon, new LinearLayout.LayoutParams(ui.dp(44), ui.dp(28)));
      ui.gap(cell, 4);
      TextView label = ui.text(names[j], 11, on ? ui.accent : ui.muted, on);
      label.setGravity(Gravity.CENTER);
      cell.addView(label);
      cell.setOnClickListener(v -> tab(id));
      if (id.equals("tools"))
        cell.setOnLongClickListener(
            v -> {
              CampusToolbox.quickChoose(this);
              return true;
            });
      nav.addView(cell, new LinearLayout.LayoutParams(0, -2, 1));
    }
    footer.addView(
        nav,
        new FrameLayout.LayoutParams(
            Math.min(getResources().getDisplayMetrics().widthPixels - ui.dp(28), ui.dp(560)),
            -2,
            Gravity.CENTER));
    View bottomLine = new View(this);
    bottomLine.setBackgroundColor(ui.border);
    root.addView(bottomLine, new LinearLayout.LayoutParams(-1, ui.dp(1)));
    root.addView(footer);
    float animationScale =
        android.provider.Settings.Global.getFloat(
            getContentResolver(), android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
    if (changedPage && animationScale > 0) {
      content.setTranslationY(ui.dp(8));
      content.setAlpha(0);
      content.animate().translationY(0).alpha(1).setDuration(180).start();
    }
    int generation = buildGeneration;
    if (restoreY > 0)
      scroll.post(
          () -> {
            if (generation == buildGeneration) scroll.scrollTo(0, restoreY);
          });
  }

  private String pageLabel(String route) {
    for (String[] item : CampusToolbox.ITEMS) if (item[0].equals(route)) return item[1];
    if (route.equals("homework")) return "我的作业";
    if (route.equals("wall")) return "班级墙";
    if (route.equals("home")) return "首页";
    if (route.equals("calendar")) return "日历";
    if (route.equals("tools")) return "工具";
    if (route.equals("me")) return "我的";
    if (route.equals("class")) return "班级";
    if (route.equals("parse-review")) return "核对导入内容";
    if (route.equals("appearance")) return "皮肤与首页";
    if (route.equals("backup")) return "数据与同步";
    if (route.equals("security")) return "账号安全";
    if (route.equals("mail")) return "邮箱通知";
    if (route.equals("about")) return "关于";
    if (route.equals("login")) return "登录";
    if (route.equals("register")) return "注册";
    return pageSection(route);
  }

  private String pageSection(String route) {
    if (route.equals("meta")) return "学习与成长";
    for (String[] item : CampusToolbox.ITEMS)
      if (item[0].equals(route)) return item[3].equals("手机") ? "手机专属" : item[3] + "工具";
    if (Arrays.asList("homework", "wall", "people", "groups", "login", "register").contains(route))
      return "账号与班级";
    return "个性与设置";
  }

  void navigationMenu() {
    LinearLayout panel = ui.column();
    panel.setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(8));
    LinearLayout title = ui.row();
    title.addView(ui.text("捞捞课程表", 21, ui.ink, true), new LinearLayout.LayoutParams(0, -2, 1));
    FrameLayout search = ui.badge("search");
    search.setContentDescription("搜索全部记录");
    title.addView(search, new LinearLayout.LayoutParams(ui.dp(48), ui.dp(48)));
    panel.addView(title);
    ui.gap(panel, 8);
    ScrollView viewport = new ScrollView(this);
    LinearLayout entries = ui.column();
    String[][] routes = {
      {"home", "首页"}, {"homework", "作业"}, {"wall", "班级墙"}, {"calendar", "日历"},
      {"plan", "规划"}, {"ask", "问答"}, {"growth", "成长"}, {"tools", "工具"},
      {"me", "我的"}, {"class", "班级"}
    };
    AlertDialog dialog = new AlertDialog.Builder(ui.dialog()).setView(panel).create();
    for (String[] entry : routes) {
      LinearLayout row = ui.row();
      row.setPadding(ui.dp(10), ui.dp(6), ui.dp(4), ui.dp(6));
      row.setMinimumHeight(ui.dp(56));
      ui.touch(row, page.equals(entry[0]) ? ui.soft : ui.surface, 12, 0);
      row.addView(
          new CampusUi.Icon(this, entry[0], page.equals(entry[0]) ? ui.accent : ui.muted),
          new LinearLayout.LayoutParams(ui.dp(22), ui.dp(22)));
      TextView label = ui.text(entry[1], 15, ui.ink, page.equals(entry[0]));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
      lp.leftMargin = ui.dp(16);
      row.addView(label, lp);
      if (entry[0].equals("tools")) {
        TextView quick =
            ui.button(
                "快捷",
                () -> {
                  dialog.dismiss();
                  CampusToolbox.quickChoose(this);
                },
                false);
        quick.setContentDescription("快捷选择工具");
        quick.setPadding(ui.dp(4), ui.dp(8), ui.dp(4), ui.dp(8));
        row.addView(quick, new LinearLayout.LayoutParams(ui.dp(64), -2));
      } else if (entry[0].equals(page)) row.addView(ui.pill("当前"));
      row.setContentDescription("导航到" + entry[1]);
      row.setOnClickListener(
          v -> {
            dialog.dismiss();
            tab(entry[0]);
          });
      entries.addView(row);
    }
    viewport.addView(entries);
    panel.addView(
        viewport,
        new LinearLayout.LayoutParams(
            -1,
            Math.min(ui.dp(560), (int) (getResources().getDisplayMetrics().heightPixels * .65))));
    search.setOnClickListener(
        v -> {
          dialog.dismiss();
          open("search");
        });
    ui.showDialog(dialog);
    Window window = dialog.getWindow();
    if (window != null) {
      window.setGravity(Gravity.BOTTOM);
      window.setLayout(
          Math.min(getResources().getDisplayMetrics().widthPixels - ui.dp(16), ui.dp(480)), -2);
    }
  }

  void quickAdd() {
    final String selected = page.equals("calendar") ? selectedDay : DateMath.today();
    LinearLayout panel = ui.column();
    panel.setPadding(ui.dp(20), ui.dp(18), ui.dp(20), ui.dp(16));
    panel.addView(ui.text("记事与快捷操作", 21, ui.ink, true));
    ui.gap(panel, 14);
    AlertDialog dialog = new AlertDialog.Builder(ui.dialog()).setView(panel).create();
    List<String> labels = new ArrayList<>(Arrays.asList("记一件事", "粘贴导入", "打卡成长", "开始专注"));
    List<Runnable> actions =
        new ArrayList<>(
            Arrays.asList(
                () -> {
                  selectedDay = selected;
                  CampusSchool.personalForm(this, null);
                },
                () -> CampusSocial.pasteImport(this),
                () -> open("growth"),
                () -> open("pomo")));
    if (!cid().isEmpty() && can("can_ingest")) {
      labels.add(2, "发布班级事项");
      actions.add(2, () -> CampusSchool.classForm(this, null));
    }
    for (int i = 0; i < labels.size(); i++) {
      final Runnable action = actions.get(i);
      panel.addView(
          ui.button(
              labels.get(i),
              () -> {
                dialog.dismiss();
                action.run();
              },
              i == 0));
      ui.gap(panel, 8);
    }
    ui.showDialog(dialog);
    Window window = dialog.getWindow();
    if (window != null) {
      window.setGravity(Gravity.BOTTOM);
      window.setLayout(
          Math.min(getResources().getDisplayMetrics().widthPixels - ui.dp(16), ui.dp(480)), -2);
    }
  }

  LinearLayout featureContent() {
    content = ui.column();
    if (page.equals("login") || page.equals("register")) auth();
    else if (CampusExtras.handles(page)) CampusExtras.render(this, page);
    else if (CampusSchool.handles(page)) CampusSchool.render(this, page);
    else if (CampusLearn.handles(page)) CampusLearn.render(this, page);
    else if (CampusSocial.handles(page)) CampusSocial.render(this, page);
    else if (CampusPhone.handles(page)) CampusPhone.render(this, page);
    else if (CampusManage.handles(page)) CampusManage.render(this, page);
    return content;
  }

  void home() {
    CampusDashboard.render(this);
  }

  void tools() {
    CampusToolbox.render(this);
  }

  void profile() {
    ui.title(content, "我的", "账号、皮肤与数据设置");
    LinearLayout identity = ui.card(content);
    identity.setBackground(ui.shape(ui.soft, 24, 0));
    LinearLayout line = ui.row();
    String name = api.logged() ? me.optString("display_name", "同学") : "同学";
    TextView avatar =
        ui.text(
            name.isEmpty() ? "我" : name.substring(0, name.offsetByCodePoints(0, 1)),
            22,
            ui.accent,
            true);
    avatar.setGravity(Gravity.CENTER);
    avatar.setBackground(ui.shape(ui.surface, 28, 0));
    line.addView(avatar, new LinearLayout.LayoutParams(ui.dp(56), ui.dp(56)));
    LinearLayout copy = ui.column();
    copy.addView(ui.text(name, 19, ui.ink, true));
    ui.gap(copy, 6);
    copy.addView(
        ui.text(
            api.logged()
                ? roleName(me.optString("role")) + " · " + me.optString("account")
                : "本机空间 · 尚未登录",
            12,
            ui.muted,
            false));
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1);
    cp.leftMargin = ui.dp(14);
    line.addView(copy, cp);
    identity.addView(line);
    ui.gap(identity, 16);
    identity.addView(
        ui.text(
            api.logged() ? me.optString("bio", "记录、交流、成长。") : "日记和学习记录保存在本机。登录后，可以连接你的班级。",
            13,
            ui.muted,
            false));
    ui.gap(identity, 16);
    identity.addView(
        ui.button(
            api.logged() ? "编辑个人主页" : "登录 / 注册",
            () -> {
              if (api.logged()) CampusSocial.editProfile(this);
              else open("login");
            },
            true));
    ui.section(content, "外观与使用习惯");
    ui.toolRows(
        content,
        new String[][] {{"appearance", "皮肤与首页", "当前：" + ui.theme.preset.name + " · 10 种配色"}});
    content.addView(ui.button("提示小人设置", () -> CampusGuide.settings(this), false));
    ui.section(content, "账号与班级");
    ui.toolRows(
        content,
        new String[][] {
          {"class", "班级管理", "加入、分组与老师管理"},
          {"people", "班级成员", "同学资料与主页"},
          {"mail", "邮箱通知", "绑定、偏好与测试邮件"},
          {"security", "账号安全", "修改密码与安全信息"}
        });
    ui.section(content, "数据与设备");
    ui.toolRows(
        content,
        new String[][] {
          {"backup", "数据与同步", "云端衔接、导入与备份"},
          {"phone", "设备能力", "权限和十项手机专属工具"},
          {"about", "关于捞捞", "版本、协议与功能介绍"}
        });
    if (staff()) {
      ui.section(content, "管理工作台");
      content.addView(ui.button("插件、用户与功能管理", () -> open("admin"), false));
    }
    if (api.logged()) {
      ui.gap(content, 22);
      content.addView(
          ui.button(
              "退出当前账号",
              () ->
                  ui.confirm(
                      "退出账号？",
                      "本地记录按账号保留。",
                      () ->
                          background(
                              "退出登录",
                              () -> {
                                api.logout();
                                return null;
                              },
                              v -> {
                                switchAccount();
                                tab("home");
                              })),
              false));
    }
  }

  void auth() {
    boolean signup = page.equals("register");
    ui.title(
        content, signup ? "加入捞捞课程表" : "欢迎回来", signup ? "使用同一账号连接网站与手机。" : "登录网站原来的账号，读取你的班级与云端记录。");
    LinearLayout box = ui.card(content);
    box.addView(ui.text("账号 · 姓名 · 班级", 19, ui.ink, true));
    ui.gap(box, 12);
    box.addView(ui.text("账号为3—20位小写字母、数字或下划线；密码至少8位。", 13, ui.muted, false));
    ui.gap(box, 22);
    box.addView(
        ui.button(
            signup ? "填写注册信息" : "填写登录信息",
            () -> {
              if (signup)
                ui.form(
                    "注册校园账号",
                    new JSONObject(),
                    v ->
                        background(
                            "注册",
                            () -> {
                              api.register(
                                  v.getString("account"),
                                  v.getString("password"),
                                  v.getString("name"),
                                  v.getString("role").equals("老师") ? "teacher" : "student",
                                  v.getString("gender").equals("男")
                                      ? "m"
                                      : v.getString("gender").equals("女") ? "f" : "");
                              return null;
                            },
                            r -> {
                              switchAccount();
                              tab("home");
                              refreshCloud();
                            }),
                    CampusUi.f("account", "账号"),
                    CampusUi.f("password", "密码", "password"),
                    CampusUi.f("name", "姓名"),
                    CampusUi.choice("role", "身份", "学生", "老师"),
                    CampusUi.choice("gender", "性别", "保密", "男", "女"));
              else
                ui.form(
                    "登录原账号",
                    new JSONObject(),
                    v ->
                        background(
                            "登录",
                            () -> api.login(v.getString("account"), v.getString("password")),
                            r -> {
                              switchAccount();
                              tab("home");
                              refreshCloud();
                            }),
                    CampusUi.f("account", "账号"),
                    CampusUi.f("password", "密码", "password"));
            },
            true));
    ui.gap(box, 10);
    box.addView(
        ui.button(
            signup ? "已有账号，登录" : "没有账号，注册", () -> open(signup ? "login" : "register"), false));
  }

  private void switchAccount() {
    if (LectureService.live) startService(new Intent(this, LectureService.class).setAction("stop"));
    CampusPhone.release(this);
    CampusDndReceiver.restoreFilter(this);
    store = new CampusStore(this, api.uid());
    activateScope();
    me = store.object("cache_me");
    currentClass = store.object("cache_class");
    cloudError = "";
    unlocked = false;
  }

  void background(String label, Work task, Done done) {
    final String owner = api.uid();
    final boolean changesOwner = label.equals("登录") || label.equals("注册") || label.equals("退出登录");
    toast(label + "…");
    worker.execute(
        () -> {
          try {
            if (!owner.equals(api.uid())) return;
            Object result = task.run();
            handler.post(
                () -> {
                  if (isFinishing() || isDestroyed() || (!changesOwner && !owner.equals(api.uid())))
                    return;
                  try {
                    done.accept(result);
                    CampusPhone.refresh(this);
                  } catch (Exception e) {
                    error(e);
                  }
                });
          } catch (Exception e) {
            handler.post(
                () -> {
                  if (!isDestroyed() && (changesOwner || owner.equals(api.uid()) || !api.logged()))
                    error(e);
                });
          }
        });
  }

  void error(Exception e) {
    loading = false;
    cloudError = e.getMessage() == null ? "操作未完成，请重试" : e.getMessage();
    toast(cloudError);
    if (api != null && store != null && !api.uid().equals(store.owner)) {
      switchAccount();
      build();
    }
  }

  void rpc(String name, JSONObject args, Done done) {
    background("正在处理", () -> api.rpc(name, args), done);
  }

  boolean requireLogin() {
    if (api.logged()) return true;
    open("login");
    return false;
  }

  boolean staff() {
    return Arrays.asList("admin", "developer", "tester").contains(me.optString("role"));
  }

  boolean teacher() {
    return currentClass.optBoolean("is_teacher") || me.optString("role").equals("admin");
  }

  boolean monitor() {
    return currentClass.optString("member_role").equals("monitor");
  }

  boolean can(String p) {
    return teacher() || currentClass.optBoolean(p);
  }

  String cid() {
    return currentClass.optString("id");
  }

  boolean needClass() {
    if (!requireLogin()) return false;
    if (cid().isEmpty()) {
      open("class");
      toast("请先选择已加入的班级");
      return false;
    }
    return true;
  }

  static String roleName(String role) {
    return role.equals("teacher")
        ? "老师"
        : role.equals("monitor")
            ? "班委"
            : role.equals("admin")
                ? "管理员"
                : role.equals("developer") ? "开发者" : role.equals("tester") ? "测试员" : "学生";
  }

  void refreshCloud() {
    if (!api.logged() || loading) return;
    loading = true;
    cloudError = "";
    build();
    background(
        "连接班级",
        () -> {
          JSONObject boot;
          try {
            boot =
                CampusJson.object(
                    api.rpc(
                        "app_bootstrap2",
                        CampusJson.obj(
                            "cid", CampusJson.nullable(store.string("native_class_id", "")))));
          } catch (CampusApi.Failure e) {
            if (e.status != 404 && e.status != 400) throw e;
            boot =
                CampusJson.object(
                    api.rpc(
                        "app_bootstrap",
                        CampusJson.obj(
                            "cid", CampusJson.nullable(store.string("native_class_id", "")))));
          }
          store.set("cache_boot", boot);
          JSONObject profile = CampusJson.object(boot.opt("me"));
          Object permissions = boot.opt("perms");
          if (!(permissions instanceof JSONArray))
            permissions = api.rpc("my_perms", new JSONObject());
          CampusJson.put(profile, "perms", permissions);
          store.set("cache_me", profile);
          JSONArray classes = boot.optJSONArray("classes");
          if (classes == null) classes = CampusJson.arr(api.rpc("my_classes", new JSONObject()));
          store.set("cache_classes", classes);
          JSONObject selected = new JSONObject();
          String wanted = store.string("native_class_id", "");
          for (JSONObject c : CampusJson.rows(classes))
            if ((c.optBoolean("is_teacher") || c.optString("status").equals("approved"))
                && (selected.length() == 0 || c.optString("id").equals(wanted))) selected = c;
          store.set("cache_class", selected);
          store.set("native_class_id", selected.optString("id"));
          if (selected.length() > 0) {
            String cid = selected.optString("id");
            JSONObject ctx = CampusJson.object(api.rpc("class_ctx", CampusJson.obj("cid", cid)));
            store.set("cache_items", ctx.opt("items"));
            store.set("cache_groups", ctx.opt("groups"));
            store.set("cache_class_opts", ctx.opt("class_opts"));
            store.set("cache_features", api.rpc("feature_state", CampusJson.obj("cid", cid)));
          }
          store.sync(api);
          store.syncGrowth(api);
          try {
            JSONObject crs = CampusJson.object(api.rpc("courses_get", new JSONObject()));
            CampusCourses.acceptCloud(store, crs);
          } catch (Exception e) {
            store.set("native_course_error", e.getMessage());
          }
          store.set("cache_loaded_at", System.currentTimeMillis());
          return null;
        },
        v -> {
          loading = false;
          me = store.object("cache_me");
          currentClass = store.object("cache_class");
          build();
        });
    handler.postDelayed(
        () -> {
          if (loading) {
            loading = false;
            build();
          }
        },
        23000);
  }

  List<JSONObject> items() {
    List<JSONObject> rows = new ArrayList<>();
    for (JSONObject x : CampusJson.rows(store.list("cache_items"))) {
      CampusJson.put(x, "_key", "c" + x.optString("id"));
      CampusJson.put(x, "_mine", false);
      rows.add(x);
    }
    for (JSONObject x : CampusJson.rows(store.list("personal_events_v1"))) {
      CampusJson.put(x, "_key", x.optString("id"));
      CampusJson.put(x, "_mine", true);
      if (!x.has("msg_type")) CampusJson.put(x, "msg_type", "个人");
      rows.add(x);
    }
    return rows;
  }

  boolean done(JSONObject x) {
    return x.optBoolean("_mine")
        ? x.optBoolean("done")
        : store.object("personal_marks_v1").optJSONObject(x.optString("_key")) != null
            && store
                .object("personal_marks_v1")
                .optJSONObject(x.optString("_key"))
                .optBoolean("done");
  }

  void mark(JSONObject x) {
    String key = x.optString("_key"), date = DateMath.today();
    boolean personal = x.optBoolean("_mine");
    boolean on = !done(x);
    if (x.optBoolean("_mine")) {
      CampusJson.put(x, "done", on);
      x.remove("_key");
      x.remove("_mine");
      store.replace("personal_events_v1", x.optString("id"), x);
    } else {
      JSONObject m = store.object("personal_marks_v1").optJSONObject(key);
      if (m == null) m = new JSONObject();
      CampusJson.put(m, "done", on);
      store.entry("personal_marks_v1", key, m);
    }
    store.entry("done_log_v1", key, on ? date : null);
    if (on && store.object("fun_opts_v1").optBoolean("confetti", true)) toast("又完成一件事，记下今天的进步。 ✦");
    if (!personal) growth("done", x.optString("id"), !on);
    build();
    syncSoon();
  }

  void syncSoon() {
    final CampusStore target = store;
    final String owner = api.uid();
    if (api.logged())
      worker.execute(
          () -> {
            try {
              if (owner.equals(api.uid())) {
                target.sync(api);
                target.syncGrowth(api);
              }
            } catch (Exception e) {
              handler.post(() -> error(e));
            }
          });
    CampusPhone.refresh(this);
  }

  void growth(String kind, String reference, boolean undo) {
    if (api.logged() && !cid().isEmpty()) store.queueGrowth(cid(), kind, reference, undo);
  }

  void toast(String s) {
    if (ComposeEntry.active(this)) {
      ComposeEntry.notice(this, s);
      return;
    }
    Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  void export(String name, String body, String mime) {
    pendingExport = body;
    Intent i =
        new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .setType(mime)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_TITLE, name);
    startActivityForResult(i, 4001);
  }

  void importBackup() {
    startActivityForResult(
        new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("application/json")
            .addCategory(Intent.CATEGORY_OPENABLE),
        4002);
  }

  void request(String permission, Runnable after) {
    if (Build.VERSION.SDK_INT < 23
        || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        || permission.equals(android.Manifest.permission.ACCESS_FINE_LOCATION)
            && checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
      after.run();
      return;
    }
    permissionAfter = after;
    requestPermissions(
        permission.equals(android.Manifest.permission.ACCESS_FINE_LOCATION)
            ? new String[] {permission, android.Manifest.permission.ACCESS_COARSE_LOCATION}
            : new String[] {permission},
        4003);
  }

  @Override
  public void onRequestPermissionsResult(int r, String[] p, int[] result) {
    super.onRequestPermissionsResult(r, p, result);
    boolean granted = result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED;
    if (p.length > 1 && p[0].equals(android.Manifest.permission.ACCESS_FINE_LOCATION))
      granted = granted || result.length > 1 && result[1] == PackageManager.PERMISSION_GRANTED;
    if (r == 4003 && result.length > 0 && granted && permissionAfter != null) permissionAfter.run();
    else toast("未授予权限，可继续使用其他功能");
    permissionAfter = null;
  }

  @Override
  protected void onActivityResult(int r, int result, Intent i) {
    super.onActivityResult(r, result, i);
    if (CampusPhone.result(this, r, result, i)) return;
    if (result != RESULT_OK || i == null || i.getData() == null) return;
    try {
      if (r == 4001) {
        try (OutputStream out = getContentResolver().openOutputStream(i.getData())) {
          if (out == null) throw new IOException("无法写入文件");
          out.write(pendingExport.getBytes("UTF-8"));
        }
        toast("文件已导出");
      } else if (r == 4002) {
        String raw = CampusApi.read(getContentResolver().openInputStream(i.getData()), 32000000);
        new JSONObject(raw);
        ui.confirm(
            "替换本地学习记录？",
            "请先导出当前备份；导入后可选择是否同步到当前账号。",
            () -> {
              try {
                CampusPhone.restoreBackup(this, raw);
                build();
                toast("备份已导入");
              } catch (Exception e) {
                error(e);
              }
            });
      }
    } catch (Exception e) {
      error(e);
    }
  }

  @Override
  public void onBackPressed() {
    if (!history.isEmpty()) {
      page = history.pop();
      build();
      return;
    }
    if (!page.equals("home")) {
      tab("home");
      return;
    }
    long n = System.currentTimeMillis();
    if (n - backAt < 2000) moveTaskToBack(true);
    else {
      backAt = n;
      toast("再按一次返回桌面");
    }
  }
}
