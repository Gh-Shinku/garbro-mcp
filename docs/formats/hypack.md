# Kogado HyPack

## Reference and attribution

- GARBro reference: `ArcFormats/Hypatia/ArcKogado.cs`, class `PakOpener`
- GARBro tag: `PAK/HyPack`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014-2018 morkt
- License: MIT

The archive and Mariel implementations are independent TypeScript rewrites based on GARbro
behavior.

## Structure

HyPack starts with `HyPack` and supports versions 0x100, 0x200, 0x300, and 0x301. Their index
records are respectively 0x20, 0x28, and 0x30 bytes. Each record combines a 0x15-byte CP932 basename
and three-byte extension, a data-relative offset, sizes, and—since version 0x200—a compression type.
Version 0x300 adds a per-entry CRC16 field and file timestamp.

Compression type 1 is Mariel, an offset/count LZ stream controlled by MSB-first 32-bit flag words.
Type 3 inverts every stored byte. Type 2 is Cocotte, whose GARbro dependency is a separate GPLv2
range-coder/BWT/MTF module and is not included in this implementation boundary.

## Support

| Capability | Status |
| --- | --- |
| Versions 0x100, 0x200, 0x300, and 0x301 | Supported |
| CP932 basename and extension fields | Supported |
| Raw entry extraction | Supported |
| Mariel LZ decompression | Supported |
| XOR-FF entry decoding | Supported |
| Cocotte decompression | Unsupported |
| Archive creation and CRC generation | Unsupported |

Synthetic fixtures cover every index version, fallback filenames, Mariel dictionary copies,
XOR-FF, and the explicit Cocotte error. No real game data is used, following the current migration
policy.
