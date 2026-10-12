package com.laolao.classcalendar;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class MindMapDocumentTest {
  @Test public void markdownHierarchyRoundTripsWithoutFlattening() throws Exception {
    JSONObject map = MindMapDocument.parseText("# 高数\n## 极限\n- 连续\n- 洛必达\n## 导数\n- 链式法则\n");
    JSONObject root = map.getJSONObject("root");
    assertEquals("高数", root.getString("text"));
    assertEquals(2, root.getJSONArray("children").length());
    assertEquals(2, root.getJSONArray("children").getJSONObject(0).getJSONArray("children").length());
    JSONObject again = MindMapDocument.parseText(MindMapDocument.toMarkdown(root));
    assertEquals(6, MindMapDocument.count(again.getJSONObject("root")));
  }

  @Test public void movingIntoOwnDescendantDoesNotModifyTree() throws Exception {
    JSONObject child = MindMapDocument.node("章节", MindMapDocument.node("例题"));
    JSONObject map = CampusJson.obj("root", MindMapDocument.node("课程", child));
    String before = map.toString();
    try {
      MindMapDocument.move(map, child.getString("id"), child.getJSONArray("children").getJSONObject(0).getString("id"), 0);
      fail("Cycle must be rejected");
    } catch (IllegalArgumentException expected) {}
    assertEquals(before, map.toString());
  }

  @Test public void freshImportRegeneratesDocumentAndNodeIds() throws Exception {
    JSONObject source = MindMapDocument.newMap("course", "线代");
    JSONObject imported = MindMapDocument.normalize(source, true);
    assertNotEquals(source.getString("id"), imported.getString("id"));
    assertNotEquals(source.getJSONObject("root").getString("id"), imported.getJSONObject("root").getString("id"));
    assertEquals(MindMapDocument.count(source.getJSONObject("root")), MindMapDocument.count(imported.getJSONObject("root")));
  }

  @Test public void duplicateIdentifiersAndExcessiveDepthAreRejected() throws Exception {
    JSONObject root = MindMapDocument.node("A"), child = MindMapDocument.node("B");
    child.put("id", root.getString("id")); root.getJSONArray("children").put(child);
    assertThrows(IllegalArgumentException.class, () -> MindMapDocument.normalize(CampusJson.obj("root", root), false));
    JSONObject deep = MindMapDocument.node("底"), cursor = deep;
    for (int i = 0; i < 50; i++) {
      JSONObject next = MindMapDocument.node("层"); cursor.getJSONArray("children").put(next); cursor = next;
    }
    JSONObject input = CampusJson.obj("root", deep);
    assertThrows(IllegalArgumentException.class, () -> MindMapDocument.normalize(input, true));
  }

  @Test public void linksRejectExecutableAndCredentialBearingSchemes() throws Exception {
    assertEquals("", MindMapDocument.safeUrl("javascript:alert(1)"));
    assertEquals("", MindMapDocument.safeUrl("https://user:pass@example.com"));
    assertEquals("https://example.com/course", MindMapDocument.safeUrl("example.com/course"));
  }

  @Test public void saveAcknowledgementCannotEraseNewerLocalEditsOrDeletion() throws Exception {
    JSONObject current = CampusJson.obj("id", "a", "edit", 9, "dirty", true, "deleted", true);
    JSONObject acknowledged = MindMapSyncRules.acknowledge(current, 8, 42);
    assertTrue(acknowledged.getBoolean("dirty"));
    assertTrue(acknowledged.getBoolean("deleted"));
    assertEquals(42, acknowledged.getLong("version"));
  }

  @Test public void remoteIndexPreservesUnsyncedMapsAndPendingDeletes() throws Exception {
    JSONArray local = new JSONArray().put(CampusJson.obj("id", "offline", "local", true, "dirty", true))
        .put(CampusJson.obj("id", "removed", "local", false, "dirty", true, "deleted", true))
        .put(CampusJson.obj("id", "old", "local", false, "dirty", false));
    JSONArray merged = MindMapSyncRules.merge(local, new JSONArray().put(CampusJson.obj("id", "remote", "version", 7, "title", "网页课程图")));
    assertEquals(3, merged.length());
    assertEquals("offline", merged.getJSONObject(0).getString("id"));
    assertTrue(merged.getJSONObject(1).getBoolean("deleted"));
    assertEquals(7, merged.getJSONObject(2).getLong("server"));
  }
}
