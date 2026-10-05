package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.media.MediaRecorder;
import android.os.*;
import java.io.File;
import org.json.*;

/** Microphone foreground service: actual AAC recording continues away from the screen. */
public class LectureService extends Service {
  static volatile boolean live;
  private MediaRecorder recorder;
  private String owner, file, title;
  private long started;
  private boolean saving;
  private static final String CHANNEL = "campus-recording";

  public IBinder onBind(Intent i) {
    return null;
  }

  public int onStartCommand(Intent intent, int flags, int id) {
    if (intent == null) return START_NOT_STICKY;
    if ("stop".equals(intent.getAction())) {
      save();
      stopSelf();
      return START_NOT_STICKY;
    }
    if (recorder != null) return START_NOT_STICKY;
    owner = intent.getStringExtra("owner");
    title = intent.getStringExtra("title");
    if (owner == null || !owner.matches("[A-Za-z0-9_-]{1,80}")) {
      stopSelf();
      return START_NOT_STICKY;
    }
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= 26)
      nm.createNotificationChannel(
          new NotificationChannel(CHANNEL, "课堂录音", NotificationManager.IMPORTANCE_LOW));
    Intent stop = new Intent(this, LectureService.class).setAction("stop");
    PendingIntent action =
        PendingIntent.getService(
            this, 52, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            53,
            new Intent(this, CampusActivity.class).putExtra("go", "recordings"),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder =
        Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
    builder
        .setSmallIcon(R.drawable.ic_stat)
        .setContentTitle(title == null ? "课堂录音" : title)
        .setContentText("正在录制，点击结束保存")
        .setOngoing(true)
        .setContentIntent(open)
        .addAction(new Notification.Action.Builder(null, "结束录音", action).build());
    try {
      if (Build.VERSION.SDK_INT >= 29)
        startForeground(
            852,
            builder.build(),
            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
      else startForeground(852, builder.build());
      file = CampusJson.id() + ".m4a";
      File out = new File(CampusPhone.media(this, owner), file);
      recorder = new MediaRecorder();
      recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
      recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
      recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
      recorder.setAudioEncodingBitRate(48000);
      recorder.setAudioSamplingRate(22050);
      recorder.setMaxDuration(30 * 60000);
      recorder.setMaxFileSize(12000000);
      recorder.setOutputFile(out.getPath());
      recorder.setOnInfoListener(
          (r, what, extra) -> {
            if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED
                || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
              save();
              stopSelf();
            }
          });
      recorder.prepare();
      recorder.start();
      live = true;
      started = System.currentTimeMillis();
      getSharedPreferences("campus_recorder", 0)
          .edit()
          .putBoolean("running", true)
          .putString("owner", owner)
          .putString("file", file)
          .putString("title", title)
          .putLong("started", started)
          .remove("error")
          .commit();
    } catch (Exception e) {
      live = false;
      getSharedPreferences("campus_recorder", 0)
          .edit()
          .putString("error", "录音未开始：" + e.getMessage())
          .putBoolean("running", false)
          .apply();
      if (recorder != null) {
        recorder.release();
        recorder = null;
      }
      if (file != null) new File(CampusPhone.media(this, owner), file).delete();
      stopSelf();
    }
    return START_NOT_STICKY;
  }

  private synchronized void save() {
    if (recorder == null || saving) return;
    saving = true;
    boolean valid = true;
    try {
      recorder.stop();
    } catch (RuntimeException e) {
      valid = false;
    } finally {
      recorder.release();
      recorder = null;
      live = false;
      getSharedPreferences("campus_recorder", 0).edit().putBoolean("running", false).apply();
    }
    File f = new File(CampusPhone.media(this, owner), file);
    if (valid && f.length() > 64) {
      CampusStore store = new CampusStore(this, owner);
      store.add(
          "native_recordings",
          CampusJson.obj(
              "id",
              CampusJson.id(),
              "title",
              title,
              "file",
              file,
              "date",
              DateMath.today(),
              "duration",
              System.currentTimeMillis() - started,
              "note",
              ""));
      Reminders.show(this, 853, "课堂录音已保存", title, "recordings");
    } else {
      f.delete();
      getSharedPreferences("campus_recorder", 0)
          .edit()
          .putString("error", "录音时间太短，未产生可播放文件")
          .apply();
    }
    stopForeground(true);
  }

  public void onDestroy() {
    save();
    live = false;
    super.onDestroy();
  }

  static void reconcile(Context c) {
    android.content.SharedPreferences p = c.getSharedPreferences("campus_recorder", 0);
    if (live || !p.getBoolean("running", false)) return;
    String owner = p.getString("owner", "guest"), id = p.getString("file", "");
    boolean recovered = false;
    if (owner.matches("[A-Za-z0-9_-]{1,80}") && CampusPhone.validId(id)) {
      File f = new File(CampusPhone.media(c, owner), id);
      android.media.MediaMetadataRetriever reader = new android.media.MediaMetadataRetriever();
      try {
        reader.setDataSource(f.getPath());
        long duration =
            Long.parseLong(
                reader.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION));
        if (duration > 0) {
          CampusStore s = new CampusStore(c, owner);
          boolean exists = false;
          for (JSONObject x : CampusJson.rows(s.list("native_recordings")))
            if (x.optString("file").equals(id)) exists = true;
          if (!exists)
            s.add(
                "native_recordings",
                CampusJson.obj(
                    "id",
                    CampusJson.id(),
                    "file",
                    id,
                    "title",
                    p.getString("title", "恢复的课堂录音"),
                    "date",
                    DateMath.today(),
                    "duration",
                    duration,
                    "note",
                    "系统结束录音后恢复的可播放文件"));
          recovered = true;
        }
      } catch (Exception ignored) {
      } finally {
        try {
          reader.release();
        } catch (Exception ignored) {
        }
      }
    }
    p.edit()
        .putBoolean("running", false)
        .putString("error", recovered ? "上次录音已恢复到列表" : "上次录音被系统中断，没有可播放的文件")
        .commit();
  }
}
