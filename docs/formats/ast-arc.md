# AST script engine resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/ArcAST.cs`, class `ArcOpener`
- GARBro tag: `AST`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Signatures

`ARC1` and `ARC2` mark the format, and the fourth byte of the marker doubles as the version.

| Marker | Version | Payload handling |
| --- | --- | --- |
| `ARC1` | 1 | Entries are stored as they are |
| `ARC2` | 2 | Names and payloads are exclusive-ored with 0xFF |

## Index

The entry count is a 32-bit value at 0x04, and records run sequentially from 0x08. Each record starts with
its own payload offset, so a record is:

| Field | Size | Meaning |
| --- | --- | --- |
| Payload offset | 4 | Absolute; the record's leading word |
| Unpacked size | 4 | |
| Name length | 1 | |
| Name | length | CP932 |

Because a record starts with its offset rather than ending with it, **an entry's stored size is the gap to
the next record's offset**. The last record's next offset is the end of the file. A next offset of zero
means the stored size equals the unpacked size, and one that falls behind the entry's own offset rejects
the archive.

A record whose offset is zero or the end of the file is a placeholder: it is skipped and does not appear in
the listing, although the records behind it still delimit the neighbouring entries' stored sizes.

Version 2 masks every name byte with 0xFF, so the name has to be unmasked before it is decoded. Names are
read as whole fields — there is no terminator handling and no length limit beyond the file, since the
reference grows its name buffer to whatever the record asks for.

## Payload handling

Version 1 archives only ever return stored bytes; the reference returns a plain `ArcFile` for them, which
skips decoding even when the record's stored and unpacked sizes differ.

Version 2 archives decode payloads:

| Stored payload | Handling |
| --- | --- |
| Unpacked, first four bytes are `0xB8B1AF76` | Exclusive-or the whole payload with 0xFF |
| Unpacked, anything else | Returned as it is |
| Packed | GARbro's default LZSS variant with a 0xFF ring buffer fill, then exclusive-or with 0xFF |

`0xB8B1AF76` is the PNG signature exclusive-ored with 0xFF, so version 2 stores icons masked.

## Support

| Capability | Status |
| --- | --- |
| `ARC1` and `ARC2` signatures, version from the fourth marker byte | Supported |
| Entry count and the sequential record walk | Supported |
| Variable-length names and version 2 name unmasking | Supported |
| Stored sizes from the next record's offset, including the zero case | Supported |
| Placeholder records and placement checks | Supported |
| Exclusive-ored PNG detection | Supported |
| LZSS decoding with a 0xFF ring buffer fill | Supported |
| Version 1 raw payloads | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry version 2 archive with a masked PNG beside a plain entry, an LZSS
payload, a version 1 archive, a packed version 1 record that stays raw, a placeholder record, a foreign
signature, an insane entry count, offsets that do not increase, a name that reaches past the archive, and a
file too small for its header.
