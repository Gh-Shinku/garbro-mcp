# Key PAK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Key/ArcPAK.cs`, class `PakOpener`
- GARbro tag: `PAK/KEY`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count sits at 4, the payload start at 0, and a block size at 0xC. The start must lie behind the header,
inside the file, and be an exact multiple of the block size — because every record stores its offset as a
*block number* rather than a byte offset.

Neither the index position nor the names are addressed directly. GARbro scans the words from 0x24 up to the
payload start looking for the first one that equals `data_offset / block_size`, which works because the first
payload begins exactly where the index ends; the word immediately before that match is a pointer to the names
pool. Flag bit two at 0x21 says such a pool exists, holding the names as consecutive null-terminated UTF-8
strings, which is the encoding the reference uses for this format. Without the flag, entries are numbered with
five digits instead.

Records then hold the block number and the size, and payloads are stored verbatim. GARbro additionally
classifies each entry by reading its first four bytes and matching them against its catalog; the port leaves
that out, since the names already carry their extensions, and the format registers no extension or signature in
the reference, so the structural checks are the detection.

## Support

| Capability | Status |
| --- | --- |
| Count and block size validation | Supported |
| Payload start as a block multiple | Supported |
| Index located by scanning for the first block number | Supported |
| Names pool behind a pointer word | Supported |
| Generated five-digit names without the flag | Supported |
| UTF-8 null-terminated names | Supported |
| Block-number records with sizes | Supported |
| Entry placement validation | Supported |
| Type classification by content signature | Not ported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover an archive with a names pool, one without names, a payload start that is not a block
multiple, and an index whose scanned word never matches.
