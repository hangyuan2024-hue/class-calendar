package com.laolao.classcalendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent it) { try { CampusPlanner.restore(c); String owner=c.getSharedPreferences("campus_active_scope",0).getString("owner","guest"); CampusStore s=new CampusStore(c,owner); CampusPhone.scheduleReminders(c,s); CampusDndReceiver.scheduleNext(c,s); CampusWidget.updateAll(c); } catch (Exception ignored) { } }
}
