package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.util.Base64;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Course recurrence, native weekly grid and the existing courses RPC contract. */
final class CampusCourses {
  static final String COURSES = "personal_course_schedule_courses_v1", META = "native_courses_meta";
  static final String[] WINTER = {
    "08:00-08:50",
    "09:00-09:50",
    "10:10-11:00",
    "11:10-12:00",
    "14:00-14:50",
    "15:00-15:50",
    "16:10-17:00",
    "17:10-18:00",
    "19:10-20:00",
    "20:10-21:00"
  };
  static final String[] SUMMER = {
    "08:00-08:50",
    "09:00-09:50",
    "10:10-11:00",
    "11:10-12:00",
    "14:30-15:20",
    "15:30-16:20",
    "16:40-17:30",
    "17:40-18:30",
    "19:40-20:30",
    "20:40-21:30"
  };
  static final String[] DAYS = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};

  static JSONObject meta(CampusStore s) {
    JSONObject m = s.object(META);
    if (!m.has("week1"))
      CampusJson.put(m, "week1", s.string("plg_course-schedule_week1", "2026-09-14"));
    if (!m.has("times")) CampusJson.put(m, "times", new JSONArray(Arrays.asList(SUMMER)));
    if (!m.has("ics")) CampusJson.put(m, "ics", true);
    return m;
  }

  static String monday(String day) {
    Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    c.setTime(DateMath.parse(day));
    int offset = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7;
    return DateMath.plus(day, -offset);
  }

  static int week(CampusStore s, String day) {
    long n =
        (DateMath.parse(day).getTime() - DateMath.parse(meta(s).optString("week1")).getTime())
            / 86400000L;
    return (int) Math.floorDiv(n, 7) + 1;
  }

  static Set<Integer> weeks(String str) {
    TreeSet<Integer> out = new TreeSet<>();
    String s = str == null ? "" : str.trim();
    if (s.isEmpty()) {
      for (int i = 1; i <= 20; i++) out.add(i);
      return out;
    }
    Matcher pm =
        Pattern.compile("^(\\d+)\\s*[-–—~至]\\s*(\\d+)\\s*[（(]?\\s*(单|双)\\s*[）)]?$").matcher(s);
    if (pm.matches()) {
      int a = Integer.parseInt(pm.group(1)), b = Integer.parseInt(pm.group(2));
      if (a < 1 || b > 30 || a > b) throw new IllegalArgumentException("周次范围为1—30");
      for (int i = a; i <= b; i++) if ((i % 2 == 1) == pm.group(3).equals("单")) out.add(i);
    } else {
      for (String part : s.split("[,，、;；\\s]+")) {
        Matcher r = Pattern.compile("^(\\d+)[-–—~至](\\d+)$").matcher(part);
        if (r.matches()) {
          int a = Integer.parseInt(r.group(1)), b = Integer.parseInt(r.group(2));
          int lo = Math.min(a, b), hi = Math.max(a, b);
          if (lo < 1 || hi > 30) throw new IllegalArgumentException("周次范围为1—30");
          for (int i = lo; i <= hi; i++) out.add(i);
        } else if (part.matches("\\d+")) {
          int i = Integer.parseInt(part);
          if (i < 1 || i > 30) throw new IllegalArgumentException("周次范围为1—30");
          out.add(i);
        } else throw new IllegalArgumentException("周次示例：1-16、1-15单、2-16双、1,3,5");
      }
    }
    if (out.isEmpty()) throw new IllegalArgumentException("周次不能为空");
    return out;
  }

  static void validate(JSONObject x, JSONObject m) {
    validateMeta(m);
    if (x.optString("name").trim().isEmpty()) throw new IllegalArgumentException("请填写课程名称");
    int d = x.optInt("day", -1),
        start = x.optInt("start"),
        end = x.optInt("end"),
        len = CampusJson.arr(m.opt("times")).length();
    if (d < 0 || d > 6 || start < 1 || end < start || end > len)
      throw new IllegalArgumentException("星期或节次超出范围");
    weeks(x.optString("weeks"));
  }

  static void validateMeta(JSONObject m) {
    String first = m.optString("week1");
    DateMath.parse(first);
    if (!monday(first).equals(first)) throw new IllegalArgumentException("第一周日期必须为周一");
    JSONArray times = m.optJSONArray("times");
    if (times == null || times.length() < 1 || times.length() > 16)
      throw new IllegalArgumentException("作息应包含1—16个时段");
    int previous = -1;
    for (int i = 0; i < times.length(); i++) {
      String[] parts = times.optString(i).split("-", -1);
      if (parts.length != 2) throw new IllegalArgumentException("课时格式应为08:00-08:50");
      int[] start = DateMath.time(parts[0]), end = DateMath.time(parts[1]);
      int lo = start[0] * 60 + start[1], hi = end[0] * 60 + end[1];
      if (lo < previous || hi <= lo) throw new IllegalArgumentException("课时必须按时间排列且不能重叠");
      previous = hi;
    }
  }

  static JSONArray cloudRows(JSONArray rows, JSONObject meta) {
    if (rows.length() > 200) throw new IllegalArgumentException("云端课表最多200条课程");
    JSONArray out = new JSONArray();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject x = rows.optJSONObject(i);
      if (x == null) throw new IllegalArgumentException("课程格式无效");
      validate(x, meta);
      out.put(
          CampusJson.obj(
              "id",
              limit(x.optString("id"), 40),
              "name",
              limit(x.optString("name"), 60),
              "day",
              x.optInt("day"),
              "start",
              x.optInt("start"),
              "end",
              x.optInt("end"),
              "weeks",
              limit(x.optString("weeks"), 40),
              "wl",
              new JSONArray(weeks(x.optString("weeks"))),
              "location",
              limit(x.optString("location"), 60),
              "teacher",
              limit(x.optString("teacher"), 40)));
    }
    return out;
  }

  static String limit(String text, int max) {
    int end = Math.min(text.length(), max);
    if (end > 0 && end < text.length() && Character.isHighSurrogate(text.charAt(end - 1))) end--;
    return text.substring(0, end);
  }

  static List<JSONObject> onDay(CampusStore s, String day) {
    List<JSONObject> list = new ArrayList<>();
    JSONObject m = meta(s);
    JSONArray times = CampusJson.arr(m.opt("times"));
    Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    c.setTime(DateMath.parse(day));
    int wd = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7, w = week(s, day);
    for (JSONObject x : CampusJson.rows(s.list(COURSES)))
      try {
        if (x.optInt("day", -1) != wd || !weeks(x.optString("weeks")).contains(w)) continue;
        validate(x, m);
        String t0 = times.optString(x.optInt("start") - 1).split("-")[0],
            t1 = times.optString(x.optInt("end") - 1).split("-")[1];
        CampusJson.put(x, "t0", t0);
        CampusJson.put(x, "t1", t1);
        list.add(x);
      } catch (Exception ignored) {
      }
    list.sort(Comparator.comparingInt(x -> x.optInt("start")));
    return list;
  }

  static List<String> conflicts(JSONArray all, JSONObject x) {
    List<String> names = new ArrayList<>();
    Set<Integer> w = weeks(x.optString("weeks"));
    for (JSONObject y : CampusJson.rows(all)) {
      if (y.optString("id").equals(x.optString("id"))
          || x.optInt("day") != y.optInt("day")
          || x.optInt("start") > y.optInt("end")
          || y.optInt("start") > x.optInt("end")) continue;
      Set<Integer> z = weeks(y.optString("weeks"));
      z.retainAll(w);
      if (!z.isEmpty()) names.add(y.optString("name"));
    }
    return names;
  }

  static void acceptCloud(CampusStore s, JSONObject response) {
    if (s.bool("native_courses_dirty", false)) return;
    JSONObject m = meta(s), remote = response.optJSONObject("meta");
    if (remote != null)
      for (String key : new String[] {"week1", "times", "ics"})
        if (remote.has(key) && !remote.isNull(key)) {
          if (key.equals("times") && CampusJson.arr(remote.opt(key)).length() == 0) continue;
          if (key.equals("week1") && remote.optString(key).isEmpty()) continue;
          CampusJson.put(m, key, remote.opt(key));
        }
    if (m.optString("week1").isEmpty()) CampusJson.put(m, "week1", "2026-09-14");
    CampusJson.put(m, "week1", monday(m.optString("week1")));
    validateMeta(m);
    JSONArray rows = response.optJSONArray("courses");
    if (rows != null) cloudRows(rows, m);
    JSONObject updates = CampusJson.obj(META, m, "plg_course-schedule_week1", m.optString("week1"));
    if (rows != null) CampusJson.put(updates, COURSES, rows);
    s.batch(updates);
  }

  static void sync(CampusActivity a) {
    if (!a.requireLogin()) return;
    final CampusStore target = a.store;
    final JSONArray rows = target.list(COURSES);
    final JSONObject m = meta(target);
    final String sig = rows.toString() + m.toString();
    a.background(
        "同步课程",
        () ->
            a.api.rpc("courses_sync", CampusJson.obj("p_courses", cloudRows(rows, m), "p_meta", m)),
        v -> {
          if ((target.list(COURSES).toString() + meta(target)).equals(sig))
            target.set("native_courses_dirty", false);
          a.toast("课程表已同步");
          a.build();
        });
  }

  static void changed(CampusActivity a) {
    a.store.set("native_courses_dirty", true);
    a.build();
    CampusPhone.refresh(a);
  }

  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "每周课程表", "周次、教室与时间，一眼看清。");
    int w =
        a.store.number(
            "native_view_week", Math.max(1, Math.min(30, week(a.store, DateMath.today()))));
    u.actionRow(
        a.content,
        new String[] {"‹ 上一周", "第 " + w + " 周", "下一周 ›"},
        new Runnable[] {
          () -> {
            a.store.set("native_view_week", Math.max(1, w - 1));
            a.build();
          },
          () -> {
            String[] o = new String[30];
            for (int i = 0; i < 30; i++) o[i] = "第 " + (i + 1) + " 周";
            u.choose(
                "选择周次",
                o,
                k -> {
                  a.store.set("native_view_week", k + 1);
                  a.build();
                });
          },
          () -> {
            a.store.set("native_view_week", Math.min(30, w + 1));
            a.build();
          }
        });
    a.content.addView(
        new Grid(a, w),
        new LinearLayout.LayoutParams(
            -1, u.dp(meta(a.store).optJSONArray("times").length() * 58 + 42)));
    u.gap(a.content, 15);
    u.actionRow(
        a.content,
        new String[] {"＋ 添加课程", "学期设置"},
        new Runnable[] {() -> form(a, null), () -> settings(a)});
    u.actionRow(
        a.content, new String[] {"拍照识别课表", "同步到网站"}, new Runnable[] {() -> ocr(a), () -> sync(a)});
    u.actionRow(
        a.content,
        new String[] {"导出课表", "导入课程 JSON"},
        new Runnable[] {
          () -> a.export("课程表.ics", ics(a, true), "text/calendar"),
          () -> CampusPhone.json(a, "courses")
        });
    if (a.store.bool("native_courses_dirty", false)) a.content.addView(u.pill("本机课程有修改，等待同步"));
    u.section(a.content, "课程清单");
    List<JSONObject> rows = CampusJson.rows(a.store.list(COURSES));
    rows.sort(Comparator.comparingInt(x -> x.optInt("day") * 100 + x.optInt("start")));
    if (rows.isEmpty()) u.empty(a.content, "把这一学期带在身边", "添加课程，或拍摄、选择已有课表进行识别。");
    for (JSONObject x : rows) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("name"), 17, u.ink, true));
      u.gap(c, 8);
      c.addView(
          u.text(
              DAYS[Math.max(0, Math.min(6, x.optInt("day")))]
                  + " · 第"
                  + x.optInt("start")
                  + "—"
                  + x.optInt("end")
                  + "节 · "
                  + x.optString("weeks")
                  + "周",
              12,
              u.muted,
              false));
      u.gap(c, 7);
      c.addView(
          u.text(x.optString("location") + "  " + x.optString("teacher"), 12, u.muted, false));
      c.setOnClickListener(v -> detail(a, x));
    }
  }

  static void form(CampusActivity a, JSONObject item) {
    JSONObject init =
        item == null
            ? CampusJson.obj("id", CampusJson.id(), "day", 0, "start", 1, "end", 2, "weeks", "1-16")
            : CampusJson.copy(item);
    CampusJson.put(init, "weekday", DAYS[Math.max(0, Math.min(6, init.optInt("day")))]);
    a.ui.form(
        item == null ? "添加课程" : "编辑课程",
        init,
        v -> {
          for (int i = 0; i < 7; i++)
            if (DAYS[i].equals(v.optString("weekday"))) CampusJson.put(v, "day", i);
          v.remove("weekday");
          validate(v, meta(a.store));
          CampusJson.put(v, "wl", new JSONArray(weeks(v.optString("weeks"))));
          List<String> conflicts = conflicts(a.store.list(COURSES), v);
          Runnable save =
              () -> {
                a.store.replace(COURSES, v.optString("id"), v);
                changed(a);
              };
          if (conflicts.isEmpty()) save.run();
          else
            a.ui.confirm(
                "课程时间重叠", "与 " + CampusJson.join("、", conflicts) + " 的部分周次冲突，仍要保存吗？", save);
        },
        CampusUi.f("name", "课程名称"),
        CampusUi.choice("weekday", "星期", DAYS),
        CampusUi.f("start", "开始节次", "number"),
        CampusUi.f("end", "结束节次", "number"),
        CampusUi.f("weeks", "周次（支持单双周）"),
        CampusUi.optional("location", "教室"),
        CampusUi.optional("teacher", "任课老师"),
        CampusUi.optional("courseType", "课程类别"),
        new CampusUi.Field("note", "课程备注", "multiline", false));
  }

  static void detail(CampusActivity a, JSONObject x) {
    a.ui.choose(
        x.optString("name"),
        new String[] {"编辑课程", "加入系统日历（本周）", "删除课程"},
        i -> {
          if (i == 0) form(a, x);
          else if (i == 2)
            a.ui.confirm(
                "删除课程？",
                x.optString("name"),
                () -> {
                  a.store.replace(COURSES, x.optString("id"), null);
                  changed(a);
                });
          else {
            int w =
                a.store.number("native_view_week", Math.max(1, week(a.store, DateMath.today())));
            if (!weeks(x.optString("weeks")).contains(w)) {
              a.toast("此课程本周不上课");
              return;
            }
            String day =
                DateMath.plus(meta(a.store).optString("week1"), (w - 1) * 7 + x.optInt("day"));
            for (JSONObject v : onDay(a.store, day))
              if (v.optString("id").equals(x.optString("id")))
                CampusSchool.systemCalendar(
                    a,
                    v.optString("name"),
                    day,
                    v.optString("t0"),
                    v.optString("t1"),
                    v.optString("location"),
                    v.optString("teacher"));
          }
        });
  }

  static void settings(CampusActivity a) {
    JSONObject m = meta(a.store);
    CampusJson.put(m, "mode", "夏秋");
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < CampusJson.arr(m.opt("times")).length(); i++)
      b.append(CampusJson.arr(m.opt("times")).optString(i)).append("\n");
    CampusJson.put(m, "timesText", b.toString().trim());
    a.ui.form(
        "学期与作息",
        m,
        v -> {
          String first = monday(v.optString("week1"));
          String mode = v.optString("mode");
          JSONArray times = new JSONArray();
          if (mode.equals("自定义")) {
            for (String line : v.optString("timesText").split("\\s+")) {
              String[] p = line.replace("—", "-").replace("–", "-").split("-");
              if (p.length != 2) throw new IllegalArgumentException("每行填写08:00-08:50这样的时段");
              DateMath.time(p[0]);
              DateMath.time(p[1]);
              if (p[0].compareTo(p[1]) >= 0) throw new IllegalArgumentException("下课应晚于上课");
              times.put(p[0] + "-" + p[1]);
            }
            if (times.length() < 1 || times.length() > 16)
              throw new IllegalArgumentException("支持1—16节课");
          } else times = new JSONArray(Arrays.asList(mode.equals("冬春") ? WINTER : SUMMER));
          JSONObject out =
              CampusJson.obj("week1", first, "times", times, "ics", v.optBoolean("ics"));
          validateMeta(out);
          for (JSONObject c : CampusJson.rows(a.store.list(COURSES))) validate(c, out);
          a.store.set(META, out);
          a.store.set("plg_course-schedule_week1", first);
          changed(a);
        },
        CampusUi.f("week1", "第一周周一", "date"),
        CampusUi.choice("mode", "上课时间", "夏秋", "冬春", "自定义"),
        new CampusUi.Field("timesText", "自定义时段（每行一节）", "multiline", false),
        CampusUi.f("ics", "课程加入日历导出", "boolean"));
  }

  static void importJson(CampusActivity a, String raw) throws Exception {
    JSONObject data = new JSONObject(raw);
    JSONArray list = data.optJSONArray("courses");
    if (list == null) list = data.optJSONArray(COURSES);
    if (list == null) throw new IllegalArgumentException("文件中没有courses课程清单");
    if (list.length() > 200) throw new IllegalArgumentException("最多导入200条课程");
    JSONObject m = data.optJSONObject("meta");
    if (m == null) m = meta(a.store);
    if (m.has("week1")) CampusJson.put(m, "week1", monday(m.optString("week1")));
    Set<String> ids = new HashSet<>();
    if (CampusJson.rows(list).size() != list.length())
      throw new IllegalArgumentException("课程清单中存在无效记录");
    validateMeta(m);
    for (JSONObject x : CampusJson.rows(list)) {
      if (x.optString("id").isEmpty()) CampusJson.put(x, "id", CampusJson.id());
      if (!ids.add(x.optString("id"))) throw new IllegalArgumentException("存在重复课程编号");
      validate(x, m);
    }
    final JSONObject mm = m;
    final JSONArray ll = list;
    a.ui.confirm(
        "导入 " + list.length() + " 门课程？",
        "将替换本机课表，请先导出旧课表备份。",
        () -> {
          a.store.set(COURSES, ll);
          a.store.set(META, mm);
          changed(a);
        });
  }

  static void ocr(CampusActivity a) {
    if (!a.requireLogin()) return;
    CampusPhone.photo(
        a,
        id -> {
          a.store.set("draft_ocr_photo", id);
          a.background(
              "识别课表",
              () -> {
                File f = CampusPhone.file(a, id);
                byte[] bytes = CampusPhone.bytes(f, 3500000);
                Object start =
                    a.api.rpc(
                        "course_ocr_start",
                        CampusJson.obj("img", Base64.encodeToString(bytes, Base64.NO_WRAP)));
                String jid = CampusJson.object(start).optString("job_id");
                if (jid.isEmpty()) throw new IOException("识别服务没有返回任务编号");
                a.store.set("native_ocr_job", jid);
                return jid;
              },
              v -> pollOcr(a, String.valueOf(v)));
        });
  }

  static void pollOcr(CampusActivity a, String jid) {
    a.background(
        "读取识别结果",
        () -> {
          for (int i = 0; i < 12; i++) {
            JSONObject r =
                CampusJson.object(a.api.rpc("course_ocr_status", CampusJson.obj("jid", jid)));
            String status = r.optString("status");
            if (status.equals("error") || status.equals("failed"))
              throw new IOException(r.optString("error", "图片识别失败"));
            if (status.equals("done")
                || status.equals("completed")
                || r.optJSONObject("result") != null) return r;
            Thread.sleep(1000);
          }
          return null;
        },
        v -> {
          if (v == null) {
            a.ui.confirm("课表仍在识别", "稍后继续获取结果？", () -> pollOcr(a, jid));
            return;
          }
          JSONObject r = (JSONObject) v, result = r.optJSONObject("result");
          if (result == null) result = r;
          JSONArray rows = CampusJson.arr(result.opt("courses"));
          if (rows.length() == 0) {
            a.toast("没有识别到课程，请换一张清晰的课表");
            return;
          }
          for (JSONObject x : CampusJson.rows(rows)) {
            CampusJson.put(x, "id", CampusJson.id());
            if (x.optString("weeks").isEmpty()) CampusJson.put(x, "weeks", "1-16");
          }
          a.store.set("draft_ocr_original", rows);
          a.store.set("draft_ocr_removed", new JSONArray());
          a.store.set("draft_ocr_courses", rows);
          a.store.set("draft_ocr_meta", result);
          a.open("ocr-review");
        });
  }

  static void review(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "核对识别课表", "识别结果需要逐项检查，确认后再加入课程表。");
    JSONArray rows = a.store.list("draft_ocr_courses");
    u.actionRow(
        a.content,
        new String[] {"使用已学习的纠错", "补加一门课程"},
        new Runnable[] {
          () ->
              a.rpc(
                  "course_learn_get",
                  new JSONObject(),
                  r -> {
                    JSONArray learned = CampusJson.arr(r),
                        current = a.store.list("draft_ocr_courses");
                    Map<String, String> replacements = new HashMap<>();
                    Map<String, Integer> scores = new HashMap<>();
                    for (int n = 0; n < learned.length(); n++) {
                      JSONArray item = learned.optJSONArray(n);
                      if (item == null
                          || !Arrays.asList("name", "location", "teacher")
                              .contains(item.optString(0))) continue;
                      String key = item.optString(0) + "|" + item.optString(1);
                      int score = item.optInt(3) + (item.optBoolean(4) ? 100 : 0);
                      if (score > scores.getOrDefault(key, -1)) {
                        scores.put(key, score);
                        replacements.put(key, item.optString(2));
                      }
                    }
                    int changed = 0;
                    for (JSONObject x : CampusJson.rows(current))
                      for (String field : new String[] {"name", "location", "teacher"}) {
                        String value = replacements.get(field + "|" + x.optString(field));
                        if (value != null
                            && !value.isEmpty()
                            && !value.equals(x.optString(field))) {
                          CampusJson.put(x, field, value);
                          changed++;
                        }
                      }
                    a.store.set("draft_ocr_courses", current);
                    a.build();
                    a.toast("已应用 " + changed + " 处纠错，请继续核对");
                  }),
          () ->
              reviewForm(
                  a,
                  rows,
                  -1,
                  CampusJson.obj(
                      "id", CampusJson.id(), "day", 0, "start", 1, "end", 2, "weeks", "1-16"))
        });
    for (int i = 0; i < rows.length(); i++) {
      final int at = i;
      JSONObject x = rows.optJSONObject(i);
      if (x == null) continue;
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("name", "未命名课程"), 17, u.ink, true));
      c.addView(u.text(x.toString(), 12, u.muted, false));
      u.gap(c, 9);
      u.actionRow(
          c,
          new String[] {"编辑", "移除"},
          new Runnable[] {
            () -> reviewForm(a, rows, at, x),
            () -> {
              JSONArray all = a.store.list("draft_ocr_courses");
              a.store.add("draft_ocr_removed", x);
              all.remove(at);
              a.store.set("draft_ocr_courses", all);
              a.build();
            }
          });
    }
    a.content.addView(u.button("确认加入课程表", () -> confirmReview(a), true));
  }

  static void reviewForm(CampusActivity a, JSONArray rows, int at, JSONObject x) {
    a.ui.form(
        "核对课程",
        x,
        v -> {
          JSONArray all = a.store.list("draft_ocr_courses");
          if (at < 0) all.put(v);
          else all.put(at, v);
          a.store.set("draft_ocr_courses", all);
          a.build();
        },
        CampusUi.f("name", "课程名称"),
        CampusUi.f("day", "星期（0为周一）", "number"),
        CampusUi.f("start", "开始节次", "number"),
        CampusUi.f("end", "结束节次", "number"),
        CampusUi.f("weeks", "周次"),
        CampusUi.optional("location", "教室"),
        CampusUi.optional("teacher", "老师"));
  }

  static String signature(JSONObject x) {
    return x.optString("name")
        + "|"
        + x.optInt("day")
        + "|"
        + x.optInt("start")
        + "|"
        + x.optInt("end")
        + "|"
        + weeks(x.optString("weeks"));
  }

  static void confirmReview(CampusActivity a) {
    a.ui.form(
        "确认导入课表",
        CampusJson.obj(
            "week1",
            meta(a.store).optString("week1"),
            "mode",
            "追加（相同课程去重）",
            "times",
            false,
            "learn",
            false,
            "sample",
            false),
        v -> {
          JSONObject m = meta(a.store), draft = a.store.object("draft_ocr_meta");
          CampusJson.put(m, "week1", monday(v.optString("week1")));
          if (v.optBoolean("times")) {
            if (draft.optJSONArray("times") == null || draft.optJSONArray("times").length() == 0)
              throw new IllegalArgumentException("图片中没有识别出作息时段");
            CampusJson.put(m, "times", draft.optJSONArray("times"));
          }
          validateMeta(m);
          JSONArray selected = a.store.list("draft_ocr_courses");
          if (selected.length() == 0) throw new IllegalArgumentException("至少保留一门课程");
          JSONArray all =
              v.optString("mode").startsWith("替换") ? new JSONArray() : a.store.list(COURSES);
          Set<String> existing = new HashSet<>();
          for (JSONObject x : CampusJson.rows(all)) existing.add(signature(x));
          for (JSONObject x : CampusJson.rows(selected)) {
            validate(x, m);
            if (existing.add(signature(x))) all.put(x);
          }
          cloudRows(all, m);
          a.store.batch(
              CampusJson.obj(
                  COURSES,
                  all,
                  META,
                  m,
                  "plg_course-schedule_week1",
                  m.optString("week1"),
                  "native_courses_dirty",
                  true));
          if (v.optBoolean("learn") || v.optBoolean("sample"))
            sendLearning(a, selected, v.optBoolean("learn"), v.optBoolean("sample"));
          a.store.set("draft_ocr_courses", new JSONArray());
          changed(a);
          a.open("courses");
        },
        CampusUi.f("week1", "第一周周一", "date"),
        CampusUi.choice("mode", "导入方式", "追加（相同课程去重）", "替换现有课程"),
        CampusUi.f("times", "采用图片识别的作息", "boolean"),
        CampusUi.f("learn", "将核对文字反馈给纠错服务", "boolean"),
        CampusUi.f("sample", "分享课表图片与核对结果作识别样本", "boolean"));
  }

  static void sendLearning(CampusActivity a, JSONArray selected, boolean learn, boolean sample) {
    JSONArray original = a.store.list("draft_ocr_original"),
        removed = a.store.list("draft_ocr_removed");
    JSONObject ocr = a.store.object("draft_ocr_meta");
    String photo = a.store.string("draft_ocr_photo", "");
    a.background(
        "提交你选择的识别反馈",
        () -> {
          if (learn) {
            JSONArray items = new JSONArray();
            Map<String, JSONObject> originals = new HashMap<>();
            for (JSONObject x : CampusJson.rows(original)) originals.put(x.optString("id"), x);
            for (JSONObject x : CampusJson.rows(selected)) {
              JSONObject was = originals.get(x.optString("id"));
              for (String f : new String[] {"name", "location", "teacher"}) {
                String value = x.optString(f);
                if (was != null && !was.optString(f).isEmpty() && !value.equals(was.optString(f)))
                  items.put(
                      CampusJson.obj("f", f, "w", limit(was.optString(f)), "r", limit(value)));
                if (!value.isEmpty())
                  items.put(CampusJson.obj("f", "vocab_" + f, "w", "", "r", limit(value)));
              }
              if (was != null && !signature(was).equals(signature(x))) {
                if (!was.optString("weeks").equals(x.optString("weeks")))
                  items.put(
                      CampusJson.obj(
                          "f",
                          "weeks",
                          "w",
                          limit(was.optString("weeks")),
                          "r",
                          limit(x.optString("weeks"))));
                String
                    before =
                        was.optInt("day") + ":" + was.optInt("start") + "-" + was.optInt("end"),
                    after = x.optInt("day") + ":" + x.optInt("start") + "-" + x.optInt("end");
                if (!before.equals(after))
                  items.put(CampusJson.obj("f", "pos", "w", before, "r", after));
              }
            }
            for (JSONObject x : CampusJson.rows(removed))
              items.put(CampusJson.obj("f", "junk", "w", limit(x.optString("name")), "r", ""));
            while (items.length() > 300) items.remove(items.length() - 1);
            if (items.length() > 0)
              a.api.rpc("course_learn_submit", CampusJson.obj("items", items));
          }
          if (sample && !photo.isEmpty())
            a.api.rpc(
                "course_ocr_sample_add",
                CampusJson.obj(
                    "img",
                    Base64.encodeToString(
                        CampusPhone.bytes(CampusPhone.file(a, photo), 3500000), Base64.NO_WRAP),
                    "ocr",
                    ocr,
                    "final",
                    cloudRows(selected, meta(a.store))));
          return null;
        },
        r -> a.toast("识别反馈已提交"));
  }

  static String limit(String s) {
    return s.substring(0, Math.min(80, s.length()));
  }

  static String esc(String s) {
    return (s == null ? "" : s)
        .replace("\\", "\\\\")
        .replace("\r", "")
        .replace("\n", "\\n")
        .replace(";", "\\;")
        .replace(",", "\\,");
  }

  static void event(
      StringBuilder b,
      String id,
      String title,
      String day,
      String time,
      String end,
      String location,
      String note) {
    DateMath.parse(day);
    b.append("BEGIN:VEVENT\r\nUID:")
        .append(esc(id))
        .append("@laolao.native\r\nDTSTAMP:")
        .append(
            new SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US) {
              {
                setTimeZone(TimeZone.getTimeZone("UTC"));
              }
            }.format(new Date()))
        .append("\r\n");
    if (time.isEmpty()) {
      b.append("DTSTART;VALUE=DATE:")
          .append(day.replace("-", ""))
          .append("\r\nDTEND;VALUE=DATE:")
          .append(DateMath.plus(day, 1).replace("-", ""))
          .append("\r\n");
    } else {
      DateMath.time(time);
      String t = day.replace("-", "") + "T" + time.replace(":", "") + "00";
      b.append("DTSTART:").append(t).append("\r\n");
      if (!end.isEmpty()) {
        DateMath.time(end);
        b.append("DTEND:")
            .append(day.replace("-", "") + "T" + end.replace(":", "") + "00")
            .append("\r\n");
      } else b.append("DURATION:PT1H\r\n");
    }
    b.append("SUMMARY:")
        .append(esc(title))
        .append("\r\nLOCATION:")
        .append(esc(location))
        .append("\r\nDESCRIPTION:")
        .append(esc(note))
        .append("\r\nEND:VEVENT\r\n");
  }

  static String ics(CampusActivity a, boolean onlyCourses) {
    StringBuilder b =
        new StringBuilder(
            "BEGIN:VCALENDAR\r\n"
                + "VERSION:2.0\r\n"
                + "PRODID:-//Laolao//Campus Native//ZH\r\n"
                + "CALSCALE:GREGORIAN\r\n");
    if (!onlyCourses)
      for (JSONObject x : a.items())
        try {
          String value = x.optString("event_time"), d = CampusJson.date(value);
          if (d.isEmpty() || a.done(x)) continue;
          String t = value.length() >= 16 ? value.substring(11, 16) : "";
          event(
              b,
              x.optString("_key"),
              x.optString("subject"),
              d,
              t,
              "",
              x.optString("location"),
              x.optString("summary") + " " + x.optString("prepare"));
        } catch (Exception ignored) {
        }
    if (onlyCourses || meta(a.store).optBoolean("ics", true)) {
      String first = meta(a.store).optString("week1");
      for (int i = 0; i < 210; i++) {
        String day = DateMath.plus(first, i);
        for (JSONObject c : onDay(a.store, day))
          event(
              b,
              c.optString("id") + "-" + day,
              c.optString("name"),
              day,
              c.optString("t0"),
              c.optString("t1"),
              c.optString("location"),
              c.optString("teacher"));
      }
    }
    b.append("END:VCALENDAR\r\n");
    return fold(b.toString());
  }

  static String fold(String text) {
    StringBuilder out = new StringBuilder();
    for (String line : text.split("\r\n")) {
      int count = 0;
      for (int at = 0; at < line.length(); ) {
        int cp = line.codePointAt(at);
        String ch = new String(Character.toChars(cp));
        int n = ch.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        if (count + n > 73) {
          out.append("\r\n ");
          count = 1;
        }
        out.append(ch);
        count += n;
        at += Character.charCount(cp);
      }
      out.append("\r\n");
    }
    return out.toString();
  }

  static final class Grid extends View {
    final CampusActivity a;
    final int week;
    final Paint p = new Paint(3);
    final List<JSONObject> hit = new ArrayList<>();
    final List<RectF> boxes = new ArrayList<>();

    Grid(CampusActivity a, int w) {
      super(a);
      this.a = a;
      week = w;
      setContentDescription("第" + w + "周课程网格；下方课程清单可编辑");
    }

    protected void onDraw(Canvas c) {
      super.onDraw(c);
      CampusUi u = a.ui;
      float density = getResources().getDisplayMetrics().density,
          header = 34 * density,
          margin = 25 * density,
          col = (getWidth() - margin) / 7,
          row = (getHeight() - header) / meta(a.store).optJSONArray("times").length();
      p.setColor(u.surface);
      c.drawRoundRect(0, 0, getWidth(), getHeight(), u.dp(15), u.dp(15), p);
      p.setTextSize(10 * density);
      p.setColor(u.muted);
      for (int d = 0; d < 7; d++)
        c.drawText("一二三四五六日".substring(d, d + 1), margin + col * (d + .4f), 22 * density, p);
      for (int i = 1; i <= meta(a.store).optJSONArray("times").length(); i++) {
        p.setColor(u.muted);
        c.drawText(String.valueOf(i), 7 * density, header + (i - .5f) * row, p);
        p.setColor(u.border);
        c.drawLine(margin, header + i * row, getWidth(), header + i * row, p);
      }
      hit.clear();
      boxes.clear();
      for (JSONObject x : CampusJson.rows(a.store.list(COURSES)))
        try {
          if (!weeks(x.optString("weeks")).contains(week)) continue;
          RectF r =
              new RectF(
                  margin + col * x.optInt("day") + 2 * density,
                  header + row * (x.optInt("start") - 1) + 2 * density,
                  margin + col * (x.optInt("day") + 1) - 2 * density,
                  header + row * x.optInt("end") - 2 * density);
          float[] hsv = {
            Math.floorMod(x.optString("name").hashCode(), 360),
            a.dark ? .46f : .14f,
            a.dark ? .4f : 1
          };
          p.setColor(Color.HSVToColor(hsv));
          c.drawRoundRect(r, 5 * density, 5 * density, p);
          p.setColor(u.ink);
          p.setTextSize(9 * density);
          String title = x.optString("name");
          float y = r.top + 15 * density;
          for (int at = 0; at < title.length() && y < r.bottom - 4 * density; ) {
            int take =
                p.breakText(title.substring(at), true, Math.max(4, r.width() - 8 * density), null);
            if (take == 0) break;
            c.drawText(title.substring(at, at + take), r.left + 4 * density, y, p);
            at += take;
            y += 13 * density;
          }
          hit.add(x);
          boxes.add(r);
        } catch (Exception ignored) {
        }
    }

    public boolean onTouchEvent(android.view.MotionEvent e) {
      if (e.getAction() == android.view.MotionEvent.ACTION_UP) {
        for (int i = boxes.size() - 1; i >= 0; i--)
          if (boxes.get(i).contains(e.getX(), e.getY())) {
            performClick();
            detail(a, hit.get(i));
            return true;
          }
      }
      return true;
    }

    public boolean performClick() {
      return super.performClick();
    }
  }
}
