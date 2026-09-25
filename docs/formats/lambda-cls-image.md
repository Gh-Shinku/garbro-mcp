# Lambda engine texture

Reference: `ArcFormats/Lambda/ImageCLS.cs`, class `ClsFormat` with the `ClsReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `lambda-cls-image`
(`packages/formats/src/lambda/cls-image.ts`).

## It shares its word with the archive of the same engine

`ArcFormats/Lambda/ArcCLS.cs` - the `DAT/CLS` container of this engine, already ported as `lambda-cls` - opens
with the same `CLS_` word and is told by a record list rather than by this head, so the two are told apart by
their order: the container stands first and this format behind it, and a caller that knows a file holds one
texture asks for this one by name.

## The head

The texture opens with `CLS_TEXFILE`. The head names a place at 0x14, and the double word **at** that place
names the frame - so the place of the frame is named in two steps. The frame's own head holds the version,
which has to be one, the width and the height, the place the picture stands at on a larger canvas, whether its
channels are packed, and a byte that names the depth: 2 for eight bits, 4 for twenty four and 5 for thirty
two, anything else being turned away.

## The channels

The channels of the picture stand at their own places, read at 0x48 of the frame with their lengths at 0x58 -
every one of them **counted from the frame**, as the reference's own `SetPosition` counts them. A picture of
eight bits carries its colour map at 0x68: where it stands and how long it is, four bytes to a colour, red
first as the reference reads it.

Three ways of storing the channels stand apart:

* **One channel**, which is the eight bit picture: the colour map and then the plain channel behind it.
* **Unpacked channels of more than one**: the reference hands the **first** channel's block over as it stands,
  drawing nothing together, so the whole picture is expected to stand in that one block. This port refuses a
  block shorter than the picture the head names, where the reference's own picture would come out short.
* **Packed channels**: a word of two bytes, read **most significant first**, names the way - nothing for rows
  that stand as they are, one for packed rows, anything else being refused by name.

A row that stands as it is takes `length / height` bytes, and when that is narrower than the picture the rest
of the row is left as it was. Every channel of a picture shares **one** such place, so what one channel leaves
behind is what the next one reads - which the tests pin.

A packed channel cuts its rows into chunks, and their lengths stand **first**, one after another, with the
bodies of the chunks behind them; the reference's own walk shows as much, since it reads a length and then
steps on by two bytes alone while counting the body into the length of the channel. The lengths of the first
`height` chunks are kept and those alone are unpacked, so the bodies behind them are never read. A row is
packed with two kinds of run: a count of bytes that stand as they are and a count of one byte written over and
over. A row the runs do not fill is filled with nothing, and a run that reaches past the picture is refused
rather than writing past it.

Every channel lands in its own byte of a pixel - red first, then green, then blue, and the fourth where the
reference puts it - which is the order a bitmap holds.

## Verification

Eight tests over synthetic fixtures (`tests/formats/lambda-cls-image.test.ts`): the three channels of a packed
picture drawn into their own bytes, a row narrower than the picture and the place the channels share,
chunk lengths that stand in front of their bodies with the bodies past the picture's height never read, two
kinds of run with a row filled with nothing, an unpacked picture handed over whole, the colour map of a
picture of eight bits, the depths, the version and the method the reference turns away, and a picture of
thirty two bits as four channels. Two of those tests caught the port reading the frame's own places as though
they were counted from the file rather than from the frame.
