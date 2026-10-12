package com.laolao.classcalendar

/** Page context changes commands, never authorization. */
internal fun quickActionIds(route: String): List<String> = when(route) {
    "calendar", "courses" -> listOf("course","import","task","reminder")
    "homework" -> listOf("task","paste","reminder","pomo")
    "class", "wall", "people", "members", "groups" -> listOf("create","join")
    "me", "settings", "appearance", "backup" -> listOf("appearance","backup","reminder","tools")
    "tools", "phone" -> listOf("tools","pomo","paste","reminder")
    "reminders" -> listOf("reminder","task")
    else -> listOf("task","paste","pomo","habit")
}