package com.laolao.classcalendar;
import org.json.*;
public class BackupCheck {
  static void reject(JSONObject d) throws Exception {
    try { NativeData.backup(d.toString()); throw new AssertionError("invalid backup accepted"); }
    catch (IllegalArgumentException expected) { }
  }
  public static void main(String[] args) throws Exception {
    JSONObject source = NativeData.empty();
    JSONObject task = new JSONObject().put("id","native-backup-test").put("type","task").put("title","A real task").put("date","2026-10-05").put("priority",2).put("done",false);
    source.getJSONArray("items").put(task);
    NativeData.backup(source.toString());
    JSONObject d = new JSONObject(source.toString()); d.getJSONArray("items").getJSONObject(0).put("id","x\" onclick=\"bad"); reject(d);
    d = new JSONObject(source.toString()); d.getJSONArray("items").getJSONObject(0).put("date","2026-02-31"); reject(d);
    d = new JSONObject(source.toString()); d.getJSONArray("items").getJSONObject(0).put("priority",1.5); reject(d);
    d = new JSONObject(source.toString()); d.getJSONArray("items").put(new JSONObject(task.toString())); reject(d);
    d = new JSONObject(source.toString()); d.put("budget",-1); reject(d);
    d = new JSONObject(source.toString()); d.getJSONArray("logs").put(new JSONObject().put("day","2026-10-05").put("kind","review").put("n",-1)); reject(d);
    d = new JSONObject(source.toString()); d.getJSONArray("items").put(new JSONObject().put("id","card1").put("type","card").put("title","Q").put("answer","A").put("date","2026-10-05").put("level",1.5)); reject(d);
    System.out.println("PASS native backup: valid record + 7 invalid record cases");
  }
}
