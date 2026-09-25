# QLIE tiled PNG picture (`DPNG`)

Format reference: GARbro `ArcFormats/Qlie/ImageDPNG.cs` (`DpngFormat`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The picture starts with the mark `DPNG` and a word, and the places of the head name the count of the tiles
and the box of the picture:

| offset | field |
| --- | --- |
| 0 | the mark `DPNG` |
| 4 | a word the reference passes over |
| 8 | the count of the tiles (`i32`, above nothing) |
| 0x0c | the width and the height of the picture (`u32` each) |
| 0x14 | the first tile |

## The tiles

The list of the tiles holds, for every tile, a head of `0x1c` places and the stream of it:

| place of the tile | field |
| --- | --- |
| 0 | the left and the top of the tile within the picture (`i32` each) |
| 8 | the width and the height of the tile (`i32` each) |
| 0x10 | the count of the stream of the tile (`u32`) |
| 0x14 | eight places the reference passes over |

The stream of a tile of a count above nothing is a **portable network graphic** of its own, and the place of
the next tile stands of the count of that stream: the place behind the head of a tile plus its count. A
tile whose count stands at nothing names no stream and is passed over, and the tiles behind it stand at the
eight places of its head, which is what the reference does as well, since it reads every tile of the count
of the head and lets a tile of no places read the same head again.

## The composition

The reference lays every tile into a `Pbgra32` surface of the Windows imaging stack: the places of the
graphic of the tile with the colours of it multiplied by the alpha of it. Every tile **overwrites** the
places of the picture it stands on, of the places of the graphic itself rather than of the box the head of
the tile names, and a place no tile stands on keeps the places of nothing the surface was built of.

This port lays the places of the graphic over **as they stand** - of the alpha of the graphic where it
stands of one and of a full alpha everywhere else - so the bitmap it hands over is the picture the tiles
name rather than a surface of the places of a display, which a bitmap of its own cannot name.

## Deviations

* A picture of no width or of no height, of a count of tiles at nothing, or one whose mark is not `DPNG`,
  is turned away, where the reference would build a surface of no places.
* A tile whose stream stands past the end of the file, or one whose stream is no graphic this project
  reads, is turned away rather than laid down short of itself.
* A tile that stands past the picture, of the places of its graphic, is held to the picture: the places of
  it within the picture are laid down and the ones behind that are passed over. The reference hands the box
  of the places of the graphic to its own surface, which holds them to the surface of the picture as well.

## Tests

`tests/formats/qlie-dpng-image.test.ts` writes the portable network graphics of the tiles by hand, of the
places this test asks for, and pins the count of the tiles, the box of the picture and the place of the
stream of a tile.

The composition is pinned with a picture of four by three places whose first tile is a graphic of four
places of an alpha of its own and whose second one is a graphic of three places, of a full alpha added to
it: the places of the memory of a picture are blue, green, red and the alpha, so the places the fixture
asks for are the ones the composition turns out. The last tile reaches the corner of the picture, which
pins the places held to it, and a tile that names no places pins the passing over of it. The bitmap of the
format of a picture of four by three places is read back beside them.
