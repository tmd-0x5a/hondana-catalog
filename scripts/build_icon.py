from collections import deque
from pathlib import Path
import sys

from PIL import Image


def is_outer_background(pixel):
    red, green, blue, _alpha = pixel
    return min(red, green, blue) > 200 and max(red, green, blue) - min(red, green, blue) < 28


def remove_connected_background(image):
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    queue = deque()
    visited = set()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        point = queue.popleft()
        if point in visited:
            continue
        visited.add(point)
        x, y = point
        if not is_outer_background(pixels[x, y]):
            continue
        pixels[x, y] = (0, 0, 0, 0)
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return image


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: build_icon.py SOURCE_PNG")

    project = Path(__file__).resolve().parents[1]
    source = Path(sys.argv[1])
    build_dir = project / "build"
    public_dir = project / "public"
    build_dir.mkdir(exist_ok=True)
    public_dir.mkdir(exist_ok=True)

    image = remove_connected_background(Image.open(source))
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side))
    master = image.convert("RGBa").resize((1024, 1024), Image.Resampling.LANCZOS).convert("RGBA")
    master.save(build_dir / "icon.png", optimize=True)
    master.save(public_dir / "app-icon.png", optimize=True)
    master.save(
        build_dir / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
