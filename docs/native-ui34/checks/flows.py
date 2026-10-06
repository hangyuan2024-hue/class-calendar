"""Task-flow checks for the native 捞捞课程表 UI 3.4.

Importing this module has no side effects. Run only on a disposable emulator:
  python flows.py --output /path/to/results --phase core
  python flows.py --output /path/to/results --phase phone

The fixture is isolated to the preview guest store. Original preference bytes
and emulator display settings are restored even when an assertion fails. Reports
contain assertions and screenshots, never an account or preferences backup.
"""

import argparse
import base64
import datetime as dt
import json
import re
import shlex
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path


BRAND = "捞捞课程表"
TABS = ("首页", "作业", "日历", "工具", "我的")
PHONE_ROUTES = (
    "widget", "reminders", "inbox", "voice", "recordings", "privacy", "quiet",
    "places", "scanner", "contacts",
)
ORIGINAL_ROUTES = {
    "home", "tools", "me", "login", "register", "calendar", "homework",
    "class", "groups", "courses", "ocr-review", "members", "class-features",
    "countdown", "ledger", "wrongbook", "diary", "plan", "growth", "farm",
    "meta", "pomo", "search", "cards", "review", "checklist", "report", "rank",
    "wall", "people", "user", "ask", "parse-review", "phone", *PHONE_ROUTES,
    "time-master", "words", "oracle", "draw", "plugins", "mail", "security",
    "backup", "appearance", "about", "intro", "credits", "admin", "admin-users",
    "admin-plugins", "admin-features", "admin-perms", "intro-edit", "draft-code",
}


def source_routes(repo):
    """Check dispatcher contracts without starting Android or importing old runners."""
    java = repo / "android/app/src/main/java/com/laolao/classcalendar"
    routes = {"home", "tools", "me", "login", "register"}
    for name in ("School", "Learn", "Social", "Phone", "Extras", "Manage"):
        text = (java / ("Campus" + name + ".java")).read_text()
        body = text[text.index("static boolean handles"):text.index("static void render")]
        routes.update(re.findall(r'"([a-z][a-z-]*)"', body))
    missing = ORIGINAL_ROUTES - routes
    assert not missing, "Removed native routes: " + ", ".join(sorted(missing))
    return len(ORIGINAL_ROUTES)


class NativeDevice:
    def __init__(self, args):
        try:
            from adb_shell.adb_device import AdbDeviceTcp
        except ImportError:
            sys.path.insert(0, "/workspace/native-build/pylibs")
            from adb_shell.adb_device import AdbDeviceTcp
        self.device = AdbDeviceTcp(args.host, args.port, default_transport_timeout_s=90)
        self.device.connect(auth_timeout_s=15)
        self.pkg = args.package
        assert self.pkg.endswith(".preview"), "This runner only modifies the preview package"
        self.activity = self.pkg + "/com.laolao.classcalendar.CampusActivity"
        self.out = Path(args.output)
        self.out.mkdir(parents=True, exist_ok=True)
        self.report = {"package": self.pkg, "checks": [], "screenshots": [],
                       "cloud_authenticated": "not tested", "physical_Huawei": "not available"}
        self.original = None
        self.display = {}
        self.global_settings = {}
        self.clipboard_apk = args.clipboard_helper
        self.clipboard_installed = False
        self.temp = tempfile.TemporaryDirectory(prefix="laolao-ui34-")

    def shell(self, command):
        return self.device.shell(command, read_timeout_s=90)

    def tree(self):
        for _ in range(8):
            result = self.shell("uiautomator dump --compressed /sdcard/laolao-ui34.xml")
            if "dumped" in result:
                try:
                    return ET.fromstring(self.shell("cat /sdcard/laolao-ui34.xml"))
                except ET.ParseError:
                    pass
            time.sleep(.2)
        raise AssertionError("Fresh Android hierarchy unavailable")

    @staticmethod
    def bounds(node):
        return tuple(map(int, re.findall(r"\d+", node.get("bounds", ""))))

    @staticmethod
    def labels(root):
        return [n.get("text", "") for n in root.iter("node") if n.get("text")]

    def find(self, label, root=None):
        root = self.tree() if root is None else root
        return [n for n in root.iter("node")
                if n.get("text") == label or n.get("content-desc") == label]

    def click(self, node):
        l, t, r, b = self.bounds(node)
        assert r > l and b > t, "Control is not visible"
        self.shell(f"input tap {(l+r)//2} {(t+b)//2}")
        time.sleep(.2)

    def scroll(self, root):
        regions = [n for n in root.iter("node")
                   if n.get("scrollable") == "true" and "ScrollView" in n.get("class", "")]
        if not regions:
            return False
        l, t, r, b = self.bounds(regions[0])
        x = l + max(12, (r-l)//30)
        self.shell(f"input swipe {x} {b-45} {x} {t+50} 280")
        return True

    def tap(self, label, attempts=3):
        for _ in range(attempts):
            root = self.tree()
            for n in self.find(label, root):
                l, t, r, b = self.bounds(n)
                if r > l and b > t:
                    self.click(n)
                    return
            if not self.scroll(root):
                break
        raise AssertionError("Missing control: " + label)

    def check(self, name, value=True):
        assert value, name
        self.report["checks"].append(name)
        self.write()
        print("PASS", name, flush=True)

    def write(self):
        (self.out / "flows-report.json").write_text(
            json.dumps(self.report, ensure_ascii=False, indent=2))

    def native(self, root):
        assert not any("WebView" in n.get("class", "") for n in root.iter("node")), \
            "A task opened a WebView"
        assert BRAND in self.labels(root), "Original product identity is missing"
        assert "暂未找到页面" not in self.labels(root), "Route dispatch fell back to the missing-page screen"

    def go(self, route):
        self.shell("am start -n " + self.activity + " --es go " + shlex.quote(route))
        time.sleep(1.0)
        root = self.tree()
        self.native(root)
        return root

    def shot(self, name):
        remote = "/sdcard/laolao-ui34.png"
        self.shell("screencap -p " + remote)
        self.device.pull(remote, str(self.out / (name + ".png")))
        self.report["screenshots"].append(name + ".png")
        self.write()

    def read_store(self):
        for _ in range(8):
            try:
                raw = self.shell("run-as " + self.pkg + " cat shared_prefs/campus_v4_guest.xml")
                return json.loads(ET.fromstring(raw).find("string[@name='data']").text)
            except (ET.ParseError, json.JSONDecodeError, AttributeError):
                time.sleep(.15)
        raise AssertionError("Cannot read persisted guest records")

    def write_raw(self, raw):
        self.shell("am force-stop " + self.pkg)
        local = Path(self.temp.name) / "store.xml"
        local.write_text(raw)
        remote = "/data/local/tmp/laolao-ui34-store.xml"
        self.device.push(str(local), remote)
        cmd = "mkdir -p shared_prefs; cat " + remote + " > shared_prefs/campus_v4_guest.xml"
        result = self.shell("run-as " + self.pkg + " sh -c " + shlex.quote(cmd))
        assert not result.strip(), result

    def fixture(self):
        self.check("Disposable Android emulator", self.shell("getprop ro.kernel.qemu").strip() == "1")
        if self.clipboard_apk:
            exists = self.shell("pm path org.laolao.testing.clipboard").strip()
            self.device.push(self.clipboard_apk, "/data/local/tmp/laolao-ui34-clipboard.apk")
            assert "Success" in self.shell("pm install -r -t /data/local/tmp/laolao-ui34-clipboard.apk")
            self.clipboard_installed = not exists
        self.original = self.shell("run-as " + self.pkg + " cat shared_prefs/campus_v4_guest.xml")
        ET.fromstring(self.original)  # Fail before touching data if backup is invalid.
        for key in ("font_scale",):
            self.display[key] = self.shell("settings get system " + key).strip()
        self.shell("settings put system font_scale 1.0")
        for key in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
            self.global_settings[key] = self.shell("settings get global " + key).strip()
            self.shell("settings put global " + key + " 0")
        self.shell("logcat -c")
        self.day = self.shell("date +%Y-%m-%d").strip()
        day = dt.date.fromisoformat(self.day)
        monday = day - dt.timedelta(days=day.weekday())
        data = {
            "ui_skin_v1": "fresh", "ui_palette_v1": {"id": "mint", "p": "#356752"},
            "native_courses_meta": {"week1": monday.isoformat(), "times": ["00:00-23:59"], "ics": True},
            "personal_course_schedule_courses_v1": [
                {"id": "fixture-course", "name": "UI34 Course", "day": day.weekday(),
                 "start": 1, "end": 1, "weeks": "1-16", "location": "A302"}],
            "personal_events_v1": [
                {"id": "fixture-event", "subject": "UI34 Baseline", "event_time": self.day + " 19:00", "done": False}],
            "habits_v1": [{"id": "fixture-habit", "name": "UI34 Habit", "icon": "📚"}],
            "habit_log_v1": {},
            "island_v1": {"on": True, "side": "right", "screen": "fixture-display-preference"},
        }
        value = {"data": data, "clock": {}, "pending": {}, "revision": 0}
        root = ET.Element("map")
        ET.SubElement(root, "string", {"name": "data"}).text = json.dumps(value, ensure_ascii=False)
        self.write_raw(ET.tostring(root, encoding="unicode"))

    def enter_ascii(self, node, value):
        assert value.isascii(), "Use the explicit ASCII fixture, never shell-encode Chinese as input text"
        self.click(node)
        old = node.get("text", "")
        self.shell("input keyevent 123")
        if old and not old.startswith("请输入"):
            self.shell("input keyevent " + " ".join(["67"] * len(old)))
        self.shell("input text " + shlex.quote(value.replace(" ", "%s")))
        self.shell("input keyevent 4")

    def set_clipboard(self, value):
        """Use Android's real ClipboardManager, without modifying the application under test."""
        encoded = base64.b64encode(value.encode()).decode()
        component = "org.laolao.testing.clipboard/.ClipboardActivity"
        self.shell("am start -n " + component + " --es base64 " + shlex.quote(encoded))
        time.sleep(.2)

    def core(self):
        root = self.go("home")
        self.check("Five familiar primary destinations", all(self.find(t, root) for t in TABS))
        self.check("Record action remains available while a course is in progress", bool(self.find("记一件事", root)))
        self.shot("home")
        for label in TABS:
            self.tap(label, attempts=1)
            root = self.tree()
            self.native(root)
            self.check("Primary tab opens native screen: " + label,
                       any(n.get("content-desc") == label and n.get("selected") == "true"
                           for n in root.iter("node")))
        for label in ("班级墙", "规划", "成长", "班级"):
            self.go("home")
            self.tap("打开导航菜单", attempts=1)
            self.tap(label, attempts=2)
            root = self.tree()
            self.native(root)
            self.check("Full navigation menu opens: " + label,
                       any(label in text for text in self.labels(root)))
        self.import_flow()

    def import_flow(self):
        self.go("calendar")
        marker = "UI34Import" + str(int(time.time()))
        message = marker + " 今天19:30提交作业，地点 A302"
        if self.clipboard_apk:
            self.set_clipboard(message)
        self.tap("粘贴导入", attempts=2)
        root = self.tree()
        self.check("Calendar opens native paste-import form directly",
                   "整理并核对" in self.labels(root) and
                   any("发布日期" in text for text in self.labels(root)))
        fields = [n for n in root.iter("node") if n.get("class") == "android.widget.EditText"
                  and "点击选择日期" not in n.get("content-desc", "")]
        assert fields, "Paste-import text field absent"
        if self.clipboard_apk:
            self.check("Import tap reads the original Chinese message from the real Android clipboard",
                       fields[0].get("text") == message)
        else:
            self.enter_ascii(fields[0], marker + " " + self.day + " 19:30 A302")
        self.tap("整理并核对", attempts=1)
        root = self.tree()
        self.check("Import reaches editable review before persistence",
                   "核对整理结果" in self.labels(root) and
                   not any(marker in x.get("subject", "")
                           for x in self.read_store()["data"]["personal_events_v1"]))
        self.shot("paste-review")
        self.tap("保存到我的事项", attempts=3)
        saved = self.read_store()["data"]["personal_events_v1"]
        records = [x for x in saved if marker in x.get("subject", "")]
        self.check("Reviewed import creates one actual persisted personal event",
                   len(records) == 1 and records[0]["event_time"] == self.day + " 19:30")
        self.shell("am force-stop " + self.pkg)
        root = self.go("calendar")
        for _ in range(5):
            if any(marker in text for text in self.labels(root)):
                break
            if not self.scroll(root):
                break
            root = self.tree()
        self.check("Imported event survives process restart and appears in calendar",
                   any(marker in text for text in self.labels(root)) and
                   any(x["id"] == records[0]["id"] for x in self.read_store()["data"]["personal_events_v1"]))
        self.shot("calendar-imported")

    def phone(self):
        self.go("tools")
        root = self.tree()
        fields = [n for n in root.iter("node") if n.get("class") == "android.widget.EditText"]
        assert fields, "Native tool search field absent"
        self.enter_ascii(fields[0], "PDF")
        root = self.tree()
        self.check("Tool search keeps the scanner reachable", "拍照资料扫描" in self.labels(root))
        self.tap("拍照资料扫描", attempts=2)
        self.native(self.tree())
        self.check("Search result opens the native scanner")
        for route in PHONE_ROUTES:
            root = self.go(route)
            self.check("Phone capability opens its native page: " + route,
                       len(self.labels(root)) > len(TABS) + 2)

    def guide(self):
        root = self.go("home")
        entry = "捞捞助手：查看提醒和询问安排"
        self.check("Original mascot has a persistent native entry", bool(self.find(entry, root)))
        self.tap(entry, attempts=1)
        root = self.tree()
        self.check("Mascot opens a usable native assistant",
                   "你的学习小助手" in self.labels(root) and
                   not any("WebView" in n.get("class", "") for n in root.iter("node")))
        self.tap("今天有什么课", attempts=3)
        root = self.tree()
        self.check("Assistant answers from the saved timetable",
                   any("UI34 Course" in text for text in self.labels(root)))
        self.shot("mascot-course-answer")
        self.tap("捞捞助手设置", attempts=1)
        self.tap("关闭首页提醒，小人仍可从顶部打开", attempts=1)
        prefs = self.read_store()["data"]["island_v1"]
        self.check("Hiding mascot reminders persists without deleting website preferences",
                   prefs == {"on": False, "side": "right", "screen": "fixture-display-preference"})
        self.shell("am force-stop " + self.pkg)
        root = self.go("home")
        self.check("Reminder preference survives restart while the mascot remains reachable",
                   "捞捞休息中" in self.labels(root) and bool(self.find(entry, root)))
        self.tap("恢复捞捞首页提醒", attempts=1)
        self.check("Restoring mascot reminders writes the original preference",
                   self.read_store()["data"]["island_v1"]["on"] is True)
        self.tap("收起捞捞助手", attempts=1)
        self.check("Restored home hint is visible", "捞捞在这儿" in self.labels(self.tree()))

    def close(self):
        try:
            if self.original is not None:
                self.write_raw(self.original)
                restored = self.shell("run-as " + self.pkg + " cat shared_prefs/campus_v4_guest.xml")
                self.check("Original guest preference bytes restored", restored == self.original)
            for key, value in self.display.items():
                if value == "null":
                    self.shell("settings delete system " + key)
                else:
                    self.shell("settings put system " + key + " " + shlex.quote(value))
            for key, value in self.global_settings.items():
                if value == "null":
                    self.shell("settings delete global " + key)
                else:
                    self.shell("settings put global " + key + " " + shlex.quote(value))
        finally:
            if self.clipboard_installed:
                self.shell("pm uninstall org.laolao.testing.clipboard")
            self.temp.cleanup()
            self.device.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--phase", choices=("core", "phone", "guide", "all", "remaining"), default="all")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5555)
    parser.add_argument("--package", default="com.laolao.classcalendar.preview")
    parser.add_argument("--source-only", action="store_true")
    parser.add_argument("--clipboard-helper", help="Test-only ClipboardActivity APK; not shipped with the application")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    count = source_routes(repo)
    print("PASS Preserved native route contracts:", count, flush=True)
    if args.source_only:
        return
    device = NativeDevice(args)
    try:
        device.check("Preserved all original native route contracts", count == 63)
        device.fixture()
        if args.phase in ("core", "all"):
            device.core()
        if args.phase == "remaining":
            device.import_flow()
        if args.phase in ("phone", "all", "remaining"):
            device.phone()
        if args.phase in ("guide", "all", "remaining"):
            device.guide()
        device.check("No Android runtime crash", "FATAL EXCEPTION" not in device.shell("logcat -d -s AndroidRuntime:E"))
        device.report["result"] = "passed"
    except Exception as error:
        device.report.update({"result": "failed", "failure": repr(error)})
        try:
            device.shot("failure")
            (device.out / "failure.xml").write_text(ET.tostring(device.tree(), encoding="unicode"))
        except Exception:
            pass
        raise
    finally:
        device.close()
        device.report["passed"] = len(device.report["checks"])
        device.write()


if __name__ == "__main__":
    main()
