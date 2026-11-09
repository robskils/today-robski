#!/usr/bin/env python3
"""Render the Kaya social share card -> public/brand/og-image.v4.png (1200x630).

Pure Pillow, no browser. Converts the self-hosted woff2 faces to ttf, uses the
exact brand tokens (oklch -> sRGB), renders at 2x and downscales for crisp AA.
To change the card, edit HEADLINE_1 / HEADLINE_2 / GROUND below and re-run:

    python3 tools/og/make-card.py

Then bump the filename (v4 -> v5) in the og:image / twitter:image meta across
public/home.html, public/how.html, public/blog.html and public/{pt,fr,es,it,de}
/index.html so social scrapers refetch instead of serving a cached copy.
"""
import math, os, tempfile
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
try:
    import numpy as np; HAVE_NP = True
except Exception:
    HAVE_NP = False

REPO  = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONTS = os.path.join(REPO, "public", "fonts")
OUT   = os.path.join(REPO, "public", "brand", "og-image.v4.png")
TMP   = tempfile.mkdtemp(prefix="kaya-og-")

# ---- copy: the live homepage hero line (home.html h1) ----
WORDMARK   = "Kaya"            # + a gold full stop, no logo mark
HEADLINE_1 = "A dozen apps to run your life."   # ivory, Cormorant 500
HEADLINE_2 = "Kaya makes them one."             # gold,  Cormorant 300 italic
DOMAIN     = "KAYA.SO"

# ---- brand tokens (home.html :root) as oklch(L C H) ----
GROUND_OK   = (0.28, 0.04, 155)   # --k-deep (the site's forest band)
GROUND_L_OK = (0.34, 0.045, 150)  # a touch lighter, for the top-left whisper
IVORY_OK    = (0.975, 0.012, 85)  # --k-ondeep
GOLD_OK     = (0.74, 0.12, 76)    # --k-gold (dark-ground variant)

def conv(woff2, name):
    f = TTFont(os.path.join(FONTS, woff2)); p = os.path.join(TMP, name); f.save(p); return p

def oklch_to_srgb(L, C, h_deg):
    h = math.radians(h_deg); a = C*math.cos(h); b = C*math.sin(h)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l=l_**3; m=m_**3; s=s_**3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb= -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    def enc(x):
        x=max(0.0,min(1.0,x))
        x = 1.055*(x**(1/2.4))-0.055 if x>0.0031308 else 12.92*x
        return int(round(max(0.0,min(1.0,x))*255))
    return (enc(r), enc(g), enc(bb))

GROUND=oklch_to_srgb(*GROUND_OK); GROUND_L=oklch_to_srgb(*GROUND_L_OK)
IVORY =oklch_to_srgb(*IVORY_OK);  GOLD=oklch_to_srgb(*GOLD_OK)

c500  = conv("CormorantGaramond-500.woff2", "c500.ttf")
c300i = conv("CormorantGaramond-300-italic.woff2", "c300i.ttf")
j600  = conv("Jost-600.woff2", "j600.ttf")

SS=2; W,H = 1200*SS, 630*SS
img = Image.new("RGB",(W,H),GROUND)
if HAVE_NP:
    yy,xx = np.mgrid[0:H,0:W]
    d = np.sqrt((xx-0.18*W)**2 + (yy-0.0)**2)/(0.95*W)
    t = (np.clip(1.0 - d/0.62, 0.0, 1.0)**1.4)*0.55
    base=np.array(GROUND,float); top=np.array(GROUND_L,float)
    img = Image.fromarray((base[None,None,:]*(1-t[...,None])+top[None,None,:]*t[...,None]).astype("uint8"),"RGB")

d = ImageDraw.Draw(img)
f_word=ImageFont.truetype(c500,48*SS); f_h1=ImageFont.truetype(c500,76*SS)
f_h2=ImageFont.truetype(c300i,76*SS);  f_dom=ImageFont.truetype(j600,18*SS)
cx=W/2

wk=d.textlength(WORDMARK,font=f_word); wd=d.textlength(".",font=f_word)
sx=cx-(wk+wd)/2; by=118*SS
d.text((sx,by),WORDMARK,font=f_word,fill=IVORY,anchor="ls")
d.text((sx+wk,by),".",font=f_word,fill=GOLD,anchor="ls")

d.text((cx,302*SS),HEADLINE_1,font=f_h1,fill=IVORY,anchor="ms")
d.text((cx,384*SS),HEADLINE_2,font=f_h2,fill=GOLD,anchor="ms")

rw=40*SS; d.rectangle([cx-rw/2,500*SS,cx+rw/2,500*SS+max(1,round(1.4*SS))],fill=GOLD)

ls=0.32*18*SS; widths=[d.textlength(c,font=f_dom) for c in DOMAIN]
x=cx-(sum(widths)+ls*(len(DOMAIN)-1))/2
ivory92=tuple(int(round(IVORY[i]*0.92+GROUND[i]*0.08)) for i in range(3)); dy=548*SS
for c,wch in zip(DOMAIN,widths):
    d.text((x,dy),c,font=f_dom,fill=ivory92,anchor="ls"); x+=wch+ls

img.resize((1200,630),Image.LANCZOS).save(OUT)
print("saved", OUT)
