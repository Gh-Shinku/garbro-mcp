# Caramel BOX resource archive (ARC4)

## Reference and attribution

- GARbro reference: `ArcFormats/CaramelBox/ArcARC4.cs`, classes `Arc4Opener`, `Arc4Entry`,
  `TzCompression`, `Arc4Stream`
- GARbro tag: `ARC4`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The file starts with the four byte signature `ARC4` followed by the little endian version `0x010000`.
The header holds the compressed index length at 8, the segment alignment at 0xc, the entry count at 0x10,
the index offset at 0x14, the absolute name area and segment table offsets at 0x1c and 0x24, and the base
offset at 0x2c. A zero alignment, a non positive index offset, name area or segment table, or a compressed
index that does not start with `tZ` is declined.

## Index

The index itself is a TzCompression stream. Every eight byte record holds a big endian 24 bit name
position, a name length, a chunk count, and a big endian 24 bit segment field. The name position is
doubled and used as an offset into the name area that follows the records. A record with a single chunk
addresses that segment directly, while a record with several chunks holds the index of its first segment
table slot; the table follows the name area and holds a big endian 24 bit address per segment.

Every address is multiplied by the alignment and shifted by the base offset.

## Entry headers

Each segment starts with a sixteen byte header holding the big endian stored size at offset four, and the
payload follows. The entry size is the sum of its segment sizes, and the payload of a multi segment entry
is the concatenation of those segments. The entry is compressed when the first segment payload starts with
the `tZ` marker, in which case the little endian unpacked size sits at offset 2 of that stream.

## TzCompression

A stream starts with a two byte marker and the little endian unpacked size, followed by blocks:

```
"tZ"          char[2], read and discarded
uint32        unpacked size, little endian
uint16        block marker, "St" for stored and "Zt" for packed
uint16        stored block size
uint16        unpacked block size, zero is invalid
uint16        initial key
byte[]        block bytes
```

Every block is decrypted first: the key is advanced with `key = key * 0x1465D9 + 0xFB5` before each
little endian 16 bit word, and the high half of the key is subtracted from that word. Stored blocks copy
their bytes directly. Packed blocks hold a byte oriented LZ77 stream:

| Control byte | Meaning |
| --- | --- |
| 0x01 to 0x7f | Copy that many literal bytes |
| 0x00 | End of the block |
| 0x80 to 0xbf | 4 bit offset plus one, 2 bit count plus two |
| 0xc0 to 0xdf | 10 bit offset plus one, 3 bit count plus three |
| 0xe0 to 0xff | 15 bit offset plus one, 6 bit count plus four |

Each back reference is followed by more control bytes until the block or the unpacked size is exhausted.

## Port notes and deviations

- Archive creation is out of scope.
- A segment header that does not fit in the file is declined instead of reading a zero filled clamped
  view like the reference does through `ArcView`.
- Repeated segments are concatenated before unpacking, matching `Arc4Stream`; the segments are read into
  memory rather than streamed.

## References

- `GARbro/ArcFormats/CaramelBox/ArcARC4.cs` - `Arc4Opener.TryOpen`, `Arc4Opener.OpenEntry`,
  `Arc4Opener.ReadInt24`, `TzCompression.Unpack`, `TzCompression.DecryptBlock`,
  `TzCompression.UnpackBlock`, `Arc4Stream.Read`
