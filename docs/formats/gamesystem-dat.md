# 0verflow DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/GameSystem/ArcDAT.cs`, class `DatOpener` (tag `DAT/0verflow`)
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first word counts 512-byte sectors: the reference rejects counts of two or below and counts at or beyond
`uint.MaxValue >> 9`, shifts the accepted value into a byte size, and requires that size to be both below the file size
and equal to the first record's sector offset. Because the index starts at 0x400, the smallest valid archive uses three
sectors.

Records begin at 0x400 and are 0x10 bytes wide: a twelve-byte packed name and a sector offset. Record `i`'s offset is
both the start of entry `i` and the end of entry `i-1`, so entry sizes are the distance between consecutive offsets,
and the walk ends when a record's name field is entirely 0xFF. Offsets must never decrease and must stay inside the
file, and every step also has to stay inside the index. An empty listing is not an archive.

## Names

Twelve bytes are decoded as four big-endian 24-bit values, each expanded into four six-bit characters based at 0x20, so
archive names only cover the `0x20`–`0x5F` range (space through underscore, in practice uppercase). The name ends at
the first space inside the first twelve characters, and the second group of four characters is the extension up to its
own first space; an extension group that starts with a space means no extension, and a name that starts with a space
rejects the archive. Names ending in `.CRGB` or `.CHAR` are typed as images.

## Extraction

Entries are plain byte ranges over their back-filled sector extents, so extraction emits the stored bytes verbatim,
including any padding up to the next sector. The reference's `OpenImage` decoders (`.BGD`, `.CRGB`, `.CHAR`) are image
decoding and are out of scope for this port.

## Support

| Capability | Status |
| --- | --- |
| Sector-counted index header | Supported |
| Index end matched against the first payload offset | Supported |
| Six-bit packed name restoration | Supported |
| 0x10 records with an all-ones end marker | Supported |
| Sector-aligned back-filled entry sizes | Supported |
| Image typing for `.CRGB` and `.CHAR` | Supported |
| Verbatim extraction | Supported |
| Image decoding | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover name restoration (with and without an extension), sector-sized listing and extraction, image
typing, a mismatched first offset, a leading-space name, decreasing offsets, a missing end marker and a too-small
sector count.
