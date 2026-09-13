# Silky IFL resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Silky/ArcIFL.cs`, class `IflOpener`
- GARbro tag: `IFL`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `IFLS`, a data offset sits at 4 and the entry count at 8. The offset is only bound-checked
against the file, because the records' own offsets are absolute rather than relative to it. Records follow at 12
with a 0x18-byte stride: a 0x10-byte name field, the data offset and the size. A blank name rejects the archive
and every payload is checked against the file.

## Extraction

The reference decides lazily whether a payload is packed. A payload qualifies when its span exceeds twelve bytes,
its name is not a `.grd` image that another Silky format owns, and its first four bytes spell `CMP_`. Qualifying
payloads declare their expanded length in the word at +4 and hold an LZSS stream from +12, decoded with a ring fill
of 0x20 instead of the default. GARBro bounds decoding to that declared size; a truncated stream leaves the unread
tail zero-filled. The port performs the same inspection while reading the index so listing and extraction agree.
Everything else is emitted verbatim, which is also what happens for a `.grd` name even when its payload carries the
marker.

## Support

| Capability | Status |
| --- | --- |
| `IFLS` signature and data offset | Supported |
| Entry count validation | Supported |
| 0x18-byte records with a name field | Supported |
| CP932 names with blank rejection | Supported |
| Entry placement validation | Supported |
| `CMP_` detection with the twelve-byte header | Supported |
| LZSS extraction with the ring fill override | Supported |
| `.grd` passthrough for its own format | Supported |
| Verbatim extraction otherwise | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored payload, a marked payload expanded with the overridden ring fill, a declaration
that bounds a longer LZSS stream, a `.grd` name left stored, a blank name, and a data offset outside the file.
