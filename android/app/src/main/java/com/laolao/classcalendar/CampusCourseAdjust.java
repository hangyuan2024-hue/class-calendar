package com.laolao.classcalendar;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Native editing and the existing courses_sync p_meta.adj cloud contract from courses.js. */
final class CampusCourseAdjust {
    static final String KEY = "personal_course_schedule_adjust_v1";

    private CampusCourseAdjust() {}

    static JSONArray adjustments(CampusStore store) {
        Object local = store.get(KEY, null);
        if (local instanceof JSONArray) return store.list(KEY);
        JSONArray fromMeta = CampusCourses.meta(store).optJSONArray("adj");
        return fromMeta == null ? new JSONArray() : CampusJson.arr(fromMeta);
    }

    static List<JSONObject> apply(CampusStore store, String day, List<JSONObject> baseCourses) {
        List<JSONObject> result =
                CourseAdjustmentRules.apply(
                        store.list(CampusCourses.COURSES),
                        CampusCourses.meta(store),
                        adjustments(store),
                        day,
                        baseCourses);
        for (JSONObject row : result) CampusJson.put(row, "date", day);
        return result;
    }

    /** Also usable by a new native UI before the established onDay dispatch is wired to apply(). */
    static List<JSONObject> onDay(CampusStore store, String day) {
        return apply(
                store,
                day,
                CourseAdjustmentRules.baseOn(
                        store.list(CampusCourses.COURSES), CampusCourses.meta(store), day));
    }

    static JSONObject cloudMeta(CampusStore store) {
        JSONObject meta = CampusCourses.meta(store);
        CampusJson.put(
                meta,
                "adj",
                CourseAdjustmentRules.clean(
                        adjustments(store), CampusJson.arr(meta.opt("times")).length()));
        return meta;
    }

    /** Preserve unsent local edits and don't erase rules when an older server omits meta.adj. */
    static void acceptCloud(CampusStore store, JSONObject response) {
        if (store.bool("native_courses_dirty", false)) return;
        JSONObject remote = response.optJSONObject("meta");
        if (remote == null || !remote.has("adj")) return;
        if (!(remote.opt("adj") instanceof JSONArray))
            throw new IllegalArgumentException("云端调课记录格式无效");
        JSONObject meta = CampusCourses.meta(store);
        JSONArray rows =
                CourseAdjustmentRules.clean(
                        remote.optJSONArray("adj"), CampusJson.arr(meta.opt("times")).length());
        CampusJson.put(meta, "adj", rows);
        store.batch(CampusJson.obj(KEY, rows, CampusCourses.META, meta));
    }

    static String dayNote(CampusStore store, String day) {
        int added = 0, cancelled = 0;
        String from = "", off = "";
        boolean isOff = false;
        for (JSONObject row : CampusJson.rows(adjustments(store))) {
            if (!day.equals(row.optString("date"))) continue;
            switch (row.optString("type")) {
                case "off":
                    isOff = true;
                    if (off.isEmpty()) off = row.optString("note", "放假 / 停课");
                    break;
                case "swap":
                    if (from.isEmpty()) from = row.optString("from");
                    break;
                case "add":
                    added++;
                    break;
                case "cancel":
                    cancelled++;
                    break;
            }
        }
        if (isOff) return off.isEmpty() ? "放假 / 停课" : off;
        List<String> notes = new ArrayList<>();
        if (!from.isEmpty()) notes.add("上 " + from + " 的课");
        if (cancelled > 0) notes.add("停 " + cancelled + " 节");
        if (added > 0) notes.add("加 " + added + " 节");
        return CampusJson.join("，", notes);
    }

    static String summary(CampusActivity a, JSONObject course) {
        if (course.optBoolean("_add")) return "临时加课";
        if (!course.optString("_from").isEmpty()) return "调课自 " + course.optString("_from");
        return dayNote(a.store, course.optString("date", a.selectedDay));
    }

    static void open(CampusActivity a) {
        open(a, null);
    }

    static void open(CampusActivity a, JSONObject course) {
        a.ui.choose(
                "调课 / 调休",
                new String[] {
                    "换课 / 调休",
                    "整天放假 / 停课",
                    "停一门课",
                    "临时加课",
                    "查看已记下的 " + adjustments(a.store).length() + " 条调整",
                    "同步课程与调课"
                },
                index -> {
                    switch (index) {
                        case 0:
                            form(a, "swap", course);
                            break;
                        case 1:
                            form(a, "off", course);
                            break;
                        case 2:
                            form(a, "cancel", course);
                            break;
                        case 3:
                            form(a, "add", course);
                            break;
                        case 4:
                            list(a);
                            break;
                        case 5:
                            sync(a);
                            break;
                    }
                });
    }

    private static String defaultDate(CampusActivity a, JSONObject course) {
        String date = course == null ? "" : course.optString("date");
        if (date.isEmpty()) date = a.selectedDay;
        try {
            DateMath.parse(date);
            return date;
        } catch (IllegalArgumentException ignored) {
            return DateMath.today();
        }
    }

    private static void form(CampusActivity a, String type, JSONObject course) {
        JSONObject initial =
                CampusJson.obj(
                        "date",
                        defaultDate(a, course),
                        "type",
                        type,
                        "name",
                        course == null ? "" : course.optString("name"),
                        "start",
                        course == null ? 1 : course.optInt("start", 1),
                        "end",
                        course == null ? 2 : course.optInt("end", 2),
                        "location",
                        course == null ? "" : course.optString("location"),
                        "teacher",
                        course == null ? "" : course.optString("teacher"),
                        "source_off",
                        true);
        if (type.equals("swap")) {
            a.ui.form(
                    "换课 / 调休",
                    initial,
                    value -> {
                        String date = value.optString("date"), from = value.optString("from");
                        DateMath.parse(date);
                        DateMath.parse(from);
                        if (date.equals(from)) throw new IllegalArgumentException("两个日期不能相同");
                        JSONArray result = new JSONArray();
                        boolean sourceAlreadyOff = false;
                        for (JSONObject row : CampusJson.rows(adjustments(a.store))) {
                            if (row.optString("date").equals(date)
                                    && (row.optString("type").equals("swap")
                                            || row.optString("type").equals("off"))) continue;
                            if (row.optString("date").equals(from)
                                    && row.optString("type").equals("off")) sourceAlreadyOff = true;
                            result.put(row);
                        }
                        result.put(
                                CampusJson.obj(
                                        "id",
                                        CampusJson.id(),
                                        "date",
                                        date,
                                        "type",
                                        "swap",
                                        "from",
                                        from));
                        if (value.optBoolean("source_off") && !sourceAlreadyOff)
                            result.put(
                                    CampusJson.obj(
                                            "id",
                                            CampusJson.id(),
                                            "date",
                                            from,
                                            "type",
                                            "off",
                                            "note",
                                            "课挪到 " + date));
                        save(a, result);
                    },
                    CampusUi.f("date", "哪天上课", "date"),
                    CampusUi.f("from", "上哪天的课", "date"),
                    CampusUi.f("source_off", "被挪走课程的那天放假", "boolean"));
        } else if (type.equals("off")) {
            a.ui.form(
                    "放假 / 整天停课",
                    initial,
                    value -> {
                        String first = value.optString("date"),
                                last = value.optString("until", first);
                        if (last.isEmpty()) last = first;
                        DateMath.parse(first);
                        DateMath.parse(last);
                        long days =
                                (DateMath.parse(last).getTime() - DateMath.parse(first).getTime())
                                                / 86400000L
                                        + 1;
                        if (days < 1 || days > 60)
                            throw new IllegalArgumentException("放假范围为1—60天，结束日期不能更早");
                        JSONArray result = adjustments(a.store);
                        for (int offset = 0; offset < days; offset++) {
                            String date = DateMath.plus(first, offset);
                            boolean found = false;
                            for (JSONObject row : CampusJson.rows(result))
                                if (date.equals(row.optString("date"))
                                        && row.optString("type").equals("off")) found = true;
                            if (!found)
                                result.put(
                                        CampusJson.obj(
                                                "id",
                                                CampusJson.id(),
                                                "date",
                                                date,
                                                "type",
                                                "off",
                                                "note",
                                                value.optString("note")));
                        }
                        save(a, result);
                    },
                    CampusUi.f("date", "开始日期", "date"),
                    new CampusUi.Field("until", "结束日期（一天可留空）", "date", false),
                    CampusUi.optional("note", "说明，例如运动会停课"));
        } else {
            List<CampusUi.Field> fields = new ArrayList<>();
            fields.add(CampusUi.f("date", "日期", "date"));
            fields.add(CampusUi.f("name", "课程名称"));
            fields.add(CampusUi.f("start", "开始节次", "number"));
            if (type.equals("add")) {
                fields.add(CampusUi.f("end", "结束节次", "number"));
                fields.add(CampusUi.optional("location", "教室"));
                fields.add(CampusUi.optional("teacher", "老师"));
            }
            fields.add(CampusUi.optional("note", "调整说明"));
            a.ui.form(
                    type.equals("add") ? "临时加课" : "停一门课",
                    initial,
                    value -> {
                        CampusJson.put(value, "type", type);
                        CampusJson.put(value, "id", CampusJson.id());
                        JSONArray result = adjustments(a.store);
                        result.put(value);
                        save(a, result);
                    },
                    fields.toArray(new CampusUi.Field[0]));
        }
    }

    static void save(CampusActivity a, JSONArray raw) {
        JSONObject meta = CampusCourses.meta(a.store);
        JSONArray clean =
                CourseAdjustmentRules.clean(raw, CampusJson.arr(meta.opt("times")).length());
        CampusJson.put(meta, "adj", clean);
        a.store.batch(
                CampusJson.obj(KEY, clean, CampusCourses.META, meta, "native_courses_dirty", true));
        CampusCourses.changed(a);
        a.toast("调课已保存，首页、日历和手机提醒会一起更新");
        if (a.api.logged() && !a.store.bool("native_sync_local", false)) sync(a);
    }

    static void sync(CampusActivity a) {
        if (!a.requireLogin()) return;
        final CampusStore target = a.store;
        final JSONArray courses = target.list(CampusCourses.COURSES);
        final JSONObject meta = cloudMeta(target);
        final String signature = courses.toString() + meta.toString();
        a.background(
                "同步课程与调课",
                () ->
                        a.api.rpc(
                                "courses_sync",
                                CampusJson.obj(
                                        "p_courses",
                                        CampusCourses.cloudRows(courses, meta),
                                        "p_meta",
                                        meta)),
                response -> {
                    if ((target.list(CampusCourses.COURSES).toString() + cloudMeta(target))
                            .equals(signature)) target.set("native_courses_dirty", false);
                    target.set("native_course_adjust_synced_at", System.currentTimeMillis());
                    a.toast("课程和调课已同步");
                    a.build();
                });
    }

    private static String describe(JSONObject row) {
        switch (row.optString("type")) {
            case "swap":
                return "上 " + row.optString("from") + " 的课";
            case "off":
                return row.optString("note").isEmpty()
                        ? "放假 / 停课"
                        : "放假 · " + row.optString("note");
            case "cancel":
                return "停课 · "
                        + row.optString("name")
                        + (row.optInt("start") == 0 ? "" : " · 第" + row.optInt("start") + "节");
            default:
                return "加课 · "
                        + row.optString("name")
                        + " · 第"
                        + row.optInt("start")
                        + "—"
                        + row.optInt("end")
                        + "节";
        }
    }

    private static void list(CampusActivity a) {
        List<JSONObject> rows = CampusJson.rows(adjustments(a.store));
        if (rows.isEmpty()) {
            a.toast("还没有临时调课，添加后会显示在这里");
            return;
        }
        List<String> options = new ArrayList<>();
        for (JSONObject row : rows) options.add(row.optString("date") + " · " + describe(row));
        a.ui.choose(
                "已记下的调课",
                options.toArray(new String[0]),
                index -> {
                    JSONObject chosen = rows.get(index);
                    a.ui.confirm(
                            "删除这条调课？",
                            chosen.optString("date") + " · " + describe(chosen),
                            () -> {
                                JSONArray result = new JSONArray();
                                for (JSONObject row : CampusJson.rows(adjustments(a.store)))
                                    if (!row.optString("id").equals(chosen.optString("id")))
                                        result.put(row);
                                save(a, result);
                            });
                });
    }
}
