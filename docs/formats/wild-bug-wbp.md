# Wild Bug WBP resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/WildBug/ArcWBP.cs`, class `WbpOpener`
- GARbro tag: `WBP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head spells `ARCFORM`, then a version digit, then ` WBUG `. The version must be two, three or four; the
entry count sits at 0x10 and the index offset, index size and data offset follow it. The data offset may not
precede the index and must stay inside the file, and the index must fit.

Versions two and three share one record layout: a record holds the data offset and size in its first eight
bytes, a name length byte at nine, and the name behind a 0x14-byte header, with a stride of that header plus
the name length and no alignment. Payload bounds are checked against the file and a blank name rejects the
archive.

Version four replaces records with two hundred-and-fifty-six-entry hash tables at 0x24 and 0x424, one for
directories and one for resources. Every record begins with a hash byte that must equal its bucket index
*and* the sum of its name bytes, reduced to eight bits, which is a strong structural check. A directory
record carries a two-byte id and its name behind a five-byte header; a resource record carries the data
offset and size in front of a name that sits at +0x14, advancing by its header plus the name length rounded
up to four bytes. Resource names are joined to their directory name without a separator, because the
directory name keeps whatever separator the archive stored, and a leading backslash is trimmed from it.

Three reference behaviours are mirrored or bounded deliberately. An unknown directory id rejects the
archive, since the reference would throw on its table lookup. The reference performs no placement check on
version four entries, and the port keeps that omission while still validating every hash and checksum. The
reference leaves its hash chains unbounded, so the port adds a chain limit of its own. Payloads are stored
verbatim.

## Support

| Capability | Status |
| --- | --- |
| `ARCFORM` head with version and tail marker | Supported |
| Version range and header field validation | Supported |
| Version 2 and 3 records with unaligned names | Supported |
| Version 4 directory and resource hash tables | Supported |
| Hash byte and name checksum validation | Supported |
| Directory name trimming and separator-preserving join | Supported |
| Unknown directory id rejection | Supported |
| Placement validation for versions 2 and 3 | Supported |
| Chain bound for version 4 | Supported as a hardening |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover versions 2 and 3, version 4 hash chains with a joined directory name, an
unsupported version, and a foreign tail marker.
