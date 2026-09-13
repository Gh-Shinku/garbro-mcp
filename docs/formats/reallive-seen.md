# RealLive SEEN scripts archive

## Reference and attribution

- GARBro reference: `ArcFormats/RealLive/ArcSEEN.cs`, class `SeenOpener`
- GARBro tag: `SEEN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `PACL` signature, carries the record count at 0x10, and follows it with 0x20-byte records
from 0x20. Each record holds a 0x10-byte CP932 name, the payload offset, the stored size, the unpacked size and a
packed flag. Records with a zero stored size are skipped without being listed, and every other record must satisfy
GARbro's placement check against the file size.

## Extraction

A record is only decoded when its packed flag is set **and** its stored bytes start with the `PACK` container
signature; flagged entries without that marker are emitted verbatim, exactly like the reference. The container keeps a
signed unpacked size at offset 8 and its stream starts at offset 0x10.

The private LZ stream is driven by control bytes consumed most-significant bit first. A set bit emits one literal byte;
a clear bit reads a little-endian word whose low nibble is the match length minus two and whose remaining bits address
the output backwards from one byte before the cursor, which makes overlapping copies possible. The port rejects
truncated streams and matches that would run before the output start or past the declared length, mirroring the
exceptions the reference would raise. The decoded length comes from the container rather than from the index, so
packed entries are listed with the index's declared size but marked as having an inexact size.

## Support

| Capability | Status |
| --- | --- |
| `PACL` signature | Supported |
| 0x20 records with 0x10-byte CP932 names | Supported |
| Offset, stored size, unpacked size and packed flag | Supported |
| Zero-size record skipping | Supported |
| Entry placement validation | Supported |
| `PACK` container detection | Supported |
| Private LZ decoder | Supported |
| Verbatim extraction | Supported |
| Script decoding | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the literal and match paths of the decoder, packed and plain entries, a flagged entry without
a container, zero-size record skipping, a foreign signature, an out-of-range entry and a broken match.
