# System21 PAK resource archive

## Reference and attribution

- GARBro reference: `Legacy/System21/ArcPAK.cs`, class `PakOpener`
- GARbro tag: `PAK/SYSTEM21`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Two four-byte signatures share one layout: an older one and a newer one whose word also marks the version.
The word at 4 is the data offset, which fixes the index size as everything between the twelve-byte header
and that offset.

Names are stored in a fixed-width field whose width is not recorded, so the reference tries candidates of
0x14, 0x34 and 0x64 bytes. A candidate is only considered when its record width — the name field plus the
stored size word — divides the index size exactly, and the candidate must then read cleanly; the newer
signature may use any of the three, while the older one only ever uses the widest, which is why the
variant search starts at a different index for each. The port keeps that ordering, so a file whose names
merely happen to fit a narrower width is still read the way the reference would read it.

Records begin at 12, each holding a name field and a stored size, and the data offset accumulates as the
reference walks the index, so payloads follow each other in index order from behind the index rather than
being addressed individually. An empty name rejects the candidate width, and each entry's span is checked
against the file. Payloads are stored verbatim; the reference installs no entry decoder for this format.

## Support

| Capability | Status |
| --- | --- |
| Both signatures | Supported |
| Version-dependent candidate ordering | Supported |
| Data offset and derived index size | Supported |
| Fixed-width name candidates with divisibility test | Supported |
| Accumulated payload offsets | Supported |
| Entry placement validation | Supported |
| CP932 names with empty rejection | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the new signature with the narrowest field, the old signature with the widest,
a fallthrough to a middle width, a foreign signature, and an empty index.
