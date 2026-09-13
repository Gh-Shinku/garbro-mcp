# Studio B-Room PK resource archive

## Reference and attribution

- GARBro reference: `Legacy/BRoom/ArcPK.cs`, class `PkOpener`
- GARbro tag: `PK/B-ROOM`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count sits at 0 and records are 0x18 bytes: a word the reference skips, the stored size, and a
0x10-byte name field. Payloads begin behind the whole index and follow each other in index order, so entry
offsets accumulate rather than being stored.

The reference then requires the accumulated end to equal the file length exactly, which the port keeps, so
an archive with trailing bytes is rejected. The format has no signature, so the `pk` and `cpc` extensions
together with that exact-coverage check are the detection. Payloads are extracted verbatim, and the
encrypted sibling variant has its own note.

## Support

| Capability | Status |
| --- | --- |
| `pk` and `cpc` extension requirement | Supported |
| Entry count validation | Supported |
| 0x18-byte records with a skipped word | Supported |
| Accumulated payload offsets | Supported |
| Exact file coverage requirement | Supported |
| Entry placement validation | Supported |
| CP932 names with blank rejection | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive and the exact-coverage rejection.
