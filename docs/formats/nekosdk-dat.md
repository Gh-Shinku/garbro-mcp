# NekoSDK DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/NekoSDK/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/NekoSDK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive carries no signature and is recognized by its `.dat` extension alone. The first record starts at offset 0,
which means the word at 0x88 is both the first payload offset and, after masking, the value the reference divides by the
0x8C record size to derive the record count. One extra record is subtracted from that quotient before the count is
validated, so a valid archive needs at least two record slots; the extra slot is only ever used as a payload offset
source when it is the first record.

Every 0x8C-byte record holds a 0x80-byte CP932 name, the unpacked size, the stored size and the payload offset. The
three words are XOR-masked with the 24-bit constant `0xCACACA`. An empty first name byte or an offset that points
before the payload region rejects the archive, and each entry must satisfy GARbro's placement check against the file
size.

## Extraction

A record is LZSS-packed when its masked unpacked size is non-zero; in that case the stored size is the packed extent and
the unpacked size is the declared output length. The port decodes those entries with GARbro's default LZSS stream and
marks them as having an inexact size, because the reference decodes to the end of the stored stream. Records with a zero
unpacked size are emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `.dat` extension detection | Supported |
| `0xCACACA` field unmasking | Supported |
| 0x8C records with 0x80-byte CP932 names | Supported |
| First-offset derived record count | Supported |
| Packed/unpacked size handling | Supported |
| Entry placement validation | Supported |
| LZSS extraction | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover verbatim and packed entries, the extension requirement, a misaligned first offset, an empty
name and an entry placed before the payload region.
