#!/usr/bin/env python3
"""Reduce AstroMenace WAV distribution size for the browser build.

The original game ships uncompressed PCM WAV sound effects and voice clips.
For the Yandex/WebAssembly package we cap WAV sample rate at 22050 Hz while
preserving channel count and PCM 16-bit output. Files already at or below the
cap are left untouched, and a converted file is accepted only when it is
strictly smaller than the source.

This affects only the generated web build's temporary gamedata tree. The
original assets remain unchanged in the source repository/upstream project.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


def probe(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=sample_rate,channels,codec_name,duration",
            "-of", "json", str(path),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    if not streams:
        raise RuntimeError("no audio stream")
    return streams[0]


def optimize(path: Path, target_rate: int) -> tuple[int, int, bool, str]:
    before = path.stat().st_size
    try:
        info = probe(path)
        sample_rate = int(info.get("sample_rate") or 0)
    except Exception as exc:
        return before, before, False, f"probe failed: {exc}"

    if sample_rate <= 0:
        return before, before, False, "unknown sample rate"
    if sample_rate <= target_rate:
        return before, before, False, f"already <= {target_rate} Hz"

    fd, tmp_name = tempfile.mkstemp(prefix=path.stem + ".web-", suffix=".wav", dir=str(path.parent))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-nostdin", "-v", "error", "-y",
                "-i", str(path),
                "-map_metadata", "-1",
                "-ar", str(target_rate),
                "-c:a", "pcm_s16le",
                str(tmp),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0 or not tmp.exists():
            return before, before, False, "ffmpeg failed"

        after = tmp.stat().st_size
        if after >= before:
            return before, before, False, "no saving"

        # Verify that ffprobe can decode the generated WAV before replacing the
        # source in the temporary CI gamedata tree.
        converted = probe(tmp)
        if int(converted.get("sample_rate") or 0) != target_rate:
            return before, before, False, "verification failed"

        os.replace(tmp, path)
        return before, after, True, f"{sample_rate}->{target_rate} Hz"
    finally:
        if tmp.exists():
            tmp.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, help="gamedata directory")
    parser.add_argument("--rate", type=int, default=22050, help="maximum WAV sample rate")
    args = parser.parse_args()

    if not args.root.is_dir():
        raise SystemExit(f"not a directory: {args.root}")
    if args.rate < 8000:
        raise SystemExit("sample-rate cap is too low")

    total_before = 0
    total_after = 0
    changed = 0
    skipped: dict[str, int] = {}
    savings: list[tuple[int, Path, int, int, str]] = []

    files = sorted(args.root.rglob("*.wav"))
    for path in files:
        before, after, did_change, reason = optimize(path, args.rate)
        total_before += before
        total_after += after
        if did_change:
            changed += 1
            savings.append((before - after, path, before, after, reason))
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

    for reason, count in sorted(skipped.items()):
        print(f"Skipped {reason}: {count}")

    print("Largest WAV savings:")
    for saving, path, before, after, reason in sorted(savings, reverse=True)[:25]:
        print(f"  {saving:10d}  {before:10d} -> {after:10d}  {reason:18s}  {path.relative_to(args.root)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
