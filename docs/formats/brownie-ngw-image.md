# Brownie NGW obfuscated bitmap

Reference: `GARbro/Legacy/Brownie/ImageNGW.cs`, class `NgwFormat`, tag `NGW`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/brownie/ngw-image.ts` (`ngwImageDescriptor`, `ngwImageFormat`, id
`brownie-ngw-image`).

This is a **subclass of the obfuscated bitmap base class** (`BMP/MB`, ported as `bmp-mb-image`) that
replaces the base's list of five tags with a single fixed one: the stored file is a bitmap whose first two
bytes read `NG`. Everything else — dropping those two bytes, prepending the real `BM` marker and reading
the bitmap's own metadata — is inherited, so the port reuses the base's `obfuscatedBitmapFormat` factory
and `openAsBitmap` helper rather than restating them.

The port exposes the resource as a single entry:

* detection requires the `NG` tag and then the same bitmap checks the base class applies: a DIB header of
  at least forty bytes, non-zero dimensions and a non-zero bit depth. A plain bitmap, a file tagged `GD`
  (which belongs to the Mink sibling) and a file too short to hold a bitmap header are all declined — the
  cross-tag case is tested both against this format and against the base class, whose five tag list does
  not include `NG`;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and sets
  `sizeKnown: true`, because only the two marker bytes differ between stored and extracted;
* extraction restores the marker and emits the bitmap verbatim; the test compares everything from the third
  byte onward;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"`, the replaced tag as `storedTag`, and the dimensions.

The reference class declares no extension list, so the descriptor registers `ngw`, which is what the tag
suggests; the extension only affects catalogue presentation, not detection or extraction.

Encoding and archive creation are out of scope.

## The places of the picture

The reference reads the surface with `Bmp.Read`, so this port reads that bitmap with the shared bitmap walk and hands the
places of the picture over as a bitmap of its own: of the width, the height and the depth of the head of the bitmap, of a
row of the count of the places a row of the picture holds (so the row padding of the file stands of no count) and of the
rows in the order the head names, which for a bitmap of a positive height means the last row of the file first. The
places the file holds behind the picture stand of no count of the walk. The factory `mb/image.ts` stands behind three
descriptors, `bmp-mb-image`, `brownie-ngw-image` and `mink-gdf-image`, so this walk stands for all three of them.
