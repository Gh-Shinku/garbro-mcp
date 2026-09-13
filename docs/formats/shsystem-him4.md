# SH System HIM4 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/SHSystem/ArcHXP.cs`, classes `Him4Opener` and `ShsCompression`
- GARbro tag: `HIM4`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Two signatures share the layout — `Him4` and `SHS6` — with the entry count at 4, the first entry's offset at 8 and
an index behind the header at 0xC. That index holds only the *later* offsets, so a record's offset is the word
before it, every size is the gap to the next offset and the last entry runs to the end of the file. Names are
generated as five digits.

Every payload starts with a stored size and an unpacked size, and its data follows that pair. A stored size of
zero means the payload is plain, in which case the two sizes agree; otherwise the entry is compressed, the
stored size is what the archive holds and the unpacked size is what extraction produces. The reference then
probes the first bytes to classify each entry through its resource catalog, and the port leaves that step out.

## Compression

`ShsCompression` is an LZ scheme with one control byte per token. A control byte below 0x20 introduces a literal
run whose length is that byte plus one, with escapes 0x1D, 0x1E and 0x1F taking a byte, a big-endian word or a
big-endian long to extend it further. Any other control byte introduces a match in one of three forms — a small
form packed into the control byte, a middle form with an offset byte and an optional extended count, and a form
with the top bit set — where the count always ends up three larger and the distance one larger, copies overlap
byte by byte, and a count that would leave the output is clamped so the declared length is filled exactly. The
reference reads without checking bounds, while the port stops instead.

The codec is exported and shared with the version 5 format, which lives in the same GARbro file.

## Support

| Capability | Status |
| --- | --- |
| Both signatures | Supported |
| Count, index and derived sizes | Supported |
| Stored and unpacked size pair per payload | Supported |
| Plain and compressed payloads | Supported |
| SH System LZ codec with all literal and match forms | Supported |
| Generated five-digit names | Supported |
| Type classification by content signature | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain and a compressed payload, a foreign signature, and a payload whose span leaves
the file.
