package com.laolao.classcalendar;

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

  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "工具箱", "学习和生活，都有顺手的工具。");
    LinearLayout search = u.row();
    search.setPadding(u.dp(15), 0, u.dp(9), 0);
    search.setBackground(u.shape(u.surface, 18, 0));
    search.addView(
        new CampusUi.Icon(a, "search", u.muted), new LinearLayout.LayoutParams(u.dp(21), u.dp(21)));
    EditText input = new EditText(a);
    input.setTextSize(15);
    input.setTextColor(u.ink);
    input.setHintTextColor(u.muted);
    input.setHint("搜索工具，例如：课表、记账、录音");
    input.setSingleLine(true);
    input.setText(a.toolQuery);
    input.setSelection(input.length());
    input.setBackground(null);
    input.setPadding(u.dp(12), u.dp(17), 0, u.dp(17));
    input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
    search.addView(input, new LinearLayout.LayoutParams(0, -2, 1));
    TextView clear = u.button("×", () -> input.setText(""), false);
    u.touch(clear, android.graphics.Color.TRANSPARENT, 12, 0);
    clear.setTextSize(22);
    clear.setContentDescription("清空工具搜索");
    clear.setVisibility(View.GONE);
    search.addView(clear, new LinearLayout.LayoutParams(u.dp(48), -2));
    a.content.addView(search);
    u.gap(a.content, 15);
    HorizontalScrollView categories = new HorizontalScrollView(a);
    categories.setHorizontalScrollBarEnabled(false);
    boolean largeText = a.getResources().getConfiguration().fontScale > 1.25f;
    categories.setFillViewport(!largeText);
    LinearLayout chips = u.row();
    categories.addView(chips);
    a.content.addView(categories);
    u.gap(a.content, 14);
    LinearLayout results = u.column();
    a.content.addView(results);
    String[] active = {a.toolCategory};
    List<TextView> buttons = new ArrayList<>();
    Runnable filter =
        () -> {
          results.removeAllViews();
          String query = input.getText().toString().trim().toLowerCase(Locale.ROOT);
          for (int i = 0; i < buttons.size(); i++) {
            TextView b = buttons.get(i);
            boolean on = b.getText().toString().equals(active[0]);
            u.touch(b, on ? u.accent : u.surface, 18, 0);
            b.setTextColor(on ? u.onAccent() : u.muted);
            b.setSelected(on);
          }
          clear.setVisibility(query.isEmpty() ? View.GONE : View.VISIBLE);
          if (query.isEmpty() && active[0].equals("全部")) {
            List<String[]> last = new ArrayList<>();
            JSONArray recent = a.store.list("native_recent_tools");
            for (int i = 0; i < Math.min(3, recent.length()); i++)
              for (String[] item : ITEMS) if (item[0].equals(recent.optString(i))) last.add(item);
            if (!last.isEmpty()) {
              u.section(results, "继续使用");
              LinearLayout shortcuts = u.row();
              shortcuts.setGravity(Gravity.TOP);
              for (String[] item : last) {
                LinearLayout shortcut = u.column();
                shortcut.setGravity(Gravity.CENTER);
                shortcut.setPadding(u.dp(10), u.dp(13), u.dp(10), u.dp(13));
                u.touch(shortcut, u.surface, 18, 0);
                shortcut.addView(
                    u.badge(item[0]), new LinearLayout.LayoutParams(u.dp(34), u.dp(34)));
                u.gap(shortcut, 8);
                TextView label = u.text(item[1], 11, u.ink, true);
                label.setGravity(Gravity.CENTER);
                shortcut.addView(label);
                shortcut.setContentDescription("继续使用：" + item[1]);
                shortcut.setOnClickListener(v -> a.open(item[0]));
                LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
                if (shortcuts.getChildCount() > 0) p.leftMargin = u.dp(8);
                shortcuts.addView(shortcut, p);
              }
              results.addView(shortcuts);
              u.gap(results, 4);
            }
          }
          List<String[]> found = new ArrayList<>();
          for (String[] item : ITEMS)
            if ((active[0].equals("全部") || item[3].equals(active[0]))
                && (query.isEmpty()
                    || (item[0] + item[1] + item[2]).toLowerCase(Locale.ROOT).contains(query)))
              found.add(item);
          TextView count =
              u.text(
                  (query.isEmpty() ? active[0] + "工具" : "搜索结果") + " · " + found.size() + " 项",
                  12,
                  u.muted,
                  false);
          count.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
          results.addView(count);
          u.gap(results, 13);
          if (found.isEmpty()) u.empty(results, "还没有找到这个工具", "试试其他名称，或切换到“全部”。");
          else if (query.isEmpty() && active[0].equals("全部")) {
            for (String group : new String[] {"学习", "规划", "生活", "手机", "更多"}) {
              u.section(results, group.equals("手机") ? "手机专属 · 十项能力" : group + "工具");
              List<String[]> rows = new ArrayList<>();
              for (String[] item : found) if (item[3].equals(group)) rows.add(item);
              u.tileGrid(results, rows.toArray(new String[0][]));
            }
          } else u.toolRows(results, found.toArray(new String[0][]));
        };
    for (String label : new String[] {"全部", "学习", "规划", "生活", "手机", "更多"}) {
      TextView b =
          u.button(
              label,
              () -> {
                active[0] = label;
                a.toolCategory = label;
                filter.run();
              },
              false);
      b.setTextSize(13);
      b.setMinWidth(u.dp(48));
      if (!largeText) b.setPadding(u.dp(8), u.dp(13), u.dp(8), u.dp(13));
      LinearLayout.LayoutParams p =
          new LinearLayout.LayoutParams(largeText ? -2 : 0, -2, largeText ? 0 : 1);
      p.rightMargin =
          u.dp(largeText ? 8 : a.getResources().getConfiguration().screenWidthDp <= 340 ? 0 : 4);
      if (label.equals("更多")) p.rightMargin = 0;
      chips.addView(b, p);
      buttons.add(b);
    }
    input.addTextChangedListener(
        new TextWatcher() {
          public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

          public void onTextChanged(CharSequence s, int start, int before, int count) {
            a.toolQuery = s.toString();
            filter.run();
          }

          public void afterTextChanged(Editable e) {}
        });
    filter.run();
  }
}
