# stand-in for "a user's own PNG": drawn without label_gen templates (680x720 = beer front slot at 80 px/cm)
from PIL import Image, ImageDraw, ImageFont
W,H=680,720
im=Image.new("RGB",(W,H))
d=ImageDraw.Draw(im)
for y in range(H):
    t=y/H; d.line([(0,y),(W,y)],fill=(int(30+60*t),int(60+120*(1-t)),int(110+90*t)))
f=lambda n,s: ImageFont.truetype(r"C:\Windows\Fonts\%s"%n,s)
d.ellipse([140,80,540,480],fill=(250,240,200),outline=(20,40,70),width=10)
d.polygon([(340,150),(430,380),(250,380)],fill=(200,60,50))
d.text((340,540),"MY HOMEBREW",font=f("impact.ttf",78),fill=(255,255,255),anchor="mm")
d.text((340,625),"batch #1 - user supplied PNG",font=f("segoeui.ttf",36),fill=(230,240,255),anchor="mm")
d.rectangle([6,6,W-7,H-7],outline=(255,255,255),width=6)
im.save(r"labels/user/my_homebrew.png")
