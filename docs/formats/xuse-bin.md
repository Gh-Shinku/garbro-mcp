# Xuse audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Xuse/ArcBIN.cs`, class `BinOpener`
- GARBro tag: `BIN/Xuse`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A Xuse audio archive stores the first data offset at 8. That offset also sizes the record table,
which starts at 4 and consists of 0x10-byte records: a 32-bit size at the start of the record and a
32-bit data offset at +4. The index size must divide exactly by 0x10, and GARbro walks the records
until an offset is zero, rejecting offsets that do not strictly increase.

GARbro assigns entry types by inspecting the first bytes of each payload, so recorded names are the
generated stems `<archive>#<n padded to 4>` completed with a detected extension. The port keeps the
stems unchanged because it has no resource-type catalog.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| 0x10-byte record table | Supported |
| Zero-offset terminator | Supported |
| Monotonic offset validation | Supported |
| Entry placement validation | Supported |
| Generated entry stems | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Entry type inference needs GARbro's global signature catalog, which also covers image and audio
decoders that this toolkit does not implement.

Synthetic fixtures cover the record walk, the zero-offset terminator, non-monotonic offset
rejection, and payload extraction.
