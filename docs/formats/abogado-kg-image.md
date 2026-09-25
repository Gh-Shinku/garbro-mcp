# AbogadoPowers image

Reference: `ArcFormats/Abogado/ImageKG.cs`, class `KgFormat` with the `KgReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `abogado-kg-image`
(`packages/formats/src/abogado/kg-image.ts`).

## The word and the head

The picture opens with `KG` and **two** version bytes: the reference lists four words - the third byte either
nothing or two, the fourth either one or two. The fourth byte is what names the depth of the picture: two
stands for three channels of a byte each, anything else of the two listed for one channel, so the picture is
twenty four bits or eight. The head holds the size, the place of the colour map of an eight bit picture and
the place the channels begin, and a head whose third byte is two also names where the alpha channel stands.

## A channel

Every channel is a walk over one **shared** bit stream - the channels stand one behind the other in it, and the
dictionary each of them predicts from stands as it starts - and every channel fills one byte of every pixel:
the first channel the first byte of the picture's own order, the second the one behind it, and so on. The
reference declares the picture as `Bgr24`, so the channel read first is the blue one.

A channel draws its first two bytes as they are, and behind them every step is one of two things:

* a **byte of its own**, which either stands whole behind the control or comes out of a dictionary: eight
  entries to every byte written so far, named by three bits, and the dictionary starts as the eight bytes of
  its own index - so the first entries of the byte nothing name nothing, one, two and so on;
* a **run** copied from one of five places, named by a code of its own: the row behind, the two neighbours of
  the byte above, two pixels back and one pixel back. Its length comes out of four widths: two bits, then four
  bits and three, then eight and then sixteen, with a length of every bit of two words standing behind that.

A byte that is drawn - whole or out of the dictionary - is moved to the front of the list of the byte before
it, which is what the dictionary of the next step predicts from.

## The picture

An eight bit picture carries its colour map in front of its channels, and the map stands as the file stores
it, four bytes to a colour with the blue first - which is the order a bitmap keeps it in, so nothing is
exchanged. A picture that names an alpha channel is drawn as four bytes to the pixel: its colour channels
spread out into the wider steps first, and the alpha channel then walks the stream that stands at its own
place - the reference resets its stream before reading it - into the fourth byte of every pixel.

Two details of the reference are kept as they stand. The picture is built **flipped**, so the channels reach a
bitmap from the bottom up. And a picture whose alpha channel cannot be read is handed over **without** it,
since both ways hand over four bytes to the pixel: what is lost is the alpha alone.

## Deviations from the reference

* Every read and every run is bounded by the file and by the picture, where the reference reads and writes
  past both.
* A run longer than sixteen million bytes is refused, since the reference reads its length out of up to
  thirty two bits and would walk the picture for as long as it names.

## Verification

Six tests over synthetic fixtures (`tests/formats/abogado-kg-image.test.ts`): the three channels of a picture
of twenty four bits, each filling its own byte of every pixel; a byte predicted out of the dictionary of the
one before it, pinned on the dictionary as it starts; runs copied from three of the five places; the colour
map of an eight bit picture; the alpha channel drawn into the fourth byte with a picture whose alpha cannot
be read handed over without it; and the word, the place and the depth the format turns away.
