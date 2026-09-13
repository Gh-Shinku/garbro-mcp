# Obfuscated PNG image

Reference: `GARbro/ArcFormats/ImagePSM.cs`, class `PsmFormat` — a subclass of `PngFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/psm/image.ts` (`psmImageDescriptor`, `psmImageFormat`, id
`psm-image`).

A PNG whose **first byte was replaced**: the stored signature is `ED 50 4E 47` (`0x474E50ED` as a
little endian word) instead of the usual `89 50 4E 47`. Everything else is an ordinary PNG, which is
why the reference derives the metadata from the PNG reader and only has to fix one byte when
extracting. `0xED` is `0x89` with its top bit set — a "text mode" corruption of the same byte.

The port exposes the resource as a single entry:

* detection needs the obscured first byte, the rest of the PNG signature (`0D 0A 1A 0A`), an `IHDR`
  chunk of the standard length at `0x0C` and non-zero dimensions, so the image metadata can be
  reported. GARbro reads none of this itself — its registry gate matches the obscured word, and a
  plain PNG passed straight to `Read` would be accepted. Re-checking the stored byte here is a
  deliberate deviation that keeps the format from claiming unobfuscated PNGs;
* width `u32@0x10` and height `u32@0x14` come from the IHDR, the bit depth from `u8@0x18` and the
  channel count from the colour type at `u8@0x19` (1, 3, 1, 2 and 4 channels for types 0, 2, 3, 4 and
  6), so the reported bit depth is `channels * bitDepth`;
* extraction is exactly the reference's `DeobfuscateStream`: a prefix stream of the four header bytes
  with the signature byte repaired, followed by the body verbatim. The result is the original PNG at
  the **original length**, so only one byte changes;
* `sizeKnown` is false because the entry covers the stored payload (the file minus the four byte
  prefix) while the extracted stream is four bytes longer;
* entry metadata carries `type: "image"` plus width, height and bit depth, `encrypted: true`, and the
  archive metadata records `image: "png"` and `encrypted: true`.

Pixel decoding, PNG structure validation beyond the IHDR and archive creation are out of scope.
