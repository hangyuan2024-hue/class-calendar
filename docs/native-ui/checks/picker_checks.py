"""Final native date-picker alignment checks on a disposable emulator.

Requires adb-shell and Pillow. Uses visible native controls for theme changes;
restores the original guest fixture in finally. No real account.
"""
import argparse, copy, hashlib, json, re, shlex, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--apk',required=True);args=p.parse_args()
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
        found=[n for n in tree().iter('node') if n.get('text')==label or n.get('content-desc')==label]
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
def write():(out/'picker-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
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
    backup=copy.deepcopy(store())
    installed=shell('pm path '+pkg).strip().split('package:')[-1]
    d.pull(installed,str(out/'installed-base.apk'))
    report['apk_sha256']=hashlib.sha256((out/'installed-base.apk').read_bytes()).hexdigest()
    check('Final installed APK matches the delivered file',report['apk_sha256']==hashlib.sha256(Path(args.apk).read_bytes()).hexdigest())
    styles=ET.parse(Path(__file__).resolve().parents[3]/'android/app/src/main/res/values/native_dialog_palettes.xml').getroot()
    for identity in ('sky','cyber'):
        palette=next(p for p in palettes if p['id']==identity)
        go('appearance');tap(palette['name']);go('ledger');tap('＋ 记一笔')
        fields=[n for n in tree().iter('node') if n.get('content-desc','').endswith('点击选择日期')];assert fields
        click(fields[0]);root=tree();(out/('native-date-'+identity+'.xml')).write_bytes(ET.tostring(root,encoding='utf-8'))

        check('Native date picker available: '+identity,any('DatePicker' in n.get('class','') or 'date_picker' in n.get('resource-id','') for n in root.iter('node')))
        im=photo('native-date-'+identity)
        style=styles.find("style[@name='CampusDialog"+identity.capitalize()+('Night' if palette['dark']=='true' else '')+"']")
        frame=next(n for n in root.iter('node') if n.get('class')=='android.widget.FrameLayout')
        l,t,r,b=bounds(frame)
        # The native dark picker uses a neutral header rather than colorAccent.
        # Check actual geometry, independent of the platform header tint.
        accent=im.getpixel((l+20,t+80))
        report.setdefault('header_colours',{})[identity]='#%02X%02X%02X'%accent
        surface=rgb(style.find("item[@name='android:windowBackground']").text)
        pixels=im.load();bands=[]
        for y in range(im.height):
            indices=[x for x in range(im.width) if pixels[x,y]==accent]
            if len(indices)>im.width*.5:bands.append((y,indices[0],indices[-1]))
        assert bands,'Native header colour unavailable'
        top=max(bands,key=lambda b:b[2]-b[1])
        y=min(im.height-1,max(b[0] for b in bands)+30)
        indices=[x for x in range(im.width) if pixels[x,y]==surface];assert indices
        ratio=(top[2]-top[1]+1)/(indices[-1]-indices[0]+1)
        report.setdefault('header_width_ratios',{})[identity]=round(ratio,4)
        check('Date header fills the dialog width: '+identity,ratio>=.97)
        shell('input keyevent 4');tap('取消')
    check('Picker review preserves business records',business(store())==business(backup))
    check('No fatal final-picker exception','FATAL EXCEPTION' not in shell('logcat -d -s AndroidRuntime'))
    report['passed']=len(report['checks']);report['result']='passed'
finally:
    if backup is not None:restore(backup)
    write();d.close()
