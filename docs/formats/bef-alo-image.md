# BeF ALO obfuscated bitmap

Reference: `GARbro/ArcFormats/BeF/ImageALO.cs`, class `AloFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/bef/alo-image.ts` (`aloImageDescriptor`, `aloImageFormat`, id
`bef-alo-image`).

A bitmap whose **`BM` marker has been replaced with two zero bytes**. Nothing else differs, so detection is the
zeroed marker plus the extension, and extraction restores the two bytes and hands the result to the shared
bitmap reader.

The obfuscation is positional, which makes the reconstruction exact: the two bytes are *replaced* rather than
inserted, so every other offset in the file keeps its position — including the bitmap's size field at offset
two, which is the field the metadata check reads. A test asserts that restoring the marker recovers the original
file byte for byte.

The port exposes the resource as a single entry:

* the rebuilt bitmap is validated with the shared `readBmpMetaData` and trimmed to its own `bfSize`; a test
  appends twenty bytes after the pixels and asserts that the output is the bitmap without them;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is flagged
  `encrypted: true`, since the marker is the obfuscated part; `sizeKnown` is false because the output is a
  bitmap built from a file that is missing its marker;
* entry metadata carries `type: "image"`, the dimensions and the bit depth; the archive metadata records
  `image: "bmp"`, `encrypted: true` and the dimensions;
* the reference declares no signature and gates on the `.alo` extension, so the descriptor registers the
  extension as metadata and the check itself lives in detection. Tests cover the extension being required and
  case insensitive, and they also pin the marker rule from both sides: a plain bitmap with `BM` is declined,
  and so is a file with only the **first** byte zeroed, while the fully zeroed pair is accepted.

Deviations, both tested: a payload that is not a bitmap is declined, and a bitmap with zero width or height is
declined even though the metadata helper accepts it, because nothing can be drawn from it.

GARbro *can* write this format — `AloFormat.Write` writes two zero bytes and then copies the bitmap from offset
two, which also shows that the stored file and the bitmap have the same length. Encoding is out of scope, so
`create` stays false.
