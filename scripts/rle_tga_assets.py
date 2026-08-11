#!/usr/bin/env python3
"""Optimize AstroMenace assets in the temporary Yandex web-build tree.

TGA optimization is lossless: AstroMenace natively supports both uncompressed
type-2 and RLE type-10 24/32-bit TGA images. The encoder preserves the original
header fields, ID bytes, descriptor/orientation and pixel order, replacing a
file only when RLE is strictly smaller.

For the browser distribution only, PCM WAV clips above 22050 Hz are also
resampled to 22050 Hz through FFmpeg while preserving channel count. The source
repository and upstream assets remain untouched. A converted WAV is accepted
only when it is valid and smaller than the original.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
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
        run = 1
        current = pixel(i)
        while i + run < count and run < 128 and pixel(i + run) == current:
            run += 1
        if run >= 2:
            out.append(0x80 | (run - 1))
            out.extend(current)
            i += run
            continue

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


def optimize_tgas(root: Path) -> int:
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
        print(f"Skipped TGA {reason}: {number}")
    print("Largest RLE savings:")
    for saving, path, before, after in sorted(best, reverse=True)[:25]:
        print(f"  {saving:10d}  {before:10d} -> {after:10d}  {path.relative_to(root)}")
    return saved


def optimize_wavs(root: Path, rate: int = 22050) -> int:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("WAV optimization skipped: FFmpeg/FFprobe not available on runner")
        print("WAV bytes saved: 0")
        return 0

    # Import the standalone optimizer from this script directory. Keeping the
    # implementation in its own file also makes it easy to run independently.
    from optimize_wav_assets import optimize as optimize_wav

    total_before = 0
    total_after = 0
    changed = 0
    best: list[tuple[int, Path, int, int, str]] = []
    skipped: dict[str, int] = {}
    files = sorted(root.rglob("*.wav"))

    for path in files:
        before, after, did_change, reason = optimize_wav(path, rate)
        total_before += before
        total_after += after
        if did_change:
            changed += 1
            best.append((before - after, path, before, after, reason))
        else:
            skipped[reason] = skipped.get(reason, 0) + 1

    saved = total_before - total_after
    print(f"WAV files examined: {len(files)}")
    print(f"WAV files optimized: {changed}")
    print(f"WAV bytes before: {total_before}")
    print(f"WAV bytes after: {total_after}")
    print(f"WAV bytes saved: {saved}")
    if total_before:
        print(f"WAV reduction: {saved * 100.0 / total_before:.2f}%")
    for reason, number in sorted(skipped.items()):
        print(f"Skipped WAV {reason}: {number}")
    print("Largest WAV savings:")
    for saving, path, before, after, reason in sorted(best, reverse=True)[:25]:
        print(f"  {saving:10d}  {before:10d} -> {after:10d}  {reason:18s}  {path.relative_to(root)}")
    return saved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, help="gamedata directory")
    args = parser.parse_args()

    root = args.root
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")

    tga_saved = optimize_tgas(root)
    wav_saved = optimize_wavs(root)
    print(f"Web asset bytes saved total: {tga_saved + wav_saved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
