# Zyx multi-frame image package (BDF)

## Reference and attribution

- GARbro reference: `ArcFormats/Zyx/ArcBDF.cs`, class `BdfOpener`
- GARbro tag: `BDF`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  int32     frame count, between one and a hundred
0x04  int32     first frame offset, always zero
0x04  records   one record of 0x1C bytes per frame
data            frames at the end of the index plus the offset recorded per record
```

Every record holds the payload offset at +0, the stored size at +4, an incremental flag at +8, two
unidentified words at +0xC and +0x10, the frame width at +0x14 and its height at +0x18.

Records with a zero stored size are skipped, and every listed frame has to carry at least four bytes, a
positive width and height, and fit inside the file. Frames are named `{base}#{index}` with a two digit index
taken from the record number, so skipped records leave gaps in the numbering. All frames are typed as
images.

The incremental flag marks frames that only encode the pixels that changed since the previous frame; the
reference resolves them while decoding, which is why an archive has to hold at least one frame.

## Port notes and deviations

- Frame payloads are exposed as stored. The reference decodes them to BGR24 pixels through `OpenImage`,
  which is out of scope, so geometry and the incremental flag are reported as metadata instead.
- An archive whose records are all empty is rejected; the reference would build an archive without a base
  frame and fail while reading it.
- Image decoding is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Zyx/ArcBDF.cs` - `BdfOpener.TryOpen`, `BdfArchive.ReadFrame`
