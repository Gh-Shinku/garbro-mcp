# G2 engine resource archive (PAK/G2)

## Reference and attribution

- GARbro reference: `ArcFormats/G2/ArcGCEX.cs`, classes `PakOpener` and `GceReader`
- GARbro tag: `PAK/G2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
+0   char[4]  "GCEX"
+4   int32    zero
+8   int64    index offset
+0x10         payloads, contiguous and in index order
```

The index starts with its own signature. Its length word counts from the beginning of that signature,
so the body always sits `0x20` bytes after it, or `0x28` bytes when the index is itself a GCE stream.

```
+0   char[4]  "GCE3"
+4   int32    0x11 when the index body is a GCE stream
+8   uint32   index length
...           packed index preamble
+0x18 int32   entry count
+0x20         index body: 0x20 byte records followed by the name blob
```

Records hold the unpacked size at `+0x10` and the stored size at `+0x18`. The name blob starts right
after the last record, and each name is a little endian length followed by CP932 bytes. Records with a
zero stored size are skipped without a name being read from the blob, and they do not advance the
payload cursor, so payloads stay contiguous for the entries that are present. Entry offsets are implicit:
the first payload sits at `0x10` and every recorded entry advances the cursor by its stored size.

## GCE streams

A GCE stream is a sequence of segments, each introduced by a four byte identifier and a little endian
output length. Segments are concatenated and fill the expected unpacked size in order.

A `GCE0` segment is stored data: the output length is followed by that many raw bytes.

A `GCE1` segment carries four more words before its data: an unused word, the length of the literal data,
another unused word, and the length of a control bit stream that lives after the literal data. The bit
stream is read most significant bit first and supplies all lengths. Each loop iteration first emits a
literal run whose length comes from the bit stream, then, unless the segment is already full, a match of
one more than the next length. Literal bytes are consumed from the data area in order.

Matches do not store an offset. The reader keeps a table of `0x10000` entries indexed by the two byte
context formed from the last output bytes, and every byte written, literal or copied, records the current
output position in the slot that context selects before the context is updated with the byte just
written. A match therefore copies from whatever position the current context last wrote, and the copy
advances both the source and the destination one byte at a time, so a match can run into the region it
is producing.

## Port notes and deviations

- The GCE decoder is a format local codec: the shared LZSS stream in `@garbro-mcp/codecs` has a different
  bit packing and no context table.
- Bit lengths use the reference's unary digit count, where the first bit selects the short form and the
  digits are read most significant first. A stream that runs out of control bits or literal bytes is
  reported as an invalid stream; the reference throws out of its reader.
- Index streams are decoded inside a guard, so a malformed or truncated index reports the archive as
  unreadable instead of throwing out of detection.
- The reference records each entry's type from its name through the format catalog. Entry typing is not
  ported.
- Archive creation and image decoding are out of scope.

## References

- `GARbro/ArcFormats/G2/ArcGCEX.cs` - `PakOpener.TryOpen`, `PakOpener.OpenEntry`, `GceReader.Unpack`,
  `GceReader.UnpackGce1Segment`, `GceReader.GetLength`, `GceReader.ReadControlStream`, `GceReader.GetBit`
