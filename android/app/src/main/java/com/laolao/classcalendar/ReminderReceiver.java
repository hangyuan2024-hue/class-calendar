package com.laolao.classcalendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent it) {
        String id = it.getStringExtra("id");
        Reminders.show(c, id == null ? 0 : id.hashCode(), it.getStringExtra("title"), it.getStringExtra("body"), it.getStringExtra("go"));
    }
}
