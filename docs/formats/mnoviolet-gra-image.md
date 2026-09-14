# M no Violet image

Reference: `GARbro/ArcFormats/MnoViolet/ImageGRA.cs`, class `GraFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mnoviolet/gra-image.ts` (`mnoVioletGraImageDescriptor`,
`mnoVioletGraImageFormat`, id `mnoviolet-gra-image`).

The **marker decides the depth**: `gra` (the reference's word `0x00617267`) is a twenty four bit image and `mas`
(`0x0073616D`) is an eight bit one, each with a null in its fourth byte. Behind it come the width (`0x04`,
word), the height (`0x08`, word), the **packed size** (`0x0C`, word) and the **unpacked size** (`0x10`, word),
so the compressed body starts at `0x14`.

The body is the library's classic **LZSS stream**, which the reference reads through `LzssReader`: a 0x1000 byte
window that starts at `0xFEE`, one control bit a token, a set bit for a literal and a back reference whose two
bytes carry the offset in their high twelve bits with the length in the low nibble below. That reader's source is
not part of the GARbro tree — it belongs to the `GameRes` library GARbro references — so the port reuses the
shared decoder, which was written against the same stream as other references reproduce it inline (the
TanukiSoft AMAP bitmap and Silky's GRD) and is pinned by their tests.

Details worth recording:

* the reference gives its image the four byte aligned **stride** of the depth, so the rows of the unpacked buffer
  are not tight. The port repacks them tight for the bitmap it writes;
* `ImageData.CreateFlipped` stores the rows **bottom up**, which a bitmap records with a positive height, so the
  port writes the rows in the order it read them with `bottomUp` set;
* neither size word is checked by the reference, and the third form its `ReadMetaData` knows — a first word of
  `1` with the depth read behind it — is unreachable, because the class registers itself under the zero
  signature and declares no extension to be matched by. The port requires both sizes to be positive and
  registers the two markers alone;
* the packed size is exact: the reference reads no more than that many bytes, so anything trailing in the file
  changes nothing;
* a body that reaches past the end of the file, or an unpacked size that cannot hold the image at the
  reference's stride, fails in the port as it does in the reference's image layer.

The tests cover both markers and their nulls, the size and dimension checks, the depth taken from the marker, a
twenty four bit image with a padded stride, an eight bit image with the grey palette, the bytes trailing the
packed size, the two failure cases and the entry name.
