# Entis multi-frame image format (ERI/MULTI)

## Reference and attribution

- GARbro reference: `ArcFormats/Entis/ArcERI.cs`, class `EriOpener`, with the metadata reader of
  `ArcFormats/Entis/ImageERI.cs`, classes `EriFormat`, `EriFile`, `EriFileHeader`, `EriMetaData`
- GARbro tag: `ERI/MULTI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The file starts with the four byte signature `Enti` and the little endian identifier word at 8 has to read
as `0x03000100` or `0x02000100`. The string at 0x10 has to begin with `Entis Rasterized Image`,
`Moving Entis Image` or `EMSAC-Image`.

## Metadata

The fixed 0x40 byte header is followed by a chain of sections, each an eight byte identifier padded with
spaces and a little endian 64 bit length:

```
"Header  "    the container of the sections below
"FileHdr "    version, contained flag, key frame count, frame count, total frame time
"ImageInf"    version, transformation, architecture, format type, width, height, bpp, clipped pixel,
              sampling flags, quantumized bits, allotted bits, blocking degree, lapped block,
              frame transform, frame degree
"descript"    a UTF-16LE string after a byte order mark, or UTF-8 text
```

The frame count is limited to a sane range. The stream position where the frames start is the end of the
`Header  ` section body, computed as 0x50 plus its declared length, and the section reader counts that
length down as it goes, which is why the body may hold slack.

## Frames

From the stream position the file holds a chain of records, again an eight byte identifier and a 64 bit
length. A `Stream  ` record advances by its header alone, so its body is itself a section chain. A
`Palette ` record carries the colors of an eight bit picture and is recorded for the decoder. `ImageFrm` and
`DiffeFrm` records become entries named `<base>#<index>.bmp` with the index padded to four digits and counted
over the frames only, and the scan stops once the declared frame count is reached. Every frame has to fit in
the file, and a file without any frame is declined.

## Extraction

Every frame is decoded with the Entis picture walk (`packages/formats/src/entis/eri-reader.ts`, the lossless
walk of `EriReader`) and handed out as a bitmap, which is what `EriMultiImage.GetFrame` does: the places of
the picture are accumulated per block, and a `DiffeFrm` frame stands of the places of the frame in front of
it as well, every place of the picture being the sum of the place of the frame in front of it and of the
place of the count of the walk of the picture itself. The frame in front of a frame is decoded along the way,
so the whole chain up to the requested frame is read.

A picture whose `descript` section names a `reference-file` tag stands of the places of the picture of that
file as well (`EriFormat.ReadImageData`): the file is read beside the picture, decoded with the same walk and
its places are added to the places of the picture, every count of a colour of the picture itself. The name of
the tag stands of the counts of the walk of the engine of the name of the picture of the counts of the walk of
the engine of the picture itself (`EriFormat.ParseTagInfo`).

## Port notes and deviations

- Archive creation is out of scope.
- The kinds of the counts of a picture of the engine of the two ways of it, the kinds 2 and 4 of the walk of
  the places of the picture, the counts of the walk of the engine of the kind `ArithmeticCode`, the places of
  a picture of the count of the walk of the engine of sixteen places of a colour and a picture that stands of
  a `reference-file` of fewer than twenty four places of a count stand refused (`UNSUPPORTED_FEATURE`), as
  `entis-eri-image` stands of them.
- The counts of a colour of the picture (`Palette `) stand read of the walk of the frames, of the counts of
  the walk of the engine of the places of the count of the walk of the picture itself: the reference stands of
  the counts of a colour of the count of the walk of the picture of no count of the walk of the engine at all
  (`ReadPalette`, of the counts of a colour of the count of the walk of the picture of its own).
- The frames of the picture stand of the counts of the walk of the engine of every count of the walk of the
  picture itself: the reference stands of the counts of the walk of the engine of the frames of the walk of
  the picture of its own (`EriMultiImage.Frames`, of the counts of the walk of the engine of the places of
  the count of the walk of the picture itself), and this port stands of the counts of the walk of the engine
  of the frames of the count of the walk of the picture in front of them alone.
- The metadata block is read in one slice bounded by the declared `Header  ` length, and a metadata block
  larger than 16 MiB is declined.
- The entry names carry the depth of the bitmap this port hands out, which the reference leaves to the
  caller.

## References

- `GARbro/ArcFormats/Entis/ArcERI.cs` - `EriOpener.TryOpen`, `EriOpener.OpenImage`
- `GARbro/ArcFormats/Entis/ImageERI.cs` - `EriFormat.ReadMetaData`, `EriFile.ReadSection`
