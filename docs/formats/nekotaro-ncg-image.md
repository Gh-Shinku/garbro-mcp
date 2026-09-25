# Nekotaro Game System image

Reference: `Legacy/Nekotaro/ImageNCG.cs`, class `NcgFormat` with the `NcgReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `nekotaro-ncg-image`
(`packages/formats/src/nekotaro/ncg-image.ts`).

## The head, and the word the picture does not carry

The head is four bytes, every one of them in its own unit: the place the picture stands at in eights and twos,
and its width in eights and its height in twos. The picture has to fit the screen it was drawn for - six
hundred and forty by four hundred - and this port also asks that both of its sides stand in whole blocks,
since the reader walks it in blocks of eight by two and of four by two. The colour map follows at 4: sixteen
colours of three bytes each.

The reference tells this picture by a word of its own **and by nothing at all**, its own list of words carrying
a second, empty entry beside `0xC8500000`; the shape of the head is what settles a file that carries no word.
This port keeps that: no signature is declared, the format stands behind the others, and the head decides.

## The colour map

Every colour stands green first and blue last, and every byte of it is keyed: the ones complement of the byte
has a byte of the engine's own name - `NEKOTARO` - taken from it, the three channels of a colour taking the
next three bytes of that name **in the order blue, red, green**, with the name starting over every eight. The
keyed value is then spread over the whole byte the way the reference's own byte cast does, which wraps.

## The blocks of the picture

The picture is drawn in two parts, and both name the places of their blocks in their own grid of the screen -
eighty blocks of eight pixels wide for the first part, a hundred and sixty of four for the second - while the
pattern every block is drawn with is read **in front of** them: four bytes, each standing for one of the four
bits of a pixel and read from its highest bit down, so a byte of nothing leaves a place alone and a byte of
every bit set puts that bit in all eight places of the block.

* The **first part** draws blocks of eight pixels by two. Its commands are told apart by the top two bits of
  the control byte: nothing for a rectangle whose width and height stand behind it, one for a run across, two
  for a run down and three for a single block.
* The **second part** draws blocks of four by two, with one pattern of its own. Its control byte carries the
  place in its lower seven bits: cleared it stands for a run down of as many blocks as the byte behind it
  names, and set for a single block.

Both walks are closed by a byte of every bit set, and the first part is repeated with a fresh pattern by a
byte of `0x7F`, while the second ends on `0xFE` as well. Every block that is drawn is marked.

A third walk then fills whatever no block of the picture drew: it walks the picture in its four pixel grid,
and for every block left unmarked it reads a pattern of its own and draws it - so the pattern of a filled
block stands behind the whole picture rather than in front of it.

One step of the reference is kept as it stands and is worth knowing: the run **down** of both parts moves the
place by `2 * width - 8` and `2 * width - 4`, which takes the block behind it a block's width to the left of
the row below. For a run that begins at the left edge the second block lands on the row below at the same
column, drawing its top row over the row the first block had drawn its own bottom into - which the tests pin.

## Deviations from the reference

* Every read is bounded by the file, and a block that would reach past the picture is refused rather than
  written past it.
* A picture whose sides do not stand in whole blocks is turned away, where the reference would divide them
  and walk out of its own place.

## Verification

Seven tests over synthetic fixtures (`tests/formats/nekotaro-ncg-image.test.ts`): the head and its refusals, a
single block of the first part with the pattern that four walks of a byte build, a run down with the step the
reference takes, the third walk filling both blocks of a picture neither part drew, the colour map - whose
first colour is worked out **by hand** and the rest against the same key written out again - the picture handed
over as a bitmap with a file that ends inside itself, and the shape of the head telling a picture that carries
no word at all.
