# Software House Parsley CG archive (CG/PARSLEY/1)

## Reference and attribution

- GARbro reference: `ArcFormats/Software House Parsley/ArcCG.cs`, class `CgV1Opener`
- GARbro tag: `CG/PARSLEY/1`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  int32     entry count
0x04  records   one NUL terminated CP932 name followed by a 32 bit payload offset
      payloads  entry sizes are derived from the next offset, the last one runs to the end of file
```

The offset table is validated against the end of the index: an entry may not start before the last record
has been read, and the whole index must fit inside the file. Names longer than 0x100 bytes, empty names
and offsets past the end of file reject the archive.

Entry typing follows the archive name. An archive named exactly `CG` (case sensitive) or starting with
`UCG` (case insensitive) is a CG archive and all of its entries are typed as images. The `UCG` variant
stores packed payloads as well, which the reference unwraps inside its image decoder.

## Port notes and deviations

- The `UCG` payload packing is not reproduced, so those entries report `compressed`, an unknown size and
  their stored bytes.
- The optional `Palette` entry and its inline 0x100 colour table are not read; the reference only uses it
  as a default palette for the image decoder, which is out of scope.
- Image decoding is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Software House Parsley/ArcCG.cs` - `CgV1Opener.TryOpen`, `CgV1Opener.OpenImage`
