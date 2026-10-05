package com.laolao.classcalendar;

import android.content.*;

public class CampusPlannerReceiver extends BroadcastReceiver {
  public void onReceive(Context c, Intent i) {
    String owner = i.getStringExtra("owner");
    if (owner != null) CampusPlanner.settle(c, new CampusStore(c, owner));
  }
}
