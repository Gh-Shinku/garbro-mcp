# Siglus engine encrypted JPEG image

Reference: `GARbro/ArcFormats/RealLive/ImageG00Jpeg.cs`, class `G00JpegFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).
Implementation: `packages/formats/src/reallive/g00-jpeg-image.ts` (`g00JpegImageDescriptor`,
`g00JpegImageFormat`, id `reallive-g00-jpeg-image`).

| field | offset |
|---|---|
| version byte, three for a JPEG | 0 |
| width (`u16`) | 1 |
| height (`u16`) | 3 |
| encrypted JPEG | 5 |

## The payload is a JPEG once the key is applied

There is no signature: the first byte says what the payload is, and only three — the encrypted JPEG — belongs to
this format. The dimensions that follow are **validated** (neither may be zero or above 0x8000) but they are
**not reported**: the reference returns whatever its JPEG reader says, so a file whose two pairs disagree is
described by the inner pair. A test builds exactly that file and checks the reported size.

Because the JPEG only appears after decryption, this is a content probe rather than a signature match.

## The cipher is an exclusive or pad

The name of GARbro's `ByteStringEncryptedStream` suggests a substitution, but its `Read` and `ReadByte` both
exclusive or the key in, indexed by position:

```
data[i] ^= key[(base + position + i) % key.Length]
```

The key here is two hundred and fifty six bytes and the wrapped region starts at offset five, so the first
payload byte uses the **first** key byte and the pad repeats every two hundred and fifty six bytes. A test uses a
payload longer than that and checks a byte at exactly twice the key length.

The key is copied from the reference programmatically rather than by hand, and is exported as `G00_JPEG_KEY` —
which mirrors the reference, where it is a public constant — so a reader can build fixtures independently.

## Reading the JPEG's own header

The metadata comes from GARbro's `Jpeg.ReadMetaData`, which walks marker segments:

* a start of image pair first;
* then markers, each `u16` big-endian with `0xFF00` set, followed by a big-endian length that **includes its own
  two bytes**;
* the first marker with `(marker & 0x00F0) == 0xC0` **except** `FFC4` is the frame header, and from it come the
  precision, the height, the width and the component count — the bit depth being `precision * components`;
* anything else is skipped by `length - 2`.

Two quirks are kept. Repeated `0xFF` fill bytes are **not** skipped, so a file that uses them takes the same
path the reference would. And since only `FFC4` is excluded, `FFC8` and `FFCC` would be read as frame headers.
One guard is the port's own: a segment length below two would make the reference's seek move backwards and loop
forever, so here it simply ends the search.

## Output

The decrypted bytes are a JPEG, and they are read with the reader of this project,
`packages/formats/src/shared/jpeg-image.ts` (the baseline sequential profile of ITU-T T.81), so the entry is a
bitmap of the places that reader returns. The reference reads the same stream through `Jpeg.Read`, the platform
decoder of the Windows imaging stack. The entry is named `image.bmp`, five bytes are dropped, so `sizeKnown` is
false, and the tests pin a grey stream exactly against the decode of the Python imaging library. `Write` throws
`NotImplementedException` in the reference.

## Process notes

Three faults, all mine:

* I read `ByteStringEncryptedStream` expecting a substitution table and found an exclusive or pad. Worth
  recording because the class name points the wrong way, and because the two are indistinguishable until the key
  is applied to real bytes;
* the fixture's JPEG segment lengths counted the payload but not the length field itself, so every segment ran
  two bytes long and no frame header was ever found — a two byte error that made the whole file unrecognisable;
* the test for the key wrapping overwrote its whole payload with arbitrary bytes, the JPEG header included, and
  then asserted extraction succeeded. The fixture now keeps the header and randomises only what follows.
