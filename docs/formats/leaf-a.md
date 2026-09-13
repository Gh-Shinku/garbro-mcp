# Leaf A resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Leaf/ArcA.cs`, classes `AOpener` and `ALeafEntry`
- GARBro tag: `A/Leaf`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive begins with the 16-bit word `0xAF1E` and a 16-bit entry count. Each 0x20-byte record holds a 0x17-byte
CP932 name, a key byte, the stored size and an offset relative to the end of the record array. An empty name or an entry
that fails GARbro's placement check rejects the archive.

A non-zero key byte marks the entry as LZSS-packed. Packed entries keep a four-byte unpacked size in front of the
compressed stream; the port reads that word while parsing the index so that listing and extraction agree, and it
validates that the four-byte prefix is inside the archive and that the remaining stored extent is non-negative.

## Extraction

Plain entries are emitted verbatim over their stored extent. Packed entries are decoded with GARbro's default LZSS
stream, and are marked as having an inexact size because the reference decodes to the end of the stored stream.

Keys between 0x7F and 0x89 additionally trigger the reference's alpha fix-up when the declared unpacked size exceeds
0x20. The reference reads exactly that many bytes into a buffer, and for indexed 32-bit images it converts
pre-multiplied BGRA pixels into straight alpha by accumulating `channel + alpha - key` per pixel from offset 0x20, with
single-byte wrap-around, while forcing the alpha byte to zero. The port reproduces that accumulator, the low nibble of
the key, and the output length.

## Support

| Capability | Status |
| --- | --- |
| `0xAF1E` signature | Supported |
| 0x20 records with 0x17-byte CP932 names | Supported |
| Record-relative payload offsets | Supported |
| Key byte packed flag | Supported |
| Four-byte unpacked size prefix | Supported |
| LZSS extraction | Supported |
| Alpha fix-up for keys 0x7F–0x89 | Supported |
| Verbatim extraction | Supported |
| Image decoding | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover plain and packed entries, the alpha fix-up, a key outside the fix-up range, a foreign
signature and an out-of-range entry.
