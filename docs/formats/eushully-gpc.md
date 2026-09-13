# Eushully graphic archive

## Reference and attribution

- GARBro reference: `ArcFormats/Eushully/ArcGPC.cs`, classes `HOpener` and `GpcOpener`
- GARbro tag: `GPC`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive carries neither a signature nor stored sizes. Its index lives in a companion file whose name takes
the archive's three-letter extension, drops the last letter and appends `h`, so a `.gpc` archive is indexed by
`.gph`. An archive whose extension is already four characters long, or whose last character is `h`, is not
treated this way, which keeps index files from being read as archives themselves.

Each index record is a one-byte name length, that many name bytes with every bit inverted, and a 32-bit data
offset. Names are CP932 and the reference appends a fixed extension to each, giving this archive `.gpcf` names
and its audio sibling `.wav`. Offsets are then *sorted*, so a record's size is the gap to the next offset and
the last one runs to the end of the file — which means an index whose records are not in order still yields
correct sizes.

GARbro reads the uppercased companion name and relies on a case-insensitive filesystem; the port tries that form
and then the lowercased one, so case-sensitive systems work too. Payloads are stored verbatim and the reader
installs no entry decoder.

## Support

| Capability | Status |
| --- | --- |
| Companion index name derived from the extension | Supported |
| Rejection when the extension is four long or ends in `h` | Supported |
| Inverted name bytes with a one-byte length | Supported |
| Appended fixed extension | Supported |
| Offset sorting with derived sizes | Supported |
| Case-insensitive companion lookup | Supported as a hardening |
| CP932 names | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover two entries, an index whose records are out of order, an archive without a companion,
and an index file being rejected as an archive.
