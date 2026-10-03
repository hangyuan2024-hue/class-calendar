package com.laolao.classcalendar;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 捞捞课程表 App：一个全屏的网页容器，外加网页做不到的几件事——
 * 拍照导入课程表、保存/打开文件（备份、导入手机日历）、到点提醒、返回键、状态栏跟着皮肤变色。
 */
public class MainActivity extends Activity {
    static final String SITE = BuildConfig.SITE_URL;
    private static final int REQ_FILE = 11, REQ_NOTIFY = 12;

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private Uri cameraUri;
    private long lastBack;
    private boolean loadedOnce, showingOffline;
    private final Handler ui = new Handler(Looper.getMainLooper());
    // 只交给主页面的口令：插件跑在隔离的小窗口里，拿不到它，也就不能借 App 发通知、存文件
    private final String tok = Long.toHexString(new java.security.SecureRandom().nextLong()) + Long.toHexString(System.nanoTime());

    @Override
    protected void onCreate(Bundle saved) {
        setTheme(R.style.AppTheme);   // 启动画面结束，换成正常主题
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#CDEEFF"));
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);   // 系统字体调大时不把排版撑乱
        s.setUserAgentString(s.getUserAgentString() + " ClassCalendarApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(startUrl(getIntent()));
    }

    private String startUrl(Intent it) {
        Uri u = it != null ? it.getData() : null;
        if (u != null && u.toString().startsWith(SITE)) return u.toString();
        String go = it != null ? it.getStringExtra("go") : null;   // 点通知进来：直接到对应页面
        return SITE + "index.html" + (go != null ? "#" + go : "");
    }

    @Override
    protected void onNewIntent(Intent it) {
        super.onNewIntent(it);
        if (it.getData() != null || it.getStringExtra("go") != null) web.loadUrl(startUrl(it));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }

    // 返回键：先让网页处理（关弹窗、回首页），网页说处理不了再退到桌面
    @Override
    public void onBackPressed() {
        if (showingOffline) { super.onBackPressed(); return; }
        web.evaluateJavascript("(window.ccAppBack && window.ccAppBack()) ? 1 : 0", v -> {
            if ("1".equals(v)) return;
            if (web.canGoBack()) { web.goBack(); return; }
            long now = System.currentTimeMillis();
            if (now - lastBack < 2000) moveTaskToBack(true);
            else { lastBack = now; Toast.makeText(this, "再按一次返回桌面", Toast.LENGTH_SHORT).show(); }
        });
    }

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            String url = u.toString();
            // 本站页面留在 App 里；安装包、别的网站、邮件、电话、日历订阅交给系统
            if (url.startsWith(SITE) && !url.endsWith(".apk")) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "手机上没有能打开这个链接的应用", Toast.LENGTH_SHORT).show(); }
            return true;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (url.startsWith(SITE)) {
                loadedOnce = true; showingOffline = false;
                v.evaluateJavascript("window.__ccTok='" + tok + "';window.dispatchEvent(new Event('cc-app-ready'))", null);
            }
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            // 只有整页打不开才显示离线页（网页自己有离线缓存，大多数时候没网也能打开）
            if (req.isForMainFrame() && !loadedOnce) showOffline();
        }
    }

    private void showOffline() {
        showingOffline = true;
        web.loadUrl("file:///android_asset/offline.html");
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            Intent pick = p.createIntent();
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            List<Intent> extra = new ArrayList<>();
            boolean image = false;
            for (String a : p.getAcceptTypes()) if (a != null && a.startsWith("image")) image = true;
            if (image) {   // 选图片时多给一个「拍照」，拍课程表最方便
                try {
                    File dir = new File(getCacheDir(), "shared");
                    dir.mkdirs();
                    File f = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
                    cameraUri = FilesProvider.uriFor(f);
                    Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                    cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    if (cam.resolveActivity(getPackageManager()) != null) extra.add(cam);
                } catch (Exception e) { cameraUri = null; }
            }
            Intent chooser = Intent.createChooser(pick, image ? "选择图片或拍照" : "选择文件");
            if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
            try { startActivityForResult(chooser, REQ_FILE); }
            catch (ActivityNotFoundException e) { fileCb = null; return false; }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && (data.getData() != null || data.getClipData() != null)) out = WebChromeClient.FileChooserParams.parseResult(res, data);
            else if (cameraUri != null) out = new Uri[]{cameraUri};   // 拍照：图片写在我们给的文件里
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
        cameraUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        if (req == REQ_NOTIFY) {
            boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
            web.evaluateJavascript("window.ccAppNotify && window.ccAppNotify(" + ok + ")", null);
        }
    }

    /** 网页通过 window.AndroidBridge 调用 */
    class Bridge {
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public int versionCode() { return BuildConfig.VERSION_CODE; }

        // 状态栏跟着网页的皮肤变色
        @JavascriptInterface public void setBars(String t, String color) {
            if (!tok.equals(t)) return;
            ui.post(() -> {
                try {
                    int c = Color.parseColor(color);
                    Window w = getWindow();
                    w.setStatusBarColor(c);
                    boolean light = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) > 150;
                    if (Build.VERSION.SDK_INT >= 30) {
                        WindowInsetsController ic = w.getInsetsController();
                        if (ic != null) ic.setSystemBarsAppearance(light ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                    } else {
                        View d = w.getDecorView();
                        int f = d.getSystemUiVisibility();
                        d.setSystemUiVisibility(light ? (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR));
                    }
                    web.setBackgroundColor(c);
                } catch (IllegalArgumentException ignored) { }
            });
        }

        @JavascriptInterface public void toast(String msg) { ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show()); }

        // 保存到「下载」文件夹（备份文件等）
        @JavascriptInterface public String saveFile(String t, String name, String mime, String b64) {
            if (!tok.equals(t)) return "";
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            name = safeName(name);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/捞捞课程表");
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (u == null) throw new Exception("insert failed");
                    try (OutputStream os = getContentResolver().openOutputStream(u)) { os.write(bytes); }
                    toast("已保存到「下载/捞捞课程表/" + name + "」");
                    return "Download/捞捞课程表/" + name;
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "");
                    dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    toast("已保存：" + f.getAbsolutePath());
                    return f.getAbsolutePath();
                }
            } catch (Exception e) {
                toast("保存失败：" + e.getMessage());
                return "";
            }
        }

        // 用别的应用打开（比如把 .ics 交给手机日历导入）
        @JavascriptInterface public boolean openFile(String t, String name, String mime, String b64) {
            if (!tok.equals(t)) return false;
            try {
                File dir = new File(getCacheDir(), "shared");
                dir.mkdirs();
                File f = new File(dir, safeName(name));
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(Base64.decode(b64, Base64.DEFAULT)); }
                Intent it = new Intent(Intent.ACTION_VIEW).setDataAndType(FilesProvider.uriFor(f), mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(Intent.createChooser(it, "用哪个应用打开").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        // 到点提醒：网页把接下来要提醒的事传过来（JSON 数组 [{id,title,body,at,go}]），App 用系统闹钟排好
        @JavascriptInterface public int setReminders(String t, String json) { return tok.equals(t) ? Reminders.replaceAll(MainActivity.this, json) : -1; }

        @JavascriptInterface public boolean canNotify() {
            return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface public void askNotify(String t) {
            if (!tok.equals(t)) return;
            ui.post(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                else web.evaluateJavascript("window.ccAppNotify && window.ccAppNotify(true)", null);
            });
        }

        @JavascriptInterface public void testNotify(String t) { if (tok.equals(t)) Reminders.show(MainActivity.this, 1, "提醒已经打开啦 🎉", "到点了会像这样提醒你", null); }

        @JavascriptInterface public void openExternal(String t, String url) {
            if (!tok.equals(t) || !(url.startsWith("https://") || url.startsWith("http://"))) return;
            ui.post(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception e) { toast("打不开这个链接"); }
            });
        }

        @JavascriptInterface public void retry() { ui.post(() -> { showingOffline = false; web.loadUrl(SITE + "index.html"); }); }

        @JavascriptInterface public boolean isOnline() { return online(); }
    }

    static String safeName(String n) {
        n = n == null ? "file" : n.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        return n.isEmpty() ? "file" : n;
    }
}
