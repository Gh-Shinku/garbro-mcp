# Leaf LAC resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Leaf/ArcLAC.cs`, classes `LacOpener` (`LAC`) and `PakOpener` (`PAK/LAC`)
- GARBro tags: `LAC`, `PAK/LAC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## One signature, two layouts

Both formats start with the same `LAC` signature and a count at 0x04, and both list records from 0x08. Their records
differ in name masking, stride and which fields are stored.

### `LAC`

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x3E | Name, CP932, terminated by a null |
| 0x3E | 1 | Compression flag |
| 0x54 | 4 | Stored size |
| 0x58 | 4 | Unpacked size |
| 0x60 | 8 | Payload offset |

Records are 0x78 bytes apart, so the fields between them carry other data the reference ignores. An empty name rejects
the archive. Compressed entries run through LZSS with the ring buffer **pre-filled with spaces** rather than zeros, which
is the difference from the default stream. Stored and unpacked sizes are both declared, so listing needs no payload
access.

### `PAK/LAC`

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x1F | Name, masked with 0xFF, terminated by a null |
| 0x1F | 1 | Compression flag |
| 0x20 | 4 | Size, including any compression header |
| 0x24 | 4 | Payload offset |

Records are 0x28 bytes apart. The name is unmasked by XORing each byte with 0xFF until a stored zero byte appears; a
name whose first byte is zero rejects the archive. The flag byte sits past the masked area and is never unmasked.

Compressed payloads carry a header that the reference strips while opening:

1. the first word is the unpacked size — unless it equals the entry size, in which case it is skipped and the second
   word is used instead;
2. the stream then starts four bytes further on, and the stored size shrinks to match;
3. an unpacked size of zero becomes one.

The port resolves that header while listing so the declared entry size and the extraction agree, and it decodes with the
default LZSS frame fill. Entries of four bytes or less are always handed out as stored.

## Deviations

A masked name that is space-padded decodes to the name followed by null characters. The reference keeps them; the port
drops trailing nulls so paths stay usable.

The reference wraps the stored size when the header is smaller than it claims, producing an enormous range. The port
rejects such a record instead.

## Support

| Capability | Status |
| --- | --- |
| `LAC` signature and count at 0x04 | Supported |
| `LAC` records with CP932 names | Supported |
| `LAC` stored and unpacked sizes, 64-bit offsets | Supported |
| `LAC` compression flag and space-filled LZSS | Supported |
| `PAK/LAC` masked name fields | Supported |
| `PAK/LAC` flag byte, size and offset pairs | Supported |
| `PAK/LAC` compression header stripping | Supported |
| `PAK/LAC` default LZSS and stored short entries | Supported |
| Path normalization and placement validation | Supported |
| Trailing null characters in masked names | Unsupported (dropped) |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and compressed entries in both layouts, path normalization, the compression header with
one and two words, short stored entries, empty names, out-of-range payloads and masked-out names.
