#include "Companion.h"
// miniz's bundled header defines non-inline functions. Compile the actual writer in this
// translation unit so the archive round-trip reader shares its single implementation.
#include "archive/ZWrapper.cpp"
#include <cstdio>
#include <cstdlib>
#include <malloc.h>
#include <memory>
#include <vector>

// Archive writing does not need an active extractor or its debug-file output.
Companion* Companion::Instance = nullptr;

static void Require(bool condition, const char* message) {
    if (!condition) {
        fprintf(stderr, "%s\n", message);
        abort();
    }
}

int main() {
    std::vector<char> payload(8 * 1024 * 1024);
    uint32_t random = 12345;
    for (char& byte : payload) {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        byte = static_cast<char>(random);
    }
    const auto before = mallinfo().uordblks;
    for (int cycle = 0; cycle < 3; ++cycle) {
        {
            std::unique_ptr<BinaryWrapper> archive = std::make_unique<ZWrapper>("archive-memory.zip");
            archive->CreateArchive();
            archive->AddFile("payload", payload);
            archive->Close();
        }
        const auto after = mallinfo().uordblks;
        printf("Archive cycle %d: used before=%zu after=%zu\n", cycle, static_cast<size_t>(before),
               static_cast<size_t>(after));
        // Allow small logging/filesystem caches, but not an archived copy of the 8
        // MiB payload.
        Require(after <= before + 1024 * 1024, "Archive memory was retained after destruction");
        {
            miniz_cpp::zip_file saved("archive-memory.zip");
            const auto bytes = saved.read("payload");
            Require(bytes.size() == payload.size(), "Saved archive payload length changed");
            for (size_t index = 0; index < payload.size(); ++index) {
                Require(static_cast<unsigned char>(bytes[index]) == static_cast<unsigned char>(payload[index]),
                        "Saved archive payload changed");
            }
        }
        Require(std::remove("archive-memory.zip") == 0, "Could not remove the test archive");
    }
    puts("Archive memory and round-trip checks passed");
}
