#!/usr/bin/env python3
"""Reduce AstroMenace WAV distribution size for the browser build.

The original game ships uncompressed PCM WAV sound effects and voice clips.
For the temporary Yandex/WebAssembly build tree we cap WAV sample rate at
22050 Hz while preserving channel count and sample width. Source assets in the
repository/upstream project are never modified.

The implementation uses Python's standard-library ``wave`` module and, where
available, ``audioop.ratecv``. A small pure-Python PCM fallback is included for
Python versions where audioop has been removed. A converted file is accepted
only after it can be opened again as PCM WAV and is strictly smaller.
"""

from __future__ import annotations

import argparse
from array import array
import os
from pathlib import Path
import sys
import tempfile
import wave

try:
    import audioop  # Python <= 3.12
except ImportError:  # pragma: no cover - used on newer runners
    audioop = None


def read_pcm(path: Path):
    with wave.open(str(path), "rb") as src:
        if src.getcomptype() != "NONE":
            raise ValueError(f"compressed WAV ({src.getcomptype()})")
        params = src.getparams()
        frames = src.readframes(src.getnframes())
    return params, frames


def resample_s16le_linear(frames: bytes, channels: int, src_rate: int, dst_rate: int) -> bytes:
    """Linear PCM16 resampler used only if audioop is unavailable.

    The format used by AstroMenace WAV assets is little-endian PCM. Linear
    interpolation avoids the very audible aliasing of simply dropping samples
    while keeping the implementation dependency-free for CI.
    """
    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()

    input_frames = len(samples) // channels
    if input_frames <= 1:
        return frames

    output_frames = max(1, (input_frames * dst_rate) // src_rate)
    out = array("h", [0]) * (output_frames * channels)
    ratio = src_rate / float(dst_rate)

    for out_index in range(output_frames):
        position = out_index * ratio
        left = int(position)
        if left >= input_frames - 1:
            left = input_frames - 1
            frac = 0.0
            right = left
        else:
            frac = position - left
            right = left + 1

        src_left = left * channels
        src_right = right * channels
        dst = out_index * channels
        for channel in range(channels):
            a = samples[src_left + channel]
            b = samples[src_right + channel]
            value = int(round(a + (b - a) * frac))
            out[dst + channel] = max(-32768, min(32767, value))

    if sys.byteorder != "little":
        out.byteswap()
    return out.tobytes()


def resample_pcm(frames: bytes, sample_width: int, channels: int, src_rate: int, dst_rate: int) -> bytes:
    if audioop is not None:
        converted, _state = audioop.ratecv(
            frames, sample_width, channels, src_rate, dst_rate, None
        )
        return converted

    if sample_width != 2:
        raise ValueError("audioop unavailable and WAV is not PCM16")
    return resample_s16le_linear(frames, channels, src_rate, dst_rate)


def optimize(path: Path, target_rate: int) -> tuple[int, int, bool, str]:
    before = path.stat().st_size
    try:
        params, frames = read_pcm(path)
    except (wave.Error, EOFError, ValueError) as exc:
        return before, before, False, f"unsupported: {exc}"

    sample_rate = params.framerate
    if sample_rate <= 0:
        return before, before, False, "unknown sample rate"
    if sample_rate <= target_rate:
        return before, before, False, f"already <= {target_rate} Hz"
    if params.sampwidth not in (1, 2, 3, 4):
        return before, before, False, f"sample width {params.sampwidth}"

    try:
        converted = resample_pcm(
            frames,
            params.sampwidth,
            params.nchannels,
            sample_rate,
            target_rate,
        )
    except (ValueError, OverflowError) as exc:
        return before, before, False, f"resample failed: {exc}"

    fd, tmp_name = tempfile.mkstemp(
        prefix=path.stem + ".web-", suffix=".wav", dir=str(path.parent)
    )
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with wave.open(str(tmp), "wb") as dst:
            dst.setnchannels(params.nchannels)
            dst.setsampwidth(params.sampwidth)
            dst.setframerate(target_rate)
            dst.setcomptype("NONE", "not compressed")
            dst.writeframes(converted)

        after = tmp.stat().st_size
        if after >= before:
            return before, before, False, "no saving"

        # Verify the generated file before atomically replacing the temporary
        # web-build source asset.
        verify, verify_frames = read_pcm(tmp)
        if (
            verify.framerate != target_rate
            or verify.nchannels != params.nchannels
            or verify.sampwidth != params.sampwidth
            or not verify_frames
        ):
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
        print(
            f"  {saving:10d}  {before:10d} -> {after:10d}  "
            f"{reason:18s}  {path.relative_to(args.root)}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
