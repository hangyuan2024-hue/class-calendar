package com.laolao.classcalendar;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class CourseAdjustmentRulesTest {
    private JSONObject meta() {
        return CampusJson.obj(
                "week1",
                "2026-09-14",
                "times",
                new JSONArray(
                        Arrays.asList(
                                "08:00-08:50",
                                "09:00-09:50",
                                "10:10-11:00",
                                "11:10-12:00",
                                "14:00-14:50",
                                "15:00-15:50")));
    }

    private JSONObject course(String id, String name, int start, String weeks) {
        return CampusJson.obj(
                "id",
                id,
                "name",
                name,
                "day",
                2,
                "start",
                start,
                "end",
                start + 1,
                "weeks",
                weeks,
                "location",
                "教学楼D400");
    }

    @Test
    public void swapUsesSourceDateWeekParityAndDoesNotRecursivelyFollowItsHoliday() {
        JSONArray courses = new JSONArray().put(course("math", "高等数学", 1, "2-16双"));
        JSONArray adjustments =
                new JSONArray()
                        .put(
                                CampusJson.obj(
                                        "id",
                                        "swap",
                                        "type",
                                        "swap",
                                        "date",
                                        "2026-10-10",
                                        "from",
                                        "2026-10-07"))
                        .put(CampusJson.obj("id", "off", "type", "off", "date", "2026-10-07"));
        List<JSONObject> result =
                CourseAdjustmentRules.apply(
                        courses,
                        meta(),
                        adjustments,
                        "2026-10-10",
                        java.util.Collections.emptyList());
        assertEquals(1, result.size());
        assertEquals("高等数学", result.get(0).optString("name"));
        assertEquals("08:00", result.get(0).optString("t0"));
        assertEquals("09:50", result.get(0).optString("t1"));
        assertEquals("2026-10-07", result.get(0).optString("_from"));
        assertFalse(courses.optJSONObject(0).has("t0"));
        assertTrue(CourseAdjustmentRules.baseOn(courses, meta(), "2026-10-14").isEmpty());
    }

    @Test
    public void offWinsSwapButExplicitAddedCourseStillExistsLikeWebsite() {
        JSONArray adjustments =
                new JSONArray()
                        .put(
                                CampusJson.obj(
                                        "id",
                                        "s",
                                        "date",
                                        "2026-10-10",
                                        "type",
                                        "swap",
                                        "from",
                                        "2026-10-07"))
                        .put(CampusJson.obj("id", "o", "date", "2026-10-10", "type", "off"))
                        .put(
                                CampusJson.obj(
                                        "id",
                                        "a",
                                        "date",
                                        "2026-10-10",
                                        "type",
                                        "add",
                                        "name",
                                        "补习课",
                                        "start",
                                        3,
                                        "end",
                                        4));
        JSONArray courses = new JSONArray().put(course("m", "高等数学", 1, "1-16"));
        List<JSONObject> result =
                CourseAdjustmentRules.apply(
                        courses,
                        meta(),
                        adjustments,
                        "2026-10-10",
                        java.util.Collections.emptyList());
        assertEquals(1, result.size());
        assertEquals("adj_a", result.get(0).optString("id"));
        assertTrue(result.get(0).optBoolean("_add"));
        assertEquals("10:10", result.get(0).optString("t0"));
        assertEquals("12:00", result.get(0).optString("t1"));
    }

    @Test
    public void cancelMatchesBothNameAndOptionalStartingPeriod() {
        JSONArray courses =
                new JSONArray()
                        .put(course("first", "数学", 1, "1-16"))
                        .put(course("later", "数学", 3, "1-16"))
                        .put(course("physics", "物理", 5, "1-16"));
        String date = "2026-10-07";
        List<JSONObject> base = CourseAdjustmentRules.baseOn(courses, meta(), date);
        JSONArray one =
                new JSONArray()
                        .put(
                                CampusJson.obj(
                                        "id", "c", "type", "cancel", "date", date, "name", "数学",
                                        "start", 1));
        List<JSONObject> result = CourseAdjustmentRules.apply(courses, meta(), one, date, base);
        assertEquals(2, result.size());
        assertEquals("later", result.get(0).optString("id"));
        JSONArray allNamed =
                new JSONArray()
                        .put(
                                CampusJson.obj(
                                        "id", "c", "type", "cancel", "date", date, "name", "数学"));
        result = CourseAdjustmentRules.apply(courses, meta(), allNamed, date, base);
        assertEquals(1, result.size());
        assertEquals("physics", result.get(0).optString("id"));
        assertEquals(3, base.size());
    }

    @Test
    public void invalidAdjustmentsCannotEnterSchedule() {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        CourseAdjustmentRules.clean(
                                new JSONArray()
                                        .put(
                                                CampusJson.obj(
                                                        "date",
                                                        "2026-10-11",
                                                        "type",
                                                        "swap",
                                                        "from",
                                                        "2026-10-11")),
                                6));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        CourseAdjustmentRules.clean(
                                new JSONArray()
                                        .put(CampusJson.obj("date", "2026-02-30", "type", "off")),
                                6));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        CourseAdjustmentRules.clean(
                                new JSONArray()
                                        .put(
                                                CampusJson.obj(
                                                        "date",
                                                        "2026-10-11",
                                                        "type",
                                                        "add",
                                                        "name",
                                                        "补课",
                                                        "start",
                                                        6,
                                                        "end",
                                                        7)),
                                6));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        CourseAdjustmentRules.clean(
                                new JSONArray()
                                        .put(
                                                CampusJson.obj(
                                                        "date",
                                                        "2026-10-11",
                                                        "type",
                                                        "unsupported")),
                                6));
    }
}
