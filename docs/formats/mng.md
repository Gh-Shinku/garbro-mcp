# Multiple-image Network Graphics (MNG)

## Reference and attribution

- GARbro reference: `ArcFormats/ImageMNG.cs`, classes `MngFormat` and `MngOpener`
- GARbro tag: `MNG`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[8]   the MNG signature, 8A 4D 4E 47 0D 0A 1A 0A
0x08  chunk     MHDR, the MNG header chunk of at least 28 bytes
      chunks    further MNG chunks until MEND or IEND
```

Every chunk is a four byte big endian length, a four byte type, the payload and a four byte checksum, so a
chunk covers `length + 12` bytes.

The reader first validates the MNG signature and the MHDR chunk, then walks the chunks to find the first
embedded PNG stream. Frame extraction then starts at that IHDR chunk: every IHDR is remembered until the
matching IEND chunk closes a frame, whose extent runs from the length field of its IHDR chunk through the
checksum of its IEND chunk. An IEND without a preceding IHDR invalidates the archive, and a stream without
any complete frame is rejected.

Frames are named `{base}#{index}.png` with a two digit index and typed as images. Each entry extracts to a
complete PNG stream.

## Port notes and deviations

- Chunk walking is bounded, where the reference loops until it finds a header or runs out of chunks; a
  malformed file terminates the walk instead.
- Checksums are not verified, matching the reference.
- MNG encoding and image decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/ImageMNG.cs` - `MngFormat.ReadMetaData`, `MngOpener.TryOpen`
