package com.laolao.classcalendar;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Real extras.js RPCs, document picker and retention policy; no storage permission is requested.
 */
final class CampusItemExtras {
    static final int PICK_ATTACHMENTS = 5301;
    private static final int MAX_FILE = 20 * 1024 * 1024;
    private static final int CHUNK = 600 * 1024;
    private static final String PREF = "autodel_v1", GRACE = "autodel_grace_v1";
    private static final WeakHashMap<CampusActivity, State> STATES = new WeakHashMap<>();

    private static final class State {
        String owner, cid, error = "", status = "";
        boolean loaded, refreshing, classAutodel = true, canSet, transferring;
        JSONObject keep = new JSONObject(), files = new JSONObject(), pickedItem;
        AtomicBoolean cancelled = new AtomicBoolean(false);

        State(CampusActivity a) {
            owner = a.store.owner;
            cid = a.cid();
        }
    }

    private CampusItemExtras() {}

    private static State state(CampusActivity a) {
        State current = STATES.get(a);
        if (current == null
                || !current.owner.equals(a.store.owner)
                || !current.cid.equals(a.cid())) {
            if (current != null) current.cancelled.set(true);
            current = new State(a);
            JSONObject cached = a.store.object("cache_item_extras");
            if (current.cid.equals(cached.optString("cid")) && cached.optBoolean("loaded")) {
                current.classAutodel = cached.optBoolean("autodel", true);
                current.canSet = cached.optBoolean("can_set");
                current.keep = CampusJson.object(cached.opt("keep"));
                current.files = CampusJson.object(cached.opt("files"));
                current.loaded = true;
            }
            STATES.put(a, current);
        }
        return current;
    }

    static boolean loaded(CampusActivity a) {
        return !a.api.logged() || state(a).loaded;
    }

    static String error(CampusActivity a) {
        return state(a).error;
    }

    static String status(CampusActivity a) {
        return state(a).status;
    }

    static boolean busy(CampusActivity a) {
        return state(a).refreshing || state(a).transferring;
    }

    static boolean personalAutodelete(CampusActivity a) {
        return a.store.object(PREF).optBoolean("cal", true);
    }

    static boolean classAutodelete(CampusActivity a) {
        return state(a).classAutodel;
    }

    static boolean canSetClassAutodelete(CampusActivity a) {
        return state(a).loaded && state(a).canSet;
    }

    static int fileCount(CampusActivity a, JSONObject item) {
        return state(a).files.optInt(key(item), 0);
    }

    private static String key(JSONObject item) {
        String key = item.optString("_key");
        return !key.isEmpty() ? key : (item.optBoolean("_mine") ? "" : "c") + item.optString("id");
    }

    static String expiry(CampusActivity a, JSONObject item) {
        boolean personal = item.optBoolean("_mine");
        boolean enabled =
                personal
                        ? personalAutodelete(a)
                        : item.optString("msg_type").equals("作业") || classAutodelete(a);
        String keep = personal ? item.optString("keep") : state(a).keep.optString(key(item));
        try {
            return CampusExtraRules.expiry(CampusExtraRules.eventDay(item), keep, enabled);
        } catch (IllegalArgumentException ignored) {
            return "";
        }
    }

    static Integer daysLeft(CampusActivity a, JSONObject item) {
        String expires = expiry(a, item);
        return expires.isEmpty() ? null : CampusExtraRules.daysLeft(expires, DateMath.today());
    }

    static List<JSONObject> soon(CampusActivity a, boolean homeworkOnly) {
        List<JSONObject> result = new ArrayList<>();
        for (JSONObject row : a.items()) {
            if (homeworkOnly && !row.optString("msg_type").equals("作业")) continue;
            Integer remaining = daysLeft(a, row);
            if (remaining != null && remaining <= 3 && !CampusSchool.hidden(a, row))
                result.add(row);
        }
        result.sort((left, right) -> expiry(a, left).compareTo(expiry(a, right)));
        return result;
    }

    static void setPersonalAutodelete(CampusActivity a, boolean on) {
        JSONObject preferences = a.store.object(PREF);
        CampusJson.put(preferences, "cal", on);
        a.store.set(PREF, preferences);
        // Enabling for old saved records starts with a fresh three-day grace, never a surprise
        // purge.
        if (on) a.store.set(GRACE, false);
        cleanPersonal(a);
        a.build();
        a.toast(on ? "个人事项过期两周后清理，最后三天可推迟" : "已关闭个人事项自动清理");
    }

    static void setClassAutodelete(CampusActivity a, boolean on) {
        if (!a.needClass()) return;
        State current = state(a);
        if (!current.loaded || !current.canSet) {
            a.toast("只有老师或有编辑权限的班委可以修改，请先刷新设置");
            return;
        }
        final String cid = a.cid();
        a.rpc(
                "class_autodel_set",
                CampusJson.obj("cid", cid, "on_", on),
                response -> {
                    if (!cid.equals(a.cid())) return;
                    if (!(response instanceof Boolean)) throw new IOException("服务器没有返回清理设置，原开关未改变");
                    current.classAutodel = (Boolean) response;
                    cache(a, current);
                    a.build();
                });
    }

    static void refresh(CampusActivity a) {
        cleanPersonal(a);
        if (!a.api.logged()) {
            a.build();
            return;
        }
        State current = state(a);
        if (current.refreshing) return;
        current.refreshing = true;
        current.error = "";
        final CampusStore target = a.store;
        final String cid = a.cid();
        a.background(
                "读取附件与保留时间",
                () -> {
                    try {
                        Object response =
                                a.api.rpc(
                                        "item_extras",
                                        CampusJson.obj("cid", CampusJson.nullable(cid)));
                        if (!(response instanceof JSONObject))
                            throw new IOException("服务器返回的事项扩展格式无效");
                        return response;
                    } catch (Exception failure) {
                        return CampusJson.obj(
                                "_failure",
                                failure.getMessage() == null ? "无法连接事项附件服务" : failure.getMessage());
                    }
                },
                response -> {
                    current.refreshing = false;
                    if (!cid.equals(a.cid()) || !target.owner.equals(a.store.owner)) return;
                    JSONObject value = CampusJson.object(response);
                    if (value.has("_failure")) {
                        current.error = value.optString("_failure");
                        a.build();
                        return;
                    }
                    current.classAutodel = value.optBoolean("autodel", true);
                    current.canSet = value.optBoolean("can_set");
                    current.keep = CampusJson.object(value.opt("keep"));
                    current.files = CampusJson.object(value.opt("files"));
                    current.loaded = true;
                    JSONArray deleted = value.optJSONArray("deleted");
                    if (deleted != null && deleted.length() > 0) {
                        Set<String> ids = new HashSet<>();
                        for (int i = 0; i < deleted.length(); i++) ids.add(deleted.optString(i));
                        JSONArray remaining = new JSONArray();
                        for (JSONObject row : CampusJson.rows(target.list("cache_items")))
                            if (!ids.contains(row.optString("id"))) remaining.put(row);
                        target.set("cache_items", remaining);
                    }
                    cache(a, current);
                    a.build();
                });
    }

    private static void cache(CampusActivity a, State current) {
        a.store.set(
                "cache_item_extras",
                CampusJson.obj(
                        "cid",
                        current.cid,
                        "loaded",
                        current.loaded,
                        "autodel",
                        current.classAutodel,
                        "can_set",
                        current.canSet,
                        "keep",
                        current.keep,
                        "files",
                        current.files));
    }

    static void cleanPersonal(CampusActivity a) {
        boolean enabled = personalAutodelete(a);
        JSONArray before = a.store.list("personal_events_v1");
        if (!a.store.bool(GRACE, false)) {
            // Login may still be pulling an existing account's records. An empty cache must not
            // consume the one-time grace before those records arrive.
            boolean hasDatedRecords = false;
            for (JSONObject item : CampusJson.rows(before))
                if (!CampusExtraRules.eventDay(item).isEmpty()) hasDatedRecords = true;
            if (!hasDatedRecords) return;
            JSONArray graced = CampusExtraRules.grantGrace(before, DateMath.today(), enabled);
            a.store.batch(CampusJson.obj("personal_events_v1", graced, GRACE, true));
            if (!before.toString().equals(graced.toString())) a.syncSoon();
            return;
        }
        if (!enabled) return;
        JSONArray remaining = new JSONArray(), gone = new JSONArray();
        for (JSONObject row : CampusJson.rows(before)) {
            if (CampusExtraRules.expired(row, DateMath.today(), true))
                gone.put(row.optString("id"));
            else remaining.put(row);
        }
        if (gone.length() == 0) return;
        a.store.set("personal_events_v1", remaining);
        a.syncSoon();
        if (a.api.logged())
            a.rpc("file_del_items", CampusJson.obj("items", gone), response -> a.build());
    }

    static void keep(CampusActivity a, JSONObject item) {
        final String itemKey = key(item), today = DateMath.today();
        if (item.optBoolean("_mine")) {
            JSONObject current = null;
            for (JSONObject row : CampusJson.rows(a.store.list("personal_events_v1")))
                if (row.optString("id").equals(item.optString("id"))) current = row;
            if (current == null) {
                a.toast("这条事项已经不存在");
                return;
            }
            String keep = CampusExtraRules.postpone(expiry(a, item), today);
            CampusJson.put(current, "keep", keep);
            a.store.replace("personal_events_v1", current.optString("id"), current);
            a.syncSoon();
            a.build();
            a.toast("已推迟，" + keep + " 之后才会清理");
        } else {
            if (!a.needClass()) return;
            final String cid = a.cid();
            a.rpc(
                    "item_keep",
                    CampusJson.obj(
                            "cid", cid, "item_id", CampusJson.numericId(item.optString("id"))),
                    response -> {
                        if (!cid.equals(a.cid())) return;
                        String keep = CampusJson.object(response).optString("keep_until");
                        DateMath.parse(keep);
                        State current = state(a);
                        CampusJson.put(current.keep, itemKey, keep);
                        cache(a, current);
                        a.build();
                        a.toast("已推迟，" + keep + " 之后才会清理");
                    });
        }
    }

    static String summary(CampusActivity a, JSONObject item) {
        Integer left = daysLeft(a, item);
        String text = left == null ? "" : left <= 0 ? "今天过后自动清理" : left <= 3 ? left + "天后自动清理" : "";
        int files = fileCount(a, item);
        return (files > 0 ? files + "个附件" : "")
                + (files > 0 && !text.isEmpty() ? " · " : "")
                + text;
    }

    static void open(CampusActivity a, JSONObject item) {
        List<String> options = new ArrayList<>();
        options.add("图片与文件附件" + (fileCount(a, item) > 0 ? "（" + fileCount(a, item) + "）" : ""));
        String expiry = expiry(a, item);
        if (!expiry.isEmpty()) options.add("推迟删除三天 · 当前保留至 " + expiry);
        options.add("自动清理设置");
        options.add("其他事项操作");
        if (busy(a)) options.add("停止附件传输");
        a.ui.choose(
                item.optString("subject", "事项附件与保留"),
                options.toArray(new String[0]),
                index -> {
                    String option = options.get(index);
                    if (index == 0) openFiles(a, item);
                    else if (option.startsWith("推迟")) keep(a, item);
                    else if (option.equals("自动清理设置")) settings(a);
                    else if (option.equals("停止附件传输")) cancel(a);
                    else CampusSchool.detail(a, item);
                });
    }

    static void settings(CampusActivity a) {
        List<String> options = new ArrayList<>();
        options.add((personalAutodelete(a) ? "关闭" : "开启") + "我自己记的事项自动清理");
        if (!a.cid().isEmpty() && canSetClassAutodelete(a))
            options.add((classAutodelete(a) ? "关闭" : "开启") + "本班其它事项自动清理");
        options.add("刷新班级清理规则与附件数量");
        options.add("查看清理说明");
        a.ui.choose(
                "过期两周自动清理",
                options.toArray(new String[0]),
                index -> {
                    String choice = options.get(index);
                    if (index == 0) setPersonalAutodelete(a, !personalAutodelete(a));
                    else if (choice.contains("本班其它")) setClassAutodelete(a, !classAutodelete(a));
                    else if (choice.startsWith("刷新")) refresh(a);
                    else
                        a.ui.choose(
                                "最后三天可以推迟三天；首次启用旧记录会先获三天宽限。班级作业由服务器始终清理，其它班级事项由老师或有权限班委决定。",
                                new String[] {"知道了"},
                                ignored -> {});
                });
    }

    private static boolean canWrite(CampusActivity a, JSONObject item) {
        return item.optBoolean("_mine")
                || CampusSchool.editAllowed(a, item)
                || item.optString("created_by").equals(a.api.uid());
    }

    private static Object cid(CampusActivity a, JSONObject item) {
        return item.optBoolean("_mine") ? JSONObject.NULL : CampusJson.nullable(a.cid());
    }

    private static boolean cloudItem(CampusActivity a, JSONObject item) {
        if (item.optBoolean("local")) {
            a.toast("这条事项只保存在设备上，不能上传云端附件");
            return false;
        }
        if (!a.requireLogin()) return false;
        if (!item.optBoolean("_mine") && !a.needClass()) return false;
        if (item.optString("id").isEmpty()) {
            a.toast("请先保存事项，再添加附件");
            return false;
        }
        return true;
    }

    static void openFiles(CampusActivity a, JSONObject item) {
        if (!cloudItem(a, item)) return;
        final JSONObject target = CampusJson.copy(item);
        final String targetClass = a.cid();
        a.rpc(
                "file_list",
                CampusJson.obj("cid", cid(a, target), "item", target.optString("id")),
                response -> {
                    if (!target.optBoolean("_mine") && !targetClass.equals(a.cid())) return;
                    if (!(response instanceof JSONArray)) throw new IOException("附件列表格式无效");
                    JSONArray rows = (JSONArray) response;
                    State current = state(a);
                    CampusJson.put(current.files, key(target), rows.length());
                    cache(a, current);
                    List<String> options = new ArrayList<>();
                    for (JSONObject file : CampusJson.rows(rows))
                        options.add(
                                file.optString("name", "未命名附件")
                                        + " · "
                                        + sizeLabel(file.optLong("size")));
                    if (canWrite(a, target)) options.add("＋ 添加图片 / 文件（单个最多20MB）");
                    if (options.isEmpty()) options.add("还没有附件");
                    a.ui.choose(
                            target.optString("subject", "事项附件"),
                            options.toArray(new String[0]),
                            index -> {
                                List<JSONObject> files = CampusJson.rows(rows);
                                if (index < files.size()) fileActions(a, target, files.get(index));
                                else if (canWrite(a, target)) pick(a, target);
                            });
                    a.build();
                });
    }

    private static String sizeLabel(long bytes) {
        return bytes >= 1048576
                ? String.format(java.util.Locale.US, "%.1f MB", bytes / 1048576d)
                : Math.max(1, (bytes + 512) / 1024) + " KB";
    }

    private static void fileActions(CampusActivity a, JSONObject item, JSONObject file) {
        List<String> actions = new ArrayList<>();
        if (file.optString("mime").startsWith("image/")) actions.add("原生查看图片");
        actions.add("保存到手机文件");
        if (file.optBoolean("can_del")) actions.add("删除附件");
        a.ui.choose(
                file.optString("name", "附件"),
                actions.toArray(new String[0]),
                index -> {
                    String action = actions.get(index);
                    if (action.equals("删除附件"))
                        a.ui.confirm(
                                "删除这个附件？",
                                file.optString("name"),
                                () ->
                                        a.rpc(
                                                "file_del",
                                                CampusJson.obj("fid", file.optString("id")),
                                                response -> openFiles(a, item)));
                    else download(a, file, action.equals("原生查看图片"));
                });
    }

    static void pick(CampusActivity a, JSONObject item) {
        if (!cloudItem(a, item)) return;
        if (!canWrite(a, item)) {
            a.toast("当前账号不能给这条事项添加附件");
            return;
        }
        State current = state(a);
        if (current.transferring) {
            a.toast("请等待当前附件传输完成");
            return;
        }
        current.pickedItem = CampusJson.copy(item);
        try {
            a.startActivityForResult(
                    new Intent(Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("*/*")
                            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                    PICK_ATTACHMENTS);
        } catch (Exception failure) {
            current.pickedItem = null;
            a.error(failure);
        }
    }

    static boolean result(CampusActivity a, int request, int result, Intent data) {
        if (request != PICK_ATTACHMENTS) return false;
        State current = STATES.get(a);
        if (current == null || current.pickedItem == null) return true;
        JSONObject item = current.pickedItem;
        current.pickedItem = null;
        if (result != Activity.RESULT_OK || data == null) return true;
        if (!current.owner.equals(a.store.owner) || !current.cid.equals(a.cid())) {
            a.toast("账号或班级已切换，请重新选择附件");
            return true;
        }
        List<Uri> uris = new ArrayList<>();
        ClipData clips = data.getClipData();
        if (clips != null)
            for (int i = 0; i < clips.getItemCount() && uris.size() < 20; i++)
                if (!uris.contains(clips.getItemAt(i).getUri()))
                    uris.add(clips.getItemAt(i).getUri());
        if (uris.isEmpty() && data.getData() != null) uris.add(data.getData());
        if (!uris.isEmpty()) upload(a, current, item, uris);
        return true;
    }

    private static void checkActive(CampusActivity a, State current) throws IOException {
        if (current.cancelled.get() || Thread.currentThread().isInterrupted())
            throw new IOException("附件传输已取消");
        if (!current.owner.equals(a.api.uid()) || !current.cid.equals(a.cid()))
            throw new IOException("账号或班级已切换，附件传输已停止");
    }

    private static void progress(CampusActivity a, State current, String text) {
        a.handler.post(
                () -> {
                    if (a.isDestroyed() || !current.owner.equals(a.store.owner)) return;
                    current.status = text;
                    a.toast(text);
                    a.build();
                });
    }

    private static void upload(CampusActivity a, State current, JSONObject item, List<Uri> uris) {
        current.transferring = true;
        current.cancelled = new AtomicBoolean(false);
        final Object cid = cid(a, item);
        a.background(
                "准备上传附件",
                () -> {
                    int ok = 0;
                    List<String> failed = new ArrayList<>();
                    try {
                        for (Uri uri : uris) {
                            if (current.cancelled.get()
                                    || !current.owner.equals(a.api.uid())
                                    || !current.cid.equals(a.cid())) {
                                failed.add("附件传输已停止");
                                break;
                            }
                            File temporary =
                                    File.createTempFile(
                                            "campus-attachment-", ".part", a.getCacheDir());
                            String name = "附件", fid = "";
                            try {
                        if (!"content".equals(uri.getScheme()))
                            throw new IOException("请通过系统文件选择器选择附件");
                                String mime = a.getContentResolver().getType(uri);
                        mime = safeMime(mime);
                                try (Cursor cursor =
                                        a.getContentResolver()
                                                .query(
                                                        uri,
                                                        new String[] {
                                                            OpenableColumns.DISPLAY_NAME,
                                                            OpenableColumns.SIZE
                                                        },
                                                        null,
                                                        null,
                                                        null)) {
                                    if (cursor != null && cursor.moveToFirst()) {
                                        int column =
                                                cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                                        if (column >= 0 && !cursor.isNull(column))
                                            name = cursor.getString(column);
                                        int size = cursor.getColumnIndex(OpenableColumns.SIZE);
                                        if (size >= 0
                                                && !cursor.isNull(size)
                                                && cursor.getLong(size) > MAX_FILE)
                                            throw new IOException("单个附件最多20MB");
                                    }
                                }
                                name = safeName(name);
                                long length =
                                        copyBounded(
                                                a.getContentResolver().openInputStream(uri),
                                                temporary,
                                                a,
                                                current);
                                int parts = Math.max(1, (int) ((length + CHUNK - 1) / CHUNK));
                                checkActive(a, current);
                                JSONObject begin =
                                        CampusJson.object(
                                                a.api.rpc(
                                                        "file_begin",
                                                        CampusJson.obj(
                                                                "cid",
                                                                cid,
                                                                "item",
                                                                item.optString("id"),
                                                                "fname",
                                                                name,
                                                                "fmime",
                                                                mime,
                                                                "fsize",
                                                                length,
                                                                "nparts",
                                                                parts)));
                                fid = begin.optString("id");
                                if (fid.isEmpty()) throw new IOException("服务器没有返回附件编号");
                                byte[] buffer = new byte[CHUNK];
                                try (InputStream in = new FileInputStream(temporary)) {
                                    for (int part = 0; part < parts; part++) {
                                        checkActive(a, current);
                                        int count = 0, read;
                                        while (count < CHUNK
                                                && (read = in.read(buffer, count, CHUNK - count))
                                                        > 0) count += read;
                                        a.api.rpc(
                                                "file_part",
                                                CampusJson.obj(
                                                        "fid",
                                                        fid,
                                                        "n",
                                                        part,
                                                        "b64",
                                                        Base64.encodeToString(
                                                                buffer, 0, count, Base64.NO_WRAP)));
                                        progress(
                                                a,
                                                current,
                                                "正在上传「"
                                                        + name
                                                        + "」 "
                                                        + (part + 1) * 100 / parts
                                                        + "%");
                                    }
                                }
                                checkActive(a, current);
                                a.api.rpc("file_end", CampusJson.obj("fid", fid));
                                fid = "";
                                ok++;
                            } catch (Exception failure) {
                                failed.add(
                                        name
                                                + "："
                                                + (failure.getMessage() == null
                                                        ? "上传失败"
                                                        : failure.getMessage()));
                                if (!fid.isEmpty() && current.owner.equals(a.api.uid()))
                                    try {
                                        a.api.rpc("file_del", CampusJson.obj("fid", fid));
                                    } catch (Exception ignored) {
                                    }
                                if (current.cancelled.get()
                                        || !current.owner.equals(a.api.uid())
                                        || !current.cid.equals(a.cid())) break;
                            } finally {
                                temporary.delete();
                            }
                        }
                        return CampusJson.obj(
                                "ok", ok, "total", uris.size(), "failed", new JSONArray(failed));
                    } finally {
                        current.transferring = false;
                    }
                },
                response -> {
                    current.transferring = false;
                    JSONObject result = CampusJson.object(response);
                    String text =
                            "附件传好 " + result.optInt("ok") + " / " + result.optInt("total") + " 个";
                    JSONArray failures = result.optJSONArray("failed");
                    current.error =
                            failures != null && failures.length() > 0 ? failures.optString(0) : "";
                    current.status = text;
                    a.toast(text + (current.error.isEmpty() ? "" : " · " + current.error));
                    openFiles(a, item);
                });
    }

    private static long copyBounded(
            InputStream source, File target, CampusActivity a, State current) throws IOException {
        if (source == null) throw new IOException("无法读取所选文件");
        long size = 0;
        try (InputStream in = source;
                OutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                checkActive(a, current);
                size += read;
                if (size > MAX_FILE) throw new IOException("单个附件最多20MB");
                out.write(buffer, 0, read);
            }
        }
        return size;
    }

    static String safeName(String value) {
        String name = value == null ? "" : value.replaceAll("[\\p{Cntrl}/\\\\]", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "附件";
        return CampusCourses.limit(name, 180);
    }

    private static String safeMime(String value) {
        return value != null && value.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")
                ? value
                : "application/octet-stream";
    }

    private static void download(CampusActivity a, JSONObject file, boolean viewImage) {
        State current = state(a);
        if (current.transferring) {
            a.toast("请等待当前附件传输完成");
            return;
        }
        int parts = file.optInt("parts");
        long size = file.optLong("size", -1);
        if (parts < 1 || parts > (MAX_FILE + CHUNK - 1) / CHUNK || size < 0 || size > MAX_FILE) {
            a.toast("附件大小或分片数量无效");
            return;
        }
        current.transferring = true;
        current.cancelled = new AtomicBoolean(false);
        a.background(
                "读取附件",
                () -> {
                    try {
                        ByteArrayOutputStream out =
                                new ByteArrayOutputStream((int) Math.min(size, CHUNK));
                        for (int part = 0; part < parts; part++) {
                            checkActive(a, current);
                            JSONObject value =
                                    CampusJson.object(
                                            a.api.rpc(
                                                    "file_get",
                                                    CampusJson.obj(
                                                            "fid",
                                                            file.optString("id"),
                                                            "n",
                                                            part)));
                            String encoded = value.optString("data");
                            if (encoded.length() > (CHUNK + 2) / 3 * 4 + 8)
                                throw new IOException("附件分片过大");
                            byte[] data = Base64.decode(encoded, Base64.DEFAULT);
                            if (data.length > CHUNK || out.size() + data.length > MAX_FILE)
                                throw new IOException("附件超过20MB");
                            out.write(data);
                            progress(a, current, "读取附件 " + (part + 1) * 100 / parts + "%");
                        }
                        if (out.size() != size) throw new IOException("附件未完整传输，请重试");
                        return out.toByteArray();
                    } catch (Exception failure) {
                        current.transferring = false;
                        throw failure;
                    }
                },
                response -> {
                    current.transferring = false;
                    byte[] bytes = (byte[]) response;
                    if (viewImage) {
                        String id = CampusPhone.savePhoto(a, new ByteArrayInputStream(bytes));
                        ComposeEntry.photo(a, id);
                    } else
                        CampusPhone.exportBytes(
                                a,
                                safeName(file.optString("name")),
                                bytes,
                                safeMime(file.optString("mime")));
                });
    }

    static void cancel(CampusActivity a) {
        State current = STATES.get(a);
        if (current != null) {
            current.cancelled.set(true);
            current.pickedItem = null;
        }
        a.toast("正在停止附件传输，已保存的事项不受影响");
    }

    static void release(CampusActivity a) {
        State current = STATES.remove(a);
        if (current != null) current.cancelled.set(true);
    }
}
