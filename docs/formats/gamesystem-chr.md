# Game System character frames (CHR/GAMESYSTEM)

## Reference and attribution

- GARbro reference: `ArcFormats/GameSystem/ArcCHR.cs`, class `ChrOpener`, and the metadata reader of
  `ArcFormats/GameSystem/ImageCHR.cs`, class `ChrFormat`
- GARbro tag: `CHR/GAMESYSTEM`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  uint32    file size
0x04  int32     rgb size
0x08  uint32    width
0x0C  uint32    height
0x10  int32     x offset
0x14  int32     y offset
0x18  ...       indexed rgb plane, running up to the rgb size
rgb   uint32    overlay size
rgb+4 int32     unknown
rgb+8 int32     frame count
...             overlay data
```

The file has to be called `*.CHR` and its size word has to agree with the actual length. The frame geometry
is validated the same way the image reader does it: both dimensions have to be non zero and at most 0x8000,
the offsets have to be non negative, and `offset + dimension` has to stay within 0x8000. The rgb size has to
exceed 0x20 and stay inside the file.

Two entries are exposed, both typed as images and named after the file with a `#00` and `#01` suffix. The
first is the indexed rgb plane, which starts at offset zero and covers the header as well. The second starts
four bytes into the overlay size field, so it includes the unknown word and the frame count rather than just
the overlay pixels.

## Port notes and deviations

- The overlay entry is bounds checked, which the reference leaves to the platform.
- Character and overlay image decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/GameSystem/ArcCHR.cs` - `ChrOpener.TryOpen`
- `GARbro/ArcFormats/GameSystem/ImageCHR.cs` - `ChrFormat.ReadMetaData`
