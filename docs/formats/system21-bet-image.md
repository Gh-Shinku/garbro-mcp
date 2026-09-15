# System21 image format (BET)

Reference: `GARbro/Legacy/System21/ImageBET.cs`, class `BetFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/system21/bet-image.ts` (`betImageDescriptor`, `betImageFormat`, id
`system21-bet-image`, `readBetLayout`, `unpackBet`, `betBodyLength`).

The file carries no word of its own — the reference registers the word of nothing for it — so the format is
told apart by the **name** of the file, which must end with `.bet`; the same holds for the packed form of the
same picture, `system21-bet-szdd-image`. The header is ten bytes: the width and the height as long words and
the depth as a word behind them, which must be **eight or twenty four bits** and must measure between one and
`0x8000` either way.

Behind the header comes the colour map of two hundred and fifty six four byte entries — only for an eight bit
picture, and taken the way the reference takes it — and then the pixels, with **no padding** between the rows.
Every byte of those pixels is **turned over**, taken with `0xFF`; the colour map is left as it stands. The
reference hands the picture out with its rows **bottom up**, by `CreateFlipped`, and so it is written here
too, which the sign of the height in the bitmap records. A picture the file is cut short of — its pixels or
its colour map — is refused with `INVALID_ARCHIVE`, where the reference's own reading would throw, and a
picture above `0x10000000` bytes is refused with `LIMIT_EXCEEDED`. Nothing here writes the format.

The tests cover finding a picture by the name of its file, declining each depth and measurement the reference
does not read, what the header says about the picture, the pixels turned over with their rows bottom up, the
colour map kept as it stands, a picture cut short of its pixels or its colour map, the same picture behind a
stream of its own (`system21-bet-szdd-image`), and the ring of that stream starting one short of its end.
