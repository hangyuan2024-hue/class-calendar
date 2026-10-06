"""Black-box native UI checks. Disposable preview emulator only; restores its original records."""
import argparse, copy, datetime as dt, json, re, shlex, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--phase', choices=['core', 'skins', 'sizes', 'all'], default='all')
args = parser.parse_args()
try:
    from adb_shell.adb_device import AdbDeviceTcp
except ImportError:
    sys.path.insert(0, '/workspace/native-build/pylibs')
    from adb_shell.adb_device import AdbDeviceTcp
device = AdbDeviceTcp('127.0.0.1', 5555, default_transport_timeout_s=90)
device.connect(auth_timeout_s=15)
pkg = 'com.laolao.classcalendar.preview'
activity = pkg + '/com.laolao.classcalendar.CampusActivity'
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report = {'package': pkg, 'version': '3.3.11-preview', 'checks': [], 'screenshots': [], 'device': 'Android 9 / API 28 AOSP emulator'}
backup = None

def shell(command): return device.shell(command, read_timeout_s=90)
def tree():
    for _ in range(8):
        if 'dumped' in shell('uiautomator dump --compressed /sdcard/campus-ui33.xml'):
            try: return ET.fromstring(shell('cat /sdcard/campus-ui33.xml'))
            except ET.ParseError: pass
        time.sleep(.3)
    raise AssertionError('Fresh native hierarchy unavailable')
def texts(root=None): return [n.get('text', '') for n in (root if root is not None else tree()).iter('node') if n.get('text')]
def bounds(node): return list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
def find(label, root=None):
    nodes = [n for n in (root if root is not None else tree()).iter('node') if n.get('text') == label or n.get('content-desc') == label or (n.get('class') == 'android.widget.Switch' and n.get('text', '').startswith(label))]
    return nodes
def click(node):
    l, t, r, b = bounds(node); assert r > l and b > t
    shell(f'input tap {(l+r)//2} {(t+b)//2}'); time.sleep(.3)
def scroll_content(root=None):
    root = root if root is not None else tree()
    regions = [n for n in root.iter('node') if n.get('scrollable') == 'true' and 'ScrollView' in n.get('class', '')]
    assert regions, 'No native scroll container available'
    l, t, r, b = bounds(regions[0])
    # Start inside the scroll padding: Android Spinner consumes a swipe that starts on its selection.
    x = l + max(10, (r-l)//30)
    shell(f'input swipe {x} {b-55} {x} {t+65} 400'); time.sleep(.3)
def tap(label):
    for _ in range(9):
        root = tree(); nodes = find(label, root)
        for n in reversed(nodes):
            l, t, r, b = bounds(n)
            if r > l and b > t: click(n); return
        scroll_content(root)
    raise AssertionError('Missing native control: ' + label)
def go(route):
    shell('am start -n ' + activity + ' --es go ' + shlex.quote(route)); time.sleep(.4)
    root = tree()
    assert '捞捞校园' in texts(root), 'App did not open ' + route
    assert not any('WebView' in n.get('class', '') for n in root.iter('node'))
    return root
def check(name, value=True):
    assert value, name
    report['checks'].append(name); write(); print('PASS', name, flush=True)
def write(): (out / 'ui33-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
def shot(name):
    shell('screencap -p /sdcard/campus-ui33.png')
    device.pull('/sdcard/campus-ui33.png', str(out / (name + '.png')))
    report['screenshots'].append(name + '.png'); write()
    return Image.open(out / (name + '.png')).convert('RGB')
def read():
    for _ in range(10):
        try: return json.loads(ET.fromstring(shell('run-as ' + pkg + ' cat shared_prefs/campus_v4_guest.xml')).find("string[@name='data']").text)
        except (ET.ParseError, json.JSONDecodeError, AttributeError): time.sleep(.2)
    raise AssertionError('Cannot read saved preview records')
def restore(value):
    shell('am force-stop ' + pkg)
    xml = ET.Element('map'); string = ET.SubElement(xml, 'string', {'name': 'data'}); string.text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    path = out / 'fixture-store.xml'; path.write_bytes(ET.tostring(xml, encoding='utf-8', xml_declaration=True))
    device.push(str(path), '/data/local/tmp/campus-ui33-fixture.xml')
    assert not shell('run-as ' + pkg + ' sh -c ' + shlex.quote('cat /data/local/tmp/campus-ui33-fixture.xml > shared_prefs/campus_v4_guest.xml')).strip()
def nav(root): return all(label in texts(root) for label in ['今日', '日程', '成长', '工具', '我的'])
def search(value):
    n = next(n for n in tree().iter('node') if n.get('class') == 'android.widget.EditText'); old = n.get('text', ''); click(n)
    shell('input keyevent 123')
    if old: shell('input keyevent ' + ' '.join(['67'] * len(old)))
    if value: shell('input text ' + shlex.quote(value))
    time.sleep(.3)
def business(value): return {k: v for k, v in value['data'].items() if k not in ['ui_skin_v1', 'ui_palette_v1', 'native_recent_tools']}

try:
    check('Disposable emulator', shell('getprop ro.kernel.qemu').strip() == '1')
    check('Final preview version installed', 'versionName=3.3.11-preview' in shell('dumpsys package ' + pkg))
    backup = copy.deepcopy(read())
    shell('wm size reset'); shell('wm density reset'); shell('settings put system font_scale 1.0'); shell('cmd uimode night no'); shell('logcat -c')
    day = shell('date +%Y-%m-%d').strip(); current = dt.date.fromisoformat(day); mon = current - dt.timedelta(days=current.weekday())
    fixture = {'data': {}, 'clock': {}, 'pending': {}, 'revision': 0}
    data = fixture['data']
    data.update({'ui_skin_v1': 'fresh', 'ui_palette_v1': {'id': 'mint', 'p': '#356752'}, 'native_wrong_subject': '全部', 'native_wrong_mode': '全部', 'native_view_week': 1,
                 'native_courses_meta': {'week1': mon.isoformat(), 'times': ['08:00-08:50', '09:00-09:50', '10:10-11:00', '11:10-12:00', '14:00-14:50', '15:00-15:50'], 'ics': True},
                 'personal_course_schedule_courses_v1': [{'id': 'demo-course-1', 'name': '高等数学', 'day': current.weekday(), 'start': 5, 'end': 6, 'weeks': '1-16', 'location': '教学楼 A302', 'teacher': '陈老师'}, {'id': 'demo-course-2', 'name': '大学英语', 'day': current.weekday(), 'start': 1, 'end': 2, 'weeks': '1-16', 'location': '教学楼 B206'}],
                 'personal_events_v1': [{'id': 'demo-event-1', 'subject': '整理本周课堂笔记', 'event_time': day + ' 19:00', 'done': False}, {'id': 'demo-event-2', 'subject': '复习微积分章节', 'event_time': day + ' 20:00', 'done': False}],
                 'habits_v1': [{'id': 'demo-read', 'name': '每天阅读', 'icon': '📚'}, {'id': 'demo-exercise', 'name': '校园慢跑', 'icon': '🌿'}],
                 'habit_log_v1': {'demo-read': {day: True}, 'deleted-habit': {day: True}},
                 'native_wrong': [{'id': 'demo-wrong-' + str(i), 'title': ['标准极限的使用条件', '主谓一致的判断', '链式求导的步骤', '数组遍历的边界'][i], 'subject': ['高等数学', '大学英语', '高等数学', '程序设计'][i], 'question': '回顾课堂中的条件，写清每一步的依据。', 'answer': '先明确条件，再选择方法。', 'reason': '容易遗漏题目中的限制条件。', 'analysis': '按定义和条件重新整理。', 'due': day, 'mastered': i == 2} for i in range(4)]})
    restore(fixture)
    if args.phase in ['core', 'all']:
        root = go('home'); check('Five native navigation destinations including Growth', nav(root))
        for label in ['今日课程，2', '待办事项，2', '今日打卡，1']:
            check('Actual saved dashboard count: ' + label, bool(find(label, root)))
        before = shot('home'); density = float(re.findall(r'\d+', shell('wm density'))[-1]) / 160
        for desc in ['返回今日工作台', '搜索校园记录', '切换校园皮肤', '登录或注册账号']:
            l, t, r, b = bounds(find(desc, root)[0]); check('48dp header target: ' + desc, min(r-l, b-t) >= round(48*density)-1)
        brand = bounds(find('捞捞校园', root)[0]); crop = (0, brand[1]-10, before.width, brand[3]+35)
        shell('input swipe 550 1620 550 650 350'); time.sleep(.5); after = shot('home-scrolled')
        check('Opaque app bar remains stable during scrolling', ImageChops.difference(before.crop(crop), after.crop(crop)).getbbox() is None)
        check('Bottom navigation remains reachable during scrolling', nav(tree()))
        shell('am force-stop ' + pkg); go('home')
        tap('成长'); check('Growth navigation opens real habit progress', '1 / 2' in texts())
        shot('growth'); tap('今日打卡'); check('Habit control writes an actual check-in', read()['data']['habit_log_v1']['demo-exercise'][day] is True)
        go('wrongbook'); shot('bookshelf')
        tap('打开高等数学错题本，2道错题'); check('Subject cover filters real records', read()['data']['native_wrong_subject'] == '高等数学' and '主谓一致的判断' not in texts())
        shot('subject-notebook')
        root = go('tools'); categories = ['全部', '学习', '规划', '生活', '手机', '更多']
        check('Six tool categories visible together', all(find(label, root) for label in categories))
        search('PDF'); root = tree(); check('Search filters actual tools and retains focus', '搜索结果 · 1 项' in texts(root) and any(n.get('text') == 'PDF' and n.get('focused') == 'true' for n in root.iter('node')))
        shell('input keyevent 4'); tap('拍照资料扫描'); shell('input keyevent 4'); time.sleep(.4)
        check('Returning to tools preserves the query', 'PDF' in texts() and '搜索结果 · 1 项' in texts())
        tap('清空工具搜索'); tap('手机'); check('Phone category keeps hub and all ten abilities', '手机工具 · 11 项' in texts())
        go('calendar'); shot('calendar'); go('courses'); shot('courses'); go('phone'); shot('phone'); go('meta'); shot('metaverse'); go('me'); shot('profile'); go('appearance'); shot('skins')
        go('me'); tap('快速应用月光白皮肤'); check('Profile colour swatch saves complete skin', read()['data']['ui_palette_v1']['id'] == 'moon')
    if args.phase in ['skins', 'all']:
        saved = copy.deepcopy(read())
        palettes = [('mint','薄荷雾','#F5F7F4'),('moon','月光白','#F7F6F3'),('sky','晴空蓝','#F3F6FD'),('forest','森野绿','#F0F6F2'),('sakura','樱花粉','#FCF3F6'),('apricot','暖杏橙','#FCF5EC'),('lavender','鸢尾紫','#F6F3FC'),('ocean','海盐青','#EFF7F8'),('cyber','深海赛博','#08131D'),('graphite','曜石黑','#12151B')]
        for ident, name, colour in palettes:
            go('appearance'); tap(name); check('Palette saved: ' + name, read()['data']['ui_palette_v1']['id'] == ident)
            root = go('home'); image = shot('skin-' + ident); expected = tuple(int(colour[i:i+2], 16) for i in [1,3,5])
            check('Actual palette pixels and native navigation: ' + name, image.getpixel((5,100)) == expected and nav(root))
        check('Ten skin switches preserve learning records', business(saved) == business(read()))
        shell('am force-stop ' + pkg); go('home'); check('Selected skin survives process restart', read()['data']['ui_palette_v1']['id'] == 'graphite')
        go('appearance'); tap('跟随手机深浅色'); check('System colour mode persists', read()['data']['ui_skin_v1'] == 'auto')
        shell('cmd uimode night yes'); time.sleep(.6); go('home'); image = shot('system-night'); check('System night mode changes full canvas', image.getpixel((5,100)) == (10,20,32))
        shell('cmd uimode night no'); time.sleep(.6); go('home'); check('System day mode restores the light canvas', shot('system-day').getpixel((5,100)) != (10,20,32))
    if args.phase in ['sizes', 'all']:
        restore(fixture)
        for width, height, density, font, label in [(960,1920,480,1.5,'320dp-large-font'), (1600,2400,320,1.,'tablet')]:
            shell(f'wm size {width}x{height}'); shell(f'wm density {density}'); shell(f'settings put system font_scale {font}'); time.sleep(.7)
            for route in ['home','tools','growth','wrongbook','me']:
                root = go(route); check(label + ' native navigation: ' + route, nav(root)); shot(label + '-' + route)
            go('ledger'); tap('＋ 记一笔'); root = tree()
            check(label + ' form save and cancel remain reachable', bool(find('保存',root)) and bool(find('取消',root)))
            dates = []
            for _ in range(8):
                root = tree()
                dates = [n for n in root.iter('node') if n.get('content-desc','').endswith('点击选择日期') and bounds(n)[3] > bounds(n)[1]]
                if dates: break
                scroll_content(root)
            assert dates; click(dates[0]); root = tree(); check(label + ' native date picker reachable', any('DatePicker' in n.get('class','') or 'date_picker' in n.get('resource-id','') for n in root.iter('node'))); shot(label + '-date-picker'); shell('input keyevent 4'); tap('取消')
    check('No Android runtime crash', 'FATAL EXCEPTION' not in shell('logcat -d -s AndroidRuntime:E'))
    report['result'] = 'passed'; report['passed'] = len(report['checks']); write()
except Exception as error:
    report['result'] = 'failed'; report['failure'] = repr(error); write()
    try: shot('failure'); (out/'failure.xml').write_text(ET.tostring(tree(), encoding='unicode'))
    except Exception: pass
    raise
finally:
    shell('wm size reset'); shell('wm density reset'); shell('settings put system font_scale 1.0'); shell('cmd uimode night no')
    if backup is not None: restore(backup)
    device.close()
