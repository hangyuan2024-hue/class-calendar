package com.laolao.classcalendar;

import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Bounded, website-compatible tree documents. Independent of Android for import/edit tests. */
final class MindMapDocument {
  static final int MAX_NODES = 1500, MAX_DEPTH = 48, MAX_BYTES = 3 * 1024 * 1024;
  static final Set<String> MARKS = new LinkedHashSet<>(Arrays.asList("p1", "p2", "p3", "done", "star", "ask", "warn", "idea", "pin", "book", "calc", "heart"));

  static String id() { return UUID.randomUUID().toString(); }
  static JSONObject node(String text, JSONObject... kids) {
    return CampusJson.obj("id", id(), "text", text, "children", new JSONArray(Arrays.asList(kids)));
  }

  static JSONObject newMap(String template, String title) {
    JSONObject root;
    switch (template) {
      case "course": root = node("课程复习", node("第一章", node("重点"), node("难点"), node("例题"), node("易错点")), node("第二章", node("重点"), node("难点")), node("公式汇总"), node("考试范围")); break;
      case "exam": root = node("考试准备", node("考试信息", node("时间"), node("地点"), node("题型分值")), node("必考知识点"), node("薄弱环节"), node("复习计划", node("第一周"), node("第二周"), node("考前一天"))); break;
      case "question": root = node("我遇到的问题", node("问题是什么"), node("需要先懂的知识", node("知识点 1"), node("知识点 2")), node("解决步骤", node("第一步"), node("第二步")), node("答案 / 结论"), node("还不懂的")); break;
      case "book": root = node("读书笔记", node("作者与背景"), node("主要观点", node("观点 1"), node("观点 2")), node("精彩句子"), node("我的感想"), node("可以用在哪")); break;
      case "project": root = node("项目计划", node("目标"), node("分工", node("成员 A"), node("成员 B")), node("时间节点"), node("需要的资源"), node("风险")); break;
      default: root = node("中心主题");
    }
    if (title != null && !title.trim().isEmpty()) CampusJson.put(root, "text", title.trim().substring(0, Math.min(500, title.trim().length())));
    return CampusJson.obj("id", id(), "title", root.optString("text"), "layout", "mind", "line", "curve", "theme", "fresh", "root", root, "v", 1);
  }

  static JSONObject normalize(JSONObject input, boolean freshIds) {
    JSONObject source = input.optJSONObject("root") != null ? input : input.optJSONObject("data");
    if (source == null || source.optJSONObject("root") == null) throw new IllegalArgumentException("这个 JSON 不是思维导图备份");
    int[] count = {0};
    Set<String> ids = new HashSet<>();
    JSONObject root = normalizeNode(source.optJSONObject("root"), freshIds, ids, 0, count);
    if (root.optString("text").trim().isEmpty()) CampusJson.put(root, "text", "未命名导图");
    String title = source.optString("title", root.optString("text"));
    if (title.trim().isEmpty()) title = root.optString("text");
    return CampusJson.obj("id", freshIds ? id() : source.optString("id", id()), "title", clip(title, 80),
        "layout", option(source.optString("layout"), "mind", "right", "down"),
        "line", option(source.optString("line"), "curve", "elbow", "straight"),
        "theme", option(source.optString("theme"), "fresh", "warm", "night", "board"), "root", root, "v", 1);
  }

  private static JSONObject normalizeNode(JSONObject source, boolean fresh, Set<String> ids, int depth, int[] count) {
    if (depth > MAX_DEPTH) throw new IllegalArgumentException("导图层级过深，最多 48 层");
    if (++count[0] > MAX_NODES) throw new IllegalArgumentException("导图最多 1500 个主题");
    if (source == null) throw new IllegalArgumentException("导图包含无效主题");
    String nodeId = fresh ? id() : source.optString("id", id());
    if (nodeId.isEmpty() || nodeId.length() > 80 || !ids.add(nodeId)) throw new IllegalArgumentException("导图主题标识重复或无效");
    JSONObject n = CampusJson.obj("id", nodeId, "text", clip(source.optString("text"), 500), "children", new JSONArray());
    Object rawKids = source.opt("children");
    if (rawKids != null && rawKids != JSONObject.NULL && !(rawKids instanceof JSONArray)) throw new IllegalArgumentException("导图子主题格式错误");
    JSONArray kids = CampusJson.arr(rawKids);
    for (int i = 0; i < kids.length(); i++) n.optJSONArray("children").put(normalizeNode(kids.optJSONObject(i), fresh, ids, depth + 1, count));
    for (String key : new String[] {"fold", "bold"}) if (source.optBoolean(key)) CampusJson.put(n, key, true);
    String color = source.optString("color");
    if (color.matches("#[0-9a-fA-F]{6}")) CampusJson.put(n, "color", color);
    String side = source.optString("side");
    if (side.equals("l") || side.equals("r")) CampusJson.put(n, "side", side);
    if (source.has("progress")) CampusJson.put(n, "progress", Math.max(0, Math.min(100, source.optInt("progress"))));
    String note = clip(source.optString("note"), 4000), link = safeUrl(source.optString("link"));
    if (!note.isEmpty()) CampusJson.put(n, "note", note);
    if (!link.isEmpty()) CampusJson.put(n, "link", link);
    JSONArray marks = new JSONArray();
    Set<String> unique = new HashSet<>();
    for (int i = 0; i < CampusJson.arr(source.opt("marks")).length(); i++) {
      String m = CampusJson.arr(source.opt("marks")).optString(i);
      if (MARKS.contains(m) && unique.add(m)) marks.put(m);
    }
    if (marks.length() > 0) CampusJson.put(n, "marks", marks);
    return n;
  }

  static String safeUrl(String value) {
    String v = value == null ? "" : value.trim();
    if (v.length() > 2000) return "";
    if (!v.matches("(?i)^https?://.*") && v.matches("(?i)^[a-z0-9.-]+\\.[a-z]{2,}([/:?#].*)?$")) v = "https://" + v;
    try {
      java.net.URI u = new java.net.URI(v);
      return (u.getScheme().equalsIgnoreCase("https") || u.getScheme().equalsIgnoreCase("http")) && u.getHost() != null && u.getUserInfo() == null ? v : "";
    } catch (Exception e) { return ""; }
  }

  private static String option(String v, String... values) {
    for (String s : values) if (s.equals(v)) return v;
    return values[0];
  }
  private static String clip(String v, int max) { return v.substring(0, Math.min(max, v.length())); }

  static JSONObject find(JSONObject root, String id) {
    if (root.optString("id").equals(id)) return root;
    for (JSONObject c : CampusJson.rows(root.opt("children"))) { JSONObject found = find(c, id); if (found != null) return found; }
    return null;
  }
  static JSONObject parent(JSONObject root, String id) {
    for (JSONObject c : CampusJson.rows(root.opt("children"))) {
      if (c.optString("id").equals(id)) return root;
      JSONObject found = parent(c, id); if (found != null) return found;
    }
    return null;
  }
  static int count(JSONObject root) {
    int n = 1;
    for (JSONObject c : CampusJson.rows(root.opt("children"))) n += count(c);
    return n;
  }

  static String addChild(JSONObject map, String parentId, String text) {
    if (count(map.optJSONObject("root")) >= MAX_NODES) throw new IllegalArgumentException("导图最多 1500 个主题");
    JSONObject p = find(map.optJSONObject("root"), parentId);
    if (p == null) throw new IllegalArgumentException("找不到这个主题");
    JSONObject n = node(text == null || text.trim().isEmpty() ? "子主题" : clip(text.trim(), 500));
    p.optJSONArray("children").put(n);
    p.remove("fold");
    return n.optString("id");
  }

  static void remove(JSONObject map, String id) {
    JSONObject p = parent(map.optJSONObject("root"), id);
    if (p == null) throw new IllegalArgumentException("中心主题不能删除");
    JSONArray next = new JSONArray();
    for (JSONObject child : CampusJson.rows(p.opt("children"))) if (!child.optString("id").equals(id)) next.put(child);
    CampusJson.put(p, "children", next);
  }

  static void move(JSONObject map, String id, String to, int position) {
    JSONObject root = map.optJSONObject("root"), n = find(root, id), old = parent(root, id), target = find(root, to);
    if (n == null || old == null || target == null) throw new IllegalArgumentException("中心主题不能移动，或目标不存在");
    if (find(n, to) != null) throw new IllegalArgumentException("不能把主题移动到自己或自己的下级");
    remove(map, id);
    List<JSONObject> children = CampusJson.rows(target.opt("children"));
    children.add(Math.max(0, Math.min(position, children.size())), n);
    CampusJson.put(target, "children", new JSONArray(children));
    target.remove("fold");
  }

  static JSONObject parseText(String text) {
    if (text == null || text.trim().isEmpty()) throw new IllegalArgumentException("请先粘贴文字");
    if (text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("文字最多 3 MB");
    class Line { int depth, indent, heading, numbered; String text; boolean head; }
    List<Line> lines = new ArrayList<>(); TreeSet<Integer> indents = new TreeSet<>();
    Pattern heading = Pattern.compile("^(#{1,6})\\s+(.+)$"), numbers = Pattern.compile("^(\\d+(?:\\.\\d+)+)[.、)]?\\s+(.+)$"), bullet = Pattern.compile("^(?:[-*+•·]|\\d+[.、)]|[（(]?\\d+[)）]|[一二三四五六七八九十]+[、.]|[a-zA-Z][.)])\\s*(.+)$");
    int minHeading = 9;
    for (String raw : text.replace("\r", "").replace("\t", "    ").split("\n")) {
      String t = raw.trim();
      if (t.isEmpty() || t.matches("(```.*|---+|\\*\\*\\*+|___+)")) continue;
      if (lines.size() >= MAX_NODES) throw new IllegalArgumentException("导图最多 1500 个主题");
      Line l = new Line();
      l.indent = raw.length() - raw.replaceFirst("^\\s+", "").length();
      Matcher h = heading.matcher(t), num = numbers.matcher(t), b = bullet.matcher(t);
      if (h.matches()) { l.head = true; l.heading = h.group(1).length() - 1; t = h.group(2); minHeading = Math.min(minHeading, l.heading); }
      else { indents.add(l.indent); if (num.matches()) { l.numbered = num.group(1).split("\\.").length; t = num.group(2); } else if (b.matches()) t = b.group(1); }
      l.text = clip(t.replaceAll("\\*\\*(.+?)\\*\\*", "$1").replaceAll("__(.+?)__", "$1").replaceAll("`([^`]+)`", "$1").trim(), 500);
      if (!l.text.isEmpty()) lines.add(l);
    }
    if (lines.isEmpty()) throw new IllegalArgumentException("没有找到可以导入的主题");
    boolean hasHeading = minHeading < 9;
    int lastHeading = -1;
    List<Integer> indentOrder = new ArrayList<>(indents);
    for (Line l : lines) {
      if (l.head) { l.depth = l.heading - minHeading; lastHeading = l.depth; }
      else l.depth = (hasHeading ? lastHeading + 1 : 0) + (l.numbered > 0 ? l.numbered - 1 : indentOrder.indexOf(l.indent));
    }
    int min = lines.stream().mapToInt(l -> l.depth).min().orElse(0);
    long top = lines.stream().filter(l -> l.depth == min).count();
    JSONObject root;
    if (top == 1 && lines.get(0).depth == min) root = node(lines.remove(0).text);
    else root = node("新导图");
    int base = lines.stream().mapToInt(l -> l.depth).min().orElse(0);
    List<JSONObject> stack = new ArrayList<>(); List<Integer> levels = new ArrayList<>();
    stack.add(root); levels.add(-1);
    for (Line l : lines) {
      int d = l.depth - base;
      while (stack.size() > 1 && levels.get(levels.size() - 1) >= d) { stack.remove(stack.size() - 1); levels.remove(levels.size() - 1); }
      if (stack.size() > MAX_DEPTH) throw new IllegalArgumentException("文字层级过深，最多 48 层");
      JSONObject n = node(l.text); stack.get(stack.size() - 1).optJSONArray("children").put(n); stack.add(n); levels.add(d);
    }
    return normalize(CampusJson.obj("root", root), true);
  }

  static String toText(JSONObject root) { StringBuilder out = new StringBuilder(); text(root, 0, out, false); return out.toString(); }
  static String toMarkdown(JSONObject root) { StringBuilder out = new StringBuilder(); text(root, 0, out, true); return out.toString(); }
  private static void text(JSONObject n, int depth, StringBuilder out, boolean markdown) {
    String prefix = markdown && depth <= 2 ? repeat("#", depth + 1) + " " : repeat("  ", markdown ? Math.max(0, depth - 3) : depth) + (depth == 0 ? "" : "- ");
    out.append(prefix).append(n.optString("text").replace('\n', ' '));
    if (markdown && n.optInt("progress") > 0) out.append("（").append(n.optInt("progress")).append("%）");
    if (markdown && !n.optString("link").isEmpty()) out.append(" [链接](").append(n.optString("link")).append(')');
    out.append('\n');
    if (markdown && !n.optString("note").isEmpty()) out.append("> ").append(n.optString("note").replace('\n', ' ')).append('\n');
    for (JSONObject c : CampusJson.rows(n.opt("children"))) text(c, depth + 1, out, markdown);
  }
  private static String repeat(String value, int n) { StringBuilder s = new StringBuilder(); for (int i = 0; i < n; i++) s.append(value); return s.toString(); }
}
