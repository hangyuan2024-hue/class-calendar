package com.laolao.classcalendar;

import android.app.AlertDialog;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Native, searchable tool catalogue. Filtering never replaces or reloads the focused input. */
final class CampusToolbox {
  static final String[][] ITEMS = {
    {"courses", "完整课程表", "周次、单双周、教室与冲突检查", "学习"},
    {"countdown", "考试倒计时", "记录考试，安排每日复习目标", "学习"},
    {"wrongbook", "错题记录本", "拍照归档，记录原因与复习进度", "学习"},
    {"words", "单词搭子", "七本离线词书、发音与记忆测试", "学习"},
    {"cards", "记忆晶片", "制作问答卡片，安排间隔复习", "学习"},
    {"review", "复习雷达", "复习今天到期的记忆晶片", "学习"},
    {"ask", "捞捞助手", "查询课程，整理与核对班群消息", "学习"},
    {"plan", "五种规划方法", "四象限、PDCA、SMART与常春藤", "规划"},
    {"pomo", "番茄专注", "专注、暂停、长短休息与记录", "规划"},
    {"time-master", "时间管理大师", "每日与每周三只青蛙，先做要事", "规划"},
    {"checklist", "校园装备清单", "出门前检查用品，减少遗忘", "规划"},
    {"report", "学习周报", "回看最近七天的实际学习记录", "规划"},
    {"diary", "图文日记", "心情、天气、照片与历史搜索", "生活"},
    {"ledger", "校园花销记账", "分类收支、月预算与数据导出", "生活"},
    {"growth", "打卡成长", "习惯打卡、连续记录与成长热力图", "生活"},
    {"farm", "云宠农场", "用真实进度喂养、升级与换云宠", "生活"},
    {"meta", "捞捞元宇宙", "学习星系、真实经验值与成长徽章", "生活"},
    {"oracle", "神谕阁", "答案之书、牌卡与思考灵感", "生活"},
    {"draw", "随机抽签器", "随机抽取、打乱顺序与公平分组", "生活"},
    {"phone", "手机助手", "十项手机专属能力，随身更方便", "手机"},
    {"widget", "桌面学习卡片", "在手机桌面查看今日课程与安排", "手机"},
    {"reminders", "系统提醒中心", "课程、作业与自定义通知提醒", "手机"},
    {"inbox", "跨应用收件箱", "从其他 App 接收文字和图片", "手机"},
    {"voice", "语音速记", "说一句话，整理成个人待办", "手机"},
    {"recordings", "课堂录音", "后台录音、重命名、播放与分享", "手机"},
    {"privacy", "日记设备验证", "使用设备验证保护私密日记", "手机"},
    {"quiet", "上课自动勿扰", "依据课表开启勿扰，结束后恢复", "手机"},
    {"places", "校园位置书签", "保存地点，查看距离与地图导航", "手机"},
    {"scanner", "拍照资料扫描", "裁切、旋转、灰度与多页 PDF", "手机"},
    {"contacts", "校园电话", "收藏联系号码，打开系统拨号", "手机"},
    {"plugins", "插件商店", "查看插件，启用、停用与管理", "更多"},
    {"search", "全局搜索", "寻找课程、事项、考试与学习记录", "更多"},
    {"intro", "功能介绍", "校园功能说明与更新历史", "更多"},
    {"credits", "贡献名单", "一起建设校园空间的伙伴", "更多"}
  };

  static String description(String route) {
    for (String[] item : ITEMS) if (item[0].equals(route)) return item[2];
    if (route.equals("homework")) return "作业、进度与截止时间";
    if (route.equals("wall")) return "班级交流、通知与新消息";
    return "打开你的校园工具";
  }

  static void remember(CampusActivity a, String route) {
    boolean known = false;
    for (String[] item : ITEMS) if (item[0].equals(route)) known = true;
    if (!known) return;
    JSONArray recent = new JSONArray().put(route), old = a.store.list("native_recent_tools");
    for (int i = 0; i < old.length() && recent.length() < 6; i++)
      if (!route.equals(old.optString(i))) recent.put(old.optString(i));
    a.store.set("native_recent_tools", recent);
  }

  private static final String[] GROUPS = {"学习", "规划", "生活", "手机", "更多"};
  private static final String[] GROUP_ROUTES = {"courses", "plan", "growth", "phone", "plugins"};
  private static final String[] GROUP_NOTES = {
    "课程表 · 考试 · 错题 · 复习",
    "五种规划 · 专注 · 清单 · 周报",
    "成长打卡 · 日记 · 记账 · 云宠",
    "桌面卡片 · 提醒 · 录音 · 扫描",
    "插件商店 · 全局搜索 · 功能介绍"
  };
  private static final String[] DEFAULT_PINS = {"courses", "wrongbook", "ledger", "countdown"};

  static String[] item(String route) {
    for (String[] x : ITEMS) if (x[0].equals(route)) return x;
    return null;
  }

  static String name(String route) {
    String[] x = item(route);
    if (x == null) return CampusManage.homeName(route);
    if (route.equals("courses")) return "课程表";
    if (route.equals("wrongbook")) return "错题本";
    if (route.equals("ledger")) return "校园记账";
    return x[1];
  }

  /** Share the existing home-tool preference. An intentionally empty list remains empty. */
  static JSONArray pinned(CampusActivity a) {
    Object saved = a.store.get("native_home_tools", null);
    JSONArray source =
        saved == null
            ? new JSONArray(Arrays.asList(DEFAULT_PINS))
            : a.store.list("native_home_tools");
    JSONArray result = new JSONArray();
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < source.length(); i++) {
      String route = source.optString(i);
      if (item(route) != null && seen.add(route)) result.put(route);
    }
    return result;
  }

  private static String[][] shortcuts(JSONArray ids) {
    String[][] result = new String[ids.length()][];
    for (int i = 0; i < ids.length(); i++)
      result[i] = new String[] {ids.optString(i), name(ids.optString(i))};
    return result;
  }

  /** The navigation shortcut opens real tools; editing is a separate, explicit action. */
  static void quickChoose(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout body = u.column();
    body.setPadding(u.dp(14), u.dp(4), u.dp(14), u.dp(8));
    JSONArray selected = pinned(a);
    final AlertDialog[] dialog = new AlertDialog[1];
    if (selected.length() == 0) {
      TextView empty = u.text("还没有常用工具，点击下面的加号选择。", 14, u.muted, false);
      empty.setPadding(u.dp(8), u.dp(12), u.dp(8), u.dp(12));
      body.addView(empty);
    } else {
      for (int i = 0; i < selected.length(); i++) {
        String route = selected.optString(i);
        LinearLayout row = toolLine(a, route, name(route), description(route));
        row.setOnClickListener(
            v -> {
              dialog[0].dismiss();
              a.open(route);
            });
        body.addView(row);
      }
    }
    ScrollView scroll = new ScrollView(a);
    scroll.setFillViewport(false);
    scroll.addView(body);
    dialog[0] =
        new AlertDialog.Builder(u.dialog())
            .setTitle("快捷工具")
            .setView(scroll)
            .setPositiveButton("＋ 调整常用", (d, w) -> editPinned(a))
            .setNegativeButton(
                "全部工具",
                (d, w) -> {
                  a.toolQuery = "";
                  a.toolCategory = "全部";
                  a.open("tools");
                })
            .create();
    u.showDialog(dialog[0]);
    if (dialog[0].getWindow() != null) {
      dialog[0].getWindow().setGravity(Gravity.BOTTOM);
      dialog[0]
          .getWindow()
          .setLayout(
              Math.min(u.dp(560), a.getResources().getDisplayMetrics().widthPixels),
              selected.length() > 5
                  ? (int) (a.getResources().getDisplayMetrics().heightPixels * .75f)
                  : -2);
    }
  }

  /** All catalogue tools can be selected. Saving keeps the old order and legacy home entries. */
  static void editPinned(CampusActivity a) {
    CampusUi u = a.ui;
    JSONArray current = pinned(a);
    LinkedHashSet<String> selected = new LinkedHashSet<>();
    for (int i = 0; i < current.length(); i++) selected.add(current.optString(i));
    LinearLayout body = u.column();
    body.setPadding(u.dp(18), u.dp(2), u.dp(18), u.dp(12));
    body.addView(u.text("勾选后同时出现在首页和快捷工具中。", 13, u.muted, false));
    Map<String, CheckBox> choices = new LinkedHashMap<>();
    for (String group : GROUPS) {
      u.section(body, group + "工具");
      for (String[] x : ITEMS) {
        if (!x[3].equals(group)) continue;
        CheckBox check = new CheckBox(u.dialog());
        check.setText(x[1]);
        check.setTextSize(15);
        check.setTextColor(u.ink);
        check.setMinHeight(u.dp(52));
        check.setPadding(u.dp(8), u.dp(10), u.dp(8), u.dp(10));
        check.setButtonTintList(ColorStateList.valueOf(u.accent));
        check.setChecked(selected.contains(x[0]));
        check.setContentDescription("常用工具：" + x[1]);
        choices.put(x[0], check);
        body.addView(check, new LinearLayout.LayoutParams(-1, -2));
      }
    }
    ScrollView scroll = new ScrollView(a);
    scroll.setFillViewport(false);
    scroll.addView(body);
    AlertDialog dialog =
        new AlertDialog.Builder(u.dialog())
            .setTitle("选择常用工具")
            .setView(scroll)
            .setNegativeButton("取消", null)
            .setNeutralButton("恢复默认", null)
            .setPositiveButton(
                "保存",
                (d, w) -> {
                  JSONArray saved = new JSONArray();
                  Set<String> added = new HashSet<>();
                  JSONArray previous = a.store.list("native_home_tools");
                  for (int i = 0; i < previous.length(); i++) {
                    String route = previous.optString(i);
                    CheckBox check = choices.get(route);
                    if ((check == null || check.isChecked()) && added.add(route)) saved.put(route);
                  }
                  // New selections follow catalogue order; existing choices retain their
                  // arrangement.
                  for (String route : choices.keySet())
                    if (choices.get(route).isChecked() && added.add(route)) saved.put(route);
                  a.store.set("native_home_tools", saved);
                  a.toast("常用工具已保存");
                  a.build();
                })
            .create();
    u.showDialog(dialog);
    dialog
        .getButton(AlertDialog.BUTTON_NEUTRAL)
        .setOnClickListener(
            v -> {
              for (Map.Entry<String, CheckBox> entry : choices.entrySet())
                entry.getValue().setChecked(Arrays.asList(DEFAULT_PINS).contains(entry.getKey()));
            });
    if (dialog.getWindow() != null) {
      dialog.getWindow().setGravity(Gravity.BOTTOM);
      dialog
          .getWindow()
          .setLayout(
              Math.min(u.dp(560), a.getResources().getDisplayMetrics().widthPixels),
              (int) (a.getResources().getDisplayMetrics().heightPixels * .82f));
    }
  }

  private static LinearLayout toolLine(CampusActivity a, String route, String title, String note) {
    CampusUi u = a.ui;
    LinearLayout row = u.row();
    row.setPadding(u.dp(10), u.dp(13), u.dp(10), u.dp(13));
    row.setMinimumHeight(u.dp(72));
    u.touch(row, u.surface, 14, 0);
    row.addView(u.badge(route), new LinearLayout.LayoutParams(u.dp(36), u.dp(36)));
    LinearLayout copy = u.column();
    copy.addView(u.text(title, 15, u.ink, true));
    u.gap(copy, 4);
    copy.addView(u.text(note, 12, u.muted, false));
    LinearLayout.LayoutParams label = new LinearLayout.LayoutParams(0, -2, 1);
    label.setMargins(u.dp(12), 0, u.dp(8), 0);
    row.addView(copy, label);
    row.addView(u.text("›", 22, u.muted, false));
    row.setContentDescription(title + "，" + note);
    row.setOnClickListener(v -> a.open(route));
    return row;
  }

  private static void hub(CampusActivity a, LinearLayout results, Runnable update) {
    CampusUi u = a.ui;
    LinearLayout header = u.row();
    header.addView(u.text("常用工具", 17, u.ink, true), new LinearLayout.LayoutParams(0, -2, 1));
    TextView add = u.button("＋", () -> editPinned(a), false);
    add.setContentDescription("选择常用工具");
    add.setTextSize(22);
    add.setPadding(0, 0, 0, 0);
    u.touch(add, Color.TRANSPARENT, 12, 0);
    header.addView(add, new LinearLayout.LayoutParams(u.dp(48), u.dp(48)));
    results.addView(header);
    u.gap(results, 8);
    JSONArray selected = pinned(a);
    if (selected.length() == 0) u.empty(results, "选择你常用的工具", "点击加号勾选，以后从这里直接打开。");
    else u.dock(results, shortcuts(selected));
    u.gap(results, 9);
    u.section(results, "工具分类");
    LinearLayout group = u.card(results);
    group.setPadding(u.dp(6), u.dp(3), u.dp(6), u.dp(3));
    for (int i = 0; i < GROUPS.length; i++) {
      final String category = GROUPS[i];
      int count = 0;
      for (String[] x : ITEMS) if (x[3].equals(category)) count++;
      LinearLayout row =
          toolLine(a, GROUP_ROUTES[i], category + " · " + count + " 项", GROUP_NOTES[i]);
      row.setOnClickListener(
          v -> {
            a.toolCategory = category;
            update.run();
          });
      group.addView(row);
      if (i + 1 < GROUPS.length) {
        View divider = new View(a);
        divider.setBackgroundColor(u.border);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, u.dp(1));
        lp.leftMargin = u.dp(58);
        group.addView(divider, lp);
      }
    }
    // Keep recent tools useful without repeating the pinned shortcuts on the same screen.
    JSONArray recent = a.store.list("native_recent_tools"), other = new JSONArray();
    Set<String> already = new HashSet<>();
    for (int i = 0; i < selected.length(); i++) already.add(selected.optString(i));
    for (int i = 0; i < recent.length() && other.length() < 3; i++) {
      String route = recent.optString(i);
      if (item(route) != null && already.add(route)) other.put(route);
    }
    if (other.length() > 0) {
      u.section(results, "最近使用");
      u.dock(results, shortcuts(other));
    }
  }

  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "工具", "");
    LinearLayout search = u.row();
    search.setPadding(u.dp(15), 0, u.dp(9), 0);
    search.setBackground(u.shape(u.surface, 15, u.border));
    search.addView(
        new CampusUi.Icon(a, "search", u.muted), new LinearLayout.LayoutParams(u.dp(21), u.dp(21)));
    EditText input = new EditText(a);
    input.setTextSize(15);
    input.setTextColor(u.ink);
    input.setHintTextColor(u.muted);
    input.setHint("搜索全部工具");
    input.setSingleLine(true);
    input.setText(a.toolQuery);
    input.setSelection(input.length());
    input.setBackground(null);
    input.setPadding(u.dp(12), u.dp(17), 0, u.dp(17));
    input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
    search.addView(input, new LinearLayout.LayoutParams(0, -2, 1));
    TextView clear = u.button("×", () -> input.setText(""), false);
    u.touch(clear, Color.TRANSPARENT, 12, 0);
    clear.setTextSize(22);
    clear.setContentDescription("清空工具搜索");
    clear.setVisibility(View.GONE);
    search.addView(clear, new LinearLayout.LayoutParams(u.dp(48), -2));
    a.content.addView(search);
    u.gap(a.content, 14);
    LinearLayout results = u.column();
    a.content.addView(results);
    final Runnable[] refresh = new Runnable[1];
    refresh[0] =
        () -> {
          results.removeAllViews();
          String query = input.getText().toString().trim().toLowerCase(Locale.ROOT);
          clear.setVisibility(query.isEmpty() ? View.GONE : View.VISIBLE);
          boolean root =
              a.toolCategory.equals("全部") || !Arrays.asList(GROUPS).contains(a.toolCategory);
          if (query.isEmpty() && root) {
            hub(a, results, refresh[0]);
            return;
          }
          if (!root) {
            TextView back =
                u.button(
                    "‹ 所有分类",
                    () -> {
                      a.toolCategory = "全部";
                      refresh[0].run();
                    },
                    false);
            u.touch(back, Color.TRANSPARENT, 12, 0);
            back.setTextColor(u.accent);
            results.addView(back);
            u.gap(results, 6);
          }
          List<String[]> found = new ArrayList<>();
          for (String[] x : ITEMS)
            if ((!query.isEmpty() || root || x[3].equals(a.toolCategory))
                && (query.isEmpty()
                    || (x[0] + x[1] + x[2]).toLowerCase(Locale.ROOT).contains(query))) found.add(x);
          TextView count =
              u.text(
                  (query.isEmpty() ? a.toolCategory + "工具" : "搜索结果") + " · " + found.size() + " 项",
                  13,
                  u.muted,
                  false);
          count.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
          results.addView(count);
          u.gap(results, 12);
          if (found.isEmpty()) u.empty(results, "没有找到这个工具", "试试“课程表”“错题”或“记账”。");
          else u.toolRows(results, found.toArray(new String[0][]));
        };
    input.addTextChangedListener(
        new TextWatcher() {
          public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

          public void onTextChanged(CharSequence s, int start, int before, int count) {
            a.toolQuery = s.toString();
            refresh[0].run();
          }

          public void afterTextChanged(Editable e) {}
        });
    refresh[0].run();
  }
}
