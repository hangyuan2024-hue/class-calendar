package com.laolao.classcalendar;

import org.json.JSONArray;
import org.json.JSONObject;

/** Calendar-day retention rules matching extras.js, without Android or network dependencies. */
final class CampusExtraRules {
    private CampusExtraRules() {}

    static String expiry(String eventDay, String keep, boolean enabled) {
        if (!enabled || eventDay == null || eventDay.isEmpty()) return "";
        String base = DateMath.plus(eventDay, 14);
        if (keep == null || keep.isEmpty()) return base;
        DateMath.parse(keep);
        return keep.compareTo(base) > 0 ? keep : base;
    }

    static int daysLeft(String expiry, String today) {
        return (int)
                ((DateMath.parse(expiry).getTime() - DateMath.parse(today).getTime()) / 86400000L);
    }

    static String postpone(String expiry, String today) {
        DateMath.parse(today);
        if (expiry == null || expiry.isEmpty()) expiry = today;
        DateMath.parse(expiry);
        return DateMath.plus(expiry.compareTo(today) > 0 ? expiry : today, 3);
    }

    static String eventDay(JSONObject item) {
        String value = item.optString("event_time");
        if (value.length() < 10 || item.optBoolean("_plugin") || item.has("_study"))
            return "";
        String day = value.substring(0, 10);
        try {
            DateMath.parse(day);
            return day;
        } catch (IllegalArgumentException ignored) {
            return "";
        }
    }

    /**
     * The first encounter grants old records a full three days and never shortens an existing keep.
     */
    static JSONArray grantGrace(JSONArray records, String today, boolean enabled) {
        JSONArray result = new JSONArray();
        String grace = DateMath.plus(today, 3);
        for (JSONObject item : CampusJson.rows(records)) {
            JSONObject copy = CampusJson.copy(item);
            String expiry = expiry(eventDay(copy), copy.optString("keep"), enabled);
            if (!expiry.isEmpty() && expiry.compareTo(grace) < 0)
                CampusJson.put(copy, "keep", grace);
            result.put(copy);
        }
        return result;
    }

    static boolean expired(JSONObject item, String today, boolean enabled) {
        String expiry = expiry(eventDay(item), item.optString("keep"), enabled);
        return !expiry.isEmpty() && expiry.compareTo(today) < 0;
    }
}
