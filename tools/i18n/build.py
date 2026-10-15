import json,re,glob,html
a=json.load(open('all.json'))
tr={}
for f in sorted(glob.glob('e*.txt')):
    for line in open(f,encoding='utf-8'):
        line=line.rstrip('\n')
        if not line.strip(): continue
        i,v=line.split('\t',1); tr[int(i)]=v
CJK=re.compile(r'[一-鿿]')
exact={}; pats=[]; missing=[]
for i,x in enumerate(a):
    k=html.unescape(x['k']).replace('\xa0',' '); k=re.sub(r'\s+',' ',k).strip()
    if i not in tr: missing.append(k); continue
    v=html.unescape(tr[i]).strip()
    if k.startswith('title="') or k.startswith('data-tab') or '" role=' in k: continue
    pk=re.findall(r'\{\d+\}',k); pv=re.findall(r'\{\d+\}',v)
    assert not (set(pv)-set(pk)), (i,k,v)
    if pk:
        if not CJK.search(re.sub(r'\{\d+\}','',k)): continue
        pats.append([k,v])
    elif len(k)==1 and CJK.search(k): continue   # 单个汉字（小、大、一…）常常是名字里的字，不翻
    else:
        exact[k]=v
        if k.startswith('- ') and v.startswith('- '): exact[k[2:]]=v[2:]
        if '**' in k and k.count('**')==v.count('**'):
            for a1,b1 in zip(k.split('**'),v.split('**')):
                a1=a1.strip(); b1=b1.strip()
                if a1 and CJK.search(a1): exact.setdefault(a1,b1)
pats.sort(key=lambda p:-len(re.sub(r'\{\d+\}','',p[0])))
js='window.CC_EN={x:'+json.dumps(exact,ensure_ascii=False,separators=(',',':'))+',p:'+json.dumps(pats,ensure_ascii=False,separators=(',',':'))+'};\nif(window.CCLang&&CCLang._start)CCLang._start();\n'
open('../../i18n-en.js','w',encoding='utf-8').write('/* 捞捞课程表 · 英文界面词典（自动生成）*/\n'+js)
print('exact',len(exact),'pats',len(pats),'missing',len(missing),len(js)//1024,'KB')
