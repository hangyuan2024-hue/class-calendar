"""Native APK checks on a disposable emulator; requires Python adb-shell, port 5555.

Never run against a personal phone: the persistence phase intentionally changes preview test data.
UI 3.3 regression: python native_regression.py --phase screens|forms --output /path/to/results
"""
import argparse, json, re, shlex, sys, time, xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['screens', 'forms'], default='screens')
parser.add_argument('--output', required=True)
parser.add_argument('--forms-from', choices=['beginning','course','focus','words'], default='beginning', help='Resume from course or focus after earlier form assertions')
parser.add_argument('--fixture-prefix', default='Test'+str(int(time.time())), help='Unique label prefix for records created by the forms phase')
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
report_path = out / 'device-checks.json'
report = json.loads(report_path.read_text()) if report_path.exists() else {'checks': [], 'device': 'Android 9 / API 28 AOSP x86_64 emulator', 'package': pkg, 'cloud_authenticated': 'not tested', 'physical_Huawei': 'not available'}

def shell(cmd): return device.shell(cmd, read_timeout_s=90)
def tree():
    result = ''
    for _ in range(6):
        result = shell('uiautomator dump /sdcard/campus-check.xml')
        # API 28 can briefly return a null accessibility root during a route
        # transition. Read a fresh compressed hierarchy instead of stale XML.
        if 'dumped' not in result:
            result = shell('uiautomator dump --compressed /sdcard/campus-check.xml')
        if 'dumped' in result:
            raw = shell('cat /sdcard/campus-check.xml')
            try: return ET.fromstring(raw)
            except ET.ParseError: pass
        time.sleep(.5)
    raise AssertionError('Cannot read native UI hierarchy: '+result.strip())
def texts(root=None): return [n.attrib.get('text', '') for n in (root if root is not None else tree()).iter('node') if n.attrib.get('text')]
def check(name, ok=True):
    if not ok: raise AssertionError(name)
    if name not in report['checks']: report['checks'].append(name)
    print('PASS', name, flush=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
def native(root):
    check('UI uses native Android widgets', not any('WebView' in n.attrib.get('class', '') for n in root.iter('node')))
def tap_node(n):
    l,t,r,b = map(int,re.findall(r'\d+',n.attrib['bounds']))
    assert r>l and b>t, 'Node is outside viewport'
    shell(f'input tap {(l+r)//2} {(t+b)//2}'); time.sleep(.25)
def tap(label, scroll=True):
    for step in range(7 if scroll else 2):
        nodes=[n for n in tree().iter('node') if n.attrib.get('text')==label or n.attrib.get('content-desc')==label]
        if nodes:
            # Bottom navigation labels may be both a parent content-description and a child.
            try: tap_node(nodes[-1]); return
            except AssertionError: pass
        if scroll: shell('input swipe 550 1680 550 700 300'); time.sleep(.2)
    raise AssertionError('Missing control: '+label)
def edit(index, value):
    fields=[n for n in tree().iter('node') if n.attrib.get('class')=='android.widget.EditText']
    n=fields[index]; old=n.attrib.get('text',''); tap_node(n)
    shell('input keyevent 123')
    if old: shell('input keyevent '+' '.join(['67']*len(old)))
    if value: shell('input text '+shlex.quote(value.replace(' ','%s')))
    shell('input keyevent 4'); time.sleep(.25)
def go(route):
    shell('am start -n '+activity+' --es go '+shlex.quote(route)); time.sleep(.3)
    root=tree(); native(root)
    assert '捞捞校园' in texts(root), 'Native screen not shown: '+route
    return root
def shot(name):
    shell('screencap -p /sdcard/campus-shot.png')
    device.pull('/sdcard/campus-shot.png', str(out/(name+'.png')))
def read_store():
    # Android atomically replaces this XML while committing; an external reader can
    # briefly see the rename/write window. Retry, then fail with the original error.
    last=None
    for _ in range(12):
        raw=shell('run-as '+pkg+' cat shared_prefs/campus_v4_guest.xml')
        try:return json.loads(ET.fromstring(raw).find("string[@name='data']").text)
        except (ET.ParseError,json.JSONDecodeError,AttributeError) as error:
            last=error;time.sleep(.15)
    raise last
def await_store(predicate, timeout=20):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=read_store()
        if predicate(value):return value
        time.sleep(.2)
    raise AssertionError('Native stored result did not arrive before timeout')
def save_store(value):
    # Used only for deadline/failure fixtures in the disposable preview emulator.
    shell('am force-stop '+pkg)
    node=ET.Element('map'); s=ET.SubElement(node,'string',{'name':'data'}); s.text=json.dumps(value,ensure_ascii=False,separators=(',',':'))
    path=out/'fixture-store.xml';path.write_bytes(ET.tostring(node,encoding='utf-8',xml_declaration=True))
    device.push(str(path),'/data/local/tmp/campus-fixture.xml')
    assert not shell('run-as '+pkg+' sh -c '+shlex.quote('cat /data/local/tmp/campus-fixture.xml > shared_prefs/campus_v4_guest.xml')).strip()
def restart(route):
    shell('am force-stop '+pkg); return go(route)
def private_bytes(path):
    import base64
    return base64.b64decode(shell('run-as '+pkg+' base64 '+shlex.quote(path)))
def save_document(filename):
    # Use the actual Android document provider instead of writing exports through ADB.
    for _ in range(10):
        root=tree()
        if any(n.attrib.get('package')=='com.android.documentsui' for n in root.iter('node')):break
        time.sleep(.3)
    fields=[n for n in root.iter('node') if n.attrib.get('class')=='android.widget.EditText']
    if fields:edit(0,filename)
    root=tree()
    controls=[n for n in root.iter('node') if n.attrib.get('text','').upper()=='SAVE' or n.attrib.get('text')=='保存']
    assert controls, 'Android save button is missing'
    tap_node(controls[-1]);time.sleep(.7)
    # An earlier partial run can leave the same output filename in Downloads.
    root=tree()
    replaces=[n for n in root.iter('node') if n.attrib.get('text','').upper()=='REPLACE']
    if replaces:tap_node(replaces[-1]);time.sleep(.5)

original_store = None
try:
    check('Disposable emulator', shell('getprop ro.kernel.qemu').strip() == '1')
    original_store = read_store()
    save_store({'data': {'ui_skin_v1': 'fresh', 'ui_palette_v1': {'id': 'mint', 'p': '#356752'}}, 'clock': {}, 'pending': {}, 'revision': 0})
    check('Regression uses isolated test records', not read_store()['data'].get('personal_events_v1'))
    check('Preview APK installed', pkg in shell('pm list packages '+pkg))
    shell('logcat -c')
    if args.phase in ('screens','all'):
        screenshots={'home':'native-home','calendar':'native-calendar','tools':'native-tools','courses':'native-courses','meta':'native-metaverse','words':'native-words','phone':'native-phone','pomo':'native-focus','ledger':'native-ledger'}
        routes=['home','calendar','class','tools','me','homework','courses','countdown','ledger','wrongbook','diary','plan','growth','farm','meta','pomo','search','cards','review','checklist','report','phone','widget','reminders','inbox','voice','recordings','privacy','quiet','places','scanner','contacts','time-master','words','oracle','draw','plugins','security','backup','appearance','about','intro','credits','ask','login','register']
        for route in routes:
            root=go(route); check('Native route opens: '+route)
            if route=='words':
                for _ in range(12):
                    if any('本机离线词库' in text for text in texts(root)):break
                    time.sleep(.3);root=tree()
                check('Full offline dictionary loads in the APK',any('本机离线词库' in text for text in texts(root)))
            if route in screenshots: shot(screenshots[route])
        go('home'); shell('wm size 880x1720'); shell('wm density 440'); time.sleep(.5)
        root=tree();check('320dp screen retains all five navigation controls',all(t in texts(root) for t in ['今日','日程','成长','工具','我的']));shot('native-small-320dp')
        shell('wm size reset');shell('wm density reset');go('home')
    if args.phase in ('forms','all'):
        shell('am force-stop '+pkg)
        if args.forms_from not in ('focus','words'):
            if args.forms_from=='beginning':
                go('calendar');tap('＋ 个人事项');edit(0,args.fixture_prefix+'TaskCheck');tap('保存')
                data=read_store()['data']; tasks=data['personal_events_v1'];task=next(x for x in tasks if x['subject']==args.fixture_prefix+'TaskCheck')
                check('Personal item created using native form',bool(task['id']))
                root=restart('calendar');check('Personal item survives process restart',any(x['subject']==args.fixture_prefix+'TaskCheck' for x in read_store()['data']['personal_events_v1']))
                tap(args.fixture_prefix+'TaskCheck');tap('标记完成');check('Personal completion saved',next(x for x in read_store()['data']['personal_events_v1'] if x['id']==task['id'])['done'])
                go('countdown');tap('＋ 添加考试');edit(0,args.fixture_prefix+'ExamCheck');tap('保存')
                check('Exam countdown created',any(x['title']==args.fixture_prefix+'ExamCheck' for x in read_store()['data']['native_exams']))
                go('ledger');tap('＋ 记一笔');edit(0,args.fixture_prefix+'LunchCheck');edit(1,'12.34');tap('保存')
                check('Ledger stores exact integer cents',next(x for x in read_store()['data']['native_ledger'] if x['title']==args.fixture_prefix+'LunchCheck')['cents']==1234)
            go('courses');tap('＋ 添加课程');edit(0,args.fixture_prefix+'MathCheck');tap('保存')
            if '课程时间重叠' in texts():tap('确定')
            check('Course created with week recurrence',any(x['name']==args.fixture_prefix+'MathCheck' for x in read_store()['data']['personal_course_schedule_courses_v1']))
            go('wrongbook');tap('＋ 记录错题');edit(0,args.fixture_prefix+'WrongCheck');edit(1,'Math');
            # The answer field may be below the first viewport.
            shell('input swipe 550 1470 550 690 350');time.sleep(.3)
            fields=[n for n in tree().iter('node') if n.attrib.get('class')=='android.widget.EditText']
            target=None
            root=tree();nodes=list(root.iter('node'))
            for i,n in enumerate(nodes):
                if n.attrib.get('text')=='正确答案':
                    target=next((x for x in nodes[i+1:] if x.attrib.get('class')=='android.widget.EditText'),None);break
            if target is not None:tap_node(target);shell('input text 42');shell('input keyevent 4')
            tap('保存');check('Wrong-answer record created',any(x['title']==args.fixture_prefix+'WrongCheck' for x in read_store()['data']['native_wrong']))
            go('growth');tap('＋ 新建习惯');edit(0,args.fixture_prefix+'ReadCheck');tap('保存');tap('今日打卡')
            check('Habit check-in recorded',any(any(v.values()) for v in read_store()['data']['habit_log_v1'].values()))
            go('diary');edit(0,'Today I learned something real.')
            check('Diary autosaves',any('something real' in x.get('text','') for x in read_store()['data']['native_diary'].values()))
            restart('diary');check('Diary survives restart',any('something real' in x.get('text','') for x in read_store()['data']['native_diary'].values()))
        if args.forms_from!='words':
            go('pomo')
            if read_store()['data'].get('native_pomo_timer',{}).get('phase')=='break':tap('结束本轮');tap('确定')
            tap('开始专注');check('Focus starts with a stored deadline',read_store()['data']['native_pomo_timer']['running'])
            restart('pomo');tap('暂停');check('Focus pause persists remaining time',not read_store()['data']['native_pomo_timer']['running'] and read_store()['data']['native_pomo_timer']['remaining']>0)
            state=read_store();state['data']['native_pomo_timer']={'id':'timer-fixture','phase':'focus','duration':60000,'remaining':60000,'deadline':int(time.time()*1000)-100,'running':True}
            before=sum(state['data'].get('pomo_log_v1',{}).values());save_store(state);go('pomo')
            check('Expired focus counts exactly once',sum(read_store()['data']['pomo_log_v1'].values())==before+1)
            restart('pomo');check('Repeated launch does not count focus twice',sum(read_store()['data']['pomo_log_v1'].values())==before+1)
            check('Focus creates real session duration',read_store()['data']['native_focus_sessions'][-1]['minutes']==1)
        root=go('words')
        for _ in range(12):
            if any('本机离线词库' in text for text in texts(root)):break
            time.sleep(.3);root=tree()
        mode=read_store()['data'].get('native_word_mode','首页')
        if mode!='首页':tap(mode+' ▾');tap('首页')
        tap('开始学习');tap('翻面与反馈');tap('选择操作');tap('记住了 · 延长间隔')
        check('Offline word learning records due date',any(v.get('due',0)>int(time.time()*1000) for v in read_store()['data']['native_word_progress'].values()))
        go('draw');tap('批量添加');edit(0,'Alice\nBob\nCarol');tap('保存');tap('开始抽一个')
        check('Random draw stores a real result',len(read_store()['data']['native_draw_history'])>0)
    log=shell('logcat -d -s AndroidRuntime:E');(out/'android-runtime.log').write_text(log)
    check('No fatal Android runtime exception','FATAL EXCEPTION' not in log)
    phases=report.setdefault('completed_phases',[])
    if args.phase not in phases:phases.append(args.phase)
    report['passed']=len(report['checks']);report['result']='passed'
finally:
    shell('wm size reset');shell('wm density reset')
    if original_store is not None: save_store(original_store)
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2));device.close()
