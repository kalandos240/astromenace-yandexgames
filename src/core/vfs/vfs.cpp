/****************************************************************************

    AstroMenace
    Hardcore 3D space scroll-shooter with spaceship upgrade possibilities.
    Copyright (c) 2006-2019 Mikhail Kurinnoi, Viewizard

    AstroMenace is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

*****************************************************************************/

#include "vfs.h"
#include <limits>
#include <cstring>
#include <fstream>
#include <cstdio>

namespace viewizard {

struct sVFS {
    std::string FileName;
    // Used only while creating a VFS.
    std::fstream File{};
    // Use C stdio for reading. This is considerably more reliable for large
    // MEMFS files in Emscripten than libstdc++ fstream/streambuf.
    std::FILE *ReadFile{nullptr};

    explicit sVFS(const std::string &_FileName) : FileName{_FileName} {}
    ~sVFS()
    {
        if (ReadFile) {
            std::fclose(ReadFile);
            ReadFile = nullptr;
        }
    }
};

struct sVFS_Entry {
    uint32_t Offset{0};
    uint32_t Size{0};
    std::weak_ptr<sVFS> Parent{};
};

namespace {
std::forward_list<std::shared_ptr<sVFS>> VFSList;
std::unordered_map<std::string, sVFS_Entry> VFSEntriesMap;
constexpr unsigned int FixedHeaderPartSize = 4 + 4 + 4;

bool ReadExact(std::FILE *File, void *Data, size_t Size)
{
    return File && Data && std::fread(Data, 1, Size, File) == Size;
}
} // unnamed namespace

static int WriteIntoVFSfromMemory(const std::shared_ptr<sVFS> &WritableVFS,
                                  const std::string &Name,
                                  const uint8_t *DataBuffer,
                                  uint32_t DataSize,
                                  uint32_t &FileTableOffset,
                                  std::unordered_map<std::string, sVFS_Entry> &WritableVFSEntriesMap)
{
    if (!WritableVFS || Name.empty() || !DataBuffer || DataSize == 0 || Name.size() > UINT16_MAX) {
        return ERR_PARAMETERS;
    }

    WritableVFSEntriesMap[Name].Offset = FileTableOffset;
    WritableVFSEntriesMap[Name].Size = DataSize;
    WritableVFS->File.seekp(WritableVFSEntriesMap[Name].Offset, std::ios::beg);
    WritableVFS->File.write(reinterpret_cast<const char*>(DataBuffer), WritableVFSEntriesMap[Name].Size);
    WritableVFSEntriesMap[Name].Parent = WritableVFS;

    for (const auto &tmpEntry : WritableVFSEntriesMap) {
        auto sharedParent = tmpEntry.second.Parent.lock();
        if (sharedParent == WritableVFS) {
            uint16_t tmpNameSize{static_cast<uint16_t>(tmpEntry.first.size())};
            WritableVFS->File.write(reinterpret_cast<char*>(&tmpNameSize), sizeof(tmpNameSize));
            WritableVFS->File.write(tmpEntry.first.c_str(), tmpEntry.first.size());
            WritableVFS->File.write(reinterpret_cast<const char*>(&tmpEntry.second.Offset), sizeof(tmpEntry.second.Offset));
            WritableVFS->File.write(reinterpret_cast<const char*>(&tmpEntry.second.Size), sizeof(tmpEntry.second.Size));
        }
    }

    WritableVFS->File.seekp(FixedHeaderPartSize, std::ios::beg);
    FileTableOffset += DataSize;
    WritableVFS->File.write(reinterpret_cast<char*>(&FileTableOffset), sizeof(FileTableOffset));

    std::cout << Name << " file added to VFS.\n";
    return 0;
}

static int WriteIntoVFSfromFile(const std::shared_ptr<sVFS> &WritableVFS,
                                const std::string &SrcName,
                                const std::string &DstName,
                                uint32_t &FileTableOffset,
                                std::unordered_map<std::string, sVFS_Entry> &WritableVFSEntriesMap)
{
    if (!WritableVFS || SrcName.empty() || DstName.empty()) return ERR_PARAMETERS;

    std::ifstream File{SrcName, std::ios::binary};
    if (File.fail()) {
        std::cerr << __func__ << "(): Can't find file " << SrcName << "\n";
        return ERR_FILE_NOT_FOUND;
    }

    File.seekg(0, std::ios::end);
    auto tmpSize = File.tellg();
    if (tmpSize == std::ios::pos_type(-1)) return ERR_PARAMETERS;
    File.seekg(0, std::ios::beg);
    uint32_t tmpFileSize = static_cast<uint32_t>(tmpSize);

    std::unique_ptr<uint8_t[]> tmpBuffer(new uint8_t[tmpFileSize]);
    File.read(reinterpret_cast<char*>(tmpBuffer.get()), tmpFileSize);
    if (File.fail() && !File.eof()) return ERR_FILE_IO;

    int rc = WriteIntoVFSfromMemory(WritableVFS, DstName, tmpBuffer.get(), tmpFileSize,
                                    FileTableOffset, WritableVFSEntriesMap);
    if (rc) std::cerr << __func__ << "(): Can't write into VFS from memory " << DstName << "\n";
    return rc;
}

int vw_CreateVFS(const std::string &Name, unsigned int BuildNumber,
                 const std::string &RawDataDir, const std::string &ModelsPack,
                 const std::string GameData[], unsigned int GameDataCount)
{
    if (Name.empty()) return ERR_PARAMETERS;

    std::shared_ptr<sVFS> TempVFS{new sVFS{Name}};
    TempVFS->File.open(Name, std::ios::binary | std::ios::out);
    if (TempVFS->File.fail()) {
        std::cerr << __func__ << "(): Can't open VFS file for write " << Name << "\n";
        return ERR_FILE_NOT_FOUND;
    }

    constexpr char Sign[4]{'V','F','S','_'};
    TempVFS->File.write(Sign, 4);
    TempVFS->File.write(VFS_VER, 4);
    TempVFS->File.write(reinterpret_cast<char*>(&BuildNumber), 4);

    uint32_t FileTableOffset{FixedHeaderPartSize + sizeof(FileTableOffset)};
    TempVFS->File.write(reinterpret_cast<char*>(&FileTableOffset), sizeof(FileTableOffset));
    std::unordered_map<std::string, sVFS_Entry> WritableVFSEntriesMap;

    if (!ModelsPack.empty()) {
        if (!VFSList.empty()) vw_ShutdownVFS();
        int rc = vw_OpenVFS(RawDataDir + ModelsPack, 0);
        if (rc) {
            std::cerr << __func__ << "(): " << RawDataDir + ModelsPack << " file not found or corrupted.\n";
            return rc;
        }

        for (const auto &tmpVFSEntry : VFSEntriesMap) {
            std::unique_ptr<cFILE> tmpFile = vw_fopen(tmpVFSEntry.first);
            if (!tmpFile) return ERR_FILE_NOT_FOUND;
            rc = WriteIntoVFSfromMemory(TempVFS, tmpVFSEntry.first, tmpFile->GetData(),
                                        static_cast<uint32_t>(tmpFile->GetSize()),
                                        FileTableOffset, WritableVFSEntriesMap);
            if (rc) {
                std::cerr << __func__ << "(): VFS compilation process aborted!\n";
                return rc;
            }
            vw_fclose(tmpFile);
        }
        vw_ShutdownVFS();
    }

    WritableVFSEntriesMap.rehash(0);
    for (unsigned int i = 0; i < GameDataCount; ++i) {
        int rc = WriteIntoVFSfromFile(TempVFS, RawDataDir + GameData[i], GameData[i],
                                      FileTableOffset, WritableVFSEntriesMap);
        if (rc) {
            std::cerr << __func__ << "(): VFS compilation process aborted!\n";
            return rc;
        }
    }

    TempVFS->File.flush();
    if (!TempVFS->File.good()) return ERR_FILE_IO;
    std::cout << "VFS file was created " << Name << "\n";
    return 0;
}

int vw_OpenVFS(const std::string &Name, unsigned int BuildNumber)
{
    auto errPrintWithVFSListPop = [&Name] (const std::string &Text, int err) {
        std::cerr << "vw_OpenVFS(): " << Text << " " << Name << "\n";
        VFSList.pop_front();
        return err;
    };

    VFSList.emplace_front(new sVFS{Name});
    auto VFS = VFSList.front();
    VFS->ReadFile = std::fopen(Name.c_str(), "rb");
    if (!VFS->ReadFile) return errPrintWithVFSListPop("Can't find VFS file", ERR_FILE_NOT_FOUND);

    if (std::fseek(VFS->ReadFile, 0, SEEK_END) != 0) return errPrintWithVFSListPop("VFS file size error", ERR_FILE_IO);
    long VFS_FileSize = std::ftell(VFS->ReadFile);
    if (VFS_FileSize < 16) return errPrintWithVFSListPop("VFS file size error", ERR_FILE_IO);
    std::rewind(VFS->ReadFile);

    char Sign[4]{};
    if (!ReadExact(VFS->ReadFile, Sign, sizeof(Sign))) return errPrintWithVFSListPop("VFS file size error", ERR_FILE_IO);
    if (std::memcmp(Sign, "VFS_", 4) != 0) {
        std::cerr << "vw_OpenVFS(): first bytes are "
                  << static_cast<unsigned>(static_cast<unsigned char>(Sign[0])) << " "
                  << static_cast<unsigned>(static_cast<unsigned char>(Sign[1])) << " "
                  << static_cast<unsigned>(static_cast<unsigned char>(Sign[2])) << " "
                  << static_cast<unsigned>(static_cast<unsigned char>(Sign[3])) << "\n";
        return errPrintWithVFSListPop("VFS file header error", ERR_FILE_IO);
    }

    char Version[4]{};
    if (!ReadExact(VFS->ReadFile, Version, sizeof(Version))) return errPrintWithVFSListPop("VFS file corrupted:", ERR_FILE_IO);
    if (std::memcmp(Version, VFS_VER, 4) != 0) return errPrintWithVFSListPop("VFS file has wrong version:", ERR_FILE_IO);

    uint32_t vfsBuildNumber{0};
    if (!ReadExact(VFS->ReadFile, &vfsBuildNumber, sizeof(vfsBuildNumber))) return errPrintWithVFSListPop("VFS file corrupted:", ERR_FILE_IO);
    if (BuildNumber) {
        if (!vfsBuildNumber) return errPrintWithVFSListPop("VFS file build number was not set", ERR_VFS_BUILD);
        if (BuildNumber != vfsBuildNumber) return errPrintWithVFSListPop("VFS file has wrong build number", ERR_VFS_BUILD);
    }

    uint32_t FileTableOffset{0};
    if (!ReadExact(VFS->ReadFile, &FileTableOffset, sizeof(FileTableOffset))) return errPrintWithVFSListPop("VFS file corrupted:", ERR_FILE_IO);
    if (FileTableOffset < 16 || FileTableOffset > static_cast<uint32_t>(VFS_FileSize)) {
        return errPrintWithVFSListPop("VFS file table offset error", ERR_FILE_IO);
    }
    if (std::fseek(VFS->ReadFile, static_cast<long>(FileTableOffset), SEEK_SET) != 0) {
        return errPrintWithVFSListPop("VFS file table seek error", ERR_FILE_IO);
    }

    while (true) {
        long Current = std::ftell(VFS->ReadFile);
        if (Current == VFS_FileSize) break;
        if (Current < 0 || Current > VFS_FileSize) return errPrintWithVFSListPop("VFS file table corrupted", ERR_FILE_IO);

        uint16_t tmpNameSize{0};
        if (!ReadExact(VFS->ReadFile, &tmpNameSize, sizeof(tmpNameSize)) || tmpNameSize == 0) {
            return errPrintWithVFSListPop("VFS file table corrupted", ERR_FILE_IO);
        }
        if (std::ftell(VFS->ReadFile) + static_cast<long>(tmpNameSize) + 8 > VFS_FileSize) {
            return errPrintWithVFSListPop("VFS file table corrupted", ERR_FILE_IO);
        }

        std::string tmpName(tmpNameSize, '\0');
        if (!ReadExact(VFS->ReadFile, &tmpName[0], tmpNameSize)) return errPrintWithVFSListPop("VFS file table corrupted", ERR_FILE_IO);

        sVFS_Entry Entry;
        if (!ReadExact(VFS->ReadFile, &Entry.Offset, sizeof(Entry.Offset)) ||
            !ReadExact(VFS->ReadFile, &Entry.Size, sizeof(Entry.Size))) {
            return errPrintWithVFSListPop("VFS file table corrupted", ERR_FILE_IO);
        }
        if (static_cast<uint64_t>(Entry.Offset) + Entry.Size > static_cast<uint64_t>(FileTableOffset)) {
            return errPrintWithVFSListPop("VFS entry range error", ERR_FILE_IO);
        }
        Entry.Parent = VFS;
        VFSEntriesMap[tmpName] = Entry;
    }

    VFSEntriesMap.rehash(0);
    std::cout << "VFS file was opened " << Name << " with " << VFSEntriesMap.size() << " entries.\n";
    return 0;
}

void vw_ShutdownVFS()
{
    VFSEntriesMap.clear();
    VFSList.clear();
    std::cout << "All VFS files closed.\n";
}

std::unique_ptr<cFILE> vw_fopen(const std::string &FileName)
{
    if (FileName.empty()) return nullptr;

    auto FileInVFS = VFSEntriesMap.find(FileName);
    if (FileInVFS != VFSEntriesMap.end()) {
        auto sharedParent = FileInVFS->second.Parent.lock();
        if (!sharedParent || !sharedParent->ReadFile) {
            if (!sharedParent) VFSEntriesMap.erase(FileName);
            return nullptr;
        }

        std::unique_ptr<cFILE> File(new cFILE(0, 0));
        File->Size_ = static_cast<long>(FileInVFS->second.Size);
        File->Data_.reset(new uint8_t[File->Size_]);

        if (std::fseek(sharedParent->ReadFile, static_cast<long>(FileInVFS->second.Offset), SEEK_SET) != 0 ||
            std::fread(File->Data_.get(), 1, static_cast<size_t>(File->Size_), sharedParent->ReadFile) != static_cast<size_t>(File->Size_)) {
            return nullptr;
        }
        return File;
    }

    std::FILE *DiskFile = std::fopen(FileName.c_str(), "rb");
    if (!DiskFile) return nullptr;
    if (std::fseek(DiskFile, 0, SEEK_END) != 0) {
        std::fclose(DiskFile);
        return nullptr;
    }
    long Size = std::ftell(DiskFile);
    if (Size < 0 || std::fseek(DiskFile, 0, SEEK_SET) != 0) {
        std::fclose(DiskFile);
        return nullptr;
    }

    std::unique_ptr<cFILE> File(new cFILE(0, 0));
    File->Size_ = Size;
    File->Data_.reset(new uint8_t[File->Size_]);
    const size_t Read = std::fread(File->Data_.get(), 1, static_cast<size_t>(File->Size_), DiskFile);
    std::fclose(DiskFile);
    if (Read != static_cast<size_t>(File->Size_)) return nullptr;
    return File;
}

int vw_fclose(std::unique_ptr<cFILE> &stream)
{
    if (!stream) return ERR_PARAMETERS;
    stream.reset();
    return 0;
}

size_t cFILE::fread(void *buffer, size_t size, size_t count)
{
    if (!buffer) {
        errno = EINVAL;
        return 0;
    }
    if (!Data_) {
        errno = EIO;
        return 0;
    }

    size_t CopyCount{0};
    for (; (CopyCount < count) && (Size_ >= static_cast<long>(Pos_ + size)); ++CopyCount) {
        memcpy(static_cast<uint8_t *>(buffer) + CopyCount * size, Data_.get() + Pos_, size);
        Pos_ += size;
    }
    if (CopyCount == 0) errno = 0;
    return CopyCount;
}

int cFILE::fseek(long offset, int origin)
{
    switch (origin) {
    case SEEK_CUR:
        if (Pos_ + offset > Size_ || Pos_ + offset < 0) return ERR_PARAMETERS;
        Pos_ += offset;
        break;
    case SEEK_END:
        if (offset > 0 || Size_ + offset < 0) return ERR_PARAMETERS;
        Pos_ = Size_ + offset;
        break;
    case SEEK_SET:
        if (offset < 0 || offset > Size_) return ERR_PARAMETERS;
        Pos_ = offset;
        break;
    default:
        std::cerr << __func__ << "(): Error in fseek function call, wrong origin.\n";
        return ERR_PARAMETERS;
    }
    return 0;
}

long cFILE::ftell()
{
    return Pos_;
}

} // viewizard namespace
