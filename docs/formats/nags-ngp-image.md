# NAGS engine image (NGP)

A header spread over the first two hundred and sixty bytes, a zlib stream behind it, and a depth stored as bytes per
pixel rather than bits.

## Reference

| Element | Value |
| --- | --- |
| Tag | `NGP` |
| Class | `NgpFormat` (`ArcFormats/Nags/ImageNGP.cs`) |
| Signature | `0x2050474E`, which reads back as `NGP ` |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `NGP ` |
| `0x12` | 4 | Packed size |
| `0x16` | 4 | Width |
| `0x1A` | 4 | Height |
| `0x1E` | 2 | Depth in **bytes** per pixel |
| `0x100` | 4 | Unpacked size |
| `0x104` | — | The compressed pixels |

The gap between the two header blocks is not read. The size words are the only part of this header that is checked,
and the reader refuses the file when either of them is zero or negative; the depth is not looked at, which is why a
file with a depth this reader cannot draw is still listed. The port turns a file with two positive sizes into an
entry and only then asks what the depth means, where the reference asks the same question after decompressing the
whole stream — the same answer for less work, and it means an unsupported depth fails the extraction rather than the
listing, as it does there.

The depth is stored in bytes and read as `u16 * 8`, so a header word of three means twenty four bits. The three the
reader knows are eight, twenty four and thirty two bits; anything else is refused.

## Pixels

The pixels are one **zlib** stream at `0x104`, `packedSize` bytes of it, and it has to produce exactly `unpackedSize`
bytes: the reference compares the length of the result with the length the header promised and throws when they
differ. The port does the same. Eight bit images become grey bitmaps, twenty four bit ones keep their blue, green,
red triples, and thirty two bit ones are blue, green, red and alpha.

No flip is applied, so the resulting bitmap is **top down** with a negative height.
