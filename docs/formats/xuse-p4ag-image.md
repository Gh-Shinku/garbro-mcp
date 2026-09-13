# Xuse/Eternal obfuscated PNG image

Reference: `GARbro/ArcFormats/Xuse/ImageP.cs`, class `P4AGFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/xuse/p4ag-image.ts` (`p4agImageDescriptor`,
`p4agImageFormat`, id `xuse-p4ag-image`).

A PNG with its **first two signature bytes dropped**: the file begins with `4E 47 0D 0A` — the PNG
signature from its third byte on — which is the registry word `0x0A0D474E`. `OpenAsPng` simply
prepends the two missing bytes (`89 50`) as a prefix stream and hands the result to `Png.ReadMetaData`,
so everything except the two byte shift is an ordinary PNG.

Because of that shift, the stored layout is two bytes earlier than usual:

| field | stored offset |
|---|---|
| remaining signature bytes `0D 0A 1A 0A` | 2 |
| IHDR chunk length (must be 13) | 6 |
| IHDR chunk type | 10 |
| width / height | 14 / 18 |
| bit depth / colour type | 22 / 23 |

The port exposes the resource as a single entry:

* detection re-checks the stored signature, the remaining signature bytes, the IHDR chunk length and
  type, non-zero dimensions and the colour type (1, 3, 1, 2 and 4 channels for types 0, 2, 3, 4 and 6),
  so the reported bit depth is `channels * bitDepth`. GARbro checks none of this itself — its registry
  gate matches the word and a plain PNG handed straight to `Read` would be accepted — so re-checking is
  a deliberate deviation, and it is what keeps the format from claiming an ordinary PNG;
* extraction prepends `89 50` to the whole stored file, i.e. the output is the original PNG and is
  **two bytes longer** than the input;
* the entry is named after the source file with a `png` extension, covers the stored file (offset 0),
  is flagged `encrypted: true` and `sizeKnown: false`;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records `image: "png"` and `encrypted: true`.

Pixel decoding, PNG structure validation beyond the IHDR and archive creation are out of scope.
