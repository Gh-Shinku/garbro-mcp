# Tanaka Tatsuhiro's engine image format

Reference: `GARbro/ArcFormats/Tanaka/ImageBC.cs`, classes `BcFormat`, `TxMetaData` and `TxReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/tanaka/bc-image.ts` (`tanakaBcImageDescriptor`, `tanakaBcImageFormat`,
id `tanaka-bc-image`, `readTxLayout`, `readTxPalette`, `unpackTx`).

The head is a plain one hundred byte bitmap head with the two letters `BC` in front of it: the place of the
block stands at `0x0A`, the width and the height at `0x12` and `0x16` as words, the depth at `0x1C` as a word
of two bytes, and the count of colours at `0x2E` — nought or less meaning the two hundred and fifty six of a
full map. The colour map itself stands at `0x36` as entries of four bytes, `B`, `G`, `R` and a byte the
engine leaves alone.

The block the pixels stand in begins with the word `TX04`, the size of a row and then the height again, and
both have to agree with the head; only then does the picture hold. The pixels themselves are a walk of three
rows and one byte:

* `111xxxxx` — the five lower places are how many bytes stand as they are, less one;
* `110xxxxx` — five places of offset into the row and then the byte behind saying how many bytes are copied
  from behind them;
* `00xxxxxx` — three places of offset and three of count, a count of seven meaning that the count stands in
  the byte behind, all within the row the walk stands in;
* `01xxxxxx` — four places of offset and two of count, read the same way, from the row above;
* `10xxxxxx` — the same, from the row two above.

A copy reads forward byte by byte, so a run may read the bytes it has just written. Once the output is whole,
every pixel of a picture of more than one byte a pixel stands as the difference from the one before it, the
row being walked along from its first pixel to its last.

The rows are handed out **bottom up** — the write path of the reference would flip them and so does the
bitmap the port writes, which keeps a positive height — and the count the block gives for a row is what the
delta walk and the copies count rows with, the block itself being laid out with that count rounded up to four
bytes. The two only line up when a row of the engine's own size is already a whole number of words.

The write path of the reference throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a copy that reaches behind the beginning of the pixels, a
stream cut short of its runs, and a head or block that does not hold are refused, where the reference would
read outside its own array or hand an impossible stride to its caller.

The tests cover the head and the block, the marks and the heights it is turned away for, the delta along a
row, a run that reads the bytes it has just written, the copies that walk back into the two rows above an
eight bit picture, the colour map written into a bitmap, and a file that does not hold a picture.
