# Leaf engine PX image

Reference: `ArcFormats/Leaf/ImagePX.cs`, classes `PxFormat` (tag `PX`) and `PxReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `leaf-px-image`
(`packages/formats/src/leaf/px-image.ts`). The picture writes no word of its own, so it is told by its
**name** - `.px` - and by the fields of its head.

## The head

The head names one of four ways, and the fields behind it differ by way:

* **the twelfth** (0x0C) keeps the picture in blocks of a size the head names, one frame after another: the
  head holds the frame count, the block size, the depth, the picture's size, and how many blocks stand
  across and down;
* **the hundred and forty-fourth** (0x90) keeps whole frames one after another behind a **second** head of
  its own, which starts at 0x20 and carries the picture's size and depth; the word `Leaf` stands at 0x14 of
  the first head, and the second head's own way must be 0x0A;
* **the sixty-fourth** (0x40 and 0x44) names the place of every block of its own in a table, and its picture
  is always four bytes a pixel;
* **the first, fourth and seventh** keep one picture in a single block whose head **is** the file's head: the
  head's own way field and depth field are that block's, and the picture's size stands at 0x14 and 0x18.

Eight bits a pixel is a picture of greys and thirty-two one of blue, green, red and an alpha. Only the
offset way may carry any other depth, because it forces thirty-two; the other ways are gated on eight or
thirty-two by the head itself, **which is also the block's own depth field** - so a file whose blocks stand
in nine or forty-eight bits cannot be opened through those ways at all, exactly as in the reference.

## The ways a block is kept

A block's own head carries its size, the place it is meant for, its way and its depth, and every block but
the one of the colour-map way is built in a buffer a thousand and twenty-four pixels wide and then cut to the
picture's own size where it is placed.

* **the first way, eight bits**: the picture stands as it is;
* **the first way, thirty-two bits**: every pixel is handed over with its colour, and its alpha is read from
  the top of its own byte - a byte holding nothing means "fully opaque";
* **the fourth way, eight bits**: the reference itself throws `NotImplementedException` here, and this port
  refuses the block by name;
* **the fourth way, nine bits**: a run of codes, each naming a place and how many pixels follow. A feature of
  the code turns the runs' alpha on or off; a pixel's colour comes from the **palette** a block of the first
  way handed over beforehand, and its alpha from a byte of its own, doubled and shifted down by one;
* **the fourth way, thirty-two and forty-eight bits**: runs of whole colours, where a colour that carries an
  alpha takes it from its own top byte, and a colour that carries none stands fully opaque in the
  thirty-two-bit way and as nothing at all - transparent black - in the forty-eight-bit one, which also
  carries a word behind every colour that is read and dropped;
* **the seventh way**: the picture of this block stands **alone** - its own size, its own stride - and its
  colours come from a map of their own rather than from a palette. The map is kept blue, green, red, alpha,
  and a colour's alpha comes out the same way as the first way's.

## What the reference does that is easy to miss

* **A run's place is added, not assigned.** The cursor a run of the fourth way writes to keeps its place
  between codes, so the place a code names is a number of rows **added** to where the last code left off.
* **A block is cut to the head's size, not to the buffer.** A picture of the colour-map way keeps a buffer of
  its own block's size behind a head that still names the original picture, and a block placed into it is
  cut by the head. This port first cut by the buffer's own size, which the ninth way's test caught.
* **The alpha is nine bits, not eight.** `(alpha << 1 | red >> 7) + 0xFF` is taken as a byte, so an alpha of
  `0x80` comes out `0xFF` rather than half way.
* The seventh way's colour map is read as `BgrA` where the palette is read as `BgrX`: both are four bytes an
  entry, and only the name of the fourth byte differs.

## Deviations from the reference

* Every read is bounded: a block head, a table, a palette and a run that reach past the file are refused, and
  so is a picture larger than this project will hold. The reference reads past the end of its own buffer.
* A run of the ninth way whose palette has not been handed over yet is refused, where the reference would
  fault on a null palette.
* A block of no way the reference names, a block of negative size, and a picture of no size are refused.

## Verification

Eight tests, with every expectation written out by hand rather than by the same walk: the head of each of
the four ways; the blocks of the first way taken from their table, with the eight bytes the reader steps over
inside every packed row; a stored frame behind its second head; the twentieth way's colours and their alpha;
the ninth way's runs read from a palette in a block of its own, with the alpha's own turning; the colour-map
way's own size and its map; the two refusals; and the name gate, which turns the same picture away under
another name.

What stands on the reference alone: no fixture here holds a copy of the seventh way's colour map beyond the
two colours it names, no fixture reaches the forty-eighth way at all - its head gate refuses every way it
could be reached through, as the reference's does - and no real file is on hand to compare against GARbro's
output.
