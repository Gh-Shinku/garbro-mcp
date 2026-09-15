# Forest image format

Reference: `GARbro/ArcFormats/ShiinaRio/ImageCHD.cs`, classes `ChdFormat`, `ChdMetaData` and `ChdReader` — the
predecessor of the ShiinaRio pictures. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/shiina-rio/chd-image.ts` (`shiinaRioChdImageDescriptor`,
`shiinaRioChdImageFormat`, id `shiina-rio-chd-image`, `readChdLayout`, `chdPixelLength`, `unpackChdRows`).

The reference registers `'CHD\0'` and declares no extension. Behind the signature stand two words, of which
the first is a count of index words that must fit in twenty bits and the second is skipped; the index holds the
place of the picture, and the reference takes the **first word that is not nothing**, so a word behind it is
never looked at. Where the index points stand the width, the height and the place of the picture as four more
words, and **sixteen bytes behind them the offsets of the rows**, one word each, which are where every row is
packed. The depth the reference writes down is thirty two bits, though the pixels it unfolds are one byte of
grey each: every picture of this format is handed out as a grey bitmap, with its rows the right way up.

Every row is packed as pairs of a count to pass over and a count of bytes to read. A count is a single byte,
except where a count to pass over is the byte `0xFF` — then it is a word behind it — and where a count of bytes
to read is **nothing** — then it is a word behind it as well. A count to pass over that is exactly what is left
of the row ends it. Every byte a run reads carries `0x57` on top of what the stream holds, and a byte the stream
does not reach carries it on top of what stood there, which is nothing in a row nothing has written to yet.

Two quirks of the reference are kept as they stand:

* the count to pass over moves the reader's **place in the row** but not the place it writes to, which the
  reference advances by the count of bytes alone — so a row that passes over pixels packs the bytes it reads at
  its own start;
* a run that reaches past the end of its **row** is not refused: it writes into the row behind it, which the
  bitmap writer then places as the first pixels of that row, because every row of a bitmap is written on its
  own. A run that reaches past the end of the **picture** is refused, because the .NET array the reference
  reads into throws there (a documented deviation in the message only).

The tests cover the signature, each index the reference does not read, the first word of the index that is not
nothing, the measurements of the picture, a row unfolded with its bias, the offsets that place every row, a
count to pass over that a byte cannot hold, a row that ends where a count is all that is left of it, a run the
stream does not fill, a run that spills into the row behind, a run that reaches past the picture, a row whose
offset names nothing and a run of no bytes.
