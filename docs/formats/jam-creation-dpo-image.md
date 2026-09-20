# Jam Creation tiled image format

Reference: `GARbro/ArcFormats/JamCreation/ImageDPO.cs`, classes `DpoFormat`, `DpoMetaData` and `DpoReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/jam-creation/dpo-image.ts` (`jamCreationDpoImageDescriptor`,
`jamCreationDpoImageFormat`, id `jam-creation-dpo-image`, `readDpoLayout`, `composeDpo`), with the bitmap
readers and writers of `packages/formats/src/shared/bmp.ts` and the companion file reader of
`packages/formats/src/shared/companion.ts`.

The reference registers the word `Divided Picture` and no name at all.

## The head

The file begins with that word, the word at `0x10` is one and the word at `0x14` is the shape of the picture —
one or two. The words behind them say where the shape of the canvas stands (`0x18`), how many names stand
behind it (a count of at least four at `0x1C`), where the names stand (`0x20`) and how large the table of them
is (`0x24`), and where the layout of the tiles stands (`0x28`). The shape of the canvas is two words of two
bytes; a name of the table is thirty two bytes wide and the table says how many of them stand there, the size
of the table standing at four bytes for every name and the two bytes of the count. A name that begins with
`.\\` stands beside the file itself.

## The tiles

The layout begins with how many tiles stand there and how many places of its picture a tile of the first shape
takes. Every tile then names eight shares of four bytes, which picture beside the file it stands in, where it
stands on the canvas, and — for the second shape of the picture — how many places of its picture it takes; the
shares of the left and the top edge of its picture are the first and the fifth of the eight, and they are
shares of the width and of the height of the picture.

Every tile stands in a picture beside the file, which the reference reads with the reader of whatever kind the
picture is and walks out into places of four bytes apiece. A tile of the first shape takes a square of as many
places as the layout names; the tile is taken from its picture where the shares say it stands, and what stands
beyond the canvas is left out.

What is handed out is a bitmap of four byte places: the canvas, with every tile in its place and every place
no tile reaches standing as nought.

## Deviations from the reference

- The reference reads a tile with whatever reader its own catalog knows; the port reads a bitmap and turns any
  other kind of picture away.
- The reference hands its tiles to the platform, which keeps the shape of a place where the picture carries one
  and stands for a whole one where it does not; the port walks a tile into four byte places with the same shape
  of a place, which `toBgra32` carries where its caller asks for it.
- A file of fewer than forty eight bytes, a file whose word is not `Divided Picture`, a file whose word at
  `0x10` is not one, a file of a shape other than one or two, a table of names whose size does not stand at
  four bytes for every name, a tile naming a picture the table does not hold, and a canvas of no places or of
  more places than this project will hold are turned away; the reference would throw while reading its head.
- A slice of the file that does not stand in it, a tile that reaches beyond its own picture, a tile whose
  places are wider than the room the layout gives a tile, and a tile that stands beyond its canvas are refused
  with a message, where the reference reaches beyond its own arrays or asks the platform to.
- A picture whose tiles do not stand beside the file is refused while a tile is handed out; the reference
  throws wherever it looked for them.

## Tests

`tests/formats/jam-creation-dpo-image.test.ts` covers the head of both shapes of the layout, a file whose word
is not that of the engine and the four heads it is turned away for, a name table that does not stand in the
file, the standing of the tiles of a picture on its canvas with its four byte places, what stands beyond the
canvas, a tile that reaches beyond its own picture, a picture whose tiles are taken from beside the file, and a
no tile reaches stand as nought.
