# Scoop GX resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Scoop/ArcGX.cs`, class `GxOpener`
- GARBro tag: `GX`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The file starts with `PARROT1.0`. The entry count sits at 0xA and a word at 0xC bounds the index, which
GARbro resolves by reading that many bytes from the start of the file. Records begin at 0x10 and are
0x12 bytes wide: a compression word, the offset of the entry's name, then the data offset, the stored
size, and the unpacked size.

Name offsets are relative to the start of the file and point inside the index region, and the name is
read as a null-terminated string from there with the remaining index bytes as its limit. The port keeps
that layout, including the requirement that the records fit inside the declared index size. A
compression value above one marks the entry as compressed; `GxOpener.OpenEntry` decodes those payloads
as zlib streams. Since a zlib stream carries no declared length, the unpacked size word is treated as
informational and those entries are marked as having an inexact size.

## Support

| Capability | Status |
| --- | --- |
| `PARROT1.0` header signature | Supported |
| Entry count validation | Supported |
| Index size bound covering records and names | Supported |
| Name offset inside the index region | Supported |
| CP932 filenames | Supported |
| Compression word with stored and packed levels | Supported |
| Entry placement validation | Supported |
| zlib extraction with metadata exposure | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored and a zlib entry, a foreign header, a name offset beyond the index
size, and records that do not fit the declared index size.
