package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.text.Html;
import android.util.Base64;
import android.widget.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Native account, cloud preferences, public content and permission-checked staff consoles. */
final class CampusManage {
  static boolean handles(String p) {
    return Arrays.asList(
            "plugins",
            "mail",
            "security",
            "backup",
            "appearance",
            "about",
            "intro",
            "credits",
            "admin",
            "admin-users",
            "admin-plugins",
            "admin-features",
            "admin-perms",
            "intro-edit",
            "draft-code")
        .contains(p);
  }

  static void render(CampusActivity a, String p) {
    switch (p) {
      case "plugins":
        plugins(a);
        break;
      case "mail":
        mail(a);
        break;
      case "security":
        security(a);
        break;
      case "backup":
        backup(a);
        break;
      case "appearance":
        appearance(a);
        break;
      case "about":
        about(a);
        break;
      case "intro":
        intro(a);
        break;
      case "credits":
        credits(a);
        break;
      case "admin":
        admin(a);
        break;
      case "admin-users":
        users(a);
        break;
      case "admin-plugins":
        adminPlugins(a);
        break;
      case "admin-features":
        features(a);
        break;
      case "admin-perms":
        perms(a);
        break;
      case "intro-edit":
        introEdit(a);
        break;
      case "draft-code":
        code(a);
        break;
    }
  }

  static void copy(CampusActivity a, String name, String text) {
    ((ClipboardManager) a.getSystemService(Context.CLIPBOARD_SERVICE))
        .setPrimaryClip(ClipData.newPlainText(name, text));
    a.toast("已复制");
  }

  static void message(CampusActivity a, String title, String body) {
    message(a, title, body, new String[0], i -> {});
  }

  static void message(
      CampusActivity a,
      String title,
      String body,
      String[] options,
      java.util.function.IntConsumer action) {
    if (ComposeEntry.active(a)) {
      ComposeEntry.message(a, title, body, options, action);
      return;
    }
    TextView text = a.ui.text(body, 15, a.ui.ink, false);
    text.setTextIsSelectable(true);
    text.setPadding(a.ui.dp(22), a.ui.dp(18), a.ui.dp(22), a.ui.dp(18));
    ScrollView s = new ScrollView(a.ui.dialog());
    s.addView(text);
    AlertDialog.Builder b =
        new AlertDialog.Builder(a.ui.dialog())
            .setTitle(title)
            .setView(s)
            .setNegativeButton("关闭", null);
    if (options.length == 1) b.setPositiveButton(options[0], (d, w) -> action.accept(0));
    else if (options.length > 1)
      b.setPositiveButton("选择操作", (d, w) -> a.ui.choose(title, options, action));
    b.show();
  }

  static String readable(Object value) {
    if (value == null || value == JSONObject.NULL) return "暂无信息";
    if (value instanceof JSONObject) {
      StringBuilder b = new StringBuilder();
      JSONObject x = (JSONObject) value;
      for (String k : CampusJson.keys(x))
        b.append(label(k))
            .append("：")
            .append(
                x.opt(k) instanceof JSONObject || x.opt(k) instanceof JSONArray
                    ? "\n" + readable(x.opt(k))
                    : String.valueOf(x.opt(k)))
            .append('\n');
      return b.toString();
    }
    if (value instanceof JSONArray) {
      StringBuilder b = new StringBuilder();
      JSONArray rows = (JSONArray) value;
      for (int i = 0; i < rows.length(); i++) b.append(readable(rows.opt(i))).append("\n");
      return b.toString();
    }
    return String.valueOf(value);
  }

  static String label(String k) {
    Map<String, String> map = new HashMap<>();
    String[][] pairs = {
      {"name", "姓名"},
      {"title", "标题"},
      {"body", "内容"},
      {"email", "邮箱"},
      {"pending", "待验证邮箱"},
      {"configured", "邮件服务已配置"},
      {"at", "时间"},
      {"created_at", "创建时间"},
      {"subject", "主题"},
      {"status", "状态"},
      {"reason", "原因"},
      {"error", "错误"},
      {"action", "操作"},
      {"who", "操作人"},
      {"snap", "当时记录"},
      {"account", "账号"},
      {"role", "角色"},
      {"gender", "性别"},
      {"bio", "简介"},
      {"contribution", "贡献"},
      {"pub", "发布日期"},
      {"text", "原消息"},
      {"items", "事项"}
    };
    for (String[] p : pairs) map.put(p[0], p[1]);
    return map.getOrDefault(k, k);
  }

  static void records(CampusActivity a, String title, Object value) {
    message(a, title, readable(value));
  }

  static void load(CampusActivity a, String rpc, String key, String route) {
    a.rpc(
        rpc,
        new JSONObject(),
        r -> {
          a.store.set(key, r);
          a.open(route);
        });
  }

  static void plugins(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "校园插件商店", "网站已发布的插件，提供独立原生学习工具。");
    String[][] known = {
      {"course-schedule", "课程表", "courses"},
      {"personal-diary", "个人日记", "diary"},
      {"theme", "主题与皮肤", "appearance"},
      {"exam-countdown", "考试倒计时", "countdown"},
      {"campus-account-book", "校园花销记账", "ledger"},
      {"error-notebook", "错题记录本", "wrongbook"},
      {"time-master", "时间管理大师", "time-master"},
      {"word-buddy", "单词搭子", "words"},
      {"oracle", "神谕阁", "oracle"},
      {"random-draw", "随机抽签器", "draw"}
    };
    for (String[] p : known) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(p[1], 18, u.ink, true));
      u.gap(c, 12);
      u.actionRow(
          c,
          new String[] {"打开工具", pluginEnabled(a, p[0]) ? "从常用列表隐藏" : "加入常用列表"},
          new Runnable[] {
            () -> a.open(p[2]),
            () -> {
              togglePlugin(a, p[0]);
              a.build();
            }
          });
    }
    u.section(a.content, "网站发布的插件");
    a.content.addView(
        u.button(
            "刷新网站插件目录",
            () ->
                a.background(
                    "读取插件目录",
                    () ->
                        a.api.rest(
                            "plugins?select=id,name,icon,description,version,default_on,published_at,author_id&order=created_at.asc"),
                    r -> {
                      a.store.set("cache_plugins", r);
                      a.build();
                    }),
            false));
    for (JSONObject p : CampusJson.rows(a.store.list("cache_plugins"))) {
      if (p.isNull("published_at") || p.optString("published_at").isEmpty()) continue;
      LinearLayout c = u.card(a.content);
      c.addView(u.text(p.optString("name") + " · v" + p.optString("version"), 16, u.ink, true));
      u.gap(c, 6);
      c.addView(u.text(p.optString("description"), 12, u.muted, false));
      u.gap(c, 12);
      String route = pluginRoute(p);
      u.actionRow(
          c,
          new String[] {route.isEmpty() ? "插件资料" : "打开原生工具", "版本记录"},
          new Runnable[] {
            () -> {
              if (route.isEmpty()) records(a, p.optString("name"), p);
              else a.open(route);
            },
            () ->
                a.rpc(
                    "plugin_changelog",
                    CampusJson.obj("pid", p.optString("id")),
                    r -> records(a, "版本记录", r))
          });
    }
    if (a.staff()) a.content.addView(u.button("开发与审核工作台", () -> loadPlugins(a), false));
  }

  static boolean pluginEnabled(CampusActivity a, String id) {
    Object saved = a.store.get("plugins_enabled_v1", null);
    if (!(saved instanceof JSONArray)) {
      for (JSONObject p : CampusJson.rows(a.store.list("cache_plugins")))
        if (id.equals(p.optString("id"))) return p.optBoolean("default_on");
      return true;
    }
    JSONArray flags = (JSONArray) saved;
    for (int i = 0; i < flags.length(); i++) if (id.equals(flags.optString(i))) return true;
    return false;
  }

  static void togglePlugin(CampusActivity a, String id) {
    JSONArray flags = a.store.list("plugins_enabled_v1");
    if (a.store.get("plugins_enabled_v1", null) == null) {
      Set<String> defaults =
          new LinkedHashSet<>(
              Arrays.asList(
                  "course-schedule",
                  "personal-diary",
                  "exam-countdown",
                  "campus-account-book",
                  "error-notebook",
                  "time-master",
                  "word-buddy",
                  "oracle",
                  "random-draw"));
      for (JSONObject p : CampusJson.rows(a.store.list("cache_plugins")))
        if (p.optBoolean("default_on")) defaults.add(p.optString("id"));
        else defaults.remove(p.optString("id"));
      for (String enabled : defaults) flags.put(enabled);
    }
    JSONArray out = new JSONArray();
    boolean found = false;
    for (int i = 0; i < flags.length(); i++)
      if (id.equals(flags.optString(i))) found = true;
      else out.put(flags.opt(i));
    if (!found) out.put(id);
    a.store.set("plugins_enabled_v1", out);
    a.syncSoon();
  }

  static String pluginRoute(JSONObject p) {
    String n = p.optString("id") + " " + p.optString("name");
    return n.contains("time-master")
        ? "time-master"
        : n.contains("word-buddy")
            ? "words"
            : n.contains("oracle")
                ? "oracle"
                : n.contains("random-draw")
                    ? "draw"
                    : n.contains("course") || n.contains("课程表")
                        ? "courses"
                        : n.contains("diary") || n.contains("日记")
                            ? "diary"
                            : n.contains("theme") || n.contains("主题")
                                ? "appearance"
                                : n.contains("countdown") || n.contains("倒计时")
                                    ? "countdown"
                                    : n.contains("account-book")
                                            || n.contains("ledger")
                                            || n.contains("记账")
                                        ? "ledger"
                                        : n.contains("error-notebook")
                                                || n.contains("wrong")
                                                || n.contains("错题")
                                            ? "wrongbook"
                                            : "";
  }

  static void mail(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "邮箱通知", "沿用网站的通知设置，重要安排及时收到。");
    if (!a.api.logged()) {
      a.content.addView(u.button("登录账号", () -> a.open("login"), true));
      return;
    }
    a.content.addView(u.button("刷新绑定状态", () -> load(a, "mail_my", "cache_mail", "mail"), false));
    JSONObject m = a.store.object("cache_mail");
    if (m.length() == 0) {
      u.empty(a.content, "先读取你的邮箱设置", "绑定、验证码、通知偏好与邮件记录都会显示在这里。");
      return;
    }
    u.section(a.content, "邮箱设置");
    LinearLayout c = u.card(a.content);
    c.addView(
        u.text(m.optString("email").isEmpty() ? "尚未绑定" : m.optString("email"), 18, u.ink, true));
    u.gap(c, 14);
    u.actionRow(
        c,
        new String[] {"绑定 / 换绑邮箱", "填写验证码"},
        new Runnable[] {
          () ->
              u.form(
                  "绑定邮箱",
                  CampusJson.obj("addr", m.optString("pending")),
                  v -> {
                    if (!android.util.Patterns.EMAIL_ADDRESS.matcher(v.optString("addr")).matches())
                      throw new IllegalArgumentException("请输入有效邮箱");
                    a.rpc(
                        "mail_bind_start",
                        CampusJson.obj("addr", v.optString("addr")),
                        r -> {
                          a.toast("验证码已发送，请查看邮箱");
                          load(a, "mail_my", "cache_mail", "mail");
                        });
                  },
                  CampusUi.f("addr", "接收通知的邮箱")),
          () ->
              u.form(
                  "邮箱验证码",
                  new JSONObject(),
                  v ->
                      a.rpc(
                          "mail_bind_confirm",
                          CampusJson.obj("c", v.optString("code")),
                          r -> {
                            JSONObject response = CampusJson.object(r);
                            if (response.has("ok") && !response.optBoolean("ok")) {
                              a.toast(response.optString("why", "验证码不正确"));
                              return;
                            }
                            a.store.set("cache_mail", r);
                            a.build();
                          }),
                  CampusUi.f("code", "验证码"))
        });
    u.actionRow(
        a.content,
        new String[] {"发送测试邮件", "解绑邮箱"},
        new Runnable[] {
          () ->
              a.rpc(
                  "mail_test",
                  new JSONObject(),
                  r -> {
                    a.store.set("cache_mail", r);
                    a.build();
                    a.toast("测试邮件已提交");
                  }),
          () ->
              u.confirm(
                  "解绑邮箱？",
                  "解绑后不会再收到邮件，可重新绑定。",
                  () ->
                      a.rpc(
                          "mail_unbind",
                          new JSONObject(),
                          r -> {
                            a.store.set("cache_mail", r);
                            a.build();
                          }))
        });
    JSONObject prefs = m.optJSONObject("prefs");
    if (prefs == null) prefs = new JSONObject();
    String[][] options = {
      {"new_items", "新发布的班级事项"},
      {"due", "截止前提醒"},
      {"wall", "班级墙通知"},
      {"report", "班级墙举报（老师）"},
      {"course", "课程提醒"}
    };
    for (String[] item : options) {
      Switch b = new Switch(u.dialog());
      b.setText(item[1]);
      b.setTextColor(u.ink);
      b.setPadding(u.dp(5), u.dp(12), u.dp(5), u.dp(12));
      b.setChecked(prefs.optBoolean(item[0], !item[0].equals("course")));
      b.setOnCheckedChangeListener(
          (v, on) ->
              a.rpc(
                  "mail_set_prefs",
                  CampusJson.obj("p", CampusJson.obj(item[0], on)),
                  r -> {
                    a.store.set("cache_mail", r);
                    a.build();
                  }));
      a.content.addView(b);
    }
    u.section(a.content, "最近邮件");
    a.content.addView(
        u.button(
            "请求处理到期邮件",
            () ->
                a.rpc(
                    "mail_tick",
                    new JSONObject(),
                    r -> {
                      a.toast("已请求服务器处理到期邮件");
                      load(a, "mail_my", "cache_mail", "mail");
                    }),
            false));
    for (JSONObject r : CampusJson.rows(m.opt("recent"))) {
      LinearLayout card = u.card(a.content);
      card.addView(u.text(r.optString("subject"), 15, u.ink, true));
      card.addView(u.text(r.optString("at") + " · " + r.optString("status"), 12, u.muted, false));
    }
  }

  static void security(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "账号安全", "设备登录信息使用 Android Keystore 加密保存。");
    if (!a.api.logged()) {
      a.content.addView(u.button("登录账号", () -> a.open("login"), true));
      return;
    }
    u.actionRow(
        a.content,
        new String[] {"读取安全信息", "修改密码"},
        new Runnable[] {
          () -> a.rpc("account_security", new JSONObject(), r -> records(a, "账号安全信息", r)),
          () ->
              u.form(
                  "修改密码",
                  new JSONObject(),
                  v -> {
                    String n = v.optString("newpw");
                    if (n.length() < 8 || !n.equals(v.optString("again")))
                      throw new IllegalArgumentException("新密码至少8位，两次输入须一致");
                    a.rpc(
                        "pw_change",
                        CampusJson.obj("oldpw", v.optString("oldpw"), "newpw", n),
                        r -> a.toast("密码已更新"));
                  },
                  CampusUi.f("oldpw", "原密码", "password"),
                  CampusUi.f("newpw", "新密码", "password"),
                  CampusUi.f("again", "再次输入新密码", "password"))
        });
    u.section(a.content, "本机隐私");
    a.content.addView(u.button("设置日记设备验证", () -> a.open("privacy"), false));
  }

  static void backup(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "数据与同步", "班级内容来自云端，自己的学习记录按账号保存。");
    LinearLayout c = u.card(a.content);
    c.addView(
        u.text(
            a.api.logged() ? "当前账号 " + a.me.optString("account", a.store.owner) : "当前为本地访客空间",
            17,
            u.ink,
            true));
    u.gap(c, 9);
    c.addView(
        u.text(
            "待同步记录 "
                + a.store.pending()
                + " 条"
                + (a.store.bool("native_sync_local", false) ? " · 仅本地模式" : ""),
            13,
            u.muted,
            false));
    u.gap(c, 17);
    u.actionRow(
        c,
        new String[] {"立即同步", "本地 / 云端模式"},
        new Runnable[] {
          () -> {
            if (a.requireLogin()) {
              a.store.set("native_sync_local", false);
              a.refreshCloud();
            }
          },
          () ->
              u.choose(
                  "学习数据同步",
                  new String[] {"保存本机，暂停云同步", "启用账号同步"},
                  i -> {
                    if (i == 1 && !a.requireLogin()) return;
                    a.store.set("native_sync_local", i == 0);
                    if (i == 1) a.refreshCloud();
                    else a.build();
                  })
        });
    u.actionRow(
        a.content,
        new String[] {"导出完整备份", "导入完整备份"},
        new Runnable[] {() -> CampusPhone.exportBackup(a), a::importBackup});
    a.content.addView(
        u.button(
            "仅导出学习数据（不含附件）",
            () ->
                a.export(
                    "捞捞课程表-学习数据-" + DateMath.today() + ".json",
                    a.store.backup().toString(),
                    "application/json"),
            false));
    u.actionRow(
        a.content,
        new String[] {"导出课程 JSON", "导出学习周报"},
        new Runnable[] {
          () ->
              a.export(
                  "原生课程备份.json",
                  CampusJson.obj(
                          "courses",
                          a.store.list(CampusCourses.COURSES),
                          "meta",
                          CampusCourses.meta(a.store))
                      .toString(),
                  "application/json"),
          () -> a.open("report")
        });
    u.section(a.content, "数据说明");
    u.empty(
        a.content,
        "已有账号可以继续使用",
        "个人事项、完成状态、习惯、规划、番茄、农场和界面偏好接入网站的账号同步；课表使用原课程接口。日记照片、录音和新增手机工具保存在本机，可导出完整备份。");
    a.content.addView(u.button("导入上一版原生工具备份", () -> CampusPhone.json(a, "legacy"), false));
    if (a.api.logged()) {
      u.gap(a.content, 15);
      a.content.addView(
          u.button(
              "清空云端个人学习记录",
              () ->
                  u.confirm(
                      "清空云端记录？",
                      "此操作会影响其他设备，无法撤销。请先导出备份。",
                      () ->
                          a.rpc(
                              "udata_wipe",
                              new JSONObject(),
                              r -> {
                                a.toast("云端个人记录已清空，本机记录保留");
                              })),
              false));
    }
  }

  static void appearance(CampusActivity a) {
    CampusUi u = a.ui;
    CampusSkins.render(a);
    u.section(a.content, "首页设置");
    a.content.addView(
        u.button(
            "成长与显示偏好",
            () -> {
              JSONObject opts = a.store.object("fun_opts_v1");
              for (String key : new String[] {"rings", "habits", "plan", "farm", "confetti"})
                if (!opts.has(key)) CampusJson.put(opts, key, true);
              a.ui.form(
                  "成长与显示偏好",
                  opts,
                  v -> {
                    a.store.set("fun_opts_v1", v);
                    a.build();
                    a.syncSoon();
                  },
                  CampusUi.f("hideDone", "日历隐藏已完成事项", "boolean"),
                  CampusUi.f("rings", "显示本周进度卡片", "boolean"),
                  CampusUi.f("habits", "显示习惯卡片", "boolean"),
                  CampusUi.f("plan", "显示规划卡片", "boolean"),
                  CampusUi.f("farm", "显示云宠卡片", "boolean"),
                  CampusUi.f("confetti", "完成时显示鼓励", "boolean"));
            },
            false));
    a.content.addView(u.button("首页卡片排版、顺序与尺寸", () -> CampusHome.edit(a), false));
    u.actionRow(
        a.content,
        new String[] {"管理首页常用工具", "选择首页背景"},
        new Runnable[] {
          () -> homeTools(a),
          () ->
              CampusPhone.photo(
                  a,
                  id -> {
                    a.store.set("native_home_photo", id);
                    a.build();
                  })
        });
    a.content.addView(
        u.button(
            "清除首页背景",
            () -> {
              a.store.set("native_home_photo", "");
              a.build();
            },
            false));
  }

  static final String[][] HOME = {
    {"homework", "我的作业"},
    {"wall", "班级交流"},
    {"plan", "时间规划"},
    {"phone", "手机助手"},
    {"courses", "课程表"},
    {"countdown", "考试倒计时"},
    {"wrongbook", "错题本"},
    {"ledger", "校园记账"},
    {"diary", "个人日记"},
    {"growth", "打卡成长"},
    {"farm", "云宠农场"},
    {"meta", "捞捞元宇宙"}
  };

  static void homeTools(CampusActivity a) {
    JSONArray ids = a.store.list("native_home_tools");
    if (ids.length() == 0) ids = new JSONArray(Arrays.asList("homework", "wall", "plan", "phone"));
    final JSONArray current = ids;
    List<String> names = new ArrayList<>();
    for (int i = 0; i < current.length(); i++)
      names.add((i + 1) + ". " + homeName(current.optString(i)));
    names.add("＋ 添加工具");
    names.add("恢复默认");
    a.ui.choose(
        "首页工具与顺序",
        names.toArray(new String[0]),
        i -> {
          if (i < current.length())
            a.ui.choose(
                names.get(i),
                new String[] {"上移", "下移", "移除"},
                j -> {
                  if (j == 2) current.remove(i);
                  else {
                    int to = j == 0 ? i - 1 : i + 1;
                    if (to >= 0 && to < current.length())
                      try {
                        Object x = current.opt(i);
                        current.put(i, current.opt(to));
                        current.put(to, x);
                      } catch (Exception e) {
                        a.error(e);
                      }
                  }
                  a.store.set("native_home_tools", current);
                  a.build();
                });
          else if (i == current.length())
            a.ui.choose(
                "选择工具",
                Arrays.stream(HOME).map(x -> x[1]).toArray(String[]::new),
                j -> {
                  String route = HOME[j][0];
                  for (int n = 0; n < current.length(); n++)
                    if (route.equals(current.optString(n))) {
                      a.toast("已经在首页");
                      return;
                    }
                  current.put(route);
                  a.store.set("native_home_tools", current);
                  a.build();
                });
          else {
            a.store.set(
                "native_home_tools",
                new JSONArray(Arrays.asList("homework", "wall", "plan", "phone")));
            a.build();
          }
        });
  }

  static String homeName(String id) {
    if (id.equals("class")) return "我的班级";
    for (String[] x : HOME) if (x[0].equals(id)) return x[1];
    return id;
  }

  static void about(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "捞捞课程表", BuildConfig.VERSION_NAME + " · Android 原生学习空间");
    u.empty(a.content, "把校园日常，安排得更好", "原生页面直接连接校园数据服务，不通过浏览器显示网站。课程、作业、班级交流、规划和生活记录都在这里。");
    u.section(a.content, "设备与数据");
    u.empty(
        a.content,
        "为安卓手机而做",
        "支持Android 7及以上。平台相机、文件选择器、日历、语音和设备验证均按需调用；设备缺少某项能力时会提示。后台提醒可能受手机省电策略影响。");
    u.actionRow(
        a.content,
        new String[] {"功能介绍", "贡献名单"},
        new Runnable[] {() -> a.open("intro"), () -> a.open("credits")});
  }

  static void intro(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "捞捞能帮你做什么？", "学习与校园生活的功能说明。");
    a.content.addView(
        u.button("刷新网站功能说明", () -> load(a, "intro_get", "cache_intro", "intro"), false));
    JSONObject data = a.store.object("cache_intro");
    for (JSONObject x : CampusJson.rows(data.opt("sections"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("title", x.optString("name")), 18, u.ink, true));
      u.gap(c, 9);
      c.addView(
          u.text(
              Html.fromHtml(
                      x.optString("body", x.optString("text", x.optString("content"))),
                      Html.FROM_HTML_MODE_LEGACY)
                  .toString(),
              14,
              u.muted,
              false));
    }
    if (data.length() == 0)
      u.tileGrid(
          a.content,
          new String[][] {
            {"calendar", "课程与安排", "把个人、班级日程放在一起"},
            {"plan", "五种规划方法", "找到适合自己的做事节奏"},
            {"wall", "班级交流", "通知、分组与评论互动"},
            {"phone", "十项手机能力", "把设备能力用到学习里"}
          });
    if (data.optBoolean("can_edit")) {
      u.actionRow(
          a.content,
          new String[] {"编辑功能介绍", "编辑历史"},
          new Runnable[] {
            () -> a.open("intro-edit"),
            () ->
                a.rpc(
                    "intro_history_list",
                    new JSONObject(),
                    r -> {
                      List<JSONObject> rows = CampusJson.rows(r);
                      a.ui.choose(
                          "介绍历史版本",
                          rows.stream()
                              .map(
                                  x ->
                                      x.optString("at", x.optString("created_at"))
                                          + " · "
                                          + x.optString("who"))
                              .toArray(String[]::new),
                          i ->
                              a.rpc(
                                  "intro_history_get",
                                  CampusJson.obj(
                                      "hid", CampusJson.numericId(rows.get(i).optString("id"))),
                                  v ->
                                      a.ui.confirm(
                                          "载入这个历史版本？",
                                          "载入后仍需核对并点击保存发布。",
                                          () -> {
                                            a.store.set("draft_intro_sections", v);
                                            a.open("intro-edit");
                                          })));
                    })
          });
    }
  }

  static void introEdit(CampusActivity a) {
    CampusUi u = a.ui;
    JSONObject data = a.store.object("cache_intro");
    u.title(a.content, "编辑功能介绍", "编辑后核对内容，再保存发布。");
    JSONArray rows = a.store.list("draft_intro_sections");
    if (rows.length() == 0) rows = CampusJson.arr(data.opt("sections"));
    final JSONArray all = rows;
    for (int i = 0; i < all.length(); i++) {
      final int index = i;
      JSONObject x = all.optJSONObject(i);
      if (x == null) continue;
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("title"), 18, u.ink, true));
      u.gap(c, 12);
      u.actionRow(
          c,
          new String[] {"编辑", "上移 / 删除"},
          new Runnable[] {
            () ->
                u.form(
                    "编辑功能说明",
                    x,
                    v -> {
                      all.put(index, v);
                      a.store.set("draft_intro_sections", all);
                      a.build();
                    },
                    CampusUi.f("title", "标题"),
                    CampusUi.f("body", "内容", "multiline")),
            () ->
                u.choose(
                    "调整说明",
                    new String[] {"上移", "删除"},
                    j -> {
                      if (j == 1) all.remove(index);
                      else if (index > 0)
                        try {
                          Object prev = all.opt(index - 1);
                          all.put(index - 1, x);
                          all.put(index, prev);
                        } catch (Exception e) {
                          a.error(e);
                        }
                      a.store.set("draft_intro_sections", all);
                      a.build();
                    })
          });
    }
    u.actionRow(
        a.content,
        new String[] {"＋ 添加章节", "保存发布"},
        new Runnable[] {
          () ->
              u.form(
                  "添加功能说明",
                  new JSONObject(),
                  v -> {
                    all.put(v);
                    a.store.set("draft_intro_sections", all);
                    a.build();
                  },
                  CampusUi.f("title", "标题"),
                  CampusUi.f("body", "内容", "multiline")),
          () ->
              u.confirm(
                  "发布功能介绍？",
                  "将更新网站与原生应用共享的功能说明。",
                  () ->
                      a.rpc(
                          "intro_save",
                          CampusJson.obj(
                              "p_sections",
                              all,
                              "base",
                              data.opt("base") != null ? data.opt("base") : data.opt("updated_at")),
                          r -> {
                            a.store.set("draft_intro_sections", new JSONArray());
                            load(a, "intro_get", "cache_intro", "intro");
                          }))
        });
  }

  static void credits(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "校园共建者", "感谢每一份让捞捞变得更好的贡献。");
    a.content.addView(
        u.button("刷新贡献名单", () -> load(a, "credit_list", "cache_credits", "credits"), false));
    for (JSONObject x : CampusJson.rows(a.store.list("cache_credits"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("name"), 19, u.ink, true));
      u.gap(c, 8);
      c.addView(u.text(x.optString("contribution"), 14, u.muted, false));
      if (a.me.optString("role").equals("admin")) {
        u.gap(c, 12);
        u.actionRow(
            c,
            new String[] {"编辑 / 排序", "删除"},
            new Runnable[] {
              () -> creditForm(a, x),
              () ->
                  u.confirm(
                      "删除贡献记录？",
                      x.optString("name"),
                      () ->
                          a.rpc(
                              "credit_delete",
                              CampusJson.obj("cid", CampusJson.numericId(x.optString("id"))),
                              r -> load(a, "credit_list", "cache_credits", "credits")))
            });
      }
    }
    if (a.me.optString("role").equals("admin"))
      a.content.addView(u.button("＋ 添加贡献记录", () -> creditForm(a, null), false));
  }

  static void creditForm(CampusActivity a, JSONObject x) {
    a.ui.form(
        "贡献记录",
        x == null ? CampusJson.obj("sort", 10) : x,
        v ->
            a.rpc(
                "credit_save",
                CampusJson.obj(
                    "cid",
                    x == null ? JSONObject.NULL : CampusJson.numericId(x.optString("id")),
                    "cname",
                    v.optString("name"),
                    "contrib",
                    v.optString("contribution"),
                    "csort",
                    v.optInt("sort")),
                r -> load(a, "credit_list", "cache_credits", "credits")),
        CampusUi.f("name", "姓名 / 团队"),
        CampusUi.f("contribution", "贡献内容", "multiline"),
        CampusUi.f("sort", "排序数字", "number"));
  }

  static boolean admin(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "校园管理工作台", "使用网站相同的账号角色与服务端权限。");
    if (!a.requireLogin()) return false;
    if (!a.staff()) {
      u.empty(a.content, "当前账号没有管理权限", "老师的班级管理位于「班级」页面。");
      return false;
    }
    a.content.addView(u.button("插件开发、提交与审核", () -> loadPlugins(a), true));
    u.gap(a.content, 14);
    a.content.addView(u.button("功能介绍编辑者", () -> editors(a), false));
    if (a.me.optString("role").equals("admin")) {
      u.gap(a.content, 14);
      u.actionRow(
          a.content,
          new String[] {"全站用户", "全站功能"},
          new Runnable[] {
            () -> loadUsers(a),
            () -> load(a, "admin_features", "cache_admin_features", "admin-features")
          });
      a.content.addView(
          u.button(
              "开发者 / 测试员权限",
              () ->
                  a.background(
                      "读取角色权限",
                      () -> a.api.rest("role_perms?select=role,perm"),
                      r -> {
                        a.store.set("cache_role_perms", r);
                        a.open("admin-perms");
                      }),
              false));
    }
    return true;
  }

  static void editors(CampusActivity a) {
    a.rpc(
        "intro_editors_list",
        new JSONObject(),
        r ->
            message(
                a,
                "介绍编辑者",
                readable(r),
                new String[] {"修改编辑者权限"},
                i ->
                    a.ui.form(
                        "编辑者权限",
                        new JSONObject(),
                        v ->
                            a.rpc(
                                "intro_editor_set",
                                CampusJson.obj(
                                    "acct", v.optString("account"), "on_", v.optBoolean("enabled")),
                                x -> a.toast("编辑者权限已保存")),
                        CampusUi.f("account", "账号"),
                        CampusUi.f("enabled", "允许编辑功能介绍", "boolean"))));
  }

  static void loadUsers(CampusActivity a) {
    a.background(
        "读取用户",
        () ->
            a.api.rest(
                "profiles?select=id,account,display_name,role,created_at&order=created_at.asc"),
        r -> {
          a.store.set("cache_admin_users", r);
          a.open("admin-users");
        });
  }

  static void users(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "全站用户管理", "角色、密码与账号删除均由服务器核验。");
    a.content.addView(u.button("刷新用户", () -> loadUsers(a), false));
    for (JSONObject x : CampusJson.rows(a.store.list("cache_admin_users"))) {
      LinearLayout c = u.card(a.content);
      c.addView(
          u.text(x.optString("display_name") + " · " + x.optString("account"), 17, u.ink, true));
      c.addView(u.text(CampusActivity.roleName(x.optString("role")), 12, u.muted, false));
      u.gap(c, 12);
      c.addView(
          u.button(
              "管理此账号",
              () ->
                  u.choose(
                      x.optString("account"),
                      new String[] {"修改角色", "重置密码", "删除账号"},
                      i -> {
                        if (i == 0)
                          u.choose(
                              "选择角色",
                              new String[] {"student", "teacher", "tester", "developer", "admin"},
                              j ->
                                  a.rpc(
                                      "set_user_role",
                                      CampusJson.obj(
                                          "uid",
                                          x.optString("id"),
                                          "new_role",
                                          new String[] {
                                                "student", "teacher", "tester", "developer", "admin"
                                              }
                                              [j]),
                                      r -> loadUsers(a)));
                        else if (i == 1)
                          u.form(
                              "重置账号密码",
                              new JSONObject(),
                              v -> {
                                if (v.optString("newpw").length() < 8)
                                  throw new IllegalArgumentException("密码至少8位");
                                a.rpc(
                                    "admin_set_password",
                                    CampusJson.obj(
                                        "uid", x.optString("id"), "newpw", v.optString("newpw")),
                                    r -> a.toast("密码已重置"));
                              },
                              CampusUi.f("newpw", "新密码", "password"));
                        else
                          u.confirm(
                              "永久删除账号？",
                              x.optString("account") + " 的账号与关联资料将被删除，无法撤销。",
                              () ->
                                  a.rpc(
                                      "admin_delete_user",
                                      CampusJson.obj("uid", x.optString("id")),
                                      r -> loadUsers(a)));
                      }),
              false));
    }
  }

  static void features(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "全站功能开关", "设置功能开放状态、身份与维护说明。");
    for (JSONObject f : CampusJson.rows(a.store.list("cache_admin_features"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(f.optString("name"), 17, u.ink, true));
      c.addView(u.text(f.optString("descr"), 12, u.muted, false));
      u.gap(c, 12);
      c.addView(
          u.button(
              "修改开放范围",
              () -> {
                JSONObject init = CampusJson.copy(f), roles = f.optJSONObject("roles");
                for (String role : new String[] {"student", "teacher", "tester", "developer"})
                  CampusJson.put(init, role, roles == null || roles.optBoolean(role, true));
                u.form(
                    "功能开放范围",
                    init,
                    v ->
                        a.rpc(
                            "admin_set_feature",
                            CampusJson.obj(
                                "k",
                                f.optString("key"),
                                "en",
                                v.optBoolean("enabled"),
                                "rls",
                                CampusJson.obj(
                                    "student",
                                    v.optBoolean("student"),
                                    "teacher",
                                    v.optBoolean("teacher"),
                                    "tester",
                                    v.optBoolean("tester"),
                                    "developer",
                                    v.optBoolean("developer")),
                                "nt",
                                v.optString("note")),
                            r ->
                                load(
                                    a, "admin_features", "cache_admin_features", "admin-features")),
                    CampusUi.f("enabled", "全站启用", "boolean"),
                    CampusUi.f("student", "学生", "boolean"),
                    CampusUi.f("teacher", "老师", "boolean"),
                    CampusUi.f("tester", "测试员", "boolean"),
                    CampusUi.f("developer", "开发者", "boolean"),
                    CampusUi.optional("note", "维护说明"));
              },
              false));
    }
  }

  static void perms(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "管理角色权限", "开发者与测试员的操作权限。");
    String[] keys = {
      "upload",
      "try_testing",
      "view_code",
      "publish",
      "reject",
      "unpublish",
      "set_default",
      "transfer",
      "manage_users"
    };
    for (String role : new String[] {"developer", "tester"}) {
      u.section(a.content, CampusActivity.roleName(role));
      for (String p : keys) {
        boolean on = false;
        for (JSONObject x : CampusJson.rows(a.store.list("cache_role_perms")))
          if (x.optString("role").equals(role) && x.optString("perm").equals(p)) on = true;
        final boolean current = on;
        Switch b = new Switch(u.dialog());
        b.setText(p);
        b.setTextColor(u.ink);
        b.setChecked(on);
        b.setPadding(0, u.dp(12), 0, u.dp(12));
        b.setOnCheckedChangeListener(
            (v, value) ->
                a.rpc(
                    "set_role_perm",
                    CampusJson.obj("r", role, "p", p, "enabled", value),
                    r -> a.toast("权限已保存")));
        a.content.addView(b);
      }
    }
  }

  static void loadPlugins(CampusActivity a) {
    a.background(
        "读取插件工作台",
        () ->
            CampusJson.obj(
                "plugins",
                a.api.rest(
                    "plugins?select=id,name,icon,description,version,published_at,default_on,author_id&order=created_at.asc"),
                "drafts",
                a.api.rest(
                    "plugin_drafts?select=plugin_id,name,icon,description,version,status,review_note,updated_at&order=updated_at.desc")),
        r -> {
          JSONObject x = CampusJson.object(r);
          a.store.set("cache_plugins", x.opt("plugins"));
          a.store.set("cache_plugin_drafts", x.opt("drafts"));
          a.open("admin-plugins");
        });
  }

  static void adminPlugins(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "插件开发与审核", "代码以原生文本查看，审核过的版本才能发布。");
    u.actionRow(
        a.content,
        new String[] {"新建 / 上传插件", "刷新插件"},
        new Runnable[] {() -> draftForm(a, null), () -> loadPlugins(a)});
    u.section(a.content, "待审与退回的草稿");
    for (JSONObject d : CampusJson.rows(a.store.list("cache_plugin_drafts"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(d.optString("name") + " v" + d.optString("version"), 17, u.ink, true));
      c.addView(
          u.text(d.optString("status") + " · " + d.optString("review_note"), 12, u.muted, false));
      u.gap(c, 12);
      u.actionRow(
          c,
          new String[] {"查看草稿代码", "编辑 / 管理"},
          new Runnable[] {
            () -> reviewCode(a, d.optString("plugin_id")),
            () ->
                u.choose(
                    d.optString("name"),
                    new String[] {"编辑草稿", "驳回草稿", "撤回草稿"},
                    i -> {
                      if (i == 0) draftForm(a, d);
                      else if (i == 1)
                        u.form(
                            "驳回原因",
                            new JSONObject(),
                            v ->
                                a.rpc(
                                    "reject_plugin",
                                    CampusJson.obj(
                                        "pid",
                                        d.optString("plugin_id"),
                                        "note",
                                        v.optString("note")),
                                    r -> loadPlugins(a)),
                            CampusUi.f("note", "审核意见", "multiline"));
                      else
                        u.confirm(
                            "撤回草稿？",
                            d.optString("name"),
                            () ->
                                a.background(
                                    "撤回草稿",
                                    () ->
                                        a.api.rest(
                                            "plugin_drafts?plugin_id=eq."
                                                + CampusJson.enc(d.optString("plugin_id")),
                                            "DELETE",
                                            null),
                                    r -> loadPlugins(a)));
                    })
          });
    }
    u.section(a.content, "已创建插件");
    for (JSONObject p : CampusJson.rows(a.store.list("cache_plugins"))) {
      LinearLayout c = u.card(a.content);
      c.addView(
          u.text(
              p.optString("name", p.optString("id"))
                  + " · "
                  + (!p.isNull("published_at") && !p.optString("published_at").isEmpty()
                      ? "已发布"
                      : "未发布"),
              16,
              u.ink,
              true));
      u.gap(c, 12);
      c.addView(
          u.button(
              "插件管理",
              () ->
                  u.choose(
                      p.optString("id"),
                      new String[] {
                        "上传新版本",
                        "版本历史",
                        "设定作者",
                        "默认启用设置",
                        !p.isNull("published_at") && !p.optString("published_at").isEmpty()
                            ? "下架插件"
                            : "删除未发布插件"
                      },
                      i -> {
                        if (i == 0)
                          draftForm(
                              a,
                              CampusJson.obj(
                                  "plugin_id",
                                  p.optString("id"),
                                  "name",
                                  p.optString("name"),
                                  "version",
                                  p.optString("version"),
                                  "description",
                                  p.optString("description"),
                                  "icon",
                                  p.optString("icon")));
                        else if (i == 1)
                          a.rpc(
                              "plugin_changelog",
                              CampusJson.obj("pid", p.optString("id")),
                              r -> records(a, "插件版本历史", r));
                        else if (i == 2)
                          u.form(
                              "插件作者",
                              new JSONObject(),
                              v ->
                                  a.rpc(
                                      "set_plugin_author",
                                      CampusJson.obj(
                                          "pid", p.optString("id"), "acct", v.optString("account")),
                                      r -> loadPlugins(a)),
                              CampusUi.f("account", "作者账号"));
                        else if (i == 3)
                          u.form(
                              "默认启用",
                              p,
                              v ->
                                  a.background(
                                      "保存默认状态",
                                      () ->
                                          a.api.rest(
                                              "plugins?id=eq." + CampusJson.enc(p.optString("id")),
                                              "PATCH",
                                              CampusJson.obj(
                                                  "default_on", v.optBoolean("default_on"))),
                                      r -> loadPlugins(a)),
                              CampusUi.f("default_on", "新用户默认启用", "boolean"));
                        else
                          u.confirm(
                              !p.isNull("published_at") && !p.optString("published_at").isEmpty()
                                  ? "下架插件？"
                                  : "删除插件？",
                              p.optString("name"),
                              () -> {
                                if (!p.isNull("published_at")
                                    && !p.optString("published_at").isEmpty())
                                  a.rpc(
                                      "unpublish_plugin",
                                      CampusJson.obj("pid", p.optString("id")),
                                      r -> loadPlugins(a));
                                else
                                  a.background(
                                      "删除插件",
                                      () ->
                                          a.api.rest(
                                              "plugins?id=eq." + CampusJson.enc(p.optString("id")),
                                              "DELETE",
                                              null),
                                      r -> loadPlugins(a));
                              });
                      }),
              false));
    }
  }

  static void draftForm(CampusActivity a, JSONObject p) {
    JSONObject init =
        p == null ? CampusJson.obj("plugin_id", "", "version", "1.0.0", "icon", "🧩") : p;
    a.ui.form(
        "插件草稿资料",
        init,
        v -> {
          if (!v.optString("plugin_id").matches("[a-z0-9][a-z0-9-]{1,39}")
              || !v.optString("version").matches("\\d+\\.\\d+\\.\\d+"))
            throw new IllegalArgumentException("插件ID用2—40位小写字母数字或连字符，版本格式1.0.0");
          a.store.set("draft_plugin_meta", v);
          a.store.set("draft_plugin_new", p == null);
          a.store.set("draft_review_id", "");
          a.ui.choose(
              "选择草稿文件",
              new String[] {"导入 plugin.js", "导入 app.html", "继续编辑现有代码"},
              i -> {
                if (i < 2) CampusPhone.json(a, i == 0 ? "plugin-js" : "plugin-html");
                else
                  a.background(
                      "读取已有草稿",
                      () ->
                          a.api.rest(
                              "plugin_drafts?select=code,app_html&plugin_id=eq."
                                  + CampusJson.enc(v.optString("plugin_id"))),
                      r -> {
                        List<JSONObject> data = CampusJson.rows(r);
                        if (data.isEmpty()) {
                          a.toast("没有已有草稿，请导入文件");
                          return;
                        }
                        a.store.set("draft_plugin_files", data.get(0));
                        a.open("draft-code");
                      });
              });
        },
        CampusUi.f("plugin_id", "插件ID"),
        CampusUi.f("name", "名称"),
        CampusUi.f("version", "新版本号"),
        CampusUi.optional("icon", "图标"),
        new CampusUi.Field("description", "简介", "multiline", false),
        new CampusUi.Field("changelog", "更新内容", "multiline", false));
  }

  static void reviewCode(CampusActivity a, String id) {
    a.background(
        "读取审核代码",
        () -> a.api.rest("plugin_drafts?select=code,app_html&plugin_id=eq." + CampusJson.enc(id)),
        r -> {
          List<JSONObject> list = CampusJson.rows(r);
          if (list.isEmpty()) {
            a.toast("草稿已不存在，请刷新");
            return;
          }
          a.store.set("draft_review_id", id);
          a.store.set("draft_review_files", list.get(0));
          a.store.set("draft_review_sha", sha(list.get(0)));
          a.open("draft-code");
        });
  }

  static String sha(JSONObject x) throws Exception {
    byte[] digest =
        MessageDigest.getInstance("SHA-256")
            .digest(
                (x.optString("code", "") + "\u0001" + x.optString("app_html", ""))
                    .getBytes("UTF-8"));
    StringBuilder b = new StringBuilder();
    for (byte value : digest) b.append(String.format(Locale.ROOT, "%02x", value & 255));
    return b.toString();
  }

  static void code(CampusActivity a) {
    CampusUi u = a.ui;
    boolean review = !a.store.string("draft_review_id", "").isEmpty();
    JSONObject files = a.store.object(review ? "draft_review_files" : "draft_plugin_files");
    u.title(
        a.content,
        review ? "审核草稿代码" : "插件代码文件",
        review
            ? a.store.string("draft_review_id", "")
            : a.store.object("draft_plugin_meta").optString("name"));
    for (String key : new String[] {"code", "app_html"}) {
      String text = files.isNull(key) ? "" : files.optString(key);
      u.section(a.content, key.equals("code") ? "plugin.js" : "app.html");
      LinearLayout c = u.card(a.content);
      TextView t = u.text(text.substring(0, Math.min(60000, text.length())), 11, u.ink, false);
      t.setTypeface(android.graphics.Typeface.MONOSPACE);
      t.setTextIsSelectable(true);
      c.addView(t);
      if (text.length() > 60000) c.addView(u.text("当前显示前60000字，可导出完整文件核对。", 12, u.muted, false));
      u.actionRow(
          c,
          new String[] {"导出完整文件", review ? "检查代码" : "导入 / 替换文件"},
          new Runnable[] {
            () ->
                a.export(
                    key.equals("code") ? "plugin.js" : "app.html",
                    text,
                    key.equals("code") ? "text/javascript" : "text/html"),
            () -> {
              if (review)
                message(
                    a,
                    "审核检查",
                    text.contains("eval(")
                            || text.contains("new Function")
                            || text.contains("document.cookie")
                        ? "发现动态代码或Cookie访问，请仔细审核完整文件。"
                        : "请核对存储访问、网络请求、权限申请与用户数据处理。原生应用只查看代码，不执行网页插件。");
              else CampusPhone.json(a, key.equals("code") ? "plugin-js" : "plugin-html");
            }
          });
    }
    if (review)
      a.content.addView(
          u.button(
              "完成核对并发布这个版本",
              () ->
                  u.confirm(
                      "发布已核对的草稿？",
                      "发布后网站用户将可以使用此插件。服务器会校验本次审核代码的指纹。",
                      () ->
                          a.rpc(
                              "publish_plugin_v2",
                              CampusJson.obj(
                                  "pid",
                                  a.store.string("draft_review_id", ""),
                                  "sha",
                                  a.store.string("draft_review_sha", "")),
                              r -> {
                                a.store.set("draft_review_id", "");
                                a.store.set("draft_review_sha", "");
                                loadPlugins(a);
                              })),
              true));
    else a.content.addView(u.button("提交草稿审核", () -> submitDraft(a), true));
  }

  static void submitDraft(CampusActivity a) {
    JSONObject meta = a.store.object("draft_plugin_meta"),
        files = a.store.object("draft_plugin_files");
    String id = meta.optString("plugin_id");
    if (files.optString("code").isEmpty() && files.optString("app_html").isEmpty()) {
      a.toast("请至少导入一个代码文件");
      return;
    }
    List<String> issues = pluginPreflight(files, id);
    if (!issues.isEmpty()) {
      message(a, "请先修正代码", CampusJson.join("\n", issues));
      return;
    }
    a.background(
        "提交插件草稿",
        () -> {
          if (a.store.bool("draft_plugin_new", false)) {
            a.api.rest("plugins", "POST", CampusJson.obj("id", id));
            a.store.set("draft_plugin_new", false);
          }
          Object caps = a.api.rpc("plugin_upload_caps", new JSONObject());
          boolean b64 = caps instanceof Number && ((Number) caps).intValue() >= 2;
          int nc = 0, nh = 0;
          for (String field : new String[] {"code", "app_html"}) {
            String s = files.isNull(field) ? "" : files.optString(field);
            int seq = 0;
            for (int from = 0; from < s.length(); ) {
              int end = Math.min(s.length(), from + 12000);
              if (end < s.length() && Character.isHighSurrogate(s.charAt(end - 1))) end--;
              String part = s.substring(from, end);
              a.api.rpc(
                  "plugin_chunk_put",
                  CampusJson.obj(
                      "p_pid",
                      id,
                      "p_field",
                      field,
                      "p_seq",
                      seq++,
                      "p_data",
                      b64 ? Base64.encodeToString(part.getBytes("UTF-8"), Base64.NO_WRAP) : part));
              from = end;
            }
            if (field.equals("code")) nc = seq;
            else nh = seq;
          }
          return a.api.rpc(
              "plugin_draft_submit",
              CampusJson.obj(
                  "p_pid",
                  id,
                  "p_name",
                  meta.optString("name"),
                  "p_icon",
                  meta.optString("icon", "🧩"),
                  "p_description",
                  meta.optString("description"),
                  "p_version",
                  meta.optString("version"),
                  "p_changelog",
                  meta.optString("changelog"),
                  "p_code_parts",
                  nc,
                  "p_html_parts",
                  nh));
        },
        r -> {
          a.store.set("draft_plugin_new", false);
          a.toast("草稿已提交，等待审核");
          loadPlugins(a);
        });
  }

  static List<String> pluginPreflight(JSONObject files, String id) {
    List<String> issues = new ArrayList<>();
    String code = files.optString("code", ""), html = files.optString("app_html", "");
    if (files.has("code") && !files.isNull("code")) {
      if (!java.util.regex.Pattern.compile("CalendarApp\\.register\\s*\\(").matcher(code).find())
        issues.add("plugin.js 里没有 CalendarApp.register(...)。");
      else if (!java.util.regex.Pattern.compile(
              "id\\s*:\\s*[\"'`]" + java.util.regex.Pattern.quote(id) + "[\"'`]")
          .matcher(code)
          .find()) issues.add("plugin.js 里注册的 id 必须为 " + id + "。");
    }
    if (java.util.regex.Pattern.compile("cc_session|access_token|refresh_token")
        .matcher(code + "\n" + html)
        .find()) issues.add("插件代码包含登录凭证相关字样，请移除登录信息读取。");
    return issues;
  }
}
