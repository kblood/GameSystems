"""contact sheets from <dir>/<design>_{front,side,back}.png -> tests/out/<dirname>_sheet<N>.png (8 designs per page)
   (usage: python tests/designs_sheet.py [dir] [filter-prefix])"""
import os, sys, glob
from PIL import Image, ImageDraw
d = (sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out", "godot_designs")).rstrip("/\\")
pre = sys.argv[2] if len(sys.argv) > 2 else ""
names = sorted({os.path.basename(f)[:-10] for f in glob.glob(d + "/*_front.png") if os.path.basename(f).startswith(pre)})
cw, ch, per = 210, 280, 8
outs = []
for p in range(0, len(names), per):
    page = names[p:p + per]
    S = Image.new("RGB", (3 * cw * 2, ((len(page) + 1) // 2) * (ch + 22)), (30, 33, 38)); dr = ImageDraw.Draw(S)
    for i, n in enumerate(page):
        ox, oy = (i % 2) * 3 * cw, (i // 2) * (ch + 22)
        dr.text((ox + 6, oy + 4), n, fill=(240, 240, 240))
        for j, v in enumerate(("front", "side", "back")):
            im = Image.open(f"{d}/{n}_{v}.png").convert("RGB").resize((cw, ch), Image.LANCZOS); S.paste(im, (ox + j * cw, oy + 22))
    o = os.path.join(os.path.dirname(d), "%s_sheet%d.png" % (os.path.basename(d) + (("_" + pre) if pre else ""), p // per + 1))
    S.save(o); outs.append(o)
print(len(names), "designs ->", ", ".join(outs))
