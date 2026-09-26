# Gaia hidden JPEG image

Reference: `GARbro/Legacy/Gaia/ImageJPG.cs`, class `HiddenJpegFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/gaia/jpeg-image.ts` (`hiddenJpegImageDescriptor`,
`hiddenJpegImageFormat`, id `gaia-hidden-jpeg-image`).

A **JPEG stored at a fixed offset behind a three byte marker**. The reference declares no signature — its
`Signature` property is `0` — and instead tests `Signature & 0xFFFFFF`, which is the first three bytes read
big endian, against `0xFDFF00`. In other words the file must begin `FF FD 00`, and the image itself starts
at offset **100**. The remaining 97 bytes of the prefix are never read, which the port preserves and a test
pins by changing them to values that would otherwise look meaningful.

The port exposes the resource as a single entry:

* detection checks the three byte marker and then parses the embedded JPEG with the shared reader of this
  project, `packages/formats/src/shared/jpeg.ts`, which follows `Jpeg.ReadMetaData`: a start of image
  marker, then a length for every marker, and the width and height from the first marker of the frame row
  apart from the Huffman table marker. A payload that is not a JPEG, or a JPEG without a frame header, is
  declined; both are tested, as is a frame header that follows other segments;
* extraction reads the picture with `packages/formats/src/shared/jpeg-image.ts` and hands a bitmap over, as
  the reference hands the stream to `Jpeg.Read`, the platform decoder of the Windows imaging stack. The
  entry is named `image.bmp` and its tests pin the places of a grey stream exactly, against the decode of
  the Python imaging library;
* the reference declares no extension list at all — the format is a candidate for every file, so the marker
  and the JPEG structure carry the whole weight of detection;
* entry metadata carries `type: "image"`, width and height, and the archive metadata records `image: "bmp"`,
  the dimensions and the prefix size.

The descriptor is flagged as encrypted because the stored form is an obfuscated image rather than a
readable one, even though the extraction only strips a prefix. Encoding and archive creation are out of
scope, as the reference itself throws `NotImplementedException` from `Write`.
