# YOX ADV+++ engine DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Yox/ArcYOX.cs`, class `DatOpener`
- GARBro tag: `DAT/YOX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with `YOX` followed by a zero byte — GARbro's `Signature` is the three-byte tag read as a 32-bit
word. The index offset sits at 8 and a signed entry count at 0x0c. Records hold a payload offset and a stored size;
the reference first tries eight-byte records and, when any record fails, clears the directory and retries with
sixteen-byte records. Zero-sized records and payloads outside the file reject the archive.

The reference then inspects every entry. An entry that itself starts with `YOX` and whose following word has bit 1
set hides zlib data behind a 0x10-byte header: the payload offset moves past that header, the stored size drops by
0x10, and the word at offset 8 becomes the unpacked size. The port applies the same adjustment while reading the
index so listing and extraction agree.

## Extraction

Entries without the packed marker are emitted verbatim. Packed entries are decompressed as zlib streams over the
adjusted payload span, matching GARbro's `ZLibStream` reading to the end of input. Packed entries report the declared
unpacked size and are marked as having an inexact size.

GARbro's `DetectFileTypes` classifies entries through `AutoEntry.DetectFileType` and renames them with the detected
extension; neither the catalog lookup nor the rename is reproduced, and entry names stay at the zero-padded index
position the reference uses before detection.

## Support

| Capability | Status |
| --- | --- |
| `YOX` signature with a zero fourth byte | Supported |
| Eight-byte records with a sixteen-byte fallback | Supported |
| Zero-size and placement validation | Supported |
| Packed `YOX` header detection with a 0x10-byte skip | Supported |
| Zlib extraction | Supported |
| Verbatim extraction | Supported |
| Entry type inference and extension rename | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover narrow and wide records, zlib-packed entries, an unpacked `YOX` entry, and zero-size and
foreign-signature rejection.
