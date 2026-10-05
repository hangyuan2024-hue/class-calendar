package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Full campus native launcher. All routes are Android widgets; no browser rendering engine. */
public class CampusActivity extends Activity {
  CampusApi api;
  CampusStore store;
  CampusUi ui;
  LinearLayout content;
  ScrollView scroll;
  JSONObject me = new JSONObject(), currentClass = new JSONObject();
  String page = "home", selectedDay = DateMath.today();
  final ExecutorService worker = Executors.newSingleThreadExecutor();
  final Handler handler = new Handler(Looper.getMainLooper());
  final Deque<String> history = new ArrayDeque<>();
  boolean dark, loading, unlocked;
  int buildGeneration;
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
      }
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
      } else if (CampusSchool.handles(go)
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
      if (path.contains("#people")) open("people");
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
    build();
  }

  void tab(String route) {
    history.clear();
    page = route;
    build();
  }

  void build() {
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
    getWindow().setStatusBarColor(ui.bg);
    getWindow().setNavigationBarColor(ui.surface);
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
    head.setPadding(ui.dp(19), ui.dp(11), ui.dp(19), ui.dp(10));
    if (!Arrays.asList("home", "calendar", "class", "tools", "me").contains(page)) {
      TextView back = ui.button("‹", () -> onBackPressed(), false);
      back.setTextSize(28);
      head.addView(back, new LinearLayout.LayoutParams(ui.dp(43), ui.dp(45)));
    }
    LinearLayout brand = ui.column();
    brand.addView(ui.text("捞捞校园", 20, ui.ink, true));
    brand.addView(ui.text(api.logged() ? "校园生活，在这里汇合" : "学习 · 日常 · 成长", 10, ui.muted, false));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
    p.leftMargin = ui.dp(9);
    head.addView(brand, p);
    TextView identity =
        ui.text(
            api.logged()
                ? me.optString("display_name", "我")
                    .substring(0, Math.min(1, me.optString("display_name", "我").length()))
                : "我",
            14,
            ui.accent,
            true);
    identity.setGravity(Gravity.CENTER);
    ui.touch(identity, ui.soft, 14, 0);
    identity.setOnClickListener(v -> open(api.logged() ? "me" : "login"));
    head.addView(identity, new LinearLayout.LayoutParams(ui.dp(42), ui.dp(42)));
    root.addView(head);
    scroll = new ScrollView(this);
    scroll.setClipToPadding(false);
    content = ui.column();
    content.setPadding(ui.dp(19), ui.dp(13), ui.dp(19), ui.dp(22));
    scroll.addView(content);
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
    LinearLayout nav = ui.row();
    nav.setPadding(ui.dp(8), ui.dp(7), ui.dp(8), ui.dp(9));
    nav.setBackgroundColor(ui.surface);
    String[] ids = {"home", "calendar", "class", "tools", "me"},
        names = {"今日", "日历", "班级", "工具", "我的"};
    String active =
        page.equals("home")
            ? "home"
            : page.equals("calendar")
                ? "calendar"
                : Arrays.asList("class", "homework", "wall", "people", "groups").contains(page)
                    ? "class"
                    : page.equals("me") || page.equals("login") || page.equals("register")
                        ? "me"
                        : "tools";
    for (int j = 0; j < 5; j++) {
      final String id = ids[j];
      boolean on = id.equals(active);
      LinearLayout cell = ui.column();
      cell.setGravity(Gravity.CENTER);
      ui.touch(cell, on ? ui.soft : ui.surface, 13, 0);
      cell.setContentDescription(names[j]);
      cell.addView(
          new CampusUi.Icon(this, id, on ? ui.accent : ui.muted),
          new LinearLayout.LayoutParams(ui.dp(23), ui.dp(23)));
      ui.gap(cell, 4);
      cell.addView(ui.text(names[j], 10, on ? ui.accent : ui.muted, on));
      cell.setOnClickListener(v -> tab(id));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ui.dp(58), 1);
      lp.leftMargin = ui.dp(2);
      lp.rightMargin = ui.dp(2);
      nav.addView(cell, lp);
    }
    root.addView(nav);
  }

  void home() {
    Calendar now = Calendar.getInstance();
    String greeting =
        now.get(Calendar.HOUR_OF_DAY) < 12
            ? "上午好"
            : now.get(Calendar.HOUR_OF_DAY) < 18 ? "下午好" : "晚上好";
    ui.title(
        content,
        greeting + (api.logged() ? "，" + me.optString("display_name", "同学") : "，同学"),
        DateMath.today()
            + " · "
            + (currentClass.optString("name").isEmpty()
                ? "你的校园生活空间"
                : currentClass.optString("nickname", currentClass.optString("name"))));
    String photo = store.string("native_home_photo", "");
    if (!photo.isEmpty()) CampusPhone.image(this, content, photo);
    if (CampusHome.render(this)) return;
    LinearLayout hero = ui.card(content);
    GradientDrawable grad =
        new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            dark ? new int[] {0xff203d60, 0xff184749} : new int[] {0xffe8ecff, 0xffe4f2f1});
    grad.setCornerRadius(ui.dp(23));
    hero.setBackground(grad);
    hero.addView(ui.pill("今日航线"));
    ui.gap(hero, 14);
    List<JSONObject> courses = CampusCourses.onDay(store, DateMath.today());
    List<JSONObject> all = items();
    long tasks = all.stream().filter(x -> !done(x) && "作业".equals(x.optString("msg_type"))).count();
    hero.addView(
        ui.text(
            courses.isEmpty() ? "把今天，安排得刚刚好。" : courses.get(0).optString("name"),
            24,
            ui.ink,
            true));
    ui.gap(hero, 10);
    hero.addView(
        ui.text(
            courses.isEmpty()
                ? "记录一件事，从一个小目标开始。"
                : courses.get(0).optString("t0")
                    + "–"
                    + courses.get(0).optString("t1")
                    + "  ·  "
                    + courses.get(0).optString("location", "教室待定"),
            13,
            ui.muted,
            false));
    ui.gap(hero, 20);
    ui.actionRow(
        hero,
        new String[] {"＋ 记一件事", "查看课表"},
        new Runnable[] {() -> CampusSchool.personalForm(this, null), () -> open("courses")});
    LinearLayout metrics = ui.row();
    metric(metrics, String.valueOf(courses.size()), "今天课程");
    metric(metrics, String.valueOf(tasks), "待完成作业");
    metric(metrics, String.valueOf(CampusLearn.habitToday(store)), "今日打卡");
    content.addView(metrics);
    ui.gap(content, 20);
    if (!api.logged()) {
      LinearLayout c = ui.card(content);
      c.addView(ui.text("连接你的班级", 16, ui.ink, true));
      ui.gap(c, 7);
      c.addView(ui.text("登录原来的账号，即可读取班级事项、作业和交流记录。", 12, ui.muted, false));
      ui.gap(c, 13);
      c.addView(ui.button("登录 / 注册", () -> open("login"), true));
    } else {
      LinearLayout row = ui.row();
      row.addView(
          ui.pill(
              loading
                  ? "正在连接校园云端"
                  : cloudError.isEmpty()
                      ? "已登录 · " + (store.pending() > 0 ? "有待同步记录" : "本地记录可用")
                      : "离线记录已保留"));
      TextView refresh = ui.button("刷新", this::refreshCloud, false);
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
      lp.leftMargin = ui.dp(10);
      row.addView(refresh, lp);
      content.addView(row);
      ui.gap(content, 16);
      if (!cloudError.isEmpty()) content.addView(ui.text(cloudError, 12, ui.muted, false));
    }
    ui.section(content, "校园常用");
    JSONArray pins = store.list("native_home_tools");
    if (pins.length() == 0)
      pins = new JSONArray(Arrays.asList("homework", "wall", "plan", "phone"));
    List<String[]> tiles = new ArrayList<>();
    for (int i = 0; i < pins.length(); i++)
      tiles.add(new String[] {pins.optString(i), CampusManage.homeName(pins.optString(i)), "点击打开"});
    ui.tileGrid(content, tiles.toArray(new String[0][]));
    ui.section(content, "接下来的安排");
    List<JSONObject> next = new ArrayList<>();
    for (JSONObject x : all) if (!done(x)) next.add(x);
    next.sort(Comparator.comparing(x -> x.optString("event_time", "9999")));
    if (next.isEmpty()) ui.empty(content, "没有待办，留一点空间给自己", "班级与个人事项都会显示在这里。");
    else
      for (JSONObject x : next.subList(0, Math.min(3, next.size())))
        CampusSchool.item(this, content, x);
    ui.section(content, "学习与生活");
    ui.tileGrid(
        content,
        new String[][] {
          {"growth", "打卡成长", "习惯、热力图与统计"},
          {"farm", "云宠农场", "用真实进度喂养云宠"},
          {"wrongbook", "错题记录本", "拍照归档，定期复习"},
          {"ledger", "校园记账", "分类收支与月预算"}
        });
  }

  private void metric(LinearLayout parent, String value, String name) {
    LinearLayout l = ui.column();
    l.setPadding(ui.dp(13), ui.dp(17), ui.dp(10), ui.dp(17));
    l.setBackground(ui.shape(ui.surface, 16, ui.border));
    l.addView(ui.text(value, 27, ui.accent, true));
    ui.gap(l, 5);
    l.addView(ui.text(name, 11, ui.muted, false));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
    if (parent.getChildCount() > 0) p.leftMargin = ui.dp(8);
    parent.addView(l, p);
  }

  void tools() {
    ui.title(content, "你的校园工具箱", "学习、规划与生活，都在一个地方。");
    ui.section(content, "学习安排");
    ui.tileGrid(
        content,
        new String[][] {
          {"courses", "完整课程表", "周次、单双周与冲突检查"},
          {"countdown", "考试倒计时", "重要考试与复习目标"},
          {"wrongbook", "错题记录本", "科目归档与复习记录"},
          {"plan", "规划方法", "四象限、PDCA、SMART"},
          {"pomo", "番茄专注", "专注与休息周期"},
          {"ask", "捞捞助手", "查询课程与整理班群消息"}
        });
    ui.section(content, "生活与成长");
    ui.tileGrid(
        content,
        new String[][] {
          {"diary", "图文日记", "心情、照片与历史"},
          {"ledger", "校园花销记账", "预算、分类与统计"},
          {"growth", "打卡成长", "连续打卡与学习轨迹"},
          {"farm", "云宠农场", "喂养、升级与换云宠"},
          {"meta", "捞捞元宇宙", "徽章与十个学习模组"},
          {"phone", "手机助手", "桌面、语音、录音与隐私"}
        });
    ui.section(content, "更多校园插件");
    ui.tileGrid(
        content,
        new String[][] {
          {"time-master", "时间管理大师", "每日、每周三只青蛙"},
          {"words", "单词搭子", "七本词书、背词与测试"},
          {"oracle", "神谕阁", "答案之书与牌卡灵感"},
          {"draw", "随机抽签器", "公平抽取、排序与分组"}
        });
    ui.section(content, "扩展与资料");
    ui.tileGrid(
        content,
        new String[][] {
          {"plugins", "插件商店", "查看、启用与管理插件"},
          {"intro", "功能介绍", "网站功能说明与历史"},
          {"credits", "贡献名单", "校园共建者"},
          {"search", "全局搜索", "事项、课程与学习记录"}
        });
  }

  void profile() {
    ui.title(
        content,
        "我的校园空间",
        api.logged()
            ? me.optString("account", "") + " · " + roleName(me.optString("role"))
            : "本地工具可以直接使用，登录后连接班级。");
    if (!api.logged()) content.addView(ui.button("登录 / 注册", () -> open("login"), true));
    else {
      LinearLayout card = ui.card(content);
      card.addView(ui.text(me.optString("display_name", "同学"), 23, ui.ink, true));
      ui.gap(card, 8);
      card.addView(ui.text(me.optString("bio", "记录、交流、成长。"), 13, ui.muted, false));
      ui.gap(card, 15);
      card.addView(ui.button("编辑个人主页", () -> CampusSocial.editProfile(this), false));
    }
    ui.section(content, "账号与班级");
    ui.tileGrid(
        content,
        new String[][] {
          {"class", "班级管理", "加入、分组与老师管理"},
          {"people", "班级成员", "同学资料与主页"},
          {"mail", "邮箱通知", "绑定、偏好与测试邮件"},
          {"security", "账号安全", "修改密码与安全信息"}
        });
    ui.section(content, "数据与外观");
    ui.tileGrid(
        content,
        new String[][] {
          {"backup", "数据与同步", "云端衔接、导入与备份"},
          {"appearance", "外观与首页", "皮肤、背景与模块排序"},
          {"phone", "设备能力", "权限和手机专属工具"},
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
        content, signup ? "加入捞捞校园" : "欢迎回来", signup ? "使用同一账号连接网站与手机。" : "登录网站原来的账号，读取你的班级与云端记录。");
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
