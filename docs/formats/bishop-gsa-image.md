# Bishop image (GSA)

Reference: `ArcFormats/Bishop/ImageGSA.cs`, class `GsaFormat` with the `GsaReader` beside it. The bits of a
picture are read by GARbro's own `ArcFormats/BitStream.cs`, an `LsbBitStream`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `bishop-gsa-image`
(`packages/formats/src/bishop/gsa-image.ts`), beside the other pictures and archives of the same engine.

## The head

The picture writes a word of its own, and its head then stands far behind it: the kind of the picture, the
places of its width and height, and where it stands inside the screen it was drawn on. A picture of the plain
kind stands three places to a byte, one of the deepest kind four, with its alpha channel in front of them.

## The bits and the blocks of a picture

The bits stand in bytes, and of every byte the **lowest** bit comes first. A picture is drawn as blocks of two
places by two, and its planes stand one behind the other; of every block three bits name one of eight ways: the
places themselves - of six, of seven or of eight bits - or a run of its own added to the places of the block
**beside** it, or of the block two rows **above** it, or the block beside it standing as it is.

A picture of the deepest kind spreads the places of its colour over the whole of a byte, five bits of the first
of them and six of the other two.

## The parts of a picture

A picture whose name ends as a part of one - two places, a one or a nothing and another place - is drawn over
the picture of the same name beside it, every place of it by as much as its own alpha channel names; a part
that stands no picture beside it stands as it is, and so stands one whose drawing fails.

## Deviations from the reference

* Every read is bounded by the picture; a block drawn out of the picture itself is turned away where the
  reference reads past it.
* Writing a picture is not implemented, as in the reference.

## Verification

Three tests over synthetic fixtures (`tests/formats/bishop-gsa-image.test.ts`): the head and the pictures it
turns away; the places of a picture themselves, three of them to a place, both as the walk of it draws them and
as a bitmap holds them - which pins the bits of a picture and the turning about of the reference; and a picture
told by the word it opens with.

The runs of a block other than the places themselves, the places of the deepest kind spread over the whole of a
byte, and the drawing of a part of a picture over the picture it belongs to stand in the port as they stand in
the reference, but no fixture of them was finished here: their fixtures did not tell the two readings apart, so
they stand among the places still to be verified of the record of this format rather than among the tests.
