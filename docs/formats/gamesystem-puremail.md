# PureMail resource archive (DAT/PUREMAIL)

## Reference and attribution

- GARbro reference: `ArcFormats/GameSystem/ArcPureMail.cs`, class `PmDatOpener`
- GARbro tag: `DAT/PUREMAIL`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
data            payloads
index           LZSS packed index, uncompressed size is a multiple of 0x50
0x00  uint32    packed index size, xored with 0xF0F0F0F0
0x04  uint32    unpacked index size, xored with 0xF0F0F0F0
0x08  uint32    unused
```

The index holds one record of `0x50` bytes per entry: an int32 flag word, a null terminated CP932 name
field of `0x40` bytes, the payload offset, the stored size and the unpacked size. Bit `0x010000` of the flags
marks a packed payload and bit `0x02000000` marks a payload that carries its own unpacked size in a leading
dword. Names ending in `.crgb`, `.char`, `.rol` or `.edg` are typed as images.

Packed payloads use a local LZSS variant with a `0x1000` byte ring buffer starting at `0xFEE`: the control
byte is read most significant bit first, a clear bit marks a literal and a set bit a match whose little
endian word holds a twelve bit offset in the high bits and a count minus three in the low nibble. The
output buffer is pre-allocated from the declared size, so a stream that ends early leaves the remainder
zeroed. The packed index uses the same codec.

## Port notes and deviations

- The bit order and match packing of this variant differ from GARbro's shared `LzssStream`, so the codec
  lives with the format port instead of `@garbro-mcp/codecs`.
- Packed entries report `sizeKnown: false`, because the extracted size either comes from a stream header or
  has to be decoded, while the declared size is the stored size.
- Image decoding is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/GameSystem/ArcPureMail.cs` - `PmDatOpener.TryOpen`, `PmDatOpener.OpenEntry`,
  `PmDatOpener.LzUnpack`
