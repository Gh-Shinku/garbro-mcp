# Mink GDF obfuscated bitmap

Reference: `GARbro/Legacy/Mink/ImageGDF.cs`, class `GdfFormat`, tag `GDF`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mink/gdf-image.ts` (`gdfImageDescriptor`, `gdfImageFormat`, id
`mink-gdf-image`).

The Mink sibling of the Brownie `NGW` format, and another **subclass of the obfuscated bitmap base class**
(`BMP/MB`, ported as `bmp-mb-image`): the stored file is a bitmap whose first two bytes read `GD`. As with
`NGW`, the port reuses the base's `obfuscatedBitmapFormat` factory and `openAsBitmap` helper, so the same
length-preserving marker restoration serves all three formats.

The port exposes the resource as a single entry:

* detection requires the `GD` tag and then the base class's bitmap checks: a DIB header of at least forty
  bytes, non-zero dimensions and a non-zero bit depth. A file tagged `NG` (the Brownie sibling) and a
  payload whose bit depth is zero are declined, both tested;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and sets
  `sizeKnown: true`, since only the two marker bytes change;
* extraction restores the marker and emits the bitmap verbatim — including a **negative bitmap height**,
  which marks top-down rows and passes through untouched. The reference reports the absolute height in its
  metadata while the emitted bitmap keeps the sign, and the test covers a file whose stored height is `-2`;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"`, the replaced tag as `storedTag`, and the dimensions.

The reference class declares no extension list, so the descriptor registers `gdf`, which is what the tag
suggests; the extension only affects catalogue presentation, not detection or extraction.

Encoding and archive creation are out of scope.
