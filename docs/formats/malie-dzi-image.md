# Malie tiled picture descriptor (`DZI`)

Format reference: GARbro `ArcFormats/Malie/ImageDZI.cs` (`DziFormat`, `DziMetaData`, `DziTile`), GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The file is a **text descriptor** rather than a picture: the picture of the engine stands of the tiles of a
`tex` directory beside the descriptor, of 256 places a tile. The reference hands every tile over to whichever
format of its registry reads it and stands the places of it in a picture of the counts of the head.

## The lines of the descriptor

```text
DZI                     the word of the format, of the place of the walk of the line behind it
<width>,<height>        the counts of the picture
<count>                 the count of the levels of the tiles
<block_w>,<block_h>     the counts of the places of a level (the count of the lines behind it)
<name>,<name>,…         the tiles of a line of the level, of a place of 256 places a name
```

The counts of a line stand of the head of it alone (`^(\d+),(\d+)`), so a line of places behind them stands
of no walk of its own. A level of the tiles stands of the lines of it: the tiles of a line stand of the
places 0, 256, 512 … of it, **of a place of no name as well**, and the lines stand of the places 0, 256, 512 …
of the picture. The reference stands of the **first** level of the tiles and parses the levels behind it into
the metadata alone; this port does the same, and the levels behind the first stand reported rather than read.

## The picture of the tiles

| place | field |
| --- | --- |
| the tile of a name of a line | the first file of the `tex` directory beside the descriptor whose stem stands of that name, of any extension behind it |

A tile of the two kinds this project reads out of a file of its own — a bitmap and a portable network graphic
— stands in the picture, of four places a colour; a tile of a picture of three places a colour stands of an
alpha of the picture behind it, the way the reference converts its own tile to the kind it draws it in. A
tile of another kind (a `jpg` and its like) is refused, because the reference reads such a tile through a
codec this project holds no walk of.

The places of the picture of the head stand of the counts of the head, of a tile standing past those places
of no place of it at all (the reference refuses such a place rather than standing over it, which is the one
place this port steps over rather than follows). The picture itself is **cropped** to the places the tiles
reach, so the picture of the walk stands of the places the tiles cover where they cover less than the counts
of the head; the counts of the head stand in the metadata of the file.

## Deviations

* A tile of a kind the project reads no walk of stands refused (`UNSUPPORTED_FEATURE`) rather than handed
  over to a codec, which the reference reaches through a library.
* A descriptor stands of this engine only where the `tex` directory of it stands beside it, which is what the
  reference asks of its file system as well; a file of no tile line at all, of no count of the frames of the
  head, and of a count of them of nothing, stands turned away.
* A tile that stands nowhere, and a picture whose tiles stand of no place of it at all, stand refused rather
  than handed out as a picture of no places (the reference refuses both as well, of an exception of its own).
* A tile whose places stand short of the picture of it, or whose kind stands of no walk this project holds,
  stands of no picture rather than of a failure of the port.

## Tests

`tests/formats/malie-dzi-image.test.ts` builds a descriptor of a picture of four places by two, of a tile of
two by two at the head of it: the walk of the lines stands pinned (the places 256 apart of a line, of a place
of no name of its own), the places of the tile of a portable network graphic stand in the places of the
picture (of the places of the colour of the engine the other way round, which is what the reader of the tile
hands over), and the picture of the walk stands cropped to the two places by two of the tile where the counts
of the head stand of four by two. A bitmap of three places a colour stands beside it, of an alpha of the
picture behind it, and a tile of a kind of its own, a descriptor of no tiles beside it and a descriptor that
stands short of the lines of a level are pinned as well.
