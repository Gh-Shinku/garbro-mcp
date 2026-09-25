# MAGES engine composite image (`LAY/MAGES`)

Format reference: GARbro `ArcFormats/NitroPlus/ArcLAY.cs` (`LayOpener`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The file of the engine is not a picture of its own: it is an **index of places** into a graphic that stands
beside it, and every layer of it is a list of tiles of that graphic.

## Head

| offset | field |
| --- | --- |
| 0 | the count of the layers (`i32`, above nothing and below `0x40000`) |
| 4 | the count of the places (`i32`, of the same count) |
| 8 | a record of twelve places for every layer |

| place of a record | field |
| --- | --- |
| 0 | the word of the layer (`u32`) |
| 4 | the first place of its tiles within the list of the places (`i32`) |
| 8 | the count of its tiles (`i32`) |

Behind the records stands the list of the places, of sixteen places each: four **single** places - the place
of the tile within the picture of the engine, then the place of it within the graphic, of one taken off the
two places of the graphic.

The reference takes a file of any mark as a candidate and stands of the **extension** of its name alone: a
file whose name does not end in `.lay` is turned away before its head is read.

## The graphic beside the index

The graphic stands beside the index under the base name of it - the name of the file less its extension and
less every place of an underline behind it - and the extension `png`. This project reads the graphic with
the walk of the places of a portable network graphic (`shared/png-image.ts`) and finds it with the lookup of
a companion beside a file (`shared/companion.ts`). A graphic that stands nowhere beside the index is what
the reference gives up on as well, so an index of no graphic is not taken as a picture of this engine.

## The picture of a layer

The picture stands of **1920 by 1080 places**, of the places of nothing behind every tile of the layers of
it, and the middle of it - 960 by 540 - is the place of nothing of the index.

Every tile is a crop of **thirty two by thirty two places** of the graphic, cut out of the whole places of
the place of the index, and laid down at the place of the index within the picture of the engine added to
the middle of it. A place of the index taken as a whole place is **rounded towards nothing**, which is what
the reference does with the places it cuts out, and the places it lays a tile down at are taken as whole
places here as well: the reference hands the fractional places to the drawing engine of its own, which reads
the places of a tile over the places behind them of its own walk, and this port takes the whole place of
them.

A crop that stands past the graphic is passed over by this port, where the reference would have the drawing
engine of its own turn the file away.

## The layers behind the layer asked for

When the engine asks for one layer of the index, the reference lays down, in this order:

1. the layer of the word **one**, unless that is the layer asked for;
2. the layer of the **face**, for a layer whose top place stands at four: a layer of the word
   `((word >> 8) & 0xF) | 0x20000000`, or the word in front of that one where the first stands nowhere;
3. the layer asked for.

## The blend

Every tile is laid over the places of the picture of the source over it: a place of a tile of a full alpha
takes the place of the picture, and a place of none leaves it. The reference lays every tile into a
`Pbgra32` surface, i.e. of the colours of a place multiplied by its alpha; this port walks the same blend in
the places of it as they stand - the colours of the place over the colours behind it, of the alpha of each
of them - and hands a bitmap of the colours as they stand rather than a surface of a display.

## Tests

`tests/formats/nitroplus-lay-image.test.ts` writes a graphic of four blocks of thirty two by thirty two
places by hand - one of each of three colours and one of half an alpha - and an index of three layers that
names them: the layer of the word one, the face and the layer the engine asks for. The graphic stands of the
red place first, which is the blue place of the picture of this project, so the places the fixture asks for
are the ones the picture turns out.

Pinned: the head, the four places of a place of the index, the turning away of an index of no layers, of a
count of places above `0x40000`, of a list of places that stands past the file and of a file that stands
short of its head; the base name of an index of a trailing underline, of a name behind a directory and of a
name of no extension.

The picture is pinned of the layer of the word one alone (the red block at the middle), of the draw order of
the three layers, of the face behind the layer asked for (the green block, one block behind the middle) and
of the layer asked for over the red one: the block of half an alpha of white over the red block of the base
turns out `128, 128, 255` of a full alpha, which is half of each of them. The bitmap of the format is read
back beside them, and an index whose graphic stands nowhere beside it, and one whose name does not end in
`.lay`, are turned away.
