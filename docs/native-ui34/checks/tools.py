"""Focused black-box checks for the native tool chooser.

Run after the main flows runner has released the disposable preview emulator:
  python tools.py --output /path/to/results

Importing this module does not connect to Android. The original guest XML bytes,
font scale, and size/density overrides are restored in finally. No account or
preference backup is written into the report directory.
"""

import argparse
import json
import re
import shlex
import time
import xml.etree.ElementTree as ET

from flows import NativeDevice


class ToolsDevice(NativeDevice):
    def __init__(self, args):
        super().__init__(args)
        self.geometry = {}
        self.geometry_raw = {}
        self.baseline = None

    def write(self):
        (self.out / "tools-report.json").write_text(
            json.dumps(self.report, ensure_ascii=False, indent=2))

    def fixture(self):
        for setting in ("size", "density"):
            raw = self.shell("wm " + setting).strip()
            self.geometry_raw[setting] = raw
            found = re.search(r"Override " + setting + r":\s*(\S+)", raw)
            self.geometry[setting] = found.group(1) if found else "reset"
        self.shell("wm size reset")
        self.shell("wm density reset")
        super().fixture()
        # The legacy navigation entry must survive chooser saves, but must not
        # be displayed among actual tools. Two visible learning choices keep the
        # essential empty-selection check short without scrolling 34 checkboxes.
        value = self.read_store()
        value["data"]["native_home_tools"] = ["homework", "courses"]
        root = ET.Element("map")
        ET.SubElement(root, "string", {"name": "data"}).text = json.dumps(value, ensure_ascii=False)
        self.write_raw(ET.tostring(root, encoding="unicode"))
        self.baseline = value["data"]

    def visible(self, node):
        l, t, r, b = self.bounds(node)
        return r > l and b > t and node.get("enabled") != "false"

    def control(self, label, root):
        matches = [n for n in self.find(label, root) if self.visible(n)]
        assert matches, "Visible control is absent: " + label
        return matches[0]

    def click_label(self, label, root):
        self.click(self.control(label, root))

    def checkbox(self, label, root):
        matches = [n for n in root.iter("node")
                   if n.get("class") == "android.widget.CheckBox"
                   and (n.get("text") == label or n.get("content-desc") == "常用工具：" + label)
                   and self.visible(n)]
        assert matches, "Visible checkbox is absent: " + label
        return matches[0]

    def edit(self):
        root = self.go("tools")
        self.click_label("选择常用工具", root)
        root = self.tree()
        native_checks = bool(self.find("选择常用工具", root)) and any(
            n.get("class") == "android.widget.CheckBox" for n in root.iter("node"))
        assert native_checks, "Tool editor did not open native checkboxes"
        if "Tool selections use real native checkboxes" not in self.report["checks"]:
            self.check("Tool selections use real native checkboxes", native_checks)
        return root

    def unchanged_records(self, data):
        for key in ("personal_course_schedule_courses_v1", "personal_events_v1",
                    "habits_v1", "habit_log_v1", "island_v1"):
            assert data[key] == self.baseline[key], "Tool chooser changed learning data: " + key

    def run(self):
        root = self.go("tools")
        self.check("Tool hub uses category rows instead of 34 expanded tools",
                   "常用工具" in self.labels(root) and
                   bool(self.find("学习 · 7 项，课程表 · 考试 · 错题 · 复习", root)) and
                   not self.find("记忆晶片", root))
        self.shot("tools-hub")

        root = self.edit()
        before = self.read_store()
        self.click(self.checkbox("错题记录本", root))
        self.click_label("取消", root)
        self.check("Cancelling tool edits writes no preference",
                   self.read_store() == before)

        root = self.edit()
        self.click(self.checkbox("单词搭子", root))
        self.click_label("保存", root)
        data = self.read_store()["data"]
        self.check("Checkbox save persists the actual selection and old navigation entry",
                   data["native_home_tools"] == ["homework", "courses", "words"])
        self.unchanged_records(data)
        self.check("Selecting tools preserves existing learning records")
        self.shell("am force-stop " + self.pkg)
        root = self.go("tools")
        self.check("Selected shortcuts survive restart",
                   bool(self.find("课程表", root)) and bool(self.find("单词搭子", root)))

        # Exercise the visible shortcut beside Tools in the complete navigation,
        # rather than relying solely on the hidden long-press convenience.
        self.click_label("打开导航菜单", root)
        self.tap("快捷选择工具", attempts=3)
        root = self.tree()
        self.check("Navigation tool shortcut shows the saved actual tools",
                   "快捷工具" in self.labels(root) and bool(self.find("课程表", root))
                   and bool(self.find("单词搭子", root)))
        self.shot("quick-tools")
        self.click_label("课程表", root)
        root = self.tree()
        self.native(root)
        self.check("Shortcut opens the real native timetable",
                   "每周课程表" in self.labels(root) and
                   any("UI34 Course" in text for text in self.labels(root)))

        root = self.go("tools")
        query = next(n for n in root.iter("node") if n.get("class") == "android.widget.EditText")
        self.click(query)
        self.shell("input text PDF")
        root = self.tree()
        self.check("Search filters real tools while retaining input focus",
                   "搜索结果 · 1 项" in self.labels(root)
                   and "拍照资料扫描" in self.labels(root)
                   and any(n.get("class") == "android.widget.EditText"
                           and n.get("text") == "PDF" and n.get("focused") == "true"
                           for n in root.iter("node")))
        self.shell("input keyevent 4")
        self.tap("清空工具搜索", attempts=1)

        root = self.edit()
        self.click(self.checkbox("完整课程表", root))
        self.click(self.checkbox("单词搭子", root))
        self.click_label("保存", root)
        data = self.read_store()["data"]
        self.check("Empty actual-tool selection saves without deleting the legacy entry",
                   data["native_home_tools"] == ["homework"])
        self.shell("am force-stop " + self.pkg)
        root = self.go("tools")
        self.check("An intentionally empty selection survives restart",
                   "选择你常用的工具" in self.labels(root)
                   and self.read_store()["data"]["native_home_tools"] == ["homework"])

        self.shell("wm size 960x1920")
        self.shell("wm density 480")
        self.shell("settings put system font_scale 1.5")
        time.sleep(.3)
        root = self.go("tools")
        add = self.control("选择常用工具", root)
        l, t, r, b = self.bounds(add)
        self.check("320dp large-font add button remains visible with a 48dp touch target",
                   add.get("text") == "＋" and min(r-l, b-t) >= 143)
        self.shot("320dp-large-font-tools")
        self.click(add)
        root = self.tree()
        save = self.control("保存", root)
        cancel = self.control("取消", root)
        self.check("320dp large-font editor keeps save and cancel visible",
                   save.get("clickable") == "true" and cancel.get("clickable") == "true")
        self.click(self.checkbox("完整课程表", root))
        visible_before = {n.get("text") for n in root.iter("node")
                          if n.get("class") == "android.widget.CheckBox" and self.visible(n)}
        save_bounds = self.bounds(save)
        self.check("320dp editor provides a scrollable checkbox body", self.scroll(root))
        root = self.tree()
        visible_after = {n.get("text") for n in root.iter("node")
                         if n.get("class") == "android.widget.CheckBox" and self.visible(n)}
        self.check("Checkbox body scrolls independently while save remains fixed",
                   bool(visible_after - visible_before)
                   and self.bounds(self.control("保存", root)) == save_bounds)
        self.shot("320dp-large-font-tool-editor")
        self.click_label("保存", root)
        data = self.read_store()["data"]
        self.check("320dp large-font save button is operable and persists a selected tool",
                   data["native_home_tools"] == ["homework", "courses"])
        self.unchanged_records(data)
        self.check("All tool flows preserve the saved learning records")
        self.check("No Android runtime crash", "FATAL EXCEPTION" not in
                   self.shell("logcat -d -s AndroidRuntime:E"))

    def close(self):
        try:
            for setting, value in self.geometry.items():
                self.shell("wm " + setting + " " + shlex.quote(value))
                self.check("Original display " + setting + " override restored",
                           self.shell("wm " + setting).strip() == self.geometry_raw[setting])
        finally:
            super().close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5555)
    parser.add_argument("--package", default="com.laolao.classcalendar.preview")
    args = parser.parse_args()
    args.clipboard_helper = None
    device = ToolsDevice(args)
    try:
        device.fixture()
        device.run()
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
        try:
            device.close()
        except Exception as error:
            device.report.update({"result": "failed", "cleanup_failure": repr(error)})
            raise
        finally:
            device.report["passed"] = len(device.report["checks"])
            device.write()


if __name__ == "__main__":
    main()
