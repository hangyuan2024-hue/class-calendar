"""Black-box checks for the native 3.2 UI, on a disposable preview emulator only.

Run after the native-v4 forms checks. Requires adb-shell, Pillow and a running
Android emulator on port 5555. Never uses a personal device or a real account.
"""
import argparse, copy, json, re, shlex, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageChops

p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--resume-tail',action='store_true');p.add_argument('--resume-final-screens',action='store_true');args=p.parse_args()
try:
    from adb_shell.adb_device import AdbDeviceTcp
except ImportError:
    sys.path.insert(0,'/workspace/native-build/pylibs')
    from adb_shell.adb_device import AdbDeviceTcp
x=AdbDeviceTcp('127.0.0.1',5555,default_transport_timeout_s=90);x.connect(auth_timeout_s=15)
pkg='com.laolao.classcalendar.preview';activity=pkg+'/com.laolao.classcalendar.CampusActivity'
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
report={'device':'Android 9 / API 28 emulator','package':pkg,'checks':[], 'screens':[], 'physical_Huawei':'not available'}
if args.resume_tail or args.resume_final_screens:report=json.loads((out/'ui-checks.json').read_text())
backup=None
original_ime=None

def shell(cmd):return x.shell(cmd,read_timeout_s=90)
def tree():
    for _ in range(7):
        dumped=shell('uiautomator dump /sdcard/native-ui-check.xml')
        if 'dumped' not in dumped:dumped=shell('uiautomator dump --compressed /sdcard/native-ui-check.xml')
        if 'dumped' in dumped:
            try:return ET.fromstring(shell('cat /sdcard/native-ui-check.xml'))
            except ET.ParseError:pass
        time.sleep(.3)
    raise AssertionError('Native hierarchy unavailable')
def texts(root=None):return [n.get('text','') for n in (root if root is not None else tree()).iter('node') if n.get('text')]
def check(name,condition=True):
    if not condition:raise AssertionError(name)
    if name not in report['checks']:report['checks'].append(name)
    (out/'ui-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('PASS',name,flush=True)
def bounds(n):return list(map(int,re.findall(r'\d+',n.get('bounds',''))))
def node(label,root=None):
    found=[n for n in (root if root is not None else tree()).iter('node') if n.get('text')==label or n.get('content-desc')==label]
    assert found,'Missing native control: '+label
    return found[-1]
def click(n):
    l,t,r,b=bounds(n);assert r>l and b>t
    shell(f'input tap {(l+r)//2} {(t+b)//2}');time.sleep(.25)
def tap(label):click(node(label))
def go(route):
    shell('am start -n '+activity+' --es go '+shlex.quote(route));time.sleep(.5)
    for _ in range(5):
        root=tree()
        if '捞捞校园' in texts(root):break
        time.sleep(.5)
    assert '捞捞校园' in texts(root),'Native route unavailable: '+route
    assert not any('WebView' in n.get('class','') for n in root.iter('node'))
    return root
def photo(name):
    shell('screencap -p /sdcard/native-ui-shot.png');x.pull('/sdcard/native-ui-shot.png',str(out/(name+'.png')))
    if name not in report['screens']:report['screens'].append(name)
    return Image.open(out/(name+'.png')).convert('RGB')
def input_text(value):
    fields=[n for n in tree().iter('node') if n.get('class')=='android.widget.EditText'];assert fields
    n=fields[0];old=n.get('text','');click(n);shell('input keyevent 123')
    if old:shell('input keyevent '+' '.join(['67']*len(old)))
    if value:shell('input text '+shlex.quote(value.replace(' ','%s')))
    time.sleep(.25)
def store():
    for _ in range(12):
        try:return json.loads(ET.fromstring(shell('run-as '+pkg+' cat shared_prefs/campus_v4_guest.xml')).find("string[@name='data']").text)
        except (ET.ParseError,json.JSONDecodeError,AttributeError):time.sleep(.15)
    raise AssertionError('Cannot read preview test storage')
def fixture(value):
    shell('am force-stop '+pkg)
    root=ET.Element('map');s=ET.SubElement(root,'string',{'name':'data'});s.text=json.dumps(value,ensure_ascii=False,separators=(',',':'))
    path=out/'fixture-store.xml';path.write_bytes(ET.tostring(root,encoding='utf-8',xml_declaration=True))
    x.push(str(path),'/data/local/tmp/native-ui-fixture.xml')
    assert not shell('run-as '+pkg+' sh -c '+shlex.quote('cat /data/local/tmp/native-ui-fixture.xml > shared_prefs/campus_v4_guest.xml')).strip()
def nav(root):return all(label in texts(root) for label in ['今日','日历','班级','工具','我的'])

try:
    check('Disposable Android emulator',shell('getprop ro.kernel.qemu').strip()=='1')
    version=shell('dumpsys package '+pkg)
    check('UI preview version 3.2.9 installed','versionCode=9' in version and 'versionName=3.2.9-preview' in version)
    # Start with no result dialogs left open by the preceding random-draw test.
    shell('am force-stop '+pkg)
    if not args.resume_final_screens:
        shell('settings put system font_scale 1.0');shell('wm size reset');shell('wm density reset')
    shell('logcat -c')
    original_ime=shell('settings get secure show_ime_with_hard_keyboard').strip()
    shell('settings put secure show_ime_with_hard_keyboard 1')
    if not (args.resume_tail or args.resume_final_screens):
        root=go('home');check('Five native navigation controls visible',nav(root))
        density=float(re.findall(r'\d+',shell('wm density'))[-1])/160
        for desc in ['返回今日工作台','搜索校园记录','切换校园皮肤','登录或注册账号']:
            l,t,r,b=bounds(node(desc,root));check('48dp touch area: '+desc,min(r-l,b-t)>=round(48*density)-1)
        before=photo('home-before-scroll')
        l,t,r,b=bounds(node('捞捞校园',root));top=max(0,t-15);bottom=b+60
        for _ in range(2):shell('input swipe 550 1670 550 650 400')
        time.sleep(.5);after=photo('home-after-scroll')
        check('App bar stays opaque and stable while scrolling',ImageChops.difference(before.crop((0,top,before.width,bottom)),after.crop((0,top,after.width,bottom))).getbbox() is None)
        check('Bottom navigation stays visible after scrolling',nav(tree()))
        shell('am force-stop '+pkg);root=go('tools')
        categories=['全部','学习','规划','生活','手机','更多']
        check('All six category controls fit within the phone viewport',all(bounds(node(label,root))[0]>=0 and bounds(node(label,root))[2]<=before.width and bounds(node(label,root))[2]-bounds(node(label,root))[0]>=round(48*density)-1 for label in categories))
        tap('手机')
        check('Phone category filters to the hub and ten capabilities','手机工具 · 11 项' in texts())
        input_text('PDF');root=tree()
        check('Tool search filters actual catalogue','搜索结果 · 1 项' in texts(root) and '拍照资料扫描' in texts(root))
        check('Filtering retains the focused search input',any(n.get('class')=='android.widget.EditText' and n.get('text')=='PDF' and n.get('focused')=='true' for n in root.iter('node')))
        shell('input keyevent 4');photo('tool-search')
        tap('拍照资料扫描');shell('input keyevent 4');time.sleep(.4)
        root=tree();check('Returning from a tool retains query and category','搜索结果 · 1 项' in texts(root) and any(n.get('text')=='PDF' for n in root.iter('node')))
        tap('清空工具搜索');tap('全部');input_text('zzzznosuchtool');shell('input keyevent 4')
        check('Empty search result has useful feedback','还没有找到这个工具' in texts())
        tap('清空工具搜索');check('Clearing search restores all 34 tools','全部工具 · 34 项' in texts())
        go('ledger');tap('＋ 记一笔');tap('保存')
        root=tree();check('Invalid form stays open with visible field error',any(t.startswith('请填写') for t in texts(root)) and '保存' in texts(root))
        photo('native-form-error');tap('取消')
        go('courses');tap('＋ 添加课程');photo('native-course-form')
        input_text('KeyboardLayoutCheck');photo('native-form-keyboard');root=tree()
        check('On-screen keyboard is actually open','mInputShown=true' in shell('dumpsys input_method'))
        check('Form footer remains reachable with keyboard open','保存' in texts(root) and bounds(node('保存',root))[3] < photo('keyboard-bounds').height)
        shell('input keyevent 4');tap('取消')
        root=go('courses');grids=[n for n in root.iter('node') if n.get('class')=='android.widget.HorizontalScrollView'];assert grids,'Run forms checks first to create a course'
        check('Weekly course grid scrolls horizontally',any(n.get('scrollable')=='true' for n in grids))
        l,t,r,b=bounds(grids[0]);image1=photo('native-course-week')
        shell(f'input swipe {r-35} {min(b-20,t+240)} {l+35} {min(b-20,t+240)} 450');time.sleep(.5)
        image2=photo('native-course-week-shifted')
        check('Swiping reveals different days without scaling text',ImageChops.difference(image1.crop((l,t,r,min(b,t+400))),image2.crop((l,t,r,min(b,t+400)))).getbbox() is not None)
        # Preserve all records, then use only disposable guest fixtures to stress long text.
        backup=store();stress=copy.deepcopy(backup)
        rows=stress['data']['personal_course_schedule_courses_v1']
        rows[0]['name']='高等数学与工程应用专题课程：超长中文课程名称显示检查'
        rows[0]['location']='第一教学楼 A 区 402 教室';fixture(stress)
        shell('wm size 880x1720');shell('wm density 440');shell('settings put system font_scale 1.5')
        root=go('home');check('320dp and 150% font retain navigation',nav(root));photo('native-small-large-font')
        root=go('phone')
        for _ in range(6):
            if '桌面学习卡片' in texts(root):break
            shell('input swipe 440 1200 440 700 350');root=tree()
        check('Large-font phone tools retain complete labels','桌面学习卡片' in texts(root));photo('native-phone-large-font')
        root=go('courses');check('Large-font course form remains available','＋ 添加课程' in texts(root));photo('native-course-large-font')
        tap('＋ 添加课程');root=tree();check('Small-screen form keeps cancel and save reachable','取消' in texts(root) and '保存' in texts(root));photo('native-form-large-font');tap('取消')
        go('ledger');tap('＋ 记一笔')
        for _ in range(5):
            root=tree();dates=[n for n in root.iter('node') if n.get('content-desc','').endswith('点击选择日期') and bounds(n)[3]>bounds(n)[1]]
            if dates:break
            shell('input swipe 440 1150 440 700 350')
        assert dates,'Small-screen date field unavailable'
        click(dates[0]);root=tree();photo('native-date-large-font')
        check('Large-font date picker uses native controls',any('DatePicker' in n.get('class','') or 'date_picker' in n.get('resource-id','') for n in root.iter('node')))
        picker_buttons=[n for n in root.iter('node') if n.get('resource-id') in ('android:id/button1','android:id/button2')]
        check('Small-screen date picker keeps both actions reachable',len(picker_buttons)==2 and all(0<=bounds(n)[0]<bounds(n)[2]<=880 and 0<=bounds(n)[1]<bounds(n)[3]<=1720 and bounds(n)[3]-bounds(n)[1]>=round(48*440/160)-1 for n in picker_buttons))
        shell('input keyevent 4');tap('取消')
        root=go('meta');check('Dark metaverse supports large text and native navigation',nav(root))
        if '进入星轨冲刺' not in texts(root):
            shell('input swipe 440 1200 440 700 350');root=tree()
        check('Metaverse primary action remains reachable at 150% font','进入星轨冲刺' in texts(root));photo('native-metaverse-large-font')
        shell('wm size 1920x1200');shell('wm density 240');shell('settings put system font_scale 1.0')
        root=go('tools');check('Tablet layout retains navigation and catalogue',nav(root) and '全部工具 · 34 项' in texts(root));photo('native-tablet-tools')
        fixture(backup);backup=None
    if not args.resume_final_screens:
        shell('wm size reset');shell('wm density reset');shell('settings put system font_scale 1.0')
        shell('wm density 480')
        root=go('home');check('360dp phone retains navigation and primary action',nav(root) and '＋ 记一件事' in texts(root));photo('native-home-360dp')
        go('phone');photo('native-phone-360dp')
        shell('wm density reset')
    shell('am force-stop '+pkg);go('home');light=photo('native-home').getpixel((5,100))
    go('meta');dark=photo('native-metaverse').getpixel((5,100));check('Metaverse has its own dark surface',sum(dark)<sum(light)-250)
    go('phone');normal=photo('native-phone').getpixel((5,100));check('Leaving metaverse restores selected light skin',normal==light)
    go('appearance');photo('native-skins');go('me');photo('native-profile')
    for route in ['tools','pomo','ledger','calendar']:
        go(route);photo('native-'+{'pomo':'focus'}.get(route,route))
    check('No fatal Android UI exception','FATAL EXCEPTION' not in shell('logcat -d -s AndroidRuntime'))
    report['passed']=len(report['checks']);report['result']='passed'
finally:
    if backup is not None:fixture(backup)
    if original_ime is not None:
        shell('settings delete secure show_ime_with_hard_keyboard' if original_ime=='null' else 'settings put secure show_ime_with_hard_keyboard '+original_ime)
    if not args.resume_final_screens:
        shell('wm size reset');shell('wm density reset');shell('settings put system font_scale 1.0')
    (out/'ui-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    x.close()
