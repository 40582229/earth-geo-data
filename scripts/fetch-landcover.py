#!/usr/bin/env python3
"""fetch-landcover.py — MODIS IGBP land cover, turned into a class grid

The elevation grids say how high the ground is. They cannot say whether it is
sand or jungle, because the Sahara and the Amazon are both low. That is a second
raster, and this is where it comes from.

NASA GIBS serves the MODIS MCD12Q1 IGBP classification as a WMS layer. The
service paints each class with a *display* colour — open shrubland comes out
cream, urban comes out pure red — so the colours themselves are useless for a
planet. What is useful is that the service renders with nearest-neighbour, so
each output pixel is exactly one of the eighteen colours in its colormap. That
makes the reverse mapping exact: colour -> class code, no thresholds, no
guessing at the edges.

So this writes class codes, 1..17 plus 17 for water, and nothing else. What the
planet looks like is decided in TypeScript, by a palette in src/colour.

    python3 scripts/fetch-landcover.py [--width 4096] [--height 2048]

Writes data/landcover/landcover-<width>.json and prints what it found.
"""

import argparse
import base64
import json
import re
import sys
import urllib.request
from datetime import date
from io import BytesIO
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"

WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
LAYER = "MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual"
COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml"
TIME = "2019-01-01"

# The colormap is authored from the IGBP class numbers, but 0 and 17 share one
# colour: MCD12Q1 uses both for water. 255 is the service's fill value.
WATER = 17
FILL = 255


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "earth-geo-data/0.1"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def read_colormap() -> list[tuple[int, int, int, int]]:
    """The colormap's entries as (r, g, b, class), in file order.

    A class list rather than a dict because there are eighteen of them and the
    lookup below is an exact match on a colour the service just told us about.
    """
    xml = fetch(COLORMAP).decode("utf-8")
    entries = []
    for match in re.finditer(r"<ColorMapEntry ([^/>]+)/>", xml):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', match.group(1)))
        if attrs.get("nodata") == "true":
            continue
        red, green, blue = (int(v) for v in attrs["rgb"].split(","))
        # "0,17" means two source values share this colour; the largest is the
        # one the IGBP table calls water, and 0 is the same thing under another
        # name. Taking the last keeps 17.
        source = int(attrs["sourceValue"].split(",")[-1])
        entries.append((red, green, blue, source))
    if len(entries) < 10:
        raise SystemExit(f"colormap: only {len(entries)} entries — has the file moved?")
    return entries


def classify(image: Image.Image, entries: list[tuple[int, int, int, int]]) -> bytes:
    """Every pixel of the WMS image becomes one class byte.

    PIL's quantiser does the nearest-colour match in C, against a palette built
    from the colormap, so this is exact rather than approximate: the service
    only ever paints those eighteen colours.
    """
    palette = Image.new("P", (1, 1))
    flat: list[int] = []
    for red, green, blue, _ in entries:
        flat.extend((red, green, blue))
    flat.extend([0] * (768 - len(flat)))
    palette.putpalette(flat)

    mapped = image.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
    indices = mapped.tobytes()

    # index -> class, as a 256-entry translation table
    table = bytearray(256)
    for index, (_, _, _, source) in enumerate(entries):
        table[index] = source
    return indices.translate(bytes(table))


def fill_holes(classes: bytearray, width: int, height: int) -> int:
    """Replace the service's fill with the class to its left.

    GIBS paints a handful of pixels — the pole row, the antimeridian — with its
    fill colour rather than a class. There are a few hundred of them in eight
    million, and a solid planet is worth more than an honest hole, so they take
    their neighbour's class. Returns how many were replaced.
    """
    holes = 0
    for row in range(height):
        start = row * width
        for column in range(width):
            index = start + column
            if classes[index] != FILL:
                continue
            holes += 1
            if column > 0:
                classes[index] = classes[index - 1]
            elif row > 0:
                classes[index] = classes[start - width]
            else:
                classes[index] = WATER
    return holes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=2048)
    parser.add_argument("--force", action="store_true", help="refetch even if the file exists")
    args = parser.parse_args()

    if args.height * 2 != args.width:
        raise SystemExit("a 2:1 grid: height must be half the width")

    out = DATA / "landcover" / f"landcover-{args.width}.json"
    if out.exists() and not args.force:
        print(f"{out} already exists — pass --force to refetch")
        return

    entries = read_colormap()
    print(f"colormap: {len(entries)} classes")

    url = (
        f"{WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS={LAYER}"
        f"&CRS=EPSG:4326&BBOX=-90,-180,90,180"
        f"&WIDTH={args.width}&HEIGHT={args.height}&FORMAT=image/png&TIME={TIME}"
    )
    print(f"fetching {args.width}x{args.height} …")
    image = Image.open(BytesIO(fetch(url)))
    if image.size != (args.width, args.height):
        raise SystemExit(f"asked for {args.width}x{args.height}, got {image.size[0]}x{image.size[1]}")

    classes = bytearray(classify(image, entries))
    holes = fill_holes(classes, args.width, args.height)
    print(f"filled {holes} pixels the service had no class for")

    histogram = [0] * 256
    for value in classes:
        histogram[value] += 1
    named = {source: (red, green, blue) for red, green, blue, source in entries}
    for code, count in enumerate(histogram):
        if count:
            print(f"  {code:>3}  {count / len(classes) * 100:6.2f}%  {named.get(code)}")

    mean = sum(code * count for code, count in enumerate(histogram)) / len(classes)

    envelope = {
        "format": "earthGeoData/1",
        "id": f"landcover-{args.width}",
        "kind": "grid",
        "title": f"MODIS IGBP land cover, {args.width}x{args.height} "
                 f"({360 / args.width:.4f}° per cell)",
        "source": {
            "name": "MODIS MCD12Q1 IGBP classification, via NASA GIBS",
            "url": url,
            "licence": "public domain (NASA EOSDIS)",
            "attribution": "MODIS Land Cover Type (MCD12Q1), NASA LP DAAC, via NASA GIBS",
            "retrieved": date.today().isoformat(),
        },
        "stats": {
            "min": min(code for code, count in enumerate(histogram) if count),
            "max": max(code for code, count in enumerate(histogram) if count),
            "mean": mean,
            "count": len(classes),
        },
        "grid": {
            "width": args.width,
            "height": args.height,
            "layout": "equirectangular",
            "rowZero": "north",
            "columnZeroLon": -180,
            "longitudeSpan": 360,
            "latitudeSpan": 180,
            "type": "uint8",
            "scale": 1,
            "offset": 0,
            "unit": "class",
            "nodata": None,
        },
        "byteLength": len(classes),
        "data": "",
    }

    envelope["data"] = base64.b64encode(bytes(classes)).decode("ascii")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(envelope, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"\n{out}  {out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
