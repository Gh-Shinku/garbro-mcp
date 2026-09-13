# Lambda engine resource archives (LAX)

## Reference and attribution

- GARbro reference: `ArcFormats/Lambda/ArcLAX.cs`, classes `LaxOpener` and `LaxStream`, with the huffman tree
  of `ArcFormats/HuffmanCompression.cs` (`HuffmanDecompressor`)
- GARbro tag: `LAX`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `$LapH__` and carries a trailer at the end of the file. The trailer points at a
compressed index, which is itself written in the same chunked stream format as the payloads.

## Layout

```
[u8 '$LapH__'] [payloads from 0x08] [compressed index] [trailer at file size - 0x28]
```

Trailer fields:

| Offset | Field |
| --- | --- |
| 0x00 | `$LapI__` marker |
| 0x08 | entry count |
| 0x0C | index offset |
| 0x10 | unpacked index size |
| 0x14 | stored index size |

The count must be sane, which means greater than zero and below 0x40000, and the stored index must be inside
the file. Payload offsets are relative to 0x08.

## Index

The unpacked index is a sequence of fixed 0x128 byte records:

| Offset | Field |
| --- | --- |
| 0x00 | `$LapF__` marker |
| 0x10 | unpacked payload size |
| 0x14 | stored payload size |
| 0x18 | payload offset, relative to 0x08 |
| 0x24 | name, 0x104 bytes, cut at its first NUL |

A record without its marker declines the archive, and a name that ends in `.bmx` or `.b32` marks the entry as
an image. An entry whose record declares no unpacked size is reported with an unknown size, because the length
is only known once the stream has been decoded.

## Payload encoding

Every payload, and the index itself, is a chain of chunks:

| Offset | Field |
| --- | --- |
| 0x00 | `_AF` marker |
| 0x03 | method: `1` lzss, `2` huffman, anything else stored |
| 0x04 | stored chunk size |
| 0x06 | final size, refused when it is not zero |
| 0x08 | unpacked chunk size |

The body starts at 0x0A and the next chunk starts at the stored chunk size, so a body may carry padding.

The lzss method keeps a 0x1000 byte frame whose position starts at 0xFEE. One control byte holds eight
decisions taken from its lowest bit: a set bit is a literal byte, a clear bit is a back reference built from two
bytes, `offset = ((high & 0xF0) << 4) | low` and `count = 3 + (high & 0x0F)`, capped at the unpacked size of the
chunk. The reference reads the first byte of a back reference before it knows which case it is.

The huffman method uses the shared tree-in-stream format, where a set bit introduces two children, a clear bit a
leaf with an eight bit value. A chunk that announces a final size would be doubly compressed, which the
reference refuses to decode; the port reports the same as an unsupported feature.

## Port notes and deviations

- The port decodes a whole chunk into a buffer rather than streaming it, which keeps the decoder a pure function;
  the result is the same because the reference caps every chunk at its own unpacked size.
- A chunk whose stored size is zero or smaller than its header ends the stream instead of looping.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Lambda/ArcLAX.cs` - `LaxOpener.TryOpen`, `LaxOpener.OpenEntry`, `LaxStream.ReadSegment`,
  `LaxStream.LzssUnpack`, `LaxStream.HuffmanUnpack`
- `GARbro/ArcFormats/HuffmanCompression.cs` - `HuffmanDecompressor.Unpack`, `HuffmanDecompressor.CreateTree`
