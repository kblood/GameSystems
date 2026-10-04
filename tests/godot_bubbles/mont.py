# usage: mont.py outdir name.png pattern1 pattern2 ... (patterns with {b}) -- bottles
import sys,os
from PIL import Image
d=sys.argv[1]; name=sys.argv[2]; a=sys.argv[3:]; i=a.index('--'); pats=a[:i]; bs=a[i+1:]
ims=[[Image.open(os.path.join(d,p.format(b=b))).convert('RGB') for p in pats] for b in bs]
h=420
rows=[[im.resize((int(im.width*h/im.height),h)) for im in r] for r in ims]
W=max(sum(im.width for im in r) for r in rows); out=Image.new('RGB',(W,h*len(rows)))
for y,r in enumerate(rows):
  x=0
  for im in r: out.paste(im,(x,y*h)); x+=im.width
out.save(os.path.join(d,name))
