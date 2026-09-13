# DiceSystem RLZ resource archive

## Reference and attribution

- GARBro reference: `Legacy/Dice/ArcRLZ.cs`, class `RlzOpener`
- GARBro tag: `RLZ`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the ASCII signature `RLZ2`. A signed 32-bit entry count follows at offset four, and the index
begins at offset 0x10 with 0x34-byte records: a 0x20-byte CP932 name, the stored size at 0x20, the unpacked size at
0x24, a packed flag at 0x28, and an offset at 0x2c that is relative to the end of the index. Payloads are checked
against the file.

## Extraction

Stored entries are emitted verbatim. Packed entries use a private LZ scheme: the control byte is consumed from its low
bit with an `0x100` sentinel, a set bit reads one literal, and a clear bit reads a little-endian word whose high nibble
plus two is the copy length and whose remaining twelve bits index a 0x800-byte frame. The frame starts at 0x7ef and
holds absolute positions, so matches normally reference the raised area where the first literals were written.

The declared unpacked size is allocated before decoding and decoding stops when it is filled or the input ends, so a
short stream leaves zero-filled tail bytes; the port reports the declared size as exact.

## Support

| Capability | Status |
| --- | --- |
| `RLZ2` signature and entry count | Supported |
| Fixed 0x34-byte index records | Supported |
| CP932 names and relative payload offsets | Supported |
| Packed flag with stored and unpacked sizes | Supported |
| Dice LZ extraction with an absolute-position frame | Supported |
| Verbatim extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and packed entries, overlapping matches, zero-filled short streams, and out-of-file
rejection.
