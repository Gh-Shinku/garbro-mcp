# Studio e.go! DAT resource archive (newer layout)

## Reference and attribution

- GARBro reference: `ArcFormats/StudioEgo/ArcEGO.cs`, class `DatOpener`
- GARbro tag: `DAT/EGO/1`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The index region's length is the word at 0 plus four, and it must lie behind the smallest possible index and
inside the file. Records follow at 4 and are variable in size: each begins with its own length, which must
exceed the header size of 0x10, stay within 0x100, and not cross the payload start. The name fills whatever
remains behind the header, and the data offset and size sit at the end of it, at +8 and +0xC.

An offset may not point inside the index region and every entry is checked against the file. The format carries
neither a signature nor a registered extension, so those structural checks are the detection, and the record
shape is what separates this layout from the older one in the same GARbro file — a file belonging to one is
rejected by the other. Payloads are stored verbatim.

The reference also implements archive creation for this variant, which is outside the scope of this read-only
port.

## Support

| Capability | Status |
| --- | --- |
| Index region length and bounds | Supported |
| Variable-length records with a 0x10-byte header | Supported |
| Record length limits (above the header, at most 0x100) | Supported |
| Name field behind the header with empty rejection | Supported |
| Data offset at +8 and size at +0xC | Supported |
| Offset and placement validation | Supported |
| Structural detection without a signature | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, the cross-layout rejection, a record no longer than its header,
and a payload start inside the header region.
