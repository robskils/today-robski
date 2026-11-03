import re, urllib.request, urllib.parse
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
zodiac="♈♉♊♋♌♍♎♏♐♑♒♓"
url="https://fonts.googleapis.com/css2?family=Noto+Sans+Symbols&text="+urllib.parse.quote(zodiac)
css=urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":UA}),timeout=30).read().decode()
m=re.search(r"src:\s*url\(([^)]+)\)",css)
furl=m.group(1).strip().strip('"\'')
data=urllib.request.urlopen(urllib.request.Request(furl,headers={"User-Agent":UA}),timeout=30).read()
open("public/fonts/NotoSansSymbols-zodiac.woff2","wb").write(data)
print("saved", len(data), "bytes")
