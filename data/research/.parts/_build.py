import json,glob,os
D=os.path.dirname(os.path.abspath(__file__))
pools=[]
for f in sorted(glob.glob(os.path.join(D,'*.json'))):
    if os.path.basename(f).startswith('_'): continue
    pools.append(json.load(open(f,encoding='utf-8')))
meta_p=os.path.join(D,'_meta.json')
meta=json.load(open(meta_p,encoding='utf-8')) if os.path.exists(meta_p) else {"researchNotes":"","unresolved":[]}
pools.sort(key=lambda p:(p['district'],p['id']))
out={"pools":pools,"researchNotes":meta.get("researchNotes",""),"unresolved":meta.get("unresolved",[])}
dest=os.path.join(D,'..','pools-district.json')
json.dump(out,open(dest,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print('wrote',len(pools),'pools ->',os.path.normpath(dest))
