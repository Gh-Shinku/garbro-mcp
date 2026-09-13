# A98SYS Engine PAK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/ActiveSoft/ArcADPACK.cs`, class `PakOpener`
- GARbro tag: `A98`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The word at 0 is the entry count, a count of one or less is rejected, and a count of exactly 0x4000 switches
to the voice archive layout. The format carries no signature and relies on the `pak` extension.

In the plain layout the index starts at 2 and each 0x10-byte record holds an eight-byte name field, a
four-byte extension field, and a data offset. The size is not stored: it is the gap to the following
record's offset, which is why the announced count is one larger than the number of entries returned — the
extra slot carries the end of the data. An offset may not point inside the index region, and a name is
decoded from its field, trimmed of trailing whitespace, and has its extension appended only when that field
is not empty.

In the voice layout a second count sits at 2 and the index starts at 4 with eight-byte records whose offset
word is at +4. That pass stops early when an offset equals the file end on the last announced record, so the
entry list can be shorter than the count suggests. The name records then follow immediately at the position
that pass stopped at, each holding a name, an extension and a *stored* size rather than a derived one, which
is the key difference between the two layouts.

GARbro resolves each entry's type through its resource catalog; the port records an inferred type from the
extension. Payloads are stored verbatim in both layouts.

## Support

| Capability | Status |
| --- | --- |
| `pak` extension requirement | Supported |
| Count validation and the 0x4000 voice marker | Supported |
| Plain layout with derived sizes | Supported |
| Plain layout's extra offset slot | Supported |
| Voice layout with stored sizes | Supported |
| Early stop at the file end in the voice listing | Supported |
| Name and extension fields with whitespace trimming | Supported |
| Offset and placement validation | Supported |
| Type classification by extension | Supported as metadata |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the plain layout, the voice layout with and without its terminator record, a count
of one, and the extension requirement.
