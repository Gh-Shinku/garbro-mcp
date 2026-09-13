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
`Palette ` record is consumed by the image decoder. `ImageFrm` and `DiffeFrm` records become entries named
`<base>#<index>` with the index padded to four digits and counted over the frames only, and the scan stops
once the declared frame count is reached. Every frame has to fit in the file, and a file without any frame
is declined.

## Extraction

Frames are extracted verbatim. The Entis image decoder, which turns frames, difference frames and the
palette into a bitmap, is out of scope.

## Port notes and deviations

- Archive creation is out of scope.
- The image decoder and the palette reader are not ported, so a `Palette ` record is skipped rather than
  validated.
- The metadata block is read in one slice bounded by the declared `Header  ` length, and a metadata block
  larger than 16 MiB is declined.

## References

- `GARbro/ArcFormats/Entis/ArcERI.cs` - `EriOpener.TryOpen`, `EriOpener.OpenImage`
- `GARbro/ArcFormats/Entis/ImageERI.cs` - `EriFormat.ReadMetaData`, `EriFile.ReadSection`
