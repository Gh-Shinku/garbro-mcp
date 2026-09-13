# KaGuYa APS3 tiled image (and the KaGuYa LZ codec)

Reference: `GARbro/ArcFormats/Kaguya/ImageAPS.cs`, class `Aps3Format` (a subclass of `ApFormat`), and the
`LzReader` codec in `ArcFormats/Kaguya/ArcKaguya.cs`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/aps3-image.ts` (`aps3ImageDescriptor`, `aps3ImageFormat`, id
`kaguya-aps3-image`) and `packages/formats/src/kaguya/kaguya-lz.ts` (`unpackKaguyaLz`).

| field | offset |
|---|---|
| signature `\x04APS` | 0 |
| version byte `3` | 4 |
| part count (`i32`) | 5 |
| parts, each one variable length | 9 |
| payload size (`u32`), checked and then unused | after the table |
| compression (`i16`): 0 or 1 | +4 |
| packed size (`u32`), mode 1 only | +6 |
| unpacked size (`u32`) | +6 or +0xA |
| packed payload, then the payload | +4 |

## A container around an AP image

The payload of this format is not pixels at all: it is a complete **`AP` image**, so extraction decompresses or
copies the payload and then runs the base class's own reader over it — `readApFields` and `readApBitmap`, the
helpers the AP port exports. That means the tile set inherits the base format's conventions wholesale: rows
stored bottom up, reversed into a **top-down** bitmap. It also means the two sets of dimensions can disagree,
because the metadata reports the union of the tile rectangles while the image that comes out has whatever size
the embedded `AP` header declares — which a test pins by giving an unnamed part a zero-sized union and still
getting a real two by two image.

## The union starts at the origin

Each part with a **name** contributes a rectangle to a union that begins at `(0, 0, 0, 0)`, so the box always
contains the origin: a part at (10, 10) reaching (15, 15) produces a **fifteen by fifteen** image rather than
five by five. Parts whose name length is zero are skipped entirely. This is the reference's arithmetic rather
than a bug to be corrected, and a test asserts both halves.

The payload size word is read, compared against what is left of the file, and then never used — the actual
sizes come from the compression header. An unknown version byte, a compression mode other than zero or one, and
an overlong payload size all decline the file.

## The KaGuYa LZ codec

`unpackKaguyaLz` is the `LzReader` codec, most significant bit first. A set bit is a literal byte; a clear bit
is a match whose twelve bit offset and four bit count follow, the count biased by two. Three details are unusual
enough to keep exactly, and each has a test:

* the frame position starts at **one**, so the frame's first byte is not written until the position wraps, and a
  match that reads it before then gets a zero that was never stored anywhere;
* an offset of **zero** ends the stream, as does running out of input at the bit level;
* the output is written **without a bounds check**, so a match that would run past the end throws an
  array-bounds error — which the port has to raise by hand, since writing past a JavaScript buffer is silently
  ignored.

Two more behaviours follow from the reference casting a bit reader's failure value rather than checking it: a
truncated **literal** stores `0xFF` and the stream continues, so the buffer fills with `0xFF` rather than
stopping, and a truncated **count nibble** is cast the same way, which makes the count come out as one instead
of three. A match may also overlap the bytes it is producing, which is how runs are encoded; a test compresses
a four byte pattern followed by a twelve byte match four bytes back and checks the whole run.

## Fixture notes

Both failures while writing these tests were the fixture's, not the port's, and both are worth the space:

* the part header is a skipped word, **one byte** of name length, then the name — the first version left the
  length byte out, so every part looked unnamed and six tests failed at once;
* a packed payload's trailer carries the **unpacked** size, which the fixture wrote as the length of the empty
  placeholder payload, so the codec correctly decoded nothing.

## Notes

* The declared extensions are `aps`, `parts` and `ap3`; the signature is four bytes, so detection is by content.
* Because the extraction gains a header, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
* The sibling class `ApsFormat` in the same file is still to be ported.
