package com.laolao.classcalendar;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.List;
import java.util.TimeZone;

/** The website's date-specific swap/off/cancel/add algorithm, also used by native reminders. */
final class CourseAdjustmentRules {
    private CourseAdjustmentRules() {}

    static JSONArray clean(JSONArray input, int periods) {
        if (input.length() > 200) throw new IllegalArgumentException("调课记录最多200条");
        if (periods < 1 || periods > 16) throw new IllegalArgumentException("作息应包含1—16节课");
        List<JSONObject> result = new ArrayList<>();
        for (int i = 0; i < input.length(); i++) {
            JSONObject x = input.optJSONObject(i);
            if (x == null) throw new IllegalArgumentException("调课记录格式无效");
            String date = x.optString("date"), type = x.optString("type");
            DateMath.parse(date);
            if (!java.util.Arrays.asList("swap", "off", "cancel", "add").contains(type))
                throw new IllegalArgumentException("不支持的调课类型");
            JSONObject out =
                    CampusJson.obj(
                            "id",
                            CampusCourses.limit(x.optString("id", CampusJson.id()), 40),
                            "date",
                            date,
                            "type",
                            type,
                            "note",
                            CampusCourses.limit(x.optString("note"), 60));
            if (out.optString("id").isEmpty()) CampusJson.put(out, "id", CampusJson.id());
            if (type.equals("swap")) {
                String from = x.optString("from");
                DateMath.parse(from);
                if (from.equals(date)) throw new IllegalArgumentException("调课的两个日期不能相同");
                CampusJson.put(out, "from", from);
            }
            if (type.equals("add") || type.equals("cancel")) {
                String name = x.optString("name").trim();
                if (name.isEmpty()) throw new IllegalArgumentException("请填写课程名称");
                CampusJson.put(out, "name", CampusCourses.limit(name, 60));
            }
            if (type.equals("add") || type.equals("cancel") && x.optInt("start") != 0) {
                int start = x.optInt("start"), end = x.optInt("end", start);
                if (start < 1 || start > periods || end < start || end > periods)
                    throw new IllegalArgumentException("调课节次超出当前作息范围");
                CampusJson.put(out, "start", start);
                if (type.equals("add")) {
                    CampusJson.put(out, "end", end);
                    CampusJson.put(
                            out, "location", CampusCourses.limit(x.optString("location"), 60));
                    CampusJson.put(out, "teacher", CampusCourses.limit(x.optString("teacher"), 40));
                }
            }
            result.add(out);
        }
        result.sort(Comparator.comparing(x -> x.optString("date")));
        return new JSONArray(result);
    }

    static List<JSONObject> baseOn(JSONArray courses, JSONObject meta, String day) {
        DateMath.parse(day);
        String week1 = meta.optString("week1");
        DateMath.parse(week1);
        int week =
                (int)
                                Math.floorDiv(
                                        DateMath.parse(day).getTime()
                                                - DateMath.parse(week1).getTime(),
                                        7L * 86400000L)
                        + 1;
        List<JSONObject> result = new ArrayList<>();
        if (week < 1 || week > 30) return result;
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.setTime(DateMath.parse(day));
        int weekday = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        JSONArray times = meta.optJSONArray("times");
        if (times == null) return result;
        for (JSONObject course : CampusJson.rows(courses)) {
            try {
                if (course.optInt("day", -1) != weekday
                        || !CampusCourses.weeks(course.optString("weeks")).contains(week)) continue;
                CampusCourses.validate(course, meta);
                JSONObject copy = CampusJson.copy(course);
                applyTimes(copy, times);
                CampusJson.put(copy, "week", week);
                result.add(copy);
            } catch (IllegalArgumentException ignored) {
                // The established native schedule also omits malformed imported rows.
            }
        }
        result.sort(Comparator.comparingInt(x -> x.optInt("start")));
        return result;
    }

    static List<JSONObject> apply(
            JSONArray courses,
            JSONObject meta,
            JSONArray adjustments,
            String day,
            List<JSONObject> base) {
        List<JSONObject> on = new ArrayList<>(), result = new ArrayList<>();
        for (JSONObject item : CampusJson.rows(adjustments))
            if (day.equals(item.optString("date"))) on.add(item);
        boolean off = false;
        JSONObject swap = null;
        for (JSONObject item : on) {
            if (item.optString("type").equals("off")) off = true;
            if (swap == null && item.optString("type").equals("swap")) swap = item;
        }
        if (!off) {
            if (swap == null) for (JSONObject course : base) result.add(CampusJson.copy(course));
            else
                for (JSONObject course : baseOn(courses, meta, swap.optString("from"))) {
                    CampusJson.put(course, "_from", swap.optString("from"));
                    result.add(course);
                }
        }
        for (JSONObject item : on)
            if (item.optString("type").equals("cancel"))
                result.removeIf(
                        course ->
                                course.optString("name").equals(item.optString("name"))
                                        && (item.optInt("start") == 0
                                                || course.optInt("start") == item.optInt("start")));
        JSONArray times = meta.optJSONArray("times");
        for (JSONObject item : on)
            if (item.optString("type").equals("add")) {
                JSONObject course = CampusJson.copy(item);
                CampusJson.put(course, "id", "adj_" + item.optString("id"));
                CampusJson.put(course, "_add", true);
                CampusJson.put(course, "_adjustment_id", item.optString("id"));
                applyTimes(course, times);
                result.add(course);
            }
        result.sort(Comparator.comparingInt(x -> x.optInt("start")));
        return result;
    }

    private static void applyTimes(JSONObject course, JSONArray times) {
        String[] start = times.optString(course.optInt("start") - 1).split("-", -1);
        String[] end = times.optString(course.optInt("end") - 1).split("-", -1);
        CampusJson.put(course, "t0", start.length == 2 ? start[0] : "");
        CampusJson.put(course, "t1", end.length == 2 ? end[1] : "");
    }
}
