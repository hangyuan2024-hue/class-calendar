package android.content;

/** Minimal JVM harness only. Never included in the Android application. */
public class Context {
  private final String name;
  public boolean failCommit;
  private final java.util.Map<String, Prefs> files = new java.util.HashMap<>();
  public Context(String name) { this.name = name; }
  public String getPackageName() { return name; }
  public SharedPreferences getSharedPreferences(String name, int mode) {
    return files.computeIfAbsent(name, k -> new Prefs());
  }
  private final class Prefs implements SharedPreferences {
    final java.util.Map<String, String> data = new java.util.HashMap<>();
    public String getString(String key, String fallback) { return data.getOrDefault(key, fallback); }
    public Editor edit() {
      return new Editor() {
        final java.util.Map<String, String> changes = new java.util.HashMap<>();
        public Editor putString(String key, String value) { changes.put(key, value); return this; }
        public boolean commit() { if (failCommit) return false; data.putAll(changes); return true; }
      };
    }
  }
}
