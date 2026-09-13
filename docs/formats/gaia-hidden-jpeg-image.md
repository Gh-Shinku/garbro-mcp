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

* detection checks the three byte marker and then parses the embedded JPEG the way `Jpeg.ReadMetaData`
  does: walk the marker segments from the start of image and take the width and height from the first
  start-of-frame marker. SOF markers occupy `0xC0..0xCF` but three values in that range are not frame
  headers — `0xC4` is a Huffman table, `0xC8` a JPEG extension and `0xCC` an arithmetic coding table — and
  the walker skips them. Standalone markers (`SOI`, `EOI`, the restart markers and `TEM`) carry no length.
  A payload that is not a JPEG, or a JPEG without a frame header, is declined; both are tested, as is a
  frame header that follows other segments;
* extraction is a straight copy of the stored bytes from offset 100 to the end of the file. Nothing is
  rewritten, so the entry is the fifth port in this repository to set `sizeKnown: true`, and the test
  compares the output byte for byte with the image it was built from;
* the entry is named after the source file with a `jpg` extension. The descriptor advertises `jpg` and
  `jpeg`, and the reference declares no extension list at all — the format is a candidate for every file,
  so the marker and the JPEG structure carry the whole weight of detection;
* entry metadata carries `type: "image"`, width and height, and the archive metadata records
  `image: "jpeg"`, the dimensions and the prefix size.

The descriptor is flagged as encrypted because the stored form is an obfuscated image rather than a
readable one, even though the extraction only strips a prefix. Encoding and archive creation are out of
scope, as the reference itself throws `NotImplementedException` from `Write`.
