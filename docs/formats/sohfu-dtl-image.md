# Sohfu image formats

Reference: `GARbro/ArcFormats/Sohfu/ImageDTL.cs`, classes `DtlFormat`, `DtlcFormat` and `DtlMetaData`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sohfu/dtl-image.ts` — `sohfuDtlImageDescriptor` /
`sohfuDtlImageFormat` (id `sohfu-dtl-image`) and `sohfuDtlcImageDescriptor` / `sohfuDtlcImageFormat` (id
`sohfu-dtlc-image`), with `readDtlLayout`, `readDtlcLayout` and `dtlBitmap`.

## DTL — the pixels stand as they are

The file begins with `DTL_`, the width and the height stand at eight and twelve as words, the depth at
sixteen and the row of the reader's own buffer at twenty. Only four, eight, twenty four and thirty two bits
a pixel are read, and the pixels stand right behind the head, a row of the reader's own buffer at a time.
The depth chooses the layout: `Bgr24` for twenty four bits, `Bgra32` for thirty two, and the sixteen shades
of grey at four bits and the two hundred and fifty six at eight. The rows are handed out top down, which is
what `ImageData.Create` means.

## DTLC — the pixels stand behind a table of runs

The same head, with `DTLC` or `DTLA` in front of it, but only twenty four and thirty two bits a pixel. The
pixels stand behind a table with an entry **a row**: the count of the row's runs as a word, and then eight
bytes a run. The reference does not read a single one of those bytes — it walks past them to reach the
pixels — so the port reads the counts and passes over the runs the same way, and it is the walking that has
to stay inside the file.

The write paths of both formats throw `NotImplementedException`, so this is a read only pair.

Deviations from the reference, in the message only: a row narrower than the picture cannot hold it and is
refused, where the reference's own array handling would answer with an exception, and a table of runs or a
run of pixels that reaches past the file is refused as well.

The tests cover the head of each kind, the marks and fields they are turned away for, the twenty four,
eight and four bit pictures written out, the second mark of the run kind, the walking of a table of runs,
and the run kind's own depth and table checks.
