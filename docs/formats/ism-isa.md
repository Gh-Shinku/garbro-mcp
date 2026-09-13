# ISM engine ISA resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ism/ArcISA.cs`, classes `IsaOpener` and `IsaIndexReader`
- GARbro tag: `ISA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head spells `ISM ARCHIVED`, the entry count sits at 0x0C, and the version word at 0x0E. GARbro reads
the version's high bit as an encryption flag, masks it off, and then never applies it, so no decryption is
performed here.

Records begin at 0x10 whatever the layout: a fixed-width name field, four bytes the reference skips, then
the data offset and the size. Two layouts differ in the name field width and the record stride — 0x0C with
a stride of 0x14, or 0x30 with a stride of 0x10 — and in the second the stride is narrower than the name
field, which the port mirrors rather than correcting. A record with an empty name rejects the layout, and
each entry's span is checked against the file.

A version other than one is tried with the first layout and falls back to the second, while version one
skips straight to the second. A name shorter than thirty-two bytes may have lost its extension inside the
field, so the reference repairs `.OG` into audio and `.PN` into image; the port records the same
conclusion as metadata. Payloads are stored verbatim.

## Support

| Capability | Status |
| --- | --- |
| `ISM ARCHIVED` head | Supported |
| Entry count and version words | Supported |
| Version-driven layout ordering | Supported |
| Both record layouts, including the narrower stride | Supported |
| Skipped word, data offset and size per record | Supported |
| Entry placement validation | Supported |
| CP932 names with empty rejection | Supported |
| Truncated extension repair as metadata | Supported |
| Encryption flag ignored as in the reference | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both layouts, a truncated audio extension, a missing marker, and a payload
outside the file.
