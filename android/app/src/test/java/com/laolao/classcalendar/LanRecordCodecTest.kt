package com.laolao.classcalendar

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class LanRecordCodecTest {
    private fun event(id: String, title: String, local: Boolean = true) =
        CampusJson.obj("id", id, "subject", title, "event_time", "2026-10-11 09:00", "local", local)

    @Test
    fun cloudModeExcludesCloudRecordsAndAllCredentials() {
        val data =
            CampusJson.obj(
                "personal_events_v1",
                JSONArray(listOf(event("local", "本机事项"), event("cloud", "云端事项", false))),
                "profile_v1",
                CampusJson.obj("name", "同学"),
                "session",
                CampusJson.obj("access_token", "never-send"),
                "native_location",
                CampusJson.obj("lat", 1),
                "cache_me",
                CampusJson.obj("name", "cache"),
            )
        val cloud = LanRecordCodec.scan(data, JSONObject(), false, 1000)
        assertEquals(1, cloud.count)
        assertEquals(1, cloud.snapshot.length())
        assertEquals("local", cloud.snapshot.getJSONObject(0).getString("r"))
        val local = LanRecordCodec.scan(data, JSONObject(), true, 1000)
        assertEquals(3, local.snapshot.length())
        assertFalse(local.snapshot.toString().contains("access_token"))
        assertFalse(local.snapshot.toString().contains("native_location"))
        assertFalse(local.snapshot.toString().contains("cache_me"))
    }

    @Test
    fun webPaletteObjectAndMap2HaveExactWireShape() {
        val data =
            CampusJson.obj(
                "ui_palette_v1",
                CampusJson.obj("id", "ocean", "p", "#5059CC", "s", "#D8DFFF"),
                "habit_log_v1",
                CampusJson.obj("habit-1", CampusJson.obj("2026-10-11", true)),
            )
        val scan = LanRecordCodec.scan(data, JSONObject(), true, 1000)
        assertEquals(2, scan.count)
        val rows = (0 until scan.snapshot.length()).map { scan.snapshot.getJSONObject(it) }
        assertEquals("_", rows.single { it.getString("k") == "ui_palette_v1" }.getString("r"))
        assertEquals(
            "habit-1\u00012026-10-11",
            rows.single { it.getString("k") == "habit_log_v1" }.getString("r"),
        )
        assertEquals(
            "#5059CC",
            rows.single { it.getString("k") == "ui_palette_v1" }.getJSONObject("v").getString("p"),
        )
    }

    @Test
    fun laterRecordWinsAndARepeatedHelloIsIdempotent() {
        val data = CampusJson.obj("personal_events_v1", JSONArray(listOf(event("one", "旧记录"))))
        val first = LanRecordCodec.scan(data, JSONObject(), false, 1000)
        val incoming =
            JSONArray(
                listOf(
                    LanRecordCodec.row("personal_events_v1", "one", event("one", "网页的新记录"), 2000)
                )
            )
        val merged = LanRecordCodec.merge(data, first.meta, incoming, false, 2001)
        assertEquals(1, merged.accepted)
        assertEquals(
            "网页的新记录",
            merged.updates.getJSONArray("personal_events_v1").getJSONObject(0).getString("subject"),
        )
        val again = LanRecordCodec.merge(merged.updates, merged.meta, incoming, false, 3000)
        assertEquals(0, again.accepted)
        assertEquals(0, again.updates.length())
        assertEquals(0, again.localDelta.length())
    }

    @Test
    fun receivingCloudModeMarksIncomingWebLocalRecordsWithoutReplacingCloudCollision() {
        val data =
            CampusJson.obj("personal_events_v1", JSONArray(listOf(event("same", "自己的云端记录", false))))
        val incoming =
            JSONArray(
                listOf(
                    LanRecordCodec.row("personal_events_v1", "same", event("same", "冲突"), 2000),
                    LanRecordCodec.row(
                        "personal_events_v1",
                        "other",
                        event("other", "网页本机记录", false),
                        2000,
                    ),
                )
            )
        val merged = LanRecordCodec.merge(data, JSONObject(), incoming, false, 2001)
        assertEquals(1, merged.accepted)
        assertEquals(1, merged.conflicts)
        val rows = merged.updates.getJSONArray("personal_events_v1")
        assertEquals("自己的云端记录", rows.getJSONObject(0).getString("subject"))
        assertFalse(rows.getJSONObject(0).getBoolean("local"))
        assertTrue(rows.getJSONObject(1).getBoolean("local"))
    }

    @Test
    fun localEditRacingReceiveIsProtectedAndStillAvailableToBroadcast() {
        val before = CampusJson.obj("personal_events_v1", JSONArray(listOf(event("one", "原始"))))
        val first = LanRecordCodec.scan(before, JSONObject(), false, 1000)
        val changed = CampusJson.obj("personal_events_v1", JSONArray(listOf(event("one", "手机刚改过"))))
        val incoming =
            JSONArray(
                listOf(LanRecordCodec.row("personal_events_v1", "one", event("one", "网页旧值"), 1500))
            )
        val merged = LanRecordCodec.merge(changed, first.meta, incoming, false, 2000)
        assertEquals(0, merged.accepted)
        assertEquals(1, merged.localDelta.length())
        assertEquals(
            "手机刚改过",
            merged.localDelta.getJSONObject(0).getJSONObject("v").getString("subject"),
        )
        assertEquals(
            2000L,
            merged.meta.getJSONObject("t").getJSONObject("personal_events_v1").getLong("one"),
        )
    }

    @Test
    fun deletionTombstonePreventsAStalePeerFromResurrectingRecord() {
        val data = CampusJson.obj("personal_events_v1", JSONArray(listOf(event("one", "待删除"))))
        val first = LanRecordCodec.scan(data, JSONObject(), false, 1000)
        val empty = CampusJson.obj("personal_events_v1", JSONArray())
        val deleted = LanRecordCodec.scan(empty, first.meta, false, 2000)
        assertTrue(deleted.delta.getJSONObject(0).isNull("v"))
        val stale =
            JSONArray(
                listOf(LanRecordCodec.row("personal_events_v1", "one", event("one", "旧设备"), 1500))
            )
        val merged = LanRecordCodec.merge(empty, deleted.meta, stale, false, 3000)
        assertEquals(0, merged.accepted)
        assertEquals(
            "-",
            merged.meta.getJSONObject("h").getJSONObject("personal_events_v1").getString("one"),
        )
    }

    @Test
    fun map2DeletionOnlyRemovesOneDateAndPreservesSiblingAndOtherNamespace() {
        val data =
            CampusJson.obj(
                "habit_log_v1",
                CampusJson.obj("habit", CampusJson.obj("2026-10-10", true, "2026-10-11", true)),
                "mood_log_v1",
                CampusJson.obj("2026-10-11", 3),
            )
        val first = LanRecordCodec.scan(data, JSONObject(), true, 1000)
        val incoming =
            JSONArray(
                listOf(LanRecordCodec.row("habit_log_v1", "habit\u00012026-10-10", null, 2000))
            )
        val merged = LanRecordCodec.merge(data, first.meta, incoming, true, 2001)
        val remaining = merged.updates.getJSONObject("habit_log_v1").getJSONObject("habit")
        assertFalse(remaining.has("2026-10-10"))
        assertTrue(remaining.getBoolean("2026-10-11"))
        assertFalse(merged.updates.has("mood_log_v1"))
    }

    @Test
    fun unknownNativeNamespaceNestedCredentialsPrototypeAndFutureClockAreRejected() {
        val incoming =
            JSONArray(
                listOf(
                    LanRecordCodec.row("native_location", "lat", 99, 1000),
                    LanRecordCodec.row(
                        "session",
                        "_",
                        CampusJson.obj("access_token", "never-send"),
                        1000,
                    ),
                    LanRecordCodec.row(
                        "profile_v1",
                        "_",
                        CampusJson.obj("name", "同学", "access_token", "never-send"),
                        1000,
                    ),
                    LanRecordCodec.row(
                        "personal_marks_v1",
                        "__proto__",
                        CampusJson.obj("x", true),
                        1000,
                    ),
                    LanRecordCodec.row(
                        "personal_events_v1",
                        "future",
                        event("future", "未来"),
                        400000,
                    ),
                    LanRecordCodec.row(
                        "personal_events_v1",
                        "wrong-id",
                        event("other-id", "编号不一致"),
                        1000,
                    ),
                )
            )
        val merged = LanRecordCodec.merge(JSONObject(), JSONObject(), incoming, false, 2000)
        assertEquals(0, merged.accepted)
        assertEquals(3, merged.conflicts)
        assertEquals(0, merged.updates.length())
    }

    @Test
    fun formerlySafeRecordNeverLeaksNewlyAddedCredentialOnSnapshot() {
        val before = CampusJson.obj("profile_v1", CampusJson.obj("name", "同学"))
        val first = LanRecordCodec.scan(before, JSONObject(), true, 1000)
        val after =
            CampusJson.obj("profile_v1", CampusJson.obj("name", "同学", "password", "never-send"))
        val scan = LanRecordCodec.scan(after, first.meta, true, 2000)
        assertEquals(0, scan.snapshot.length())
        assertEquals(0, scan.delta.length())
    }

    @Test
    fun largeUtf16MessageUsesWebsiteChunksAndReassemblesOutOfOrderWithEmoji() {
        val value = event("large", "中文🌟".repeat(25000))
        val message =
            LanRecordCodec.envelope(
                "hello",
                JSONArray(listOf(LanRecordCodec.row("personal_events_v1", "large", value, 1000))),
            )
        val packets = LanRecordCodec.encode(message)
        assertTrue(packets.size > 1)
        val decoder = LanRecordCodec.Decoder()
        var completed: JSONObject? = null
        packets.reversed().forEach { packet ->
            val chunk = JSONObject(packet)
            assertTrue(chunk.getString("d").length <= 60000)
            completed = decoder.accept(packet, 1000) ?: completed
        }
        assertEquals(
            value.getString("subject"),
            completed!!
                .getJSONArray("list")
                .getJSONObject(0)
                .getJSONObject("v")
                .getString("subject"),
        )
    }

    @Test
    fun duplicateChunksAreIdempotentButMismatchedCountsAndExpiredPartialMessagesFailSafely() {
        val decoder = LanRecordCodec.Decoder()
        val first = CampusJson.obj("chunk", "web123", "i", 0, "n", 2, "d", "{\"type\":\"hello\",")
        assertNull(decoder.accept(first.toString(), 1000))
        assertNull(decoder.accept(first.toString(), 1001))
        assertThrows(IllegalArgumentException::class.java) {
            decoder.accept(
                CampusJson.obj("chunk", "web123", "i", 1, "n", 3, "d", "x").toString(),
                1002,
            )
        }
        decoder.expire(32000)
        assertNull(
            decoder.accept(
                CampusJson.obj("chunk", "web123", "i", 1, "n", 2, "d", "\"list\":[]}").toString(),
                32001,
            )
        )
        val message = decoder.accept(first.toString(), 32002)
        assertEquals("hello", message!!.getString("type"))
        assertThrows(IllegalArgumentException::class.java) {
            decoder.accept("{\"format\":\"laolao-native-v4\",\"schema\":4,\"data\":{}}", 40000)
        }
    }

    @Test
    fun desktopCountdownRoundTripPreservesNativeGoalsAndRepresentsDeletionInOneCollection() {
        val native =
            CampusJson.obj(
                "id",
                "exam",
                "title",
                "期末考试",
                "date",
                "2026-12-20",
                "time",
                "10:00",
                "goals",
                JSONArray(listOf(CampusJson.obj("text", "复习", "done", true))),
            )
        val outbound = NativeLanRecordAdapter.mergeExams(JSONArray(), JSONArray(listOf(native)))
        assertTrue(outbound.getJSONObject(0).getBoolean("local"))
        val webEdit =
            CampusJson.obj(
                "id",
                "exam",
                "title",
                "网页改过的考试",
                "date",
                "2026-12-21",
                "emoji",
                "📝",
                "local",
                true,
            )
        val imported =
            NativeLanRecordAdapter.nativeExams(
                JSONArray(listOf(webEdit)),
                JSONArray(listOf(native)),
            )
        assertEquals("10:00", imported.getJSONObject(0).getString("time"))
        assertTrue(
            imported.getJSONObject(0).getJSONArray("goals").getJSONObject(0).getBoolean("done")
        )
        assertEquals("网页改过的考试", imported.getJSONObject(0).getString("title"))
        assertEquals(0, NativeLanRecordAdapter.nativeExams(JSONArray(), imported).length())
        assertEquals(0, NativeLanRecordAdapter.mergeExams(JSONArray(), JSONArray()).length())
    }

    @Test
    fun fnvHashMatchesWebsiteUtf16OverflowGoldenValues() {
        assertEquals("ztntfp0", LanRecordCodec.hash(""))
        assertEquals("m3bicr5", LanRecordCodec.hash("hello"))
    }

    @Test
    fun sdpAcceptsDataOnlyHostIceAndRejectsRelaysAndMedia() {
        assertTrue(
            NativeLanController.safeSdp(
                "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 udp 1 192.168.1.2 5555 typ host\r\n"
            )
        )
        assertFalse(
            NativeLanController.safeSdp(
                "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 udp 1 192.168.1.2 5555 typ relay\r\n"
            )
        )
        assertFalse(NativeLanController.safeSdp("v=0\r\nm=audio 9 RTP/AVP 0\r\n"))
    }
}
