# MAGI PAK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/NitroPlus/ArcPAK.cs`, class `PakOpener` (tag `PAK/MAGI`)
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The GARbro comment notes that this
format is very similar to the NitroPlus v3 archive, but without encryption.

## Structure

The archive starts with a 32-bit little-endian version word, which must be 3 or 4, and a 32-bit entry count. The word at
0x0C is the size of a zlib-compressed index that begins at 0x118; the reference rejects sizes below two bytes or beyond
the file. Payload offsets inside the index are relative to the end of the compressed index, not to the file start.

## Index

The decompressed index is a sequence of variable-length records. Each record starts with a 32-bit name length and a
CP932 field of that size, whose value stops at the first zero byte. Version 4 appends a 32-bit directory flag: when it
is set the record is a directory, three further words are skipped, and the directory name becomes the running prefix for
the entries that follow, combined with `Path.Combine` semantics. Directories themselves are not listed.

File records continue with a payload offset, the unpacked size, an unused word, a packed flag and a packed size. An
entry is treated as compressed only when the flag is non-zero **and** the packed size is non-zero; compressed entries
use the packed size as their stored extent and the unpacked size as their output length, while plain entries use the
unpacked size for both. Every entry must satisfy GARbro's placement check against the archive size.

## Extraction

Compressed entries are decoded as zlib streams over their stored extent; plain entries are emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| Version 3 and 4 signatures | Supported |
| Compressed index at 0x118 | Supported |
| Index-relative payload offsets | Supported |
| Version 4 directory records | Supported |
| `Path.Combine` name prefixing | Supported |
| Packed/unpacked size handling | Supported |
| Entry placement validation | Supported |
| Zlib extraction | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover packed and verbatim entries, version 4 directories, an unsupported version, a corrupt index
and an out-of-range entry.
