# GameSystem CG image format

Reference: `GARbro/ArcFormats/GameSystem/ImageCGD.cs`, classes `CgdFormat` and `CgdReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gamesystem/cgd-image.ts` (`gameSystemCgdImageDescriptor`,
`gameSystemCgdImageFormat`, id `game-system-cgd-image`, `readCgdLayout`, `unpackCgd`).

The reference declares no signature word: the **first word of the file is the file's own length**, or that
length less the sixteen bytes of the head, and that is what tells the picture apart. The width and the height
stand at four and eight as words and both must lie between one and `0x8000`. The depth is always reported as
twenty four bits.

The pixels are a walk of colour steps that stand on three accumulators, one a channel, which begin at nothing:

| control byte | what it does |
| --- | --- |
| below `0x80` | the word of the control above the byte behind it names an entry of the colour table; the three **signed** channels of that entry are added to the colour as it stands and the sum is the next pixel |
| `0x80` to `0xBE` | the colour as it stands is repeated, one more time than the control says less `0x80` |
| `0xFF` | the walk ends where the picture still stands |
| `0xBF` and above, but not `0xFF` | three times the control less `0xBF` bytes stand in the stream themselves; they are the next pixels and the colour the walk goes on from |

The colour table holds `0x8000` entries of three bytes, blue, green and red, each channel five bits wide with
its highest bit as the sign, so a channel above fifteen is its own value less thirty two. Every sum is held to
eight bits, which is what the reference does by writing the accumulator through a byte. A command that writes
past the picture is refused, which the reference's own array write answers with an exception (a documented
deviation in the message only). The write path of the reference throws `NotImplementedException`, so this is a
read only format.

The tests cover a head that declares the file's own length and one whose declared length leaves the head out,
the declines of a wrong length and of measurements outside the range, the measurements the port reports, the
walk of signed colour steps and the repeat behind them, the pixels that stand in the stream themselves and the
colour the walk goes on from, the delimiter, and a command that writes past the picture.
