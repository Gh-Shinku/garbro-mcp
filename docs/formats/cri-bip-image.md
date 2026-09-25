# PS2 tiled bitmap (`BIP`)

Format reference: GARbro `ArcFormats/Cri/ImageBIP.cs` (`BipFormat`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture carries **no mark of its own**: every file of any extension is a candidate of the reference, and
the head of the picture tells whether the file is one of them.

## Head

A head of five or ten words, of which the second names the list of the tiles and the last one, less eight,
stands under every place of a tile:

| offset | field |
| --- | --- |
| 0 | the count of the words of the head (`i32`): 5 or 10 |
| 4 | the place of the list of the tiles (`u32`) |
| `kind*4 - 4` | the place under every place of a tile, less eight (`u32`) |

The list of the tiles stands at the place the second word names and in front of the places of the tiles.
The place under every place of a tile stands of the last word of the head plus eight, so a place of a tile
of nothing stands at the end of the head.

## The list of the tiles

The list holds a head and then a record of `0x1c` places for every tile of it:

| offset | field |
| --- | --- |
| 0 | the count of the tiles (`i16`, above nothing) and a word of nothing (`i16`) |
| 4 | a word the reference passes over (`i32`) |
| 8 | the width and the height of the picture (`u16` each, above nothing) |
| 0x0c | the first record of a tile |

| place of the record | field |
| --- | --- |
| 0 | eight places the reference passes over |
| 8 | the left and the top of the tile within the picture (`u16` each) |
| 0x10 | the width and the height of the tile (`u16` each) |
| 0x14 | eight places the reference passes over |
| 0x18 | the place of the stream of the tile, of the place under every place of a tile (`u32`) |

The box of the picture of the head is **grown** as the records are read: a tile whose left and width, or
whose top and height, stand past the box widens it, so the picture holds every tile of the list.

## The stream of a tile

The stream of a tile stands of a head of `0x7c` places and then a **portable network graphic**:

| place of the stream | field |
| --- | --- |
| 0 | the mark `PNGFILE2` |
| 0x18 | the count of the whole stream (`i32`), of which the head is taken off |
| 0x68 | a word that stands for the alpha of the graphic (`i32`) |
| 0x6c | the place of the tile within its own box (`i32` each, the left and then the top) |

The graphic stands of `count - 0x7c` places behind that head, and it is laid into the picture at the place
of the tile within the picture added to the place of it within its own box.

## The composition

The reference lays every graphic into a `Bgra32` surface of the Windows imaging stack, and every tile
**overwrites** the places of the picture it stands on. A place no tile stands on keeps the places of
nothing the surface was built of.

The alpha of a place stands of the word at `0x68` of the stream:

* where that word stands at nothing, every place of the graphic stands of a full alpha, whatever the
  graphic itself carries;
* where it stands above nothing, the alpha of the graphic stands of a place of one hundred and twenty eight
  of the place of two hundred and fifty five, with the places above the full one held to it.

The reference **swaps the first and the third place** of every place of the graphic before it lays it down,
which stands of the order the Windows imaging stack hands the places of a picture back in rather than of the
graphic itself: this port lays the places of the graphic over in the order its own walk of one hands them
back, which is the order of the places of the memory of the reference as well.

## Deviations

* A file whose head stands of another count of words, whose list of the tiles stands in front of the head or
  behind the places of the tiles, whose word of nothing is set, whose count of tiles or box stands at
  nothing, or whose list runs short of the file, is turned away, where the reference would read past the end
  of its own stream.
* A tile whose head stands past the end of the file, whose mark is not `PNGFILE2`, whose stream stands past
  the end of the file or is no graphic this project reads, is turned away rather than laid down short of
  itself.
* A tile whose places stand past the picture is held to it: the places of it within the picture are laid
  down and the ones behind that are passed over. The reference hands the box of the places of the graphic to
  its own surface, which holds them to the surface of the picture as well.
* A file of no mark is taken as a candidate of the lowest order, which is what the reference does with the
  formats whose mark stands at nothing.

## Tests

`tests/formats/cri-bip-image.test.ts` writes the portable network graphics of the tiles by hand, of the
places this test asks for, and pins the head, the list of the tiles, the box of the picture of the head, the
growing of that box to hold a tile that stands past it, and the turning away of a head of another count of
words, of a list that stands past the places of the tiles, of a word of nothing that is set, of a count of
tiles at nothing, of a box at nothing and of a file that stands short of its head.

The composition is pinned with a picture whose first graphic stands of four places and whose second one of
three, of the places of the memory of a picture (blue, green, red and the alpha): the places the fixture
asks for are the ones the composition turns out, the head of the tile that names no alpha stands of a full
one everywhere, and a graphic whose head names an alpha is pinned of the places of it within its own box and
of the alpha of a place of one hundred and twenty eight. A tile whose mark is not `PNGFILE2` is turned away,
and the bitmap of the format of a picture of four by three places is read back beside them.
