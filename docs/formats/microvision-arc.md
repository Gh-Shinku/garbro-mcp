# MicroVision resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/MicroVision/ArcARC.cs`, class `ArcOpener` and `ArcReader`
- GARBro tag: `ARC/MICROVISION`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `ARC1` archive obfuscates its words by spreading them across fixed strides: header fields use a
stride of 0x0C and index fields a stride of 7, in both cases little-endian across the four gathered
bytes.

The header holds the record count at 0x0D, the name blob offset at 8 with its length at 9 — or, when
that offset is zero, at 7 and 6 — and the index offset at 4. The combined name and index length is
aligned to 0x80 and must stay inside the file. Records are 0x20 bytes wide and read their name offset,
name length, data offset, stored size, and unpacked size through the index stride; names live in the
blob at absolute offsets.

Entries whose unpacked size differs from the stored size are LZ-compressed. GARbro's variant reads
bits most-significant first, takes a set bit as a literal, and decodes a match as a twelve-bit offset
whose nibbles are swapped between the two bytes, with a length of two plus the low nibble of the
second byte; the ring buffer starts at position 1.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Strided header and index words | Supported |
| Aligned index requirement | Supported |
| Name blob at absolute offsets | Supported |
| Packed and stored entry layouts | Supported |
| Engine LZ decompression | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the strided layout, stored and packed entries, the LZ variant, signature
rejection, and payload range rejection.
