"""Eight native skin choices, pickers and system mode on a disposable emulator.

Requires adb-shell and Pillow. Uses visible native controls for theme changes;
restores the original guest fixture and system mode in finally. No real account.
"""
import argparse, copy, json, re, shlex, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
try:
    from adb_shell.adb_device import AdbDeviceTcp
except ImportError:
    sys.path.insert(0,'/workspace/native-build/pylibs')
    from adb_shell.adb_device import AdbDeviceTcp
d=AdbDeviceTcp('127.0.0.1',5555,default_transport_timeout_s=90);d.connect(auth_timeout_s=15)
pkg='com.laolao.classcalendar.preview';activity=pkg+'/com.laolao.classcalendar.CampusActivity'
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
palettes=json.loads((Path(__file__).parent/'results/palette-tokens.json').read_text())
report={'device':'Android 9 / API 28 emulator','package':pkg,'checks':[],'screens':[]}
backup=None;original_mode=None

def shell(cmd):return d.shell(cmd,read_timeout_s=90)
def tree():
    for _ in range(8):
        dumped=shell('uiautomator dump --compressed /sdcard/skin-check.xml')
        if 'dumped' in dumped:
            try:return ET.fromstring(shell('cat /sdcard/skin-check.xml'))
            except ET.ParseError:pass
        time.sleep(.3)
    raise AssertionError('Fresh native hierarchy unavailable')
def texts(root):return [n.get('text','') for n in root.iter('node') if n.get('text')]
def bounds(n):return list(map(int,re.findall(r'\d+',n.get('bounds',''))))
def click(n):
    l,t,r,b=bounds(n);assert r>l and b>t
    shell(f'input tap {(l+r)//2} {(t+b)//2}');time.sleep(.3)
def tap(label):
    for _ in range(7):
        found=[n for n in tree().iter('node') if n.get('text')==label or n.get('content-desc')==label or (n.get('class')=='android.widget.Switch' and n.get('text','').startswith(label))]
        if found:
            click(found[-1]);return
        shell('input swipe 550 1650 550 700 350')
    raise AssertionError('Missing skin control: '+label)
def go(route):
    shell('am start -n '+activity+' --es go '+shlex.quote(route))
    for _ in range(8):
        root=tree()
        if '捞捞校园' in texts(root):break
        time.sleep(.5)
    assert '捞捞校园' in texts(root),'Native app unavailable'
    assert not any('WebView' in n.get('class','') for n in root.iter('node'))
    return root
def check(name,ok=True):
    if not ok:raise AssertionError(name)
    report['checks'].append(name);write();print('PASS',name,flush=True)
def write():(out/'skin-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
def photo(name):
    shell('screencap -p /sdcard/skin-shot.png');d.pull('/sdcard/skin-shot.png',str(out/(name+'.png')))
    report['screens'].append(name)
    return Image.open(out/(name+'.png')).convert('RGB')
def store():
    for _ in range(12):
        try:return json.loads(ET.fromstring(shell('run-as '+pkg+' cat shared_prefs/campus_v4_guest.xml')).find("string[@name='data']").text)
        except (ET.ParseError,json.JSONDecodeError,AttributeError):time.sleep(.15)
    raise AssertionError('Cannot read emulator guest fixture')
def restore(value):
    shell('am force-stop '+pkg)
    root=ET.Element('map');s=ET.SubElement(root,'string',{'name':'data'});s.text=json.dumps(value,ensure_ascii=False,separators=(',',':'))
    path=out/'fixture-store.xml';path.write_bytes(ET.tostring(root,encoding='utf-8',xml_declaration=True))
    d.push(str(path),'/data/local/tmp/skin-fixture.xml')
    assert not shell('run-as '+pkg+' sh -c '+shlex.quote('cat /data/local/tmp/skin-fixture.xml > shared_prefs/campus_v4_guest.xml')).strip()
def business(value):return {k:v for k,v in value['data'].items() if k not in ('ui_skin_v1','ui_palette_v1','native_recent_tools')}
def rgb(value):return tuple(int(value[i:i+2],16) for i in (1,3,5))
def nav(root):return all(t in texts(root) for t in ('今日','日历','班级','工具','我的'))

try:
    check('Disposable Android emulator',shell('getprop ro.kernel.qemu').strip()=='1')
    shell('am force-stop '+pkg);shell('wm size reset');shell('wm density reset');shell('settings put system font_scale 1.0')
    backup=copy.deepcopy(store());original_mode=shell('cmd uimode night').strip().split()[-1]
    shell('cmd uimode night no');shell('logcat -c')
    root=go('home');found=[n for n in root.iter('node') if n.get('content-desc')=='切换校园皮肤'];assert found
    l,t,r,b=bounds(found[0]);density=int(re.findall(r'\d+',shell('wm density'))[-1])/160
    check('Visible palette button has a 48dp touch area',min(r-l,b-t)>=round(48*density)-1)
    click(found[0]);check('Header palette button opens the native gallery','给校园，换一种心情。' in texts(tree()))
    for palette in palettes:
        go('appearance');tap(palette['name'])
        saved=store()['data'];check('Skin selection persisted: '+palette['id'],saved['ui_palette_v1']['id']==palette['id'] and saved['ui_skin_v1']==('cyber' if palette['dark']=='true' else 'fresh'))
        root=go('home');image=photo('skin-'+palette['id'])
        check('Actual home uses complete palette: '+palette['id'],image.getpixel((5,100))==rgb(palette['bg']) and image.getpixel((5,500))==rgb(palette['bg']) and nav(root))
        if palette['id'] in ('sky','sakura','cyber','graphite'):
            go('ledger');tap('＋ 记一笔');root=tree()
            dates=[n for n in root.iter('node') if n.get('content-desc','').endswith('点击选择日期')];assert dates
            click(dates[0]);root=tree()
            check('Native date picker opens in '+palette['id'],any('DatePicker' in n.get('class','') or 'date_picker' in n.get('resource-id','') for n in root.iter('node')))
            photo('date-'+palette['id']);shell('input keyevent 4');tap('取消')
    shell('am force-stop '+pkg);root=go('home');image=photo('skin-restart')
    check('Selected graphite palette survives restart',store()['data']['ui_palette_v1']['id']=='graphite' and image.getpixel((5,100))==rgb('#12151B'))
    check('Changing all eight skins preserves business records',business(store())==business(backup))
    go('appearance');tap('跟随手机深浅色')
    check('System mode preference saved',store()['data']['ui_skin_v1']=='auto')
    shell('cmd uimode night no');root=go('home');image=photo('skin-system-day')
    check('Follow-system mode uses daylight palette',image.getpixel((5,100))==rgb('#F3F6FD') and nav(root))
    shell('cmd uimode night yes');root=go('home');image=photo('skin-system-night')
    check('Follow-system mode uses readable night palette',image.getpixel((5,100))==rgb('#0A1420') and nav(root))
    shell('cmd uimode night no');root=go('home');image=photo('skin-system-day-return')
    check('Follow-system mode returns to daylight',image.getpixel((5,100))==rgb('#F3F6FD'))
    check('No fatal Android skin exception','FATAL EXCEPTION' not in shell('logcat -d -s AndroidRuntime'))
    report['passed']=len(report['checks']);report['result']='passed'
finally:
    if backup is not None:restore(backup)
    if original_mode in ('yes','no','auto'):shell('cmd uimode night '+original_mode)
    write();d.close()
