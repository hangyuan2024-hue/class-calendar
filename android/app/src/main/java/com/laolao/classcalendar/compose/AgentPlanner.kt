package com.laolao.classcalendar

/** Deterministic study suggestions grounded in actual records, without altering them. */
internal data class BusyInterval(val start: Int, val end: Int)

internal data class StudyTarget(val title: String, val deadline: Int = 22 * 60)

internal data class StudyBlock(val title: String, val start: Int, val end: Int)

internal object AgentPlanner {
    fun minute(time: String): Int? {
        val parts = time.split(':')
        if (parts.size != 2) return null
        val hour = parts[0].toIntOrNull() ?: return null
        val min = parts[1].toIntOrNull() ?: return null
        return if (hour in 0..23 && min in 0..59) hour * 60 + min else null
    }

    fun clock(minute: Int) = "%02d:%02d".format(minute / 60, minute % 60)

    fun plan(
        now: Int,
        busy: List<BusyInterval>,
        targets: List<StudyTarget>,
        duration: Int = 25,
        end: Int = 22 * 60,
    ): List<StudyBlock> {
        require(duration > 0)
        val occupied = busy.filter { it.end > it.start }.sortedBy { it.start }
        var cursor = maxOf(8 * 60, ((now + 4) / 5) * 5)
        val result = mutableListOf<StudyBlock>()
        for (target in targets.take(3)) {
            val limit = minOf(end, target.deadline)
            for (slot in occupied) {
                if (slot.end <= cursor) continue
                if (cursor + duration <= slot.start) break
                cursor = maxOf(cursor, slot.end + 5)
            }
            if (cursor + duration > limit) continue
            result.add(StudyBlock(target.title, cursor, cursor + duration))
            cursor += duration + 5
        }
        return result
    }
}
