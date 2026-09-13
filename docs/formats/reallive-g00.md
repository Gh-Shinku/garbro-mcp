# RealLive engine frame tables (G00/v2)

## Reference and attribution

- GARBro reference: `ArcFormats/RealLive/ArcG00.cs`, class `G00Opener`
- Frame table decompressor: `G00Reader.LzDecompress` in `ArcFormats/RealLive/ImageG00.cs`
- GARBro tag: `G00/v2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

A G00 file is a container of bitmap frames. The file header only carries the image dimensions and a frame count;
the frames themselves live in a table that is packed at the end of the file. The format has no signature, so
detection is gated by the `.g00` extension plus the header checks the reference performs.

## File layout

```
[u8 type = 2] [u16 width] [u16 height] [i16 frame count]
[frame count x 0x18 bytes of frame geometry]
[packed frame table up to the end of the file]
```

The width and height must be between 1 and 0x8000 and the frame count between 2 and 0x1000, as in the reference.
Frame geometry records hold the screen coordinates of each frame (`i32 x`, `i32 y` and offsets the reference does
not use), so the port skips them and starts reading the table at `9 + 0x18 x count`.

## Packed frame table

```
[i32 packed size including this eight byte header] [i32 unpacked size] [bit stream]
```

The bit stream starts with a one-bit marker and refills a control byte whenever shifting the marker down reaches
the sentinel value one. A set bit copies one byte literally. A clear bit reads a sixteen bit word whose low four
bits extend a base copy length of two and whose upper twelve bits are the distance in bytes; copies are allowed to
overlap the bytes they produce. The loop runs while the output still has room and the packed size budget lasts, so
a table that ends early is tolerated and one that runs out of budget stops.

The first word of the unpacked table is the frame count again and must agree with the file header, which the port
checks, exactly as the reference does.

## Entries

```
[u32 offset] [u32 size]
```

Offsets are relative to the start of the unpacked table. Frames whose size is zero are dropped from the listing,
but the remaining frames keep their original index in the name: `<file base>#<index padded to three digits>`.

## Port notes and deviations

- Every entry re-unpacks the table when it is opened instead of caching it on the archive handle, keeping the
  handle stateless. The reference keeps the unpacked table in memory; the port trades that for a simpler contract
  and identical results.
- Literal reads that run past the end of the packed stream decode as zeroes, mirroring the reference's stream
  reader, while control words and copies that leave the stream or the output bounds decline the file (in the
  reference those array accesses throw).
- The reference `G00Opener` is an archive format that hands out frame bitmaps, which is what the port exposes. The
  separate `G00` image format and its tile decoder in `ImageG00.cs` are out of scope, so frames are returned as raw
  bitmaps.

## References

- `GARbro/ArcFormats/RealLive/ArcG00.cs` - `G00Opener`, `G00Entry`, `G00Archive`
- `GARbro/ArcFormats/RealLive/ImageG00.cs` - `G00Reader.LzDecompress`
