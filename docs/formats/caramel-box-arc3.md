# Caramel BOX resource archive (ARC3)

## Reference and attribution

- GARbro reference: `ArcFormats/CaramelBox/ArcARC3.cs`, classes `Arc3Opener`, `Arc3Entry`,
  `LzBitStream`
- GARbro tag: `ARC3`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The file starts with the four byte signature `arc3`. The header holds big endian values: the format
version at 4, the cluster size at 8, the cluster-relative base offset at 0xc, and the cluster-relative
index offset and index size at 0x18 and 0x1c. A zero index size or cluster size is declined, and the index
has to fit in the file.

## Index

The index is a chain of deltas rather than a table. Every record starts with a control byte whose high
nibble is a field marker and whose low nibble is a length:

| Marker | Meaning |
| --- | --- |
| 0 to 0xe | Copy `length` name bytes into a shared buffer at that offset. The name length becomes marker plus length |
| 0xf, length 0xf | Increment the last byte of the buffered name |
| 0xf, other length | Copy `length` name bytes to the front of the buffer and mark the name as new |
| 0, 0xf | Distance record: fold the previous entry's offset and continue with the same three bytes |

Three name bytes follow every record, holding a big endian 24 bit value. Names longer than three
characters are built from a three character extension followed by the stem, so the stored name for
`DATA.BIN` is `BINDATA`. A record marked as new is followed by three bytes the reader skips. Every
asterisk in a final name becomes a full width asterisk.

## Entry headers

The entry offset is `(distance + base offset) * cluster size`. Each entry starts with a 0x20 byte header
holding the big endian stored size at 8 and the big endian flags at 0x14. The payload follows, and the
entry span is the header plus the stored size.

A flag of two marks the payload as bit inverted. The payload starts with a four byte little endian
signature: when its low half reads `lz`, the entry is compressed, the big endian unpacked size follows at
offset two, and six bytes of prefix are removed from the stored size. Entries that are not compressed have
their type derived from the payload signature.

## Extraction

Encrypted entries are bit inverted, and compressed entries are expanded from their `lz` payload, which is
a sequence of `ze` chunks:

```
"ze"          char[2]
uint16        unpacked chunk length, big endian
byte[]        bit stream of the chunk
```

The chunk bit stream is read most significant bit first, two bytes at a time, and restarted for every
chunk. It holds an unary-prefixed integer for a literal run (the run length plus one) followed by the
literal bytes, then unary-prefixed integers for the back reference distance and count.

## Port notes and deviations

- Archive creation is out of scope.
- The `longinfo.$$$` name map is not applied, so stored names stay as the index holds them. The reference
  reads that entry and replaces names when it succeeds, ignoring any error.
- The distance record is parsed exactly like the reference, including reading the same three bytes for the
  previous entry's offset and for the current distance.
- A payload shorter than the six byte prefix header is read as far as the file goes, matching the clamped
  view the reference reads through.
- Only single chunk compressed entries are covered by the fixtures; the multi chunk path shares the same
  reader and is exercised by the same code.

## References

- `GARbro/ArcFormats/CaramelBox/ArcARC3.cs` - `Arc3Opener.TryOpen`, `Arc3Opener.OpenEntry`,
  `Arc3Opener.UnpackLze`, `Arc3Opener.UnpackZeChunk`, `Arc3Opener.LzeGetInteger`,
  `Arc3Opener.BigEndian24`, `Arc3Opener.ReadNameMap`, `LzBitStream`
