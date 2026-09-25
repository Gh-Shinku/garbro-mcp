# ShiinaRio image (MI4)

Reference: `ArcFormats/ShiinaRio/ImageMI4.cs`, class `Mi4Format` with the `Reader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `shiina-rio-mi4-image`
(`packages/formats/src/shiina-rio/mi4-image.ts`), beside the other pictures, sounds and archives of the same
engine.

## The head

The picture opens with its own word, then the places of its width and its height, every one of them a long
word, and its places stand behind them.

## The bits of a picture

The walk of the picture reads a word of **four bytes** at a time and takes its bits from the **highest** of
them down: the reader lays the bytes of a word one behind the other from its lowest one up and takes its
highest bit first, which is the same as reading a word the other way round with its highest bit in front. A
word the file does not hold in full stands as it does, the rest of it nothing, so a picture whose bits run out
is drawn out of nothing rather than turned away.

## The two walks of a picture

A place of the picture is drawn out of B, G and R, every one of them a byte that is carried from the place
before it. The first bit of a place tells whether it is drawn at all; the bits behind it name one of five
ways:

* a place of its own, whose three bytes are read out of the file itself, behind the word the bits stand in;
* a run of two bits over each of the three bytes, smaller by one - and a run of every bit set naming the place
  **above** the one the walk stands at;
* a run of three bits, smaller by three - a run of every bit set naming the place above as well, the second
  walk adding the runs of the three bytes to it and the first walk standing there;
* a run of four bits, smaller by seven - the first walk naming the place above and to the **left** of the walk
  when its run stands every bit set, the second walk standing there;
* a run of five bits, smaller by fifteen.

The second walk of the picture reaches further in its second way as well: a run that does not stand every bit
set carries on into a second run of two bits, and one that does names one of the two places beside the place
above the walk - to its left when a bit is set and to its right when it is not.

The reference draws a picture with the **second** walk of its own and, if that walk stands short of what the
file holds, draws it again with the first - the second walk standing over a file that ends where it does
rather than reading past it, which is where the two of them part.

## Deviations from the reference

* Every read is bounded by the file and by the picture; a place copied from outside the picture is turned away
  rather than read out of whatever stands beside it.

## Verification

Seven tests over synthetic fixtures (`tests/formats/shiina-rio-mi4-image.test.ts`): the head and the pictures it
turns away; a place of its own read out of the file behind the word of its bits; a run of five bits over every
one of the three bytes of a place, over four places of a picture; a run of four bits naming the place above and
to the left of the walk, in the first walk of the picture; and a picture whose second walk stands short - the
second walk reading the bits of a run as a place of its own and then reaching for the place above a picture of
one place, where the first walk reads the same bits as the runs of the other two bytes, so that the reference
draws the picture again and this port does the same.

The fixtures write the bits of a picture the way the reader reads them: the bits of a word in front of the
bytes it stands in, from its highest one down.
