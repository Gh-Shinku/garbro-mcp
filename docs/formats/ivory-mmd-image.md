# Ivory image format, the line kind

Reference: `GARbro/ArcFormats/Ivory/ImageMMD.cs`, classes `MmdFormat` and `MmdMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ivory/mmd-image.ts` (`ivoryMmdImageDescriptor`, `ivoryMmdImageFormat`, id
`ivory-mmd-image`, `readMmdLayout`, `decodeMmd`, `readMmdPalette`).

The signature word the reference declares is `0x1A444D4D`, the four bytes `MMD\x1A`, and it declares no
extensions. The header is twenty four bytes:

| offset | what it holds |
| --- | --- |
| `0x04` | the width |
| `0x06` | the height |
| `0x08` | how many bytes hold the bits of the line |
| `0x0C` | where the bytes the bits stand for end, so that there are that many less the count above of them |
| `0x10` | how far behind the pixels the colour map stands |
| `0x14` | how many entries the colour map holds |

The first length has to hold something, the second has to stand behind the first and the third has to hold
something as well, or the picture is turned away; a picture of no width or height and a colour map of fewer
than no entries are turned away too, the second of which the reference would throw on where it reads the map.

The picture itself is a line of one byte for every four pixels of a row — a width that is not a multiple of
four leaves the pixels behind the last whole four of every row undecoded, and the rows behind the first one
skewed by as much, since the reference counts the line in whole fours. Behind the line stand the bits that say
which of its bytes change and the bytes they change by, taken one after another as the bits ask for them and
laid over the line as it stands, so a line byte is everything that has been put on it so far; the bits walk
from the highest downwards and do not start over at a row. Every line byte then holds two nibbles, the high one
first, each of which says how a pair of pixels is made: a nibble of nothing reads the two pixels out of the
stream, and any other nibble copies them from a pair behind, which the two halves of the table of the reference
give as rows above and pairs along — a nibble of one is the pair behind, one of four the pair above, and one of
sixteen rows above. A copy that reaches before the start of the picture is refused, as is a line whose bits or
whose changes run out, where the reference's own reader would run past them; the pixels the stream does not
hold stand at nothing, since the reference reads as many as are there.

The colour map stands behind the pixels, of as many entries as the header says up to a whole one of two hundred
and fifty six, three bytes each of which the first is red, the second green and the third blue; the map is
written out in the order a bitmap wants it, and a map the file does not hold all of is refused, where the
reference's own reader throws. The write path of the reference throws `NotImplementedException`, so this is a
read only format, and a picture whose pixels would take more than 256 megabytes is refused.

The tests cover the four bytes of the signature, the declines of a line of no length, of one whose second
length does not stand behind the first, of a colour map of fewer than no entries, of a picture of no width or
height, of a signature a byte away and of a header that is not all there, the measurements reported for the
picture, a picture whose line asks for nothing, a picture whose bits change its line and whose nibbles copy
pairs from behind it both straight and along a row, the colour map written out with the red byte first, the
refusals of a copy from before the start of the picture, of a line whose bits or changes run out and of a colour
map the file is short of, a picture too large to hold, and the line of a picture read on its own.
