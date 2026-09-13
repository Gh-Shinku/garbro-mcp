# Squadra D SDA resource archive

## Reference and attribution

- GARBro reference: `Legacy/SquadraD/ArcSDA.cs`, class `SdaOpener`
- GARBro tag: `SDA/SD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `SA\0` archive stores the data offset at 4; the record count is derived from the index size,
`(data_offset - 8) / 0x14`. Records are 0x14 bytes with a 0x10-byte CP932 name, a data offset
relative to the data area at +0x0c, and the stored size at +0x10. Because the offset field overlaps
the last four bytes of the name field, GARbro trims the name and practical names stay short.

Every payload is LZSS-compressed and begins with its unpacked size. The bit stream is read
least-significant first: a zero bit introduces a literal byte, a one bit introduces a match whose
twelve-bit offset indexes a 0x1000-byte ring buffer that starts writing at 0xfc0, and whose length is
three plus a four-bit field, or six bits when a following bit is set.

Because the unpacked size is declared in the payload, the port reads it while listing so entry sizes
stay verifiable, and exposes the stored size as the packed size.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Derived record count | Supported |
| Relative data offsets | Supported |
| LSB-first bit stream | Supported |
| Literal and back-reference decoding | Supported |
| Declared unpacked size | Supported |
| Entry placement validation | Supported |
| CP932 filenames with trimming | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, literal-only payloads, a back-reference that copies from
the ring buffer, and signature rejection.
