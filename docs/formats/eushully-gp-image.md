# Old Eushully graphic (GP)

Reference: `ArcFormats/Eushully/ImageGP.cs`, class `GpFormat` with the `GpReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `eushully-gp-image`
(`packages/formats/src/eushully/gp-image.ts`), beside the other pictures and archives of the same engine.

## The head

The picture writes no word of its own and carries no extension of its own either, so a caller has to name it -
the extension of the reference is one it made up. Its head names whether it carries an alpha channel, the way
it is drawn (a picture of the places themselves, of a colour map, or of slices), the length of the elements of
a slice and how many places one of them holds, its depth, the length of its colour map, and then the places of
the picture itself.

## The three ways of drawing a picture

* **the places themselves**: three bytes to a place, handed over the other way round as a bitmap keeps them;
* **a colour map**: the colour map first - three bytes to a colour, red, green and blue - and then either the
  places of the picture as one byte each, when the depth is eight bits and the picture carries no alpha
  channel, or **elements** of the places, every element holding as many places as the head names, of as many
  bits as the depth of the picture names, and every place of them a colour of the map;
* **slices**: the colour map, the two colours the slices draw behind their places, the length of the slices
  themselves, and then a slice after a slice: how many places stand behind the ones it draws - the highest bit
  of that length naming which of the two colours stands behind them - and how many places it draws in front,
  as elements of their own.

Of a colour map the places are read the other way round from the way the reference's own viewer holds it: the
third byte of a colour comes first, so a picture of a colour map handed to a bitmap is the mirror of one
handed over as eight places to a byte. Both stand as they do in the reference.

## The alpha channel

A picture that carries an alpha channel keeps it behind its places: the places of the picture it belongs to,
then a length and a count of places at a time. A picture whose alpha channel names places other than its own
carries none, and the reference hands it over without one.

## Deviations from the reference

* Every read is bounded by the file, and the places of a run that reach past the width of the picture are not
  drawn; the reference reads past both.
* A picture that names no places of an element, or no places of a slice, is refused where the reference would
  walk it for ever.
* Writing a picture is not implemented, as in the reference.

## Verification

Seven tests over synthetic fixtures (`tests/formats/eushully-gp-image.test.ts`): the head and the pictures it
turns away; the places of a picture that stand as they are, both as the walk hands them over and as a bitmap
holds them; a picture of eight places to a byte, with the colour map of a bitmap around them; elements holding
two places each, of a colour map read the other way round; a slice naming the places behind it and the places
in front of it, of a colour counted from the end of the colour map; a picture told by the shape of its
head alone; and both the alpha channel of a picture that carries one - with the picture whose alpha channel
names places other than its own, which carries none - and the colour map of one that stands eight places to a
byte, handed over as a bitmap with the colour map of the file around it.
