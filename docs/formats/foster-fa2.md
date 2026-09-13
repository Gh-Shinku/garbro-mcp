# Foster game engine resource archives (FA2)

## Reference and attribution

- GARbro reference: `ArcFormats/Foster/ArcFA2.cs`, classes `Fa2Opener` and `Fa2Compression`
- GARbro tag: `FA2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[u8 'FA2'] [u8 0x00] [u8 flags at 0x04] [3 unknown bytes] [u32 index offset at 0x08] [i32 count at 0x0C]
[payloads on sixteen byte steps] [index]
```

Bit zero of the flags byte marks a compressed index, which the format's own codec unpacks to `count * 0x20`
bytes; otherwise the index runs from its offset to the end of the file. Every index record is:

| Offset | Field |
| --- | --- |
| 0x00 | name, at most 0x0F bytes |
| 0x0F | entry flags, bit 1 marks a packed payload |
| 0x10 | eight unknown bytes |
| 0x18 | unpacked size |
| 0x1C | stored size |

Payload offsets are not stored. They start at 0x10 and advance by the stored size rounded up to sixteen bytes,
so the data area is a sequence of aligned payloads and the index follows behind it.

## Payload codec

The decoder reads control bits from a thirty two bit word that is refilled with a little endian read and
consumed from its most significant bit, which means each chunk of four bytes is used back to front and the
first control bit comes from the fourth byte. Literal payload bytes are not part of that bit stream: they are
read from the same input at its current position, so the encoder and the decoder have to agree on how the
chunks and the literals are interleaved.

| Control | Meaning |
| --- | --- |
| `1` | literal, one byte read from the stream |
| `0 1 1` | offset from a byte and three bits, plus 0x100; 0x8FF and above ends the stream |
| `0 1 0` | offset from a byte |
| `0 0 1` | offset from a byte and one bit |
| `0 0 0 1` | offset from 0x100, a byte and one bit |
| `0 0 0 0 1` | offset from 0x100, a byte and two bits |
| `0 0 0 0 0 1` | offset from 0x100, a byte and three bits |
| `0 0 0 0 0 0` | offset from 0x100, a byte and four bits |

The first two offset forms copy exactly two bytes, from `target - offset - 1` and `target - offset`. The
remaining forms are followed by a length ladder: one bit gives three, a clear bit followed by a set bit gives
four, then `5 + bit`, `7 + two bits`, `11 + four bits` and finally `27 + byte`. Copies are byte by byte, so an
offset of zero repeats the last written byte.

## Port notes and deviations

- The reference writes the second byte of a short copy without bounds checking; the port stops at the declared
  output size.
- Reads outside the stream are treated as zero instead of failing, and the port keeps a literal's position in
  step with the reference's chunked reader.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Foster/ArcFA2.cs` - `Fa2Opener.TryOpen`, `Fa2Opener.OpenEntry`, `Fa2Compression.Unpack`,
  `Fa2Compression.FetchBits`, `Fa2Compression.GetNextBit`, `Fa2Compression.GetBits`
