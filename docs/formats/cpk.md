# CRI CPK

## Reference and attribution

- GARBro reference: `ArcFormats/Cri/ArcCPK.cs`, class `CpkOpener`
- GARBro tag: `CPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on the documented structure and
GARbro behavior.

## Structure

A CPK archive begins with `CPK `. Its header and directory chunks contain CRI `@UTF` tables. Each
chunk marker is followed by a little-endian 64-bit byte length and the table data. Tables use
big-endian schema, row, string, and binary-data offsets. Tables whose `@UTF` signature is obscured
are decoded with CRI's rolling XOR key.

A named `TOC ` table supplies IDs, relative offsets, sizes, filenames, and optional directory names.
An `ITOC` table instead contains compact low- and high-size tables; its entries are placed in ID
order from `ContentOffset` with the archive's requested alignment.

Entries normally contain raw bytes. An entry beginning with `CRILAYLA` is expanded with the reverse
bitstream LZ decoder and its stored prefix is restored.

## Support

| Capability | Status |
| --- | --- |
| Signature and structural detection | Supported |
| Plain and XOR-obscured `@UTF` tables | Supported |
| Named TOC indexes | Supported |
| Compact ITOC indexes and alignment | Supported |
| Raw entry extraction | Supported |
| CRILAYLA entry decompression | Supported |
| Archive creation | Unsupported |

The implementation is covered by synthetic archives for both index forms, malformed-boundary
tests, and literal CRILAYLA streams. It has not been validated against real game data, following the
current migration policy.
