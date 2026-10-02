#ifndef ASTROMENACE_PARTICLE_ALLOCATOR_H
#define ASTROMENACE_PARTICLE_ALLOCATOR_H
#include <algorithm>
#include <cstddef>
#include <new>
#include <unordered_map>
#include <vector>

namespace viewizard {
namespace particle_memory {
struct Pool {
    struct Link { Link *Next; };
    Link *Free{nullptr};
    size_t Live{0};
    std::vector<void*> Blocks;
    void *Allocate(size_t Stride) {
        if (!Free) {
            void *Block = ::operator new(Stride * 256);
            Blocks.push_back(Block);
            for (size_t i = 0; i < 256; ++i) {
                auto *Node = reinterpret_cast<Link*>(static_cast<char*>(Block) + i * Stride);
                Node->Next = Free;
                Free = Node;
            }
        }
        Link *Node = Free;
        Free = Node->Next;
        ++Live;
        return Node;
    }
    void Deallocate(void *Pointer) noexcept {
        auto *Node = static_cast<Link*>(Pointer);
        Node->Next = Free;
        Free = Node;
        --Live;
    }
    void ReleaseIdle() {
        if (Live) return;
        for (void *Block : Blocks) ::operator delete(Block);
        Blocks.clear();
        Free = nullptr;
    }
};
inline std::unordered_map<size_t, Pool> &Pools() {
    // Survive static destruction order; idle storage is released at mission exit.
    static auto *Registry = new std::unordered_map<size_t, Pool>;
    return *Registry;
}
inline void ReleaseIdle() {
    for (auto &Entry : Pools()) Entry.second.ReleaseIdle();
}
} // particle_memory

template <typename T> struct ParticleAllocator {
    using value_type = T;
    template <typename U> struct rebind { using other = ParticleAllocator<U>; };
    ParticleAllocator() noexcept = default;
    template <typename U> ParticleAllocator(const ParticleAllocator<U>&) noexcept {}
    static size_t Stride() {
        const size_t Alignment = std::max(alignof(T), alignof(void*));
        return (std::max(sizeof(T), sizeof(void*)) + Alignment - 1) / Alignment * Alignment;
    }
    static particle_memory::Pool &Storage() {
        static auto &Storage = particle_memory::Pools()[Stride()];
        return Storage;
    }
    T *allocate(size_t Count) {
        static_assert(alignof(T) <= alignof(std::max_align_t), "Particle nodes require ordinary alignment");
        if (Count != 1) return static_cast<T*>(::operator new(Count * sizeof(T)));
        return static_cast<T*>(Storage().Allocate(Stride()));
    }
    void deallocate(T *Pointer, size_t Count) noexcept {
        if (Count != 1) { ::operator delete(Pointer); return; }
        Storage().Deallocate(Pointer);
    }
};
template <typename T, typename U> bool operator==(const ParticleAllocator<T>&,const ParticleAllocator<U>&) noexcept { return true; }
template <typename T, typename U> bool operator!=(const ParticleAllocator<T>&,const ParticleAllocator<U>&) noexcept { return false; }
} // viewizard
#endif
