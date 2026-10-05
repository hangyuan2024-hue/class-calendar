package com.laolao.classcalendar;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/** 把 App 缓存目录 cache/shared 里的文件临时借给别的应用（相机写照片、日历读 .ics）。只开放这一个目录。 */
public class FilesProvider extends ContentProvider {
    static final String AUTH = BuildConfig.APPLICATION_ID + ".files";
    private static File root;

    static Uri uriFor(File f) { return Uri.parse("content://" + AUTH + "/" + Uri.encode(f.getName())); }

    @Override public boolean onCreate() { root = new File(getContext().getCacheDir(), "shared"); root.mkdirs(); return true; }

    private File fileOf(Uri u) throws FileNotFoundException {
        String name = u.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) throw new FileNotFoundException();
        return new File(root, name);
    }

    @Override public ParcelFileDescriptor openFile(Uri u, String mode) throws FileNotFoundException {
        File f = fileOf(u);
        int m = mode.contains("w") ? ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE
                                    : ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(f, m);
    }

    @Override public String getType(Uri u) {
        String n = u.getLastPathSegment(), ext = n != null && n.contains(".") ? n.substring(n.lastIndexOf('.') + 1).toLowerCase() : "";
        if ("ics".equals(ext)) return "text/calendar";
        String t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return t != null ? t : "application/octet-stream";
    }

    @Override public Cursor query(Uri u, String[] proj, String sel, String[] args, String sort) {
        try {
            File f = fileOf(u);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) { return null; }
    }

    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
