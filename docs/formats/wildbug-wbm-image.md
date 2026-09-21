# Wild Bug WBM image

Reference: `ArcFormats/WildBug/ImageWBM.cs`, classes `WbmFormat` and the `WbmReader` behind it, whose nine
packed walks stand on the `WpxDecoder` base. The head and the record walk are shared with the ported sound
of the same engine (`wildbug/wpx-section.ts`). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.
Implemented as `wildbug-wbm-image` (`packages/formats/src/wildbug/wbm-image.ts`).

## What this port reads

A picture of this engine is told from a sound of it by the three bytes behind the word both carry: `BMP`
here, `WAV` there. The records behind the head are the same in both.

* the record that opens with `0x10` holds the picture's own head: the width and the height as two words, and
  the depth it is stored in at `0x0C`. The depth picks how many bytes a pixel takes, eight bits taking one,
  sixteen two, twenty four three and thirty two four; any other depth is refused, as the reference refuses
  it;
* the record that opens with `0x11` holds the pixels, padded to four bytes a row;
* the record that opens with `0x12` holds the colours of an eight bit picture, three bytes each, up to two
  hundred and fifty six of them. A picture of eight bits without that record is read as shades of grey,
  which is what the reference's own `Gray8` means;
* the record that opens with `0x13` holds an alpha channel for a picture of twenty four bits or more, one
  byte to a pixel and padded to four bytes a row. It is spread over the pixels into a four byte picture, and
  a channel the reader cannot produce leaves the picture without one - which is what the reference's own
  catch does.

## The packed way this port reads

A section is read as it stands when its format has the top bit set, `0x80`, or when it declares no packed
length at all. Otherwise the second byte of its record names one of nine walks, `UnpackV0` through
`UnpackVD`, for the ways `0x00` to `0x0F`.

The `0x00` walk is ported. It copies the picture's first pixel as it stands, padded to a whole four bytes,
and then reads the picture a bit at a time out of the bytes that follow. A bit equal to the walk's own
condition is a literal byte; any other bit begins a back reference, whose three further bits name one of
eight pixel offsets and whose following bit says whether the run is the shortest one or a counted one, which
the walk counts out for itself a bit at a time. The reference tries the walk three times: twice with one
table of offsets and a set bit of its own, and once with the other table and a clear bit, which is how a
stream of clear bits is read as literals by the last attempt. A finding of the walk's own - a section with no
bytes, one shorter than the first pixel, or a run reaching past the picture - ends the unpack rather than
asking for another attempt, which is what the reference does as well.

The `0x01` walk is ported as well, and it is much the same shape with two differences. Its references come
in four forms rather than one: on the reference's first attempt a reference is either a byte or a word away
from the byte before the place it writes to, and stands for a run of two or three bytes, while on the later
attempts one of the two forms is a short run taken from the table of pixel offsets instead. And in every
walk, a clear bit behind a reference **adds** a run the walk counts out for itself to the run the reference
named.

The `0x02` walk is ported too, and it is the `0x00` walk with its literal bytes taken from a table of codes.
Behind the picture's first pixel stand a hundred and twenty eight bytes holding a four bit length for every
one of the two hundred and fifty six symbols, two symbols to a byte with the lower nibble first, and behind
those stand the codes themselves, one for every symbol that was given a length, in the order the symbols run.
A code is kept at the place its own bits name once they are shifted up to fill fifteen of them, so the walk
finds a literal by collecting bits until the length the table holds for the bits collected matches how many
of them there are. The codes are read out of the same supply of bits the picture is then read from.

The `0x03` walk is ported as well, and it is the `0x02` walk's table of codes with the `0x01` walk's four
shapes of back reference behind it.

The `0x08` and `0x09` walk is ported too: the `0x00` walk's raw literal bytes with two shapes of back
reference, a set bit standing for a byte away from the byte before the place written to and a clear bit for
one of the eight pixel offsets. Those two shapes are the first attempt's of the `0x01` and `0x03` walks
without the word form, and this walk tells its attempts apart by nothing but the bit it looks for.

Every one of the nine walks is ported, and together they read every way a section of this engine can say
its picture is packed:

* the `0x00` walk of the ways `0x00` and `0x08`: raw literal bytes, a three bit index into the table of
  pixel offsets, and a run the walk counts out for itself;
* the `0x01` walk of the way `0x01`: the same, with four shapes of back reference told apart by which
  attempt the walk is on, one of them a byte or a word away from the byte before the place written to;
* the `0x02` walk of the way `0x02`: the `0x00` walk's references with its literals taken from a table of
  codes;
* the `0x03` walk of the way `0x03`: the table of codes with the `0x01` walk's four shapes;
* the `0x04` walk of the ways `0x04` and `0x06`, and the `0x05` walk of the ways `0x05` and `0x07`: the
  prediction table with, behind it, the reference of the `0x00` walk and the four shapes of the `0x01` walk;
* the `0x09` walk of the way `0x09`: raw literals with the two shapes only the first attempt of the `0x01`
  walk reads;
* the `0x0B` walk of the ways `0x0A` and `0x0B`: the table of codes whose symbol is the byte written, with
  those same two shapes;
* the `0x0F` walk of the ways `0x0C` upwards: the table of codes whose symbols name a place in the
  prediction table.

The reference pads the first pixel of the `0x04` walk out to the next whole four bytes from **one byte** on,
where every other walk counts from nothing; that is the only difference between their openings, and it shows
only at a depth of four bytes to a pixel.

## Deviations from the reference

* Every read is bounded: a picture shorter than the size its head names, and a section reaching past the end
  of the file, are refused, where the reference would throw an end of stream error or keep zeros.
* A picture of no width or no height, and a depth the engine never writes, are refused.
* The decoded rows are padded to four bytes, while every bitmap writer of this project takes rows that stand
  one behind the other, so they are unpadded before the bitmap is written. The alpha merge walks by the pixel
  size and needs no such step.

## Verification

Twenty two tests build files with a mirror writer. The first eight: a stored picture of twenty four bits whose padded rows come out
of the bitmap without padding; a picture of thirty two bits whose alpha channel is spread over it (the byte
the picture keeps behind its colours is deliberately different, so a port that kept it would fail) and whose
second row of alpha starts where its own four byte stride says; a picture of thirty two bits with no alpha
channel, which is left alone; a picture of eight bits read through its colours, checked both in the decoded
table and in the bitmap, whose colours are turned round from red first to blue first; a picture of eight bits
without colours, read as shades of grey; a picture of sixteen bits, whose bitmap declares the five bit masks;
a packed section refused with the name of the walk it asks for, beside the same section declaring nothing
packed, which is read as it stands; and the refusals - the word of a sound, no head, a head too short, a
depth of twelve, no pixels, and pixels reaching past the file.

Fourteen further tests cover the packed walks, and the bit stream they build is the one the walks read: a reader
is checked on its own, handing out a byte's flags highest first and the literal bytes behind them; then a
picture of the `0x00` way whose bytes are all literals; then one of that way whose last byte is a back
reference, which takes the byte its own offset names; then a stream of clear bits, which the first two
attempts read as back references and only the third, whose own bit is clear, reads as literals, so the retry
machinery is pinned down as well; then a picture of the `0x01` way whose bytes are all literals, which shows
the two ways apart; and then a reference of that way in the shape only its first attempt reads, whose
distance of nothing copies the byte before the place it writes to - and then that byte again, twice over.
Then a picture of the `0x02` way whose table gives its first four symbols a code of two bits each, so the
table's own reading is pinned as well; then one of the `0x03` way through that same table with a reference
whose counted run is added to the run itself; then two of the `0x09` way, one for each of its two shapes of
reference; then one of the `0x0B` way, whose table's symbols are the bytes written; and then one each of the
`0x04` and `0x05` ways and one of the `0x0F`, whose expected bytes are worked out by writing the same
prediction table and the same move to the front out in the test itself.

What stands on the reference alone: the later attempts' shapes of back reference and the retry between
attempts, which no fixture here reaches - the ones the fixtures pin are the first attempt's byte form, a
counted run, the table of codes, and the prediction table's own walk; and no real file is on hand to compare
against GARbro's output.
