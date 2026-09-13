# C's Ware BLITZ DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/CsWare/ArcDAT.cs`, class `PakOpener` (tag `DAT/CSWARE`)
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive has no signature. It starts with the record count and the packed size of a zlib-compressed index that begins
at 0x08; the reference rejects the format unless the packed size stays inside the file and the first byte at 0x08 is the
zlib marker `0x78`. Payload offsets are relative to the end of that compressed index, so the payload region follows the
index directly.

The index is a flat array of 0x20-byte records: a 0x18-byte CP932 name followed by the payload offset and size. An empty
name rejects the archive, a record that does not fit inside the decompressed index is a hard failure, and every entry
must pass the reference's placement check.

## Extraction

Entries are plain byte ranges of their declared size; the reference has no compression step for payloads, and its
`OpenImage` BMP decoder is out of scope for this port.

## Support

| Capability | Status |
| --- | --- |
| Count and packed size validation | Supported |
| Zlib marker check at 0x08 | Supported |
| Zlib-compressed index at 0x08 | Supported |
| 0x18-byte CP932 names | Supported |
| Index-relative payload offsets | Supported |
| Entry placement validation | Supported |
| Verbatim extraction | Supported |
| Image decoding | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover index parsing and extraction, a foreign zlib marker, a corrupt index, a packed size that
reaches the end of the file, an empty name, an out-of-range entry and a truncated index.
