import re, urllib.request
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
css=urllib.request.urlopen(urllib.request.Request("https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap",headers={"User-Agent":UA}),timeout=30).read().decode()
for b in re.findall(r"@font-face\s*{([^}]*)}", css):
    if "U+0000-00FF" not in b: continue
    style=re.search(r"font-style:\s*(\w+)",b).group(1)
    weight=re.search(r"font-weight:\s*(\d+)",b).group(1)
    url=re.search(r"url\((https://[^)]+\.woff2)\)",b).group(1)
    print(style,weight,url[-40:])
