# Kurumi GRA image

Reference: `GARbro/ArcFormats/Kurumi/ImageGRA.cs`, class `GraFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kurumi/gra-image.ts` (`kurumiGraImageDescriptor`,
`kurumiGraImageFormat`, id `kurumi-gra-image`).

A **masked, zlib compressed bitmap** from the "Virgin Snow" engine.

| field | offset |
|---|---|
| `Virgin Snow Compressed Data 1.0` (32 byte field) | 0 |
| masked zlib stream | 0x20 |

The registry signature `0x67726956` is `"Virg"`, the first four characters of the header text rather than an
independent constant, and the test asserts that relation. `ReadMetaData` compares the whole 32 byte field
against the text, so the port re-checks it even though the signature already matched — a test breaks the
final character only (turning `1.0` into `1.1`) and expects a decline, which shows the text check is what
rejects the file.

`UnpackStream` wraps everything after the header in `ByteStringEncryptedStream` with the two byte key
`{0x5A, 0xA5}` and inflates the result. The key is **repeating**, so consecutive bytes are masked with
alternating values; like the UM3 and Regrips ports, the test asserts the relation (`stored[0x20] ===
compressed[0] ^ 0x5A`, `stored[0x21] === compressed[1] ^ 0xA5`, `stored[0x22] === compressed[2] ^ 0x5A`)
instead of trusting a constant.

The port exposes the resource as a single entry:

* the inflated payload is a bitmap, validated with the shared `readBmpMetaData` helper. The stream carries
  no unpacked size, so decompression uses the new `inflateZlibBufferCapped` codec — the existing
  `inflateZlibBuffer` treats its length argument as an exact expectation, which would reject any image that
  is smaller than the bound. Because decoding happens during detection, that cap is load bearing;
* the output is **trimmed to the bitmap's own `bfSize`**, which is a separate number from the size of the
  inflated stream. This is the same two-size rule the HTF and ADVGSys ports follow, and it produced the same
  fixture mistake here that it did there: the first version of this fixture declared the trailing slack in
  `bfSize`, so the port correctly refused to trim anything and the test failed against a correct
  implementation. When a bitmap trim assertion fails, check which of the two sizes the fixture wrote;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is
  flagged `compressed` and `encrypted` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and the bitmap's bit depth; the archive metadata
  records `image: "bmp"`, `compression: "zlib"`, `encrypted: true` and the dimensions.

Declines, all tested: a wrong header text, a stream that does not inflate, a payload that inflates to
something which is not a bitmap, a file that stops inside the header, and a stream masked with the wrong key.
A file shorter than or equal to the header is declined before any decode.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope. The
descriptor registers no extension, matching the reference, and the symbols are prefixed with the engine
because the tag `GRA/VS` names the engine variant.
