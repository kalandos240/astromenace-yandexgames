#!/usr/bin/env python3
"""Losslessly RLE-compress AstroMenace true-color TGA assets in place.

AstroMenace's TGA loader supports both uncompressed type-2 and RLE type-10
24/32-bit images. This tool preserves the original 18-byte TGA header fields,
ID bytes, image descriptor/orientation and pixel order; it changes only the
image type and pixel encoding. A file is replaced only when the RLE form is
strictly smaller, so noisy textures never grow.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import struct
import tempfile


def encode_rle_pixels(pixels: bytes, bytes_per_pixel: int) -> bytes:
    count = len(pixels) // bytes_per_pixel
    out = bytearray()

    def pixel(i: int) -> bytes:
        start = i * bytes_per_pixel
        return pixels[start:start + bytes_per_pixel]

    i = 0
    while i < count:
        # Prefer an RLE packet for two or more equal adjacent pixels.
        run = 1
        current = pixel(i)
        while i + run < count and run < 128 and pixel(i + run) == current:
            run += 1
        if run >= 2:
            out.append(0x80 | (run - 1))
            out.extend(current)
            i += run
            continue

        # Otherwise collect a raw packet, stopping before the next repeated run.
        raw_start = i
        raw_len = 1
        i += 1
        while i < count and raw_len < 128:
            next_run = 1
            next_pixel = pixel(i)
            while i + next_run < count and next_run < 128 and pixel(i + next_run) == next_pixel:
                next_run += 1
            if next_run >= 2:
                break
            raw_len += 1
            i += 1

        out.append(raw_len - 1)
        start = raw_start * bytes_per_pixel
        end = (raw_start + raw_len) * bytes_per_pixel
        out.extend(pixels[start:end])

    return bytes(out)


def optimize_tga(path: Path) -> tuple[int, int, bool, str]:
    data = path.read_bytes()
    if len(data) < 18:
        return len(data), len(data), False, "short header"

    header = bytearray(data[:18])
    id_length = header[0]
    color_map_type = header[1]
    image_type = header[2]
    width = struct.unpack_from("<H", header, 12)[0]
    height = struct.unpack_from("<H", header, 14)[0]
    depth = header[16]

    if color_map_type != 0:
        return len(data), len(data), False, "color mapped"
    if image_type == 10:
        return len(data), len(data), False, "already RLE"
    if image_type != 2:
        return len(data), len(data), False, f"type {image_type}"
    if depth not in (24, 32):
        return len(data), len(data), False, f"{depth} bpp"
    if width == 0 or height == 0:
        return len(data), len(data), False, "zero dimensions"

    bpp = depth // 8
    pixel_offset = 18 + id_length
    pixel_bytes = width * height * bpp
    pixel_end = pixel_offset + pixel_bytes
    if pixel_end > len(data):
        return len(data), len(data), False, "truncated pixels"

    prefix = data[18:pixel_offset]
    pixels = data[pixel_offset:pixel_end]
    suffix = data[pixel_end:]

    encoded = encode_rle_pixels(pixels, bpp)
    header[2] = 10
    candidate = bytes(header) + prefix + encoded + suffix

    if len(candidate) >= len(data):
        return len(data), len(data), False, "no saving"

    # Atomic replacement keeps CI from ever leaving a half-written asset.
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(candidate)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)

    return len(data), len(candidate), True, "compressed"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, help="gamedata directory")
    args = parser.parse_args()

    root = args.root
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")

    total_before = 0
    total_after = 0
    changed = 0
    examined = 0
    skipped: dict[str, int] = {}
    best: list[tuple[int, Path, int, int]] = []

    for path in sorted(root.rglob("*.tga")):
        examined += 1
        before, after, did_change, reason = optimize_tga(path)
        total_before += before
        total_after += after
        if did_change:
            changed += 1
            best.append((before - after, path, before, after))
        else:
            skipped[reason] = skipped.get(reason, 0) + 1

    saved = total_before - total_after
    print(f"TGA files examined: {examined}")
    print(f"TGA files RLE-compressed: {changed}")
    print(f"TGA bytes before: {total_before}")
    print(f"TGA bytes after: {total_after}")
    print(f"TGA bytes saved: {saved}")
    if total_before:
        print(f"TGA reduction: {saved * 100.0 / total_before:.2f}%")

    for reason, number in sorted(skipped.items()):
        print(f"Skipped {reason}: {number}")

    print("Largest RLE savings:")
    for saving, path, before, after in sorted(best, reverse=True)[:25]:
        print(f"  {saving:10d}  {before:10d} -> {after:10d}  {path.relative_to(root)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
