# 'Game System' character image format

Reference: `GARbro/ArcFormats/GameSystem/ImageCHR.cs`, classes `ChrFormat`, `ChrMetaData` and `ChrReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gamesystem/chr-image.ts` (`gameSystemChrImageDescriptor`,
`gameSystemChrImageFormat`, id `game-system-chr-image`, `readChrLayout`, `unpackChrRgb`, `readChrOverlay`,
`unpackChr`).

The head begins with the **length of the file itself** as a word, which is the whole of the format's own
check — no other file can carry it, so this format is tried after the ones with a signature of their own. The
size of the ran rows stands at four and has to be larger than the head, the width and the height stand at
eight and twelve and are kept within `0x8000` together with their offsets, and those offsets stand at
sixteen and twenty. The depth is always reported as thirty two bits, and the ran rows begin at `0x20`.

`ChrReader.UnpackRgb` walks a row at a time, a byte a step:

| control | what it does |
| --- | --- |
| below `0x7F` | one pixel that stands itself, of the three bytes behind it, with a fourth byte the control's own value doubled — the complement of `0xFE - 2 * ctl` |
| below `0x9F` | one pixel that stands and is then repeated as many times as the control says |
| `0xFF` | the row ends |
| anything else | as many pixels as the control says are passed over, leaving the zeros the picture was made of |

Where the ran rows end before the file does, the word there says whether a frame is drawn over them at all;
behind it stands a word that is not read and then the count of frames. The first frame carries its own place
and measurements, which are counted from the picture's own offsets and from its **bottom** edge, and its
pixels then stand as they are: three bytes and a fourth that is stretched over the whole byte from the `0x80`
the frame holds.

The rows are handed out **bottom up**, which is what `ImageData.CreateFlipped` means. The write path of the
reference throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a stream that ends inside a row, and a pixel or a frame
that reaches past the picture, are refused with messages of this project's own, where the reference would
read or write past its own array.

The tests cover the head and the word, measurements and offsets it is turned away for, pixels that stand,
are repeated and are passed over, the frame drawn over the rows it names, and a file that does not hold a
picture.
