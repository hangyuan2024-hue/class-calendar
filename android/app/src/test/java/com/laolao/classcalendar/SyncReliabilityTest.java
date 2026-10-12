package com.laolao.classcalendar;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;

public class SyncReliabilityTest {
  @Test public void logicalStampNeverMovesBackwards() { assertEquals(101,SyncReliability.stamp(50,100)); assertEquals(200,SyncReliability.stamp(200,100)); }
  @Test public void editsDuringUploadRemainPending() {
    JSONObject sent=CampusJson.obj("t",5,"v","old"), current=CampusJson.obj("t",6,"v","new");
    assertFalse(SyncReliability.acknowledged(current,sent));
    assertTrue(SyncReliability.acknowledged(sent,sent));
    assertFalse(SyncReliability.acknowledged(CampusJson.obj("t",5,"v","new"),sent));
  }
  @Test public void emptyValidPageAccepted() { assertEquals(7,SyncReliability.pull(CampusJson.obj("rows",new JSONArray(),"rev",7,"more",false),7).optLong("rev")); }
  @Test(expected=IllegalStateException.class) public void missingRowsCannotAdvanceCursor() { SyncReliability.pull(CampusJson.obj("rev",10),1); }
  @Test(expected=IllegalStateException.class) public void backwardsCursorRejected() { SyncReliability.pull(CampusJson.obj("rows",new JSONArray(),"rev",1),3); }
  @Test(expected=IllegalStateException.class) public void stalledPaginationRejected() { SyncReliability.pull(CampusJson.obj("rows",new JSONArray(),"rev",3,"more",true),3); }
  @Test(expected=IllegalStateException.class) public void missingValueCannotDeleteRecord() { SyncReliability.pull(CampusJson.obj("rows",new JSONArray().put(CampusJson.obj("ns","x","k","a","t",5)),"rev",6),1); }
  @Test public void tombstoneIsExplicitlyValid() { SyncReliability.pull(CampusJson.obj("rows",new JSONArray().put(CampusJson.obj("ns","x","k","a","t",5,"v",null)),"rev",6),1); }
  @Test public void serverClockWinsOverIncorrectWallClock() { SyncReliability.calibrate(1800000000000L,0); assertTrue(Math.abs(SyncReliability.now()-1800000000000L)<1000); }
  @Test public void beijingEventTimeIgnoresPhoneTimeZone() { java.util.TimeZone old=java.util.TimeZone.getDefault(); try { java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("America/Los_Angeles")); assertEquals(0L,CampusJson.at("1970-01-01","08:00")); } finally { java.util.TimeZone.setDefault(old); } }
}