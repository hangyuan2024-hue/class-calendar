package com.laolao.classcalendar
import org.junit.Assert.*
import org.junit.Test
class QuickActionModelTest {
    @Test fun calendarHasCourseCreationAndImport() { assertEquals(listOf("course","import","task","reminder"),quickActionIds("calendar")) }
    @Test fun classHasSpaceActionsNotCourseActions() { assertEquals(listOf("create","join"),quickActionIds("class")) }
    @Test fun inboxPrioritizesTask() { assertEquals("task",quickActionIds("homework").first()) }
    @Test fun settingsHasBackup() { assertTrue(quickActionIds("settings").contains("backup")) }
}