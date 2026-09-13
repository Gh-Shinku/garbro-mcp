# Yaneurao image format

Reference: `GARbro/Legacy/Yaneurao/ImageYGA.cs`, class `YgaFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).
Implementation: `packages/formats/src/yaneurao/yga-image.ts` (`ygaImageDescriptor`, `ygaImageFormat`, id
`yaneurao-yga-image`).

| field | offset |
|---|---|
| marker, `yga` or `epf` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| compression word (`i32`) | 0xC |
| unpacked size (`i32`) | 0x10 |
| payload | 0x18 |

## Two markers, one format

The format answers to **both** three byte markers, `yga` and `epf`, and declares both extensions. That is what
the reference's `Signatures` array holds, so both are registered here and a test accepts a file of either kind.

## The compression word is signed, and only one value is refused

The single check in `ReadMetaData` is `compression > 1`. Read as a **signed** thirty two bit integer, that
refuses 2 and above but **accepts a negative value** — and since the compression test is `!= 0` rather than a
comparison against one, a negative word then counts as *compressed*. A test covers both halves: words above one
are declined, and a word of −1 detects and reports `compressed: true`.

## The declared size governs everything, including failure

The payload is exactly `unpackedSize` bytes of pixels, and the reference allocates that many bytes before
reading into them. Two consequences are ported as they behave:

* the read result is **ignored**, so a stream that stops early leaves the rest of the buffer as allocated —
  zeroes. That holds for both branches: a short LZSS stream and a short stored block. Two tests check the tail;
* a size that cannot serve the bitmap the header describes fails, because the reference's bitmap writer reads
  whole rows from it. A negative word fails as well, since the reference could not allocate the buffer at all.

The port adds only a ceiling on the declared size, because that number decides an allocation the file itself
need not justify.

## Output

The reference builds the image with `ImageData.Create`, which has no stride of its own — so every row is a whole
number of pixels — and yields a **top down** bitmap. Its negative height is what the test asserts, along with
the pixels being carried verbatim. `Write` throws `NotImplementedException` in the reference.

## Process notes

* The first version of the uncompressed branch collected the stored bytes and the zero padding into one array
  with spread syntax. That is a multi-megabyte array literal, which can overflow the stack; it now allocates and
  copies.
* A `let` that the same edit left without a reassignment raised the lint count to 46 until it became `const` —
  the check that no new file adds a warning is worth running on every port.
* The truncated stream test initially used the header of an *uncompressed* file, so the port took the plain path
  and copied the compressed bytes; the fixture had to say compressed.
