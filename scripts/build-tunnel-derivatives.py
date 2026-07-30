#!/usr/bin/env python3
"""Build lightweight WebP display images for the complete prompt tunnel."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_DATA = ROOT / "data" / "archive.json"
OUTPUT_DIR = ROOT / "assets" / "archive-display"
MAX_EDGE = 1280
QUALITY = 86
MAX_TOTAL_BYTES = 55 * 1024 * 1024


def archive_sources() -> list[str]:
    data = json.loads(ARCHIVE_DATA.read_text(encoding="utf-8"))
    ordered: list[str] = []
    seen: set[str] = set()
    for case in data.get("cases", []):
        for image in case.get("images", []):
            source = str(image.get("src", ""))
            if source and source not in seen:
                seen.add(source)
                ordered.append(source)
    return ordered


def display_path(source: str) -> Path:
    return OUTPUT_DIR / f"{Path(source).stem}.webp"


def normalized_rgb(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, "white")
        canvas.paste(rgba, mask=rgba.getchannel("A"))
        return canvas
    return image.convert("RGB")


def convert(source: Path, target: Path) -> None:
    with Image.open(source) as opened:
        image = normalized_rgb(opened)
        image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(
            target,
            "WEBP",
            quality=QUALITY,
            method=6,
            exact=True,
            exif=b"",
            icc_profile=None,
        )


def build() -> None:
    sources = archive_sources()
    expected = {display_path(source).name for source in sources}
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUTPUT_DIR.glob("*.webp"):
        if stale.name not in expected:
            stale.unlink()
    for source in sources:
        source_path = (ROOT / source).resolve()
        if ROOT not in source_path.parents or not source_path.is_file():
            raise FileNotFoundError(f"Missing or unsafe archive source: {source}")
        convert(source_path, display_path(source))


def inspect() -> dict:
    sources = archive_sources()
    items = []
    for source in sources:
        target = display_path(source)
        if not target.is_file():
            raise FileNotFoundError(f"Missing tunnel derivative: {target.relative_to(ROOT)}")
        with Image.open(target) as image:
            items.append(
                {
                    "source": source.replace("\\", "/"),
                    "display": target.relative_to(ROOT).as_posix(),
                    "width": image.width,
                    "height": image.height,
                    "format": image.format,
                    "bytes": target.stat().st_size,
                }
            )
    total_bytes = sum(item["bytes"] for item in items)
    if len(items) != 137:
        raise RuntimeError(f"Expected 137 derivatives, found {len(items)}")
    if total_bytes > MAX_TOTAL_BYTES:
        raise RuntimeError(
            f"Tunnel derivative payload is {total_bytes} bytes; limit is {MAX_TOTAL_BYTES}"
        )
    return {
        "count": len(items),
        "totalBytes": total_bytes,
        "maxEdge": MAX_EDGE,
        "quality": QUALITY,
        "items": items,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate existing derivatives")
    args = parser.parse_args()
    try:
        if not args.check:
            build()
        print(json.dumps(inspect(), ensure_ascii=False))
        return 0
    except Exception as error:  # pragma: no cover - exercised through CLI status
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
