# Hexenhaus ODIO archive

## Reference and attribution

- GARBro reference: `ArcFormats/Hexenhaus/ArcODIO.cs`, class `BinOpener`
- GARBro tag: `BIN/ODIO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `ODIO` archive starts with the ASCII signature, a zero word at 4, and the marker `0xCCAE01FF` at
0x0a. The first data offset sits at 0x12, which is also the start of a 6-byte record table: the
record count is `(first_offset - 0x12) / 6`, and record `i` starts with entry `i`'s 32-bit data
offset plus two unused bytes.

Every entry runs up to the next recorded offset, and the last one to the end of the file. Entries
are named `<archive>#<n padded to 4>.ogg`.

Payloads at least 0x2c bytes long that start with `ONCE` are containers: GARBro skips the 0x2c-byte
header and rotates every remaining byte right by four bits, which is a nibble swap.

## Support

| Capability | Status |
| --- | --- |
| Signature and marker detection | Supported |
| 6-byte offset record table | Supported |
| Generated `.ogg` names | Supported |
| `ONCE` container unwrapping | Supported |
| Nibble-rotation payload decryption | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record table, generated names, `ONCE` unwrapping with nibble rotation,
and marker rejection.
