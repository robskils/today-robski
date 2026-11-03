import re, urllib.request
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
css_url="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap"
req=urllib.request.Request(css_url, headers={"User-Agent":UA})
css=urllib.request.urlopen(req, timeout=30).read().decode()
blocks=re.findall(r"@font-face\s*{([^}]*)}", css)
want={("normal","400"):"SourceSerif4-400.woff2",("normal","600"):"SourceSerif4-600.woff2",("italic","400"):"SourceSerif4-400-italic.woff2"}
got={}
for b in blocks:
    if "U+0000-00FF" not in b: continue
    style=re.search(r"font-style:\s*(\w+)",b).group(1)
    weight=re.search(r"font-weight:\s*(\d+)",b).group(1)
    url=re.search(r"url\((https://[^)]+\.woff2)\)",b).group(1)
    key=(style,weight)
    if key in want and key not in got: got[key]=url
for key,fn in want.items():
    if key not in got: print("MISSING",key); continue
    data=urllib.request.urlopen(urllib.request.Request(got[key],headers={"User-Agent":UA}),timeout=30).read()
    open("public/fonts/"+fn,"wb").write(data)
    print("saved",fn,len(data),"bytes")
