package com.laolao.classcalendar;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;
import org.webrtc.*;

/** Native WebRTC DataChannel peer for the website's live.js and desktop lan.js protocol. */
final class NativeLanController {
  private static final AtomicBoolean INITIALIZED = new AtomicBoolean();
  private final CampusActivity activity;
  private final ScheduledExecutorService actor = Executors.newSingleThreadScheduledExecutor();
  private final ExecutorService requests = Executors.newSingleThreadExecutor();
  private final Map<String, Peer> peers = new LinkedHashMap<>();
  private final Map<String, String> online = new LinkedHashMap<>();
  private final String device;
  private volatile JSONObject published;
  private volatile boolean destroyed;
  private boolean foreground, pinging, missingRpc;
  private long generation, clockOffset, lastPing, received, sent, receivedAt, sentAt;
  private int failures, localCount, conflicts;
  private String error = "", serverError = "";
  private CampusStore scope;
  private CampusApi api;
  private NativeLanRecordAdapter records;
  private PeerConnectionFactory factory;
  private ScheduledFuture<?> poll, delta;

  private static final class Peer {
    final String device;
    final long generation;
    final LanRecordCodec.Decoder decoder = new LanRecordCodec.Decoder();
    final Deque<String> outbound = new ArrayDeque<>();
    PeerConnection connection;
    DataChannel channel;
    String state = "connecting", kind = "", offerType = "";
    long changedAt = System.currentTimeMillis(), queuedBytes;
    boolean sentHello, signalSent, draining;

    Peer(String device, long generation) {
      this.device = device;
      this.generation = generation;
    }
  }

  NativeLanController(CampusActivity activity) {
    this.activity = activity;
    android.content.SharedPreferences preferences =
        activity.getSharedPreferences("native_lan_device_v1", 0);
    String existing = preferences.getString("device", "");
    if (!validDevice(existing)) {
      existing = "a" + UUID.randomUUID().toString().replace("-", "");
      if (!preferences.edit().putString("device", existing).commit())
        throw new IllegalStateException("无法保存局域网设备编号");
    }
    device = existing;
    published =
        CampusJson.obj(
            "enabled",
            activity.store.bool("native_lan_enabled", false),
            "logged",
            activity.api.logged(),
            "state",
            "off",
            "text",
            "局域网互传已关闭",
            "open",
            0,
            "online",
            0,
            "local",
            0,
            "received",
            0,
            "sent",
            0,
            "peers",
            new JSONArray());
  }

  JSONObject state() {
    return CampusJson.copy(published);
  }

  void start() {
    post(
        () -> {
          foreground = true;
          bindScope();
          missingRpc = false;
          error = serverError = "";
          requestPing();
          publish();
        });
  }

  void stop() {
    post(
        () -> {
          foreground = false;
          generation++;
          pinging = false;
          cancelPoll();
          if (delta != null) delta.cancel(false);
          closeAll();
          publish();
        });
  }

  void destroy() {
    if (destroyed) return;
    destroyed = true;
    actor.execute(
        () -> {
          foreground = false;
          generation++;
          cancelPoll();
          closeAll();
          if (factory != null) factory.dispose();
          factory = null;
        });
    requests.shutdownNow();
    actor.shutdown();
  }

  void setEnabled(boolean enabled) {
    // Persist immediately so a rapid style switch reads the same setting.
    activity.store.set("native_lan_enabled", enabled);
    post(
        () -> {
          bindScope();
          generation++;
          pinging = false;
          missingRpc = false;
          error = serverError = "";
          failures = 0;
          cancelPoll();
          closeAll();
          if (enabled && foreground) requestPing();
          publish();
        });
  }

  /** Used by the retry button and by account changes; does not invent a peer connection. */
  void refresh() {
    post(
        () -> {
          bindScope();
          missingRpc = false;
          error = serverError = "";
          failures = 0;
          requestPing();
          publish();
        });
  }

  void dataChanged() {
    post(
        () -> {
          boolean rebound = bindScope();
          if (!wanted()) {
            closeAll();
            publish();
            return;
          }
          if (rebound) requestPing();
          if (delta != null) delta.cancel(false);
          delta =
              actor.schedule(
                  () -> {
                    if (!wanted()) return;
                    try {
                      LanRecordCodec.Scan scan = records.scan(now());
                      localCount = scan.count;
                      if (scan.delta.length() > 0) {
                        for (Peer peer : new ArrayList<>(peers.values()))
                          if ("open".equals(peer.state))
                            send(peer, LanRecordCodec.envelope("delta", scan.delta));
                      }
                      publish();
                    } catch (Exception e) {
                      setError(e);
                    }
                  },
                  250,
                  TimeUnit.MILLISECONDS);
        });
  }

  private boolean bindScope() {
    CampusStore current = activity.store;
    CampusApi currentApi = activity.api;
    if (scope == current && api == currentApi) return false;
    generation++;
    cancelPoll();
    closeAll();
    pinging = false;
    scope = current;
    api = currentApi;
    records = new NativeLanRecordAdapter(current);
    received = sent = receivedAt = sentAt = clockOffset = lastPing = 0;
    conflicts = failures = 0;
    missingRpc = false;
    error = serverError = "";
    localCount = records.localCount();
    return true;
  }

  private boolean current(CampusStore frozen, CampusApi frozenApi, long token) {
    return !destroyed
        && foreground
        && generation == token
        && scope == frozen
        && activity.store == frozen
        && api == frozenApi
        && activity.api == frozenApi
        && frozenApi.logged()
        && frozen.owner.equals(frozenApi.uid())
        && frozen.bool("native_lan_enabled", false);
  }

  private boolean wanted() {
    return !destroyed
        && foreground
        && scope != null
        && scope == activity.store
        && api == activity.api
        && api.logged()
        && scope.owner.equals(api.uid())
        && scope.bool("native_lan_enabled", false)
        && !missingRpc;
  }

  private void requestPing() {
    cancelPoll();
    bindScope();
    if (!wanted()) {
      closeAll();
      publish();
      return;
    }
    if (pinging) return;
    if (!connected()) {
      serverError = "网络未连接；本地学习记录仍然保留";
      schedule(10000);
      publish();
      return;
    }
    final CampusStore frozen = scope;
    final CampusApi frozenApi = api;
    final long token = generation, began = System.currentTimeMillis();
    localCount = records.localCount();
    String classId = activity.currentClass.optString("id");
    JSONObject args =
        CampusJson.obj(
            "p_dev",
            device,
            "p_cid",
            classId.isEmpty() ? null : CampusJson.numericId(classId),
            "p_lan",
            true,
            "p_kind",
            "phone" + (localCount > 0 || records.localMode() ? "+L" : ""));
    pinging = true;
    requests.execute(
        () -> {
          if (!current(frozen, frozenApi, token)) return;
          try {
            JSONObject response = CampusJson.object(frozenApi.rpc("sync_ping", args));
            long ended = System.currentTimeMillis();
            post(
                () -> {
                  if (!current(frozen, frozenApi, token)) return;
                  pinging = false;
                  failures = 0;
                  serverError = "";
                  long serverNow = response.optLong("now");
                  if (serverNow > 0) {
                    long offset = serverNow - (began + ended) / 2;
                    clockOffset =
                        lastPing == 0 || Math.abs(offset - clockOffset) > 1000
                            ? offset
                            : Math.round(clockOffset * .8 + offset * .2);
                  }
                  lastPing = ended;
                  handlePing(response);
                  schedule(busy() ? 1000 : 3000);
                  publish();
                });
          } catch (Exception e) {
            post(
                () -> {
                  if (!current(frozen, frozenApi, token)) return;
                  pinging = false;
                  failures++;
                  if (e instanceof CampusApi.Failure) {
                    CampusApi.Failure failure = (CampusApi.Failure) e;
                    if (failure.status == 404
                        || failure.status == 401
                        || String.valueOf(failure.getMessage())
                            .matches("(?is).*sync_ping|.*PGRST202|.*Could not find.*"))
                      missingRpc = true;
                  }
                  serverError = missingRpc ? "服务器的局域网信令暂不可用；请保持本地记录，稍后重试" : readable(e);
                  if (missingRpc) closeAll();
                  else schedule(Math.min(60000, 3000L << Math.min(failures, 4)));
                  publish();
                });
          }
        });
  }

  private void handlePing(JSONObject response) {
    online.clear();
    for (JSONObject row : CampusJson.rows(response.opt("peers"))) {
      String remote = row.optString("dev");
      if (validDevice(remote) && !device.equals(remote)) online.put(remote, row.optString("kind"));
    }
    for (JSONObject signal : CampusJson.rows(response.opt("sig"))) {
      String from = signal.optString("from");
      if (online.containsKey(from)) handleSignal(from, signal.optJSONObject("body"));
    }
    for (Map.Entry<String, String> entry : online.entrySet()) {
      Peer peer = peers.get(entry.getKey());
      if (peer != null) peer.kind = entry.getValue();
      boolean needs = localCount > 0 || records.localMode() || entry.getValue().endsWith("+L");
      if (needs
          && device.compareTo(entry.getKey()) < 0
          && (peer == null
              || ("failed".equals(peer.state)
                  && System.currentTimeMillis() - peer.changedAt > 30000)))
        createOffer(entry.getKey(), entry.getValue());
    }
    for (Peer peer : new ArrayList<>(peers.values()))
      if (!online.containsKey(peer.device) && !"open".equals(peer.state)) {
        close(peer);
        peers.remove(peer.device);
      }
  }

  private void createOffer(String remote, String kind) {
    try {
      Peer peer = createPeer(remote, kind);
      DataChannel.Init init = new DataChannel.Init();
      init.ordered = true;
      wire(peer, peer.connection.createDataChannel("cc-lan", init));
      peer.connection.createOffer(
          new DescriptionObserver() {
            @Override
            public void onCreateSuccess(SessionDescription description) {
              post(() -> setLocal(peer, description));
            }

            @Override
            public void onCreateFailure(String reason) {
              post(() -> fail(peer, "设备连接请求未完成，请确认两端在同一 Wi-Fi"));
            }
          },
          new MediaConstraints());
    } catch (Exception e) {
      setError(e);
    }
  }

  private Peer createPeer(String remote, String kind) {
    if (!wanted()) throw new IllegalStateException("局域网连接已暂停");
    Peer previous = peers.remove(remote);
    if (previous != null) close(previous);
    if (factory == null) {
      synchronized (INITIALIZED) {
        if (!INITIALIZED.get()) {
          PeerConnectionFactory.initialize(
              PeerConnectionFactory.InitializationOptions.builder(activity.getApplicationContext())
                  .setEnableInternalTracer(false)
                  .createInitializationOptions());
          INITIALIZED.set(true);
        }
      }
      factory = PeerConnectionFactory.builder().createPeerConnectionFactory();
    }
    Peer peer = new Peer(remote, generation);
    peer.kind = kind;
    PeerConnection.RTCConfiguration configuration =
        new PeerConnection.RTCConfiguration(Collections.emptyList());
    configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
    // Empty ICE servers is intentional: host candidates only; no STUN, TURN, media tracks or relay.
    peer.connection =
        factory.createPeerConnection(
            configuration,
            new PeerConnection.Observer() {
              @Override
              public void onSignalingChange(PeerConnection.SignalingState state) {}

              @Override
              public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
                if (state == PeerConnection.IceConnectionState.FAILED
                    || state == PeerConnection.IceConnectionState.DISCONNECTED
                    || state == PeerConnection.IceConnectionState.CLOSED)
                  post(() -> fail(peer, "未能保持局域网直连；确认同一 Wi-Fi，关闭访客网络隔离后重试"));
              }

              @Override
              public void onIceConnectionReceivingChange(boolean receiving) {}

              @Override
              public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
                if (state == PeerConnection.IceGatheringState.COMPLETE)
                  post(() -> sendDescription(peer));
              }

              @Override
              public void onIceCandidate(IceCandidate candidate) {}

              @Override
              public void onIceCandidatesRemoved(IceCandidate[] candidates) {}

              @Override
              public void onAddStream(MediaStream stream) {}

              @Override
              public void onRemoveStream(MediaStream stream) {}

              @Override
              public void onDataChannel(DataChannel channel) {
                post(() -> wire(peer, channel));
              }

              @Override
              public void onRenegotiationNeeded() {}

              @Override
              public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
            });
    if (peer.connection == null) throw new IllegalStateException("这台设备暂不能建立局域网连接");
    peers.put(remote, peer);
    actor.schedule(
        () -> {
          if (active(peer) && "connecting".equals(peer.state))
            fail(peer, "连接超时；请让两台设备登录同一账号并连接同一 Wi-Fi");
        },
        20,
        TimeUnit.SECONDS);
    return peer;
  }

  private void handleSignal(String remote, JSONObject body) {
    if (body == null || !wanted()) return;
    String type = body.optString("type"), sdp = body.optString("sdp");
    if ((!type.equals("offer") && !type.equals("answer")) || !safeSdp(sdp)) return;
    try {
      if (type.equals("offer")) {
        Peer existing = peers.get(remote);
        if (existing != null && "open".equals(existing.state)) return;
        Peer peer = createPeer(remote, online.get(remote));
        peer.connection.setRemoteDescription(
            new DescriptionObserver() {
              @Override
              public void onSetSuccess() {
                post(
                    () -> {
                      if (!active(peer)) return;
                      peer.connection.createAnswer(
                          new DescriptionObserver() {
                            @Override
                            public void onCreateSuccess(SessionDescription description) {
                              post(() -> setLocal(peer, description));
                            }

                            @Override
                            public void onCreateFailure(String reason) {
                              post(() -> fail(peer, "无法回应设备连接，请重试"));
                            }
                          },
                          new MediaConstraints());
                    });
              }

              @Override
              public void onSetFailure(String reason) {
                post(() -> fail(peer, "对方的连接信息无法使用，请两端重新打开互传"));
              }
            },
            new SessionDescription(SessionDescription.Type.OFFER, sdp));
      } else {
        Peer peer = peers.get(remote);
        if (peer == null
            || !active(peer)
            || peer.connection.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER)
          return;
        peer.connection.setRemoteDescription(
            new DescriptionObserver() {
              @Override
              public void onSetFailure(String reason) {
                post(() -> fail(peer, "对方的连接回应无效，请重试"));
              }
            },
            new SessionDescription(SessionDescription.Type.ANSWER, sdp));
      }
    } catch (Exception e) {
      setError(e);
    }
  }

  private void setLocal(Peer peer, SessionDescription description) {
    if (!active(peer)) return;
    peer.offerType = description.type.canonicalForm();
    peer.connection.setLocalDescription(
        new DescriptionObserver() {
          @Override
          public void onSetSuccess() {
            post(
                () -> {
                  if (!active(peer)) return;
                  if (peer.connection.iceGatheringState()
                      == PeerConnection.IceGatheringState.COMPLETE) sendDescription(peer);
                  else actor.schedule(() -> sendDescription(peer), 3, TimeUnit.SECONDS);
                });
          }

          @Override
          public void onSetFailure(String reason) {
            post(() -> fail(peer, "设备本地连接信息未就绪，请重试"));
          }
        },
        description);
  }

  private void sendDescription(Peer peer) {
    if (!active(peer) || peer.signalSent || peer.offerType.isEmpty()) return;
    SessionDescription description = peer.connection.getLocalDescription();
    if (description == null || !safeSdp(description.description)) return;
    peer.signalSent = true;
    CampusStore frozen = scope;
    CampusApi frozenApi = api;
    long token = generation;
    JSONObject args =
        CampusJson.obj(
            "p_from",
            device,
            "p_to",
            peer.device,
            "p_body",
            CampusJson.obj("type", peer.offerType, "sdp", description.description));
    requests.execute(
        () -> {
          if (!current(frozen, frozenApi, token)) return;
          try {
            frozenApi.rpc("lan_send", args);
            post(
                () -> {
                  if (current(frozen, frozenApi, token)) {
                    schedule(300);
                    publish();
                  }
                });
          } catch (Exception e) {
            post(
                () -> {
                  if (current(frozen, frozenApi, token)) {
                    serverError = readable(e);
                    fail(peer, "连接信息未送达，请重试");
                  }
                });
          }
        });
  }

  private void wire(Peer peer, DataChannel channel) {
    if (!active(peer)) {
      if (channel != null) channel.dispose();
      return;
    }
    if (channel == null || !"cc-lan".equals(channel.label())) {
      if (channel != null) channel.dispose();
      fail(peer, "对方没有打开捞捞局域网互传");
      return;
    }
    if (peer.channel != null && peer.channel != channel) {
      channel.dispose();
      return;
    }
    peer.channel = channel;
    channel.registerObserver(
        new DataChannel.Observer() {
          @Override
          public void onBufferedAmountChange(long previousAmount) {
            post(() -> drain(peer));
          }

          @Override
          public void onStateChange() {
            post(() -> channelChanged(peer));
          }

          @Override
          public void onMessage(DataChannel.Buffer buffer) {
            if (buffer.binary || buffer.data.remaining() > 400000) return;
            byte[] bytes = new byte[buffer.data.remaining()];
            buffer.data.get(bytes);
            String text = new String(bytes, StandardCharsets.UTF_8);
            post(() -> receive(peer, text));
          }
        });
    channelChanged(peer);
  }

  private void channelChanged(Peer peer) {
    if (!active(peer) || peer.channel == null) return;
    DataChannel.State state = peer.channel.state();
    if (state == DataChannel.State.OPEN) {
      peer.state = "open";
      peer.changedAt = System.currentTimeMillis();
      error = "";
      if (!peer.sentHello) {
        peer.sentHello = true;
        try {
          LanRecordCodec.Scan scan = records.scan(now());
          localCount = scan.count;
          send(peer, LanRecordCodec.envelope("hello", scan.snapshot));
        } catch (Exception e) {
          setError(e);
        }
      }
      drain(peer);
    } else if (state == DataChannel.State.CLOSED) fail(peer, "对方已暂停局域网互传");
    publish();
  }

  private void receive(Peer peer, String text) {
    if (!active(peer) || !"open".equals(peer.state)) return;
    try {
      JSONObject message = peer.decoder.accept(text, System.currentTimeMillis());
      if (message == null) return;
      LanRecordCodec.Merge merged = records.apply(message.optJSONArray("list"), now());
      // A receive can race the debounced local scan. Relay that protected edit before it is lost
      // from the next scan's delta; each receiver still resolves it with the same record clock.
      if (merged.localDelta.length() > 0)
        for (Peer connected : new ArrayList<>(peers.values()))
          if ("open".equals(connected.state))
            send(connected, LanRecordCodec.envelope("delta", merged.localDelta));
      conflicts += merged.conflicts;
      if (merged.accepted > 0) {
        received += merged.accepted;
        receivedAt = System.currentTimeMillis();
        localCount = records.localCount();
        final CampusStore appliedScope = scope;
        activity.handler.post(
            () -> {
              if (activity.store == appliedScope
                  && activity.api.logged()
                  && appliedScope.owner.equals(activity.api.uid())) {
                CampusPhone.refresh(activity);
                ComposeEntry.refresh(activity);
              }
            });
      }
      if ("hello".equals(message.optString("type")) && !peer.sentHello) {
        peer.sentHello = true;
        send(peer, LanRecordCodec.envelope("hello", records.scan(now()).snapshot));
      }
      publish();
    } catch (Exception e) {
      setError(e);
    }
  }

  private void send(Peer peer, JSONObject message) {
    if (!active(peer) || peer.channel == null || peer.channel.state() != DataChannel.State.OPEN)
      return;
    List<String> packets = LanRecordCodec.encode(message);
    for (String packet : packets) {
      long size = packet.getBytes(StandardCharsets.UTF_8).length;
      if (peer.queuedBytes + size > 20000000L) {
        fail(peer, "互传队列已满，请稍后重试；本地记录未改变");
        return;
      }
      peer.outbound.add(packet);
      peer.queuedBytes += size;
    }
    int count = CampusJson.arr(message.opt("list")).length();
    if (count > 0) {
      sent += count;
      sentAt = System.currentTimeMillis();
    }
    drain(peer);
  }

  private void drain(Peer peer) {
    if (!active(peer)
        || peer.channel == null
        || peer.channel.state() != DataChannel.State.OPEN
        || peer.draining) return;
    peer.draining = true;
    try {
      while (!peer.outbound.isEmpty() && peer.channel.bufferedAmount() < 1000000L) {
        String text = peer.outbound.peek();
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (!peer.channel.send(new DataChannel.Buffer(ByteBuffer.wrap(bytes), false))) {
          fail(peer, "这次互传尚未发出，请重试；记录仍在本机");
          break;
        }
        peer.outbound.remove();
        peer.queuedBytes -= bytes.length;
      }
    } finally {
      peer.draining = false;
    }
    if (!peer.outbound.isEmpty()) actor.schedule(() -> drain(peer), 50, TimeUnit.MILLISECONDS);
  }

  private boolean active(Peer peer) {
    return wanted()
        && peer.generation == generation
        && peers.get(peer.device) == peer
        && !"failed".equals(peer.state);
  }

  private boolean busy() {
    for (Peer peer : peers.values()) if ("connecting".equals(peer.state)) return true;
    return false;
  }

  private void fail(Peer peer, String message) {
    if (peers.get(peer.device) != peer || "failed".equals(peer.state)) return;
    peer.state = "failed";
    peer.changedAt = System.currentTimeMillis();
    error = message;
    close(peer);
    publish();
  }

  private void close(Peer peer) {
    if (peer.channel != null) {
      peer.channel.unregisterObserver();
      peer.channel.close();
      peer.channel.dispose();
      peer.channel = null;
    }
    if (peer.connection != null) {
      peer.connection.close();
      peer.connection.dispose();
      peer.connection = null;
    }
    peer.decoder.clear();
    peer.outbound.clear();
    peer.queuedBytes = 0;
  }

  private void closeAll() {
    for (Peer peer : peers.values()) close(peer);
    peers.clear();
    online.clear();
  }

  private void cancelPoll() {
    if (poll != null) poll.cancel(false);
    poll = null;
  }

  private void schedule(long milliseconds) {
    cancelPoll();
    if (wanted()) poll = actor.schedule(this::requestPing, milliseconds, TimeUnit.MILLISECONDS);
  }

  private void post(Runnable action) {
    if (!destroyed) {
      try {
        actor.execute(action);
      } catch (RejectedExecutionException ignored) {
      }
    }
  }

  private long now() {
    return System.currentTimeMillis() + clockOffset;
  }

  private boolean connected() {
    try {
      ConnectivityManager manager =
          (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
      NetworkInfo network = manager == null ? null : manager.getActiveNetworkInfo();
      return network != null && network.isConnected();
    } catch (SecurityException ignored) {
      return true;
    }
  }

  private void setError(Exception e) {
    error = readable(e);
    publish();
  }

  private static String readable(Exception e) {
    String text = e.getMessage();
    // Never expose raw auth responses, SDP, device IPs or stored values in the interface/logs.
    if (e instanceof CampusApi.Failure) {
      int status = ((CampusApi.Failure) e).status;
      if (status == 401) return "登录已过期，请重新登录后再互传";
      if (status == 429) return "请求较多，请稍后重试";
      if (status >= 500) return "连接服务暂不可用；本地学习记录仍然保留";
      return "连接服务暂未响应，请稍后重试";
    }
    if (e instanceof IllegalArgumentException && text != null && text.length() < 100) return text;
    return "互传暂未完成，请确认网络后重试；本地学习记录仍然保留";
  }

  private void publish() {
    if (destroyed) return;
    boolean enabled = activity.store.bool("native_lan_enabled", false),
        logged = activity.api.logged();
    int open = 0;
    JSONArray deviceList = new JSONArray();
    for (Peer peer : peers.values()) {
      if ("open".equals(peer.state)) open++;
      deviceList.put(CampusJson.obj("kind", kindName(peer.kind), "state", peer.state));
    }
    String state, text;
    if (!enabled) {
      state = "off";
      text = "局域网互传已关闭";
    } else if (!logged) {
      state = "signin";
      text = "先登录，再与同一账号的网页或电脑互传";
    } else if (!foreground) {
      state = "paused";
      text = "回到 App 后继续寻找设备";
    } else if (missingRpc) {
      state = "unavailable";
      text = serverError;
    } else if (open > 0) {
      state = "connected";
      text = "已直连 " + open + " 台设备，本机学习记录正在互传";
    } else if (!serverError.isEmpty() || !error.isEmpty()) {
      state = "error";
      text = !serverError.isEmpty() ? serverError : error;
    } else if (busy()) {
      state = "connecting";
      text = "正在与同一 Wi-Fi 的设备建立加密直连";
    } else if (localCount == 0 && !records.localMode() && !hasRemoteLocal()) {
      state = "idle";
      text = "还没有需要互传的本机记录，已等待同一账号的设备";
    } else {
      state = "searching";
      text =
          lastPing == 0
              ? "正在查找同一账号的设备"
              : online.isEmpty() ? "等待另一台设备：同一账号、同一 Wi-Fi，并保持两端打开" : "已发现在线设备，正在尝试局域网直连";
    }
    published =
        CampusJson.obj(
            "enabled",
            enabled,
            "logged",
            logged,
            "foreground",
            foreground,
            "state",
            state,
            "text",
            text,
            "open",
            open,
            "online",
            online.size(),
            "local",
            localCount,
            "received",
            received,
            "sent",
            sent,
            "receivedAt",
            receivedAt,
            "sentAt",
            sentAt,
            "lastPing",
            lastPing,
            "conflicts",
            conflicts,
            "clockOff",
            clockOffset,
            "peers",
            deviceList);
    activity.handler.post(
        () -> {
          if (!destroyed && !activity.isFinishing()) ComposeEntry.refresh(activity);
        });
  }

  private boolean hasRemoteLocal() {
    for (String kind : online.values()) if (kind.endsWith("+L")) return true;
    return false;
  }

  private static String kindName(String value) {
    if (value == null) return "其他设备";
    String kind = value.replace("+L", "");
    return kind.equals("desktop")
        ? "电脑"
        : kind.equals("phone") ? "手机" : kind.equals("web") ? "网页" : "其他设备";
  }

  private static boolean validDevice(String value) {
    return value != null && value.matches("[A-Za-z0-9_-]{6,40}");
  }

  static boolean safeSdp(String sdp) {
    return sdp != null
        && sdp.length() > 10
        && sdp.length() <= 100000
        && sdp.startsWith("v=0")
        && !sdp.matches("(?is).*a=candidate:[^\r\n]* typ (?:relay|srflx|prflx)(?: |\r|\n).*")
        && !sdp.contains("m=audio")
        && !sdp.contains("m=video");
  }

  private abstract static class DescriptionObserver implements SdpObserver {
    @Override
    public void onCreateSuccess(SessionDescription sdp) {}

    @Override
    public void onSetSuccess() {}

    @Override
    public void onCreateFailure(String reason) {}

    @Override
    public void onSetFailure(String reason) {}
  }
}
