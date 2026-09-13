# route2 engine CGF CG archive

## Reference and attribution

- GARBro reference: `ArcFormats/Triangle/ArcCGF.cs`, classes `CgfOpener` and `CgfEntry`
- GARBro tag: `CGF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A route2 CG archive has no signature. The record count sits at 0 and selects one of two record
widths: the width whose implied index end, `4 + count * width`, equals the trailing offset word of
the first record, which begins at 0x14 for 0x14-byte records and at 0x20 for 0x20-byte records. The
name occupies every byte of a record except its trailing word.

That trailing word holds the entry's own start offset with two flag bits in the top bits, so offsets
are masked with `0x3FFFFFFF`. The last entry ends at the file size. GARbro rejects layouts whose first
record spans exactly the distance to the second record's trailing word, the check that separates
route2 archives from its sibling variants, and it refuses archives at or beyond `0x3FFFFFFF` bytes.

Extraction rewrites the stored layout. GARbro wraps every entry in `CgfEntry` except those with flag
`1` or an `.iaf` extension, and wrapped entries are read as a twelve-byte header followed by the
payload: the size word and four further bytes in front of the payload land in the header, and an entry
flagged `2` first skips sixteen bytes and additionally keeps the record's first eight bytes as the
head of that header. The port exposes the flag bits as entry metadata and marks the stored span as
unreliable, because the extracted length is `12 + packed size` rather than the recorded span.

## Support

| Capability | Status |
| --- | --- |
| Record-width selection from the index end | Supported |
| Flag-bit masking of offsets | Supported |
| Name validation | Supported |
| Entry placement validation | Supported |
| route2 layout rejection | Supported |
| Size limit check | Supported |
| CP932 filenames | Supported |
| Entry listing | Supported |
| Prefixed-header extraction (`CgfEntry`) | Supported |
| Raw extraction for flag `1` and `.iaf` | Supported |
| Image decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the 0x14 and 0x20 record widths, flag-bit masking, prefixed extraction,
raw extraction for `.iaf` and single-bit flags, width rejection, and blank-name rejection.
