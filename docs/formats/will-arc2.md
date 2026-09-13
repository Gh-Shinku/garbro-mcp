# Will Co. game engine resource archive v2 (ARC/WillV2)

## Reference and attribution

- GARbro reference: `ArcFormats/Will/ArcPulltop.cs`, classes `Arc2Opener` and `PspFormat`
- GARbro tag: `ARC/WillV2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive has no signature, so the index itself has to be recognisable.

```
+0  int32    entry count
+4  uint32   index size
+8           index: per entry, an eight byte record followed by the entry name
```

Each record holds the stored size and an offset relative to the payload base, which is the end of the
index. Payloads are laid out after the index, normally in record order, but nothing in the format
requires that. Names are little endian UTF-16 code units terminated by a zero unit, and an empty name
is rejected. The reader requires the walk to consume the index exactly, which is what makes a file
without a signature detectable.

## Extraction

Three cases are distinguished by the entry name.

Entries with a `ws2` or `json` extension are scripts: the whole entry is rotated right by two bits
inside each byte. The rotation is skipped when the archive file name contains `Model`, which the
reference treats as the marker of a model archive.

Entries with a `psp` extension are an LZSS stream with a ring buffer. The stream starts with the
unpacked size, followed by control bytes and payload. A control byte is read least significant bit
first, one bit per operation, and up to eight operations follow before the next control byte. A set bit
is a literal, which is written both to the output and to the ring buffer. A clear bit is a match: two
bytes give an absolute ring buffer index in the high twelve bits and a length offset in the low nibble,
and the match copies `2 + (low & 0xF)` bytes. Both the ring buffer position and the match source wrap
around a `0x1000` byte frame that starts at position one and is zero filled, so a match can copy from
positions that were never written.

All other entries are returned verbatim.

## Port notes and deviations

- The PSP decoder is a format local codec. The shared `LzssStream` in `@garbro-mcp/codecs` assigns the
  high and low nibbles of its length word the other way around and uses a different minimum match
  length, so the shared codec cannot decode this stream.
- The reference declares no signature and relies on detection, and so does the port.
- The reference creates plain entries for PSP streams, so the declared size is the stored stream and the
  unpacked size is only known after the stream header is read. The port marks those entries as having an
  unknown size and records the stream's own size in metadata.
- Archive creation is out of scope, although the reference can write this format. The `PspFormat`
  resource alias, which maps the `PSP` extension to the `PSB` image format, is not a port of this
  archive and is out of scope as well.
- The reference records each entry's type from its name through the format catalog. Entry typing is not
  ported.

## References

- `GARbro/ArcFormats/Will/ArcPulltop.cs` - `Arc2Opener.TryOpen`, `Arc2Opener.OpenEntry`,
  `Arc2Opener.OpenPsp`, `Arc2Opener.IsScriptFile`, `Arc2Opener.Create`, `Arc2Opener.CopyScript`
