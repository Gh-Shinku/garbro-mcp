# Zyx tiled image format

Reference: `GARbro/ArcFormats/Zyx/ImageSPL.cs`, classes `SplFormat`, `SplReader` and `Tile`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/zyx/spl-image.ts` (`zyxSplImageDescriptor`, `zyxSplImageFormat`, id
`zyx-spl-image`, `readSplLayout`, `unpackSpl`).

The reference declares no signature and gates on nothing else, so any file may be a candidate and the head is
what tells a picture apart from anything else. The head begins with a **signed** word of tiles, of which none
to two hundred and fifty six is allowed; each tile is four signed words — its left, top, right and bottom
edges — of which the left and top may not stand before the start of the picture and the right and bottom must
stand behind their own left and top. Behind the tiles stand the width and the height of the picture as signed
words, both of which must be positive, and every tile must lie inside the picture. The depth is always
reported as twenty four bits. The tiles are carried into the entry and archive metadata; the reference reads
them but never uses them itself.

The walk behind the head is a command byte and then its payload:

| byte | what it does |
| --- | --- |
| `0` | the byte behind it is a count of repeats of the pixel before the run |
| `1` | the byte behind it is the count and the byte behind that the distance in pixels; a whole run is copied |
| `2` | the count is the byte behind the command and the distance the word behind it; a whole run is copied |
| `3` | the byte behind it is the distance in pixels; one pixel is copied |
| `4` | the word behind it is the distance in pixels; one pixel is copied |
| five and above | three times the byte less four is a run of pixels that stand in the stream themselves |

Every run of whole pixels is copied a byte at a time, so a run whose distance is one repeats the pixel before
it. A command that reaches outside the picture is refused, which the reference's own array reads and writes
answer with an exception (a documented deviation in the message only). A run of pixels that stands in the
stream itself reads as much as the stream still holds, leaving the rest of it as nothing, which is how a
region behaves for the reference, and a stream that stops where a command is wanted ends the walk.

The tests cover a head of two tiles and its measurements, the declines of too many tiles, of a negative count,
of a tile whose edges do not describe an area, of a tile outside the picture and of a picture of no size, the
measurements and the tiles the port reports, a picture written out again twenty four bits a pixel, a head that
is not all there, and of the walk itself a run of pixels that stand in the stream, a repeat, a copy of whole
pixels, the wider counts and distances of the second and fourth kinds, the refusal of a command that reaches
outside the picture, and a stream that stops before the picture is whole.
