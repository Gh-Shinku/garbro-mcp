# KiriKiri XP3

## Sources and license

- GARbro reference: `ArcFormats/KiriKiri/ArcXP3.cs`
- Pinned commit: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2014-2020 morkt
- License: MIT; the complete text is retained in the root `LICENSE` file
- Official KiriKiri cross-reference: [`base/XP3Archive.cpp`](https://github.com/krkrz/krkrz/blob/master/base/XP3Archive.cpp)

The implementation was written after analyzing the binary structure and observable behavior. It
uses this project's asynchronous bigint and streaming APIs instead of porting GARbro's C# class
hierarchy.

## Structure summary

A standard XP3 file begins with an 11-byte signature followed by a little-endian 64-bit index
offset. The low three bits of the first byte in an index block identify the encoding method (0 for
raw and 1 for zlib). The high bit, `0x80`, indicates that another index block follows.

Each `File` chunk contains:

- `info`: flags, original size, archived size, and the UTF-16LE filename;
- `segm`: encoding method, 64-bit offset, original size, and archived size for one or more segments;
- `adlr`: the Adler-32 checksum of the file contents.

Each segment can independently use raw or zlib encoding. Only index blocks are loaded into memory,
and only up to their declared size. File contents are emitted sequentially through bigint range
reads and zlib streams.

## Initial support matrix

| Capability | Status |
| --- | --- |
| Standalone XP3 detection | Supported |
| Raw/zlib index | Supported |
| Continued index | Supported |
| UTF-16LE paths | Supported |
| Raw/zlib multi-segment files | Supported |
| Listing protected/encrypted entries | Supported |
| Extracting protected/encrypted entries | Unsupported; returns `UNSUPPORTED_FEATURE` |
| Game-specific ciphers and obfuscated indexes | Unsupported |
| PEXP3 / EXE-embedded XP3 | Unsupported |
| XP3 creation | Unsupported |

All offsets and sizes remain `bigint` values in the public API. They are converted to JavaScript
`number` values only after bounds checking and only when an index Buffer must be allocated.
