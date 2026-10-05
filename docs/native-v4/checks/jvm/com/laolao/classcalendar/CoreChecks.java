package com.laolao.classcalendar;

import android.content.Context;
import java.util.*;
import org.json.*;

public final class CoreChecks {
  static final List<String> passed = new ArrayList<>();

  static void check(String name, boolean ok) {
    if (!ok) throw new AssertionError(name);
    passed.add(name);
  }

  interface Task {
    void run() throws Exception;
  }

  static void rejects(String name, Task task) throws Exception {
    boolean rejected = false;
    try {
      task.run();
    } catch (IllegalArgumentException | JSONException | IllegalStateException e) {
      rejected = true;
    }
    check(name, rejected);
  }

  static CampusStore fresh(String owner) {
    return new CampusStore(new Context(UUID.randomUUID().toString()), owner);
  }

  static JSONObject course(String id, String weeks, int start, int end) {
    return CampusJson.obj(
        "id", id, "name", "高等数学", "day", 0, "weeks", weeks, "start", start, "end", end);
  }

  static JSONObject meta() {
    return CampusJson.obj(
        "week1",
        "2026-09-14",
        "times",
        new JSONArray(Arrays.asList(CampusCourses.SUMMER)),
        "ics",
        true);
  }

  static JSONObject pull(JSONArray rows) {
    return CampusJson.obj("rev", 1, "rows", rows, "more", false);
  }

  public static void main(String[] args) throws Exception {
    check("Leap-day arithmetic", DateMath.plus("2024-02-28", 1).equals("2024-02-29"));
    check("Year-boundary arithmetic", DateMath.plus("2026-12-31", 1).equals("2027-01-01"));
    rejects("Invalid calendar date rejected", () -> DateMath.parse("2026-02-29"));
    rejects("Invalid time rejected", () -> DateMath.time("24:00"));
    check(
        "UTC arithmetic remains correct across timezone changes",
        DateMath.plus("2026-03-08", 1).equals("2026-03-09"));
    rejects("Malformed event timestamp rejected", () -> CampusJson.eventTime("2026-01-01 99:00"));
    check("Money uses decimal cents", CampusLearn.cents("0.29") == 29);
    check("Money rounds half up", CampusLearn.cents("12.345") == 1235);
    rejects("Negative money rejected", () -> CampusLearn.cents("-2"));
    rejects("Amounts smaller than a rounded cent rejected", () -> CampusLearn.cents("0.001"));
    check("CSV formula text stays inert", CampusLearn.csv(" \t=SUM(1,2)\nnext").startsWith("\"'"));
    rejects("Unbounded money rejected", () -> CampusLearn.cents("99999999999"));
    check(
        "Odd-week parsing",
        CampusCourses.weeks("1-7单").equals(new TreeSet<>(Arrays.asList(1, 3, 5, 7))));
    check(
        "Even-week parsing",
        CampusCourses.weeks("2-8双").equals(new TreeSet<>(Arrays.asList(2, 4, 6, 8))));
    check(
        "Mixed week parsing",
        CampusCourses.weeks("1-3,5,7-8").equals(new TreeSet<>(Arrays.asList(1, 2, 3, 5, 7, 8))));
    rejects("Week 31 rejected", () -> CampusCourses.weeks("31"));
    CampusStore courses = fresh("guest");
    courses.set(CampusCourses.META, meta());
    courses.set(CampusCourses.COURSES, new JSONArray().put(course("odd", "1-15单", 1, 2)));
    check("First semester week", CampusCourses.week(courses, "2026-09-14") == 1);
    check(
        "Pre-semester dates do not truncate to week one",
        CampusCourses.week(courses, "2026-09-13") == 0);
    check("Odd-week course appears", CampusCourses.onDay(courses, "2026-09-14").size() == 1);
    check("Course absent in even week", CampusCourses.onDay(courses, "2026-09-21").isEmpty());
    JSONArray all = new JSONArray().put(course("one", "1-7单", 1, 2));
    check(
        "Overlapping period conflict detected",
        CampusCourses.conflicts(all, course("two", "1-7单", 2, 3)).size() == 1);
    check(
        "Disjoint weeks do not conflict",
        CampusCourses.conflicts(all, course("two", "2-8双", 1, 2)).isEmpty());
    JSONObject bad = meta();
    CampusJson.put(bad, "week1", "2026-09-15");
    rejects("Non-Monday semester metadata rejected", () -> CampusCourses.validateMeta(bad));
    JSONObject overlap = meta();
    CampusJson.put(overlap, "times", new JSONArray().put("09:00-09:50").put("09:40-10:20"));
    rejects("Overlapping bell times rejected", () -> CampusCourses.validateMeta(overlap));
    check(
        "Cloud payload contains calculated week list",
        CampusCourses.cloudRows(all, meta()).getJSONObject(0).getJSONArray("wl").length() == 4);
    JSONObject longCourse = course("long", "1-20", 1, 2);
    CampusJson.put(longCourse, "name", "校".repeat(80));
    CampusJson.put(longCourse, "teacher", "师".repeat(80));
    JSONObject cloudCourse =
        CampusCourses.cloudRows(new JSONArray().put(longCourse), meta()).getJSONObject(0);
    check(
        "Course sync respects website text limits",
        cloudCourse.getString("name").length() == 60
            && cloudCourse.getString("teacher").length() == 40);
    check(
        "Course text limit preserves Unicode pairs", CampusCourses.limit("abc🎓", 4).equals("abc"));
    CampusStore emptyCourses = fresh("guest");
    CampusCourses.acceptCloud(
        emptyCourses,
        CampusJson.obj(
            "courses",
            new JSONArray(),
            "meta",
            CampusJson.obj("week1", "", "times", new JSONArray())));
    check(
        "New-account empty metadata preserves usable bell times",
        CampusCourses.meta(emptyCourses).getJSONArray("times").length() > 0);
    check(
        "Profile heatmap reads numeric growth points",
        CampusLearn.activityValue(CampusJson.obj("2026-10-05", 30), "2026-10-05") == 30);
    check(
        "Habit heatmap still reads Boolean check-ins",
        CampusLearn.activityValue(CampusJson.obj("2026-10-05", true), "2026-10-05") == 1);
    check(
        "Missing profile heatmap days remain empty",
        CampusLearn.activityValue(new JSONObject(), "2026-10-05") == 0);
    check(
        "Plugin upload rejects missing registration",
        !CampusManage.pluginPreflight(CampusJson.obj("code", "hello()"), "sample").isEmpty());
    check(
        "Plugin upload rejects mismatched ID",
        !CampusManage.pluginPreflight(
                CampusJson.obj("code", "CalendarApp.register({id:'other'})"), "sample")
            .isEmpty());
    check(
        "Plugin upload rejects credential reads",
        !CampusManage.pluginPreflight(
                CampusJson.obj("app_html", "<html>cc_session_v1</html>"), "sample")
            .isEmpty());
    check(
        "Plugin upload accepts matching registration",
        CampusManage.pluginPreflight(
                CampusJson.obj("code", "CalendarApp.register({id:'sample'})"), "sample")
            .isEmpty());
    String text = "SUMMARY:" + "校园课程表🎓".repeat(40) + "\r\n";
    String folded = CampusCourses.fold(text);
    check("ICS folds without damaging Unicode", folded.replace("\r\n ", "").equals(text));
    for (String line : folded.split("\r\n"))
      if (line.getBytes("UTF-8").length > 75) throw new AssertionError("ICS byte-length limit");
    check("ICS uses 75-byte lines", true);
    check(
        "ICS escapes injection characters", CampusCourses.esc("a,b;c\nd").equals("a\\,b\\;c\\nd"));

    Context ctx = new Context(UUID.randomUUID().toString());
    CampusStore a = new CampusStore(ctx, "account-a"),
        b = new CampusStore(ctx, "account-b"),
        same = new CampusStore(ctx, "account-a");
    a.add(
        "personal_events_v1",
        CampusJson.obj(
            "id", "one", "subject", "Native task", "event_time", "2026-10-05", "done", false));
    check("Accounts are isolated", b.list("personal_events_v1").length() == 0);
    check(
        "Page/widget/receiver stores share committed state",
        same.list("personal_events_v1").length() == 1);
    JSONObject detached = a.object("personal_marks_v1");
    CampusJson.put(detached, "bad", true);
    check(
        "Object reads cannot modify committed state", a.object("personal_marks_v1").length() == 0);
    ((JSONArray) a.get("personal_events_v1", null)).getJSONObject(0).put("subject", "UNSAVED");
    check(
        "Raw array reads cannot modify committed state",
        a.list("personal_events_v1").getJSONObject(0).getString("subject").equals("Native task"));
    check("Durable outbox records changes", a.pending() == 1);
    ctx.failCommit = true;
    rejects("Failed storage commit is surfaced", () -> a.set("native_search", "not saved"));
    ctx.failCommit = false;
    check("Failed commit leaves memory unchanged", a.string("native_search", "").isEmpty());
    check(
        "Failed commit leaves other instances unchanged",
        same.string("native_search", "").isEmpty());
    a.set("native_sync_local", true);
    a.entry("plan_notes_v1", "cur", "pdca");
    check("Paused sync retains new modifications", a.pending() == 2);
    final int[] noCalls = {0};
    a.sync(
        new CampusApi(
            "account-a",
            (n, p) -> {
              noCalls[0]++;
              return pull(new JSONArray());
            }));
    check("Local mode does not contact server", noCalls[0] == 0);
    a.set("native_sync_local", false);
    final JSONArray pushed = new JSONArray();
    a.sync(
        new CampusApi(
            "account-a",
            (n, p) -> {
              if (n.equals("udata_push")) {
                for (int i = 0; i < p.getJSONArray("p").length(); i++)
                  pushed.put(p.getJSONArray("p").get(i));
                return true;
              }
              return pull(new JSONArray());
            }));
    check(
        "Queued offline records are pushed and acknowledged",
        pushed.length() == 2 && a.pending() == 0);
    a.replace("personal_events_v1", "one", null);
    final boolean[] tombstone = {false};
    a.sync(
        new CampusApi(
            "account-a",
            (n, p) -> {
              if (n.equals("udata_push")) {
                tombstone[0] = p.getJSONArray("p").getJSONObject(0).isNull("v");
                return true;
              }
              return pull(new JSONArray());
            }));
    check("Deletion creates a durable tombstone", tombstone[0] && a.pending() == 0);

    CampusStore remote = fresh("account-r");
    remote.sync(
        new CampusApi(
            "account-r",
            (n, p) ->
                pull(
                    new JSONArray()
                        .put(
                            CampusJson.obj(
                                "ns",
                                "habit_log_v1",
                                "k",
                                "habit\u00012026-10-05",
                                "v",
                                true,
                                "t",
                                1000)))));
    check(
        "Website nested habit keys are reconstructed",
        remote.object("habit_log_v1").getJSONObject("habit").getBoolean("2026-10-05"));
    remote.sync(
        new CampusApi(
            "account-r",
            (n, p) ->
                pull(
                    new JSONArray()
                        .put(
                            CampusJson.obj(
                                "ns",
                                "habit_log_v1",
                                "k",
                                "habit\u00012026-10-05",
                                "v",
                                null,
                                "t",
                                2000)))));
    check("Cloud tombstones remove nested records", remote.object("habit_log_v1").length() == 0);
    CampusStore newer = fresh("account-n");
    newer.entry("personal_marks_v1", "c42", CampusJson.obj("done", true));
    newer.sync(
        new CampusApi(
            "account-n",
            (n, p) ->
                n.equals("udata_push")
                    ? true
                    : pull(
                        new JSONArray()
                            .put(
                                CampusJson.obj(
                                    "ns",
                                    "personal_marks_v1",
                                    "k",
                                    "c42",
                                    "v",
                                    CampusJson.obj("done", false),
                                    "t",
                                    1)))));
    check(
        "Older cloud edits do not overwrite a newer local change",
        newer.object("personal_marks_v1").getJSONObject("c42").getBoolean("done"));
    CampusStore newerRemote = fresh("account-newer-r");
    newerRemote.entry("personal_marks_v1", "c42", CampusJson.obj("done", true));
    newerRemote.sync(
        new CampusApi(
            "account-newer-r",
            (n, p) -> {
              if (n.equals("udata_push"))
                throw new AssertionError("overwritten event must not be pushed");
              return pull(
                  new JSONArray()
                      .put(
                          CampusJson.obj(
                              "ns",
                              "personal_marks_v1",
                              "k",
                              "c42",
                              "v",
                              CampusJson.obj("done", false),
                              "t",
                              System.currentTimeMillis() + 10000)));
            }));
    check(
        "Newer cloud changes win and cancel stale outbox entries",
        !newerRemote.object("personal_marks_v1").getJSONObject("c42").getBoolean("done")
            && newerRemote.pending() == 0);
    CampusStore ack = fresh("account-ack");
    ack.entry("plan_notes_v1", "cur", "quad");
    final int[] count = {0};
    try {
      ack.sync(
          new CampusApi(
              "account-ack",
              (n, p) -> {
                if (n.equals("udata_pull")) return pull(new JSONArray());
                if (count[0]++ == 0) {
                  ack.entry("plan_notes_v1", "cur", "smart");
                  return true;
                }
                throw new java.io.IOException("offline");
              }));
    } catch (java.io.IOException expected) {
    }
    check(
        "Acknowledging an old request keeps a newer concurrent edit",
        ack.pending() == 1 && ack.object("plan_notes_v1").getString("cur").equals("smart"));
    a.queueGrowth("class-one", "habit", "habit-id|2026-10-05", false);
    a.queueGrowth("class-one", "habit", "habit-id|2026-10-05", true);
    check(
        "Repeated growth updates queue final state only",
        a.object("native_growth_queue").length() == 1);
    a.syncGrowth(
        new CampusApi(
            "account-a",
            (n, p) -> {
              check(
                  "Growth queue uses exact RPC fields",
                  n.equals("growth_log") && p.length() == 4 && p.getBoolean("undo"));
              return true;
            }));
    check(
        "Successful growth delivery removes queued event",
        a.object("native_growth_queue").length() == 0);

    CampusStore backup = fresh("account-backup");
    backup.set("cache_me", CampusJson.obj("private", "not exported"));
    backup.set("native_diary_lock", true);
    backup.set(
        "native_diary",
        CampusJson.obj("2026-10-05", CampusJson.obj("text", "My day", "date", "2026-10-05")));
    backup.add("personal_events_v1", CampusJson.obj("id", "kept", "subject", "Keep me"));
    backup.add(
        "native_focus_sessions",
        CampusJson.obj("id", "focus-backup-check", "day", "2026-10-05", "minutes", 25));
    JSONObject exported = backup.backup();
    check(
        "Backups omit login cache and device controls",
        !exported.getJSONObject("data").has("cache_me")
            && !exported.getJSONObject("data").has("native_diary_lock"));
    CampusStore destination = fresh("account-import");
    destination.add("personal_events_v1", CampusJson.obj("id", "old", "subject", "old"));
    destination.set("native_diary_lock", true);
    destination.restore(exported.toString());
    check(
        "Backup restores real focus-session history",
        destination.list("native_focus_sessions").length() == 1);
    check(
        "Valid backup restores learning records",
        destination.list("personal_events_v1").getJSONObject(0).getString("id").equals("kept")
            && destination.object("native_diary").length() == 1);
    check("Restore preserves device privacy control", destination.bool("native_diary_lock", false));
    check("Restore pauses sync for review", destination.bool("native_sync_local", false));
    JSONObject malformed = CampusJson.copy(exported);
    malformed.getJSONObject("data").put("personal_events_v1", "bad");
    rejects("Wrong record type rejected", () -> destination.restore(malformed.toString()));
    check(
        "Rejected backup does not clear existing data",
        destination.list("personal_events_v1").getJSONObject(0).getString("id").equals("kept"));
    JSONObject duplicate = CampusJson.copy(exported);
    duplicate
        .getJSONObject("data")
        .put(
            "personal_events_v1",
            new JSONArray().put(CampusJson.obj("id", "dup")).put(CampusJson.obj("id", "dup")));
    rejects(
        "Duplicate imported identifiers rejected", () -> destination.restore(duplicate.toString()));
    JSONObject malicious = CampusJson.copy(exported);
    malicious.getJSONObject("data").put("access_token", "abc");
    rejects("Login state cannot be imported", () -> destination.restore(malicious.toString()));
    JSONObject invalidFocus = CampusJson.copy(exported);
    invalidFocus
        .getJSONObject("data")
        .getJSONArray("native_focus_sessions")
        .getJSONObject(0)
        .put("minutes", -1);
    rejects(
        "Malformed focus history cannot be imported",
        () -> destination.restore(invalidFocus.toString()));
    JSONObject wrongStage = CampusJson.copy(exported);
    wrongStage
        .getJSONObject("data")
        .put("plan_notes_v1", CampusJson.obj("pdca:bad", CampusJson.obj("stage", -1)));
    rejects("Unsafe planning state rejected", () -> destination.restore(wrongStage.toString()));
    JSONObject badCourse = CampusJson.copy(exported);
    badCourse.getJSONObject("data").put(CampusCourses.META, meta());
    badCourse
        .getJSONObject("data")
        .put(CampusCourses.COURSES, new JSONArray().put(course("bad", "1-16", 15, 20)));
    rejects(
        "Out-of-range imported course rejected", () -> destination.restore(badCourse.toString()));
    rejects(
        "Wrong backup schema rejected",
        () -> destination.restore("{\"format\":\"laolao-native-v4\",\"schema\":99,\"data\":{}}"));
    CampusStore world = fresh("guest");
    String today = DateMath.today();
    world.entry("done_log_v1", "one", today);
    world.add("habits_v1", CampusJson.obj("id", "h", "name", "read"));
    world.entry(
        "habit_log_v1",
        "h",
        CampusJson.obj(
            today, true, DateMath.plus(today, -1), true, DateMath.plus(today, -2), true));
    world.entry("pomo_log_v1", today, 1);
    world.entry("plan_notes_v1", "smart:g", CampusJson.obj("done", true));
    world.entry("plan_notes_v1", "pdca:g", CampusJson.obj("round", 1, "stage", 3));
    world.entry(
        "plan_notes_v1",
        "ivy:" + today,
        new JSONArray()
            .put(CampusJson.obj("text", "a", "done", true))
            .put(CampusJson.obj("text", "b", "done", true)));
    JSONObject stats = CampusWorld.stats(world);
    check("Metaverse uses original website XP formula", stats.getLong("exp") == 100);
    check(
        "Metaverse level follows quadratic thresholds",
        stats.getInt("level") == 2 && stats.getLong("lo") == 40 && stats.getLong("hi") == 160);
    check(
        "Metaverse streak and daily missions use saved history",
        stats.getInt("bestStreak") == 3
            && stats.getInt("doneToday") == 1
            && stats.getInt("pomosToday") == 1);
    check(
        "Empty account starts with zero XP", CampusWorld.stats(fresh("guest")).getLong("exp") == 0);
    System.out.println(
        new JSONObject()
            .put("passed", passed.size())
            .put("checks", new JSONArray(passed))
            .toString(2));
  }
}
