# Eternity engine image (`SGF`)

Reference: GARbro `ArcFormats/Eternity/ImageSGF.cs`, classes `SgfFormat`, `SgfMetaData` and `SgfReader`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/eternity/sgf-image.ts`, registered as `eternity-sgf-image`.

A picture of the engine: the colour channels are stored as a walk of differences over a stream of bits, the
alpha channel as a second walk of the same kind, and both are read in blocks of rows.

## The header

| offset | field |
| --- | --- |
| 0 | `SG` |
| 2 | the version, which must be 100 |
| 4 | the width |
| 6 | the height |
| 8 | the alpha flag, read as a whole word |
| 0x0c | the block size in rows |
| 0x14 | where the colour blocks start |
| 0x1c | where the alpha section starts |

The reference declares its signature as a word that spells `SG` followed by one more byte, and then matches
only the two letters; the port keeps the two letters and requires the version, which the reference checks
strictly.

## The colour walk

The reader keeps five rotating masks over 32 bit words, read from the stream on demand:

* the first answers, once per bit from the lowest up, whether the next channel byte carries a byte at all —
  a set bit means the channel keeps the value it had, and nothing is read;
* for an answer that does carry a byte, the second says whether that byte is a difference or a literal;
* for a difference, the third says which way it goes and the fourth holds the step itself as a nibble,
  which is added to or taken from the channel modulo 256;
* for a literal, the fifth holds four bytes, lowest first.

A word is taken whenever its mask reaches one. The masks begin at one and rotate as answers are given — by
one place for the first three, by four for the nibbles (so a word of eight nibbles) and by eight for the
literals (so a word of four bytes). They are shared by the three channels and all of them start over at the
beginning of every block.

A block opens with a word that is added to the running position to give the next block, and four bytes that
seed the three channels. After every row the three channels take the value of the first pixel of the row
just written, so a row reads on from its own start rather than from the row above.

## The alpha section

When the picture declares alpha, the reference reads a word at the alpha offset: `A ` leads to a section of
the same walk with one channel, and `BM` leads to a method whose body is commented out and which therefore
returns nothing, leaving such a picture with three channels only. The section holds its own block size at 8
and the offset of its first block at 0x10, relative to the section.

The alpha walk fills its array from the last row **backwards**, so the first value it decodes belongs to the
bottom pixel and the array it leaves behind reads top down, which is the order the pixels are woven in.

## Deviations from the reference

* Every read is bounded and a stream that ends early raises a `GarbroError`; the reference lets the stream
  throw.
* A block size of zero is refused with a message, where the reference divides by it.
* Only an `A ` alpha section is read, matching the reference, which returns nothing for any other word.

## Verification

Eleven fixtures in `tests/formats/eternity-sgf-image.test.ts` cover the header rejections, the header
fields, a block of literals, a block of differences, a channel that keeps its seed, the block length that
leads to the next block, both alpha paths and the absence of alpha, a picture without a block size, a stream
that ends early, and detection, listing and extraction through the registered format.

The fixtures are built with a small writer of their own that packs channel bytes as the reader's literals —
the first and second words left clear, the fifth holding four bytes — and the two cases that need the other
branches are written out by hand, so their expectations come from the reference's own table of steps rather
than from the port. The bitmap expectations account for the row padding a bitmap requires.
