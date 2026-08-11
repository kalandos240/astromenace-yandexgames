#!/usr/bin/env python3
from pathlib import Path

path = Path('src/core/audio/buffer.cpp')
text = path.read_text(encoding='utf-8')

helper_marker = 'static ALuint CreatePCMBufferFromWAVMemory'
if helper_marker not in text:
    anchor = '''std::unordered_map<std::string, ALuint> SoundBuffersMap;\nstd::unordered_map<std::string, sStreamBuffer> StreamBuffersMap;\n'''
    if anchor not in text:
        raise SystemExit('Could not find audio buffer maps')

    helper = r'''

#ifdef __EMSCRIPTEN__
static uint16_t ReadLE16(const unsigned char *Data)
{
    return static_cast<uint16_t>(Data[0]) |
           (static_cast<uint16_t>(Data[1]) << 8);
}

static uint32_t ReadLE32(const unsigned char *Data)
{
    return static_cast<uint32_t>(Data[0]) |
           (static_cast<uint32_t>(Data[1]) << 8) |
           (static_cast<uint32_t>(Data[2]) << 16) |
           (static_cast<uint32_t>(Data[3]) << 24);
}

static ALuint CreatePCMBufferFromWAVMemory(const void *RawData, size_t RawSize)
{
    const auto *Data = static_cast<const unsigned char *>(RawData);
    if (!Data || RawSize < 12 ||
        memcmp(Data, "RIFF", 4) != 0 || memcmp(Data + 8, "WAVE", 4) != 0) {
        std::cerr << __func__ << "(): unsupported or corrupted WAV header\n";
        return 0;
    }

    uint16_t AudioFormat{0};
    uint16_t Channels{0};
    uint16_t BitsPerSample{0};
    uint32_t SampleRate{0};
    const unsigned char *PCM{nullptr};
    uint32_t PCMSize{0};

    size_t Offset{12};
    while (Offset + 8 <= RawSize) {
        const unsigned char *Chunk = Data + Offset;
        const uint32_t ChunkSize = ReadLE32(Chunk + 4);
        const size_t ChunkDataOffset = Offset + 8;
        if (ChunkDataOffset + ChunkSize > RawSize) {
            std::cerr << __func__ << "(): corrupted WAV chunk\n";
            return 0;
        }

        if (memcmp(Chunk, "fmt ", 4) == 0 && ChunkSize >= 16) {
            const unsigned char *Fmt = Data + ChunkDataOffset;
            AudioFormat = ReadLE16(Fmt);
            Channels = ReadLE16(Fmt + 2);
            SampleRate = ReadLE32(Fmt + 4);
            BitsPerSample = ReadLE16(Fmt + 14);
        } else if (memcmp(Chunk, "data", 4) == 0) {
            PCM = Data + ChunkDataOffset;
            PCMSize = ChunkSize;
        }

        Offset = ChunkDataOffset + ChunkSize + (ChunkSize & 1u);
    }

    if (AudioFormat != 1 || !PCM || !PCMSize || !SampleRate) {
        std::cerr << __func__ << "(): only uncompressed PCM WAV is supported in web build\n";
        return 0;
    }

    ALenum Format{0};
    if (Channels == 1 && BitsPerSample == 8) {
        Format = AL_FORMAT_MONO8;
    } else if (Channels == 1 && BitsPerSample == 16) {
        Format = AL_FORMAT_MONO16;
    } else if (Channels == 2 && BitsPerSample == 8) {
        Format = AL_FORMAT_STEREO8;
    } else if (Channels == 2 && BitsPerSample == 16) {
        Format = AL_FORMAT_STEREO16;
    } else {
        std::cerr << __func__ << "(): unsupported WAV channels/bit depth: "
                  << Channels << "/" << BitsPerSample << "\n";
        return 0;
    }

    ALuint Buffer{0};
    alGenBuffers(1, &Buffer);
    if (!CheckALError(__func__) || !Buffer) {
        return 0;
    }

    alBufferData(Buffer, Format, PCM, static_cast<ALsizei>(PCMSize),
                 static_cast<ALsizei>(SampleRate));
    if (!CheckALError(__func__)) {
        alDeleteBuffers(1, &Buffer);
        return 0;
    }

    return Buffer;
}
#endif
'''
    text = text.replace(anchor, anchor + helper, 1)

old = '''    Buffer = alutCreateBufferFromFileImage(file->GetData(), static_cast<ALsizei>(file->GetSize()));\n    if (!CheckALUTError(__func__)) {\n        return 0;\n    }\n'''
new = '''#ifdef __EMSCRIPTEN__\n    Buffer = CreatePCMBufferFromWAVMemory(file->GetData(), file->GetSize());\n    if (!Buffer) {\n        return 0;\n    }\n#else\n    Buffer = alutCreateBufferFromFileImage(file->GetData(), static_cast<ALsizei>(file->GetSize()));\n    if (!CheckALUTError(__func__)) {\n        return 0;\n    }\n#endif\n'''

if new not in text:
    if old not in text:
        raise SystemExit('Could not find ALUT WAV loader block')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Added native OpenAL WAV memory loader for Emscripten.')
