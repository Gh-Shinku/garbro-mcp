# 'GameSystem' background image

Reference: `GARbro/ArcFormats/GameSystem/ImageBGD.cs`, class `BgdFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gamesystem/bgd-image.ts` (`gameSystemBgdImageDescriptor`,
`gameSystemBgdImageFormat`, id `gamesystem-bgd-image`, `readBgdLayout`).

The reference registers this format under no word at all, and what decides is the **length**: the word the
file opens with is the length of everything behind the header, so a background has to be exactly as long as
it says it is. Behind it sit the width and the height, neither of which may be nothing or more than 32768.
The picture is always twenty four bits to a pixel.

The pixels are a **difference** from what the picture held before, four bits to a colour, and every three
bytes of the stream hold **two pixels** — six nibbles in all. The reference keeps three states, one to a
colour, which start at one and name which of three bands of differences the next nibble is read from; the
nibbles of the second pixel are read from the band the nibble of the first one moved its colour into, and
then each state falls back to that band for the next op. The nibbles are read from the op in this order:

| bits | colour |
| --- | --- |
| 0 | blue of the first pixel |
| 4 | green of the first |
| 8 | red of the first |
| 12 | red of the **second** |
| 16 | blue of the second |
| 20 | green of the second |

The bands themselves are the reference's own tables: the first eight differences of a band rise and the eight
behind them fall, and the second band's are twice the first's, so the same nibble means a different step in a
different band. A background of an odd number of pixels has one pixel more than its ops write, and the
reference leaves it as it was, which is where the zero pixel of such a picture comes from. The rows are the
other way up for a bitmap, which the reference's own flipped image means, so the bitmap written here carries
a positive height and the rows as the stream gives them.

A file cut short of the ops its measurements need is refused with `INVALID_ARCHIVE`. Nothing here writes the
format.

The tests cover finding a background as long as its own word says and declining one whose word does not
account for it or whose side is nothing, the measurements it reports, a picture whose nibbles are all nothing
pinned against numbers counted by hand, the order the six nibbles are read in, a whole background of ops, the
pixel left over of a background with an odd count, and a background cut short of its ops.
