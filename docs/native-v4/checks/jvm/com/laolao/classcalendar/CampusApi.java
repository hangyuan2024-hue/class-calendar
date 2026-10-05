package com.laolao.classcalendar;

import org.json.JSONObject;

/** Injects deterministic server responses without registering or modifying a real account. */
final class CampusApi {
  interface Handler { Object call(String name, JSONObject args) throws Exception; }
  final String owner;
  final Handler handler;
  CampusApi(String owner, Handler handler) { this.owner = owner; this.handler = handler; }
  String uid() { return owner; }
  Object rpc(String name, JSONObject args) throws Exception { return handler.call(name, args); }
}
