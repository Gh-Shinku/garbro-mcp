# Studio e.go! DAT resource archive (older layout)

## Reference and attribution

- GARBro reference: `ArcFormats/StudioEgo/ArcEGO.cs`, class `OldDatOpener`
- GARbro tag: `DAT/EGO/0`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This layout shares its whole index walk with the newer one in the same GARbro file: the region length is the
word at 0 plus four, records follow at 4 with their own length in front, the length must exceed the header
size, stay within 0x100 and not cross the payload start, and the name fills the rest of the record.

The difference is where the header ends. Here it is 0xC bytes, which moves the data offset to +4 and the size
to +8 and leaves four more bytes for the name than the newer layout does. That difference is what tells the two
apart, since neither carries a signature: a file built for one layout is rejected by the other's reader, and
the port covers both as separate formats so each can be selected independently.

An offset may not point inside the index region and every entry is checked against the file. Payloads are
stored verbatim, and unlike the newer variant the reference declares no archive creation for this one.

## Support

| Capability | Status |
| --- | --- |
| Index region length and bounds | Supported |
| Variable-length records with a 0xC-byte header | Supported |
| Record length limits (above the header, at most 0x100) | Supported |
| Name field behind the header with empty rejection | Supported |
| Data offset at +4 and size at +8 | Supported |
| Offset and placement validation | Supported |
| Structural detection without a signature | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive and the cross-layout rejection from the newer variant's note.
