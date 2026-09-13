# GSS engine resource archive (ARC/LSD)

## Reference and attribution

- GARbro reference: `ArcFormats/Gss/ArcARC.cs`, class `LsdOpener`
- GARbro tag: `ARC/LSD`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive itself is an unindexed payload area and only opens for a file with the `arc` extension that has a
sibling `BIN` file holding the index:

```
0x00  bytes     'LSDARC V.100'
0x0C  int32     record count
0x10  records   int32 packed flag, uint32 offset, uint32 unpacked size, uint32 stored size,
                null terminated CP932 name
```

Record offsets and sizes refer to the `arc` file. A payload marked as packed and starting with `LSD\x1A`
carries a twelve byte header: an encoding method byte at `0x04`, a pack method byte at `0x05` and the
unpacked size at `0x06`. The stored stream starts at `0x0C` and only the pack method is acted upon; all
encoding method values the reference knows are no-ops.

Pack method `R` is a byte oriented RLE. A command byte splits into a count and a case: when both top bits are
set the count is the low nibble and the case the high nibble, otherwise the count is the low six bits and the
case the top two. Case `0x40` copies a literal run, `0x80` fills with one byte, `0x00` skips bytes, `0xD0`
and `0xE0` prefix a twelve bit count, `0xC0` prefixes a skip count, and `0xF0` ends the stream.

## Port notes and deviations

- Pack methods `D`, `H` and `W` are unimplemented in GARbro itself; this port raises an unsupported feature
  error for them, where GARbro would raise `NotImplementedException`.
- Payloads whose pack method is unknown are copied verbatim, matching the reference fallback.
- The R unpacker clamps every command to the output length, so a malformed stream cannot write out of range
  where the reference would throw.
- The companion name is looked up as `NAME.BIN` and then as `NAME.bin`; the reference relies on a
  case-insensitive virtual file system.
- Packed entries report `sizeKnown: false`, because the extracted size comes from the payload header rather
  than the index. Entries without the payload signature are returned as stored, including their header.
- Image decoding and archive creation are out of scope.

## References

- `GARbro/ArcFormats/Gss/ArcARC.cs` - `LsdOpener.TryOpen`, `LsdOpener.OpenEntry`, `LsdOpener.UnpackR`,
  `LsdOpener.UnpackH`, `LsdOpener.UnpackW`
