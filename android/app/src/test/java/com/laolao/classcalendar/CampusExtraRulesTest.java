package com.laolao.classcalendar;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CampusExtraRulesTest {
    @Test
    public void numericStudyAssessmentIdentifiersAreNeverCalendarDeletionCandidates() {
        JSONObject assessment = CampusJson.obj("event_time", "2026-09-01", "_study", 42L);
        assertEquals("", CampusExtraRules.eventDay(assessment));
        assertFalse(CampusExtraRules.expired(assessment, "2026-10-11", true));
        assertFalse(CampusExtraRules.grantGrace(new JSONArray().put(assessment), "2026-10-11", true)
            .optJSONObject(0).has("keep"));
    }
    @Test
    public void expiresAfterTheDatePassesNotOnTheLastRetainedDay() {
        JSONObject item = CampusJson.obj("id", "old", "event_time", "2026-10-14 23:50");
        assertEquals("2026-10-28", CampusExtraRules.expiry("2026-10-14", "", true));
        assertEquals(0, CampusExtraRules.daysLeft("2026-10-28", "2026-10-28"));
        assertFalse(CampusExtraRules.expired(item, "2026-10-28", true));
        assertTrue(CampusExtraRules.expired(item, "2026-10-29", true));
        assertFalse(CampusExtraRules.expired(item, "2026-11-20", false));
    }

    @Test
    public void postponeUsesLaterOfDeadlineAndTodayAndAccumulates() {
        assertEquals("2026-11-04", CampusExtraRules.postpone("2026-10-28", "2026-11-01"));
        assertEquals("2026-11-08", CampusExtraRules.postpone("2026-11-05", "2026-11-01"));
        assertEquals("2026-11-11", CampusExtraRules.postpone("2026-11-08", "2026-11-01"));
        assertEquals("2026-11-04", CampusExtraRules.postpone("", "2026-11-01"));
    }

    @Test
    public void firstRunGraceDoesNotPurgeOrShortenExistingKeeps() {
        JSONArray input =
                new JSONArray()
                        .put(CampusJson.obj("id", "old", "event_time", "2026-09-01"))
                        .put(
                                CampusJson.obj(
                                        "id",
                                        "kept",
                                        "event_time",
                                        "2026-09-01",
                                        "keep",
                                        "2027-01-01"))
                        .put(CampusJson.obj("id", "undated", "event_time", ""))
                        .put(
                                CampusJson.obj(
                                        "id", "study", "event_time", "2026-09-01", "_study", true));
        JSONArray output = CampusExtraRules.grantGrace(input, "2026-10-11", true);
        assertEquals(4, output.length());
        assertEquals("2026-10-14", output.optJSONObject(0).optString("keep"));
        assertEquals("2027-01-01", output.optJSONObject(1).optString("keep"));
        assertFalse(output.optJSONObject(2).has("keep"));
        assertFalse(output.optJSONObject(3).has("keep"));
        assertFalse(input.optJSONObject(0).has("keep"));
    }

    @Test
    public void unknownDatesAndDisabledCleanupLeaveRecordsAlone() {
        JSONObject badDate = CampusJson.obj("event_time", "2026-02-30");
        assertEquals("", CampusExtraRules.eventDay(badDate));
        assertFalse(CampusExtraRules.expired(badDate, "2026-10-11", true));
        JSONArray disabled =
                CampusExtraRules.grantGrace(
                        new JSONArray().put(CampusJson.obj("event_time", "2026-01-01")),
                        "2026-10-11",
                        false);
        assertFalse(disabled.optJSONObject(0).has("keep"));
        assertEquals("2028-03-13", CampusExtraRules.expiry("2028-02-28", "", true));
    }
}
