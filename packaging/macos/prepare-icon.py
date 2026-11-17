"""Build the macOS application asset with transparent, antialiased corners."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

source, target = map(Path, sys.argv[1:3])
scale = 4
size = 1024 * scale
inset = 64 * scale
tile = Image.open(source).convert("RGBA").resize((size-2*inset, size-2*inset), Image.Resampling.LANCZOS)
mask = Image.new("L", tile.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile.width-1, tile.height-1), radius=188*scale, fill=255)
tile.putalpha(mask)
icon = Image.new("RGBA", (size, size))
icon.alpha_composite(tile, (inset, inset))
icon = icon.resize((1024, 1024), Image.Resampling.LANCZOS)
assert icon.getpixel((0, 0))[3] == icon.getpixel((64, 64))[3] == 0
assert icon.getpixel((512, 512))[3] == 255
target.parent.mkdir(parents=True, exist_ok=True)
icon.save(target)
print("PASS rounded Dock icon: 1024px, transparent margin and all four corners")
