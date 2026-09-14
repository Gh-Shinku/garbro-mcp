# Candy Soft image

Reference: `GARbro/ArcFormats/Interheart/ImageCandy.cs`, class `CandyFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/interheart/epf-image.ts` (`interheartEpfImageDescriptor`,
`interheartEpfImageFormat`, id `interheart-epf-image`).

An image whose header comes in **two forms**, both of them **big endian** and both starting with their own
size, which is the word the reference registers:

| field | 14 byte header | 10 byte header |
|---|---|---|
| header size | 0 | 0 |
| offset X, offset Y | 2, 4 | — |
| width, height | 6, 8 | 2, 4 |
| depth in bits | 0x0A | 6 |
| version | 0x0B | 7 |
| palette entries | 0x0C | 8 |

The two registered words are a fourteen byte header (`0x0E00`) and a ten byte one **whose width happens to be
0x280** (`0x80020A00`); the list ends in the zero that makes the format reachable from the pass that offers it
every remaining file, so a ten byte header of any width is taken as long as its version is one or two, its depth
is between one and thirty two bits, and its dimensions are not zero. The port registers the same two words and
opts into `extensionFallback`, since the format declares no extensions of its own.

The palette, when the header counts any entries, sits **between the header and the compressed pixels**. Every
entry is four bytes whose first is dropped, and its colours are red, green and blue; a bitmap palette wants
them blue, green, red with a fourth byte it does not use.

The pixels are run length coded in a way this format shares with no other port. A control byte's eight bits are
first grouped into **runs of equal bits**, each run a bit value and a count, and each run then describes pixels:

* a **set** bit means that many literal bytes, each of which also goes into a 0x1000 byte window;
* a **clear** bit means that many two byte matches, of a low nibble plus three bytes, copied from the window at
  the offset the rest of the word holds.

The window advances a byte for every byte written out, so a match that reaches its own output copies what it has
just written — an offset of zero repeats the first byte three times — and its first bytes are zeroes when no
literal has been read yet. A stream that ends between control bytes stops quietly and leaves the rest of the
pixels as they were allocated; one that ends in the middle of a literal run or of a match fails, which is the
`EndOfStreamException` the reference's unguarded reads raise.

What the decoder produces is the image **grouped into blocks whose columns are stored one after the other**: the
port walks a block a column at a time and writes every pixel back **reversed**, so the stored red, green and blue
becomes blue, green, red, or, for a thirty two bit image of the second version, the stored alpha, red, green and
blue becomes blue, green, red and alpha. Blocks are 0x90 pixels a side for eight bit images and 0x50 for the
rest. One bit images are already packed a row at a time and are neither shuffled nor reversed.

Details worth recording:

* a **thirty two bit image of the first version is read as twenty four bit** — the reference's decoder picks
  three bytes a pixel for it — which the port reproduces;
* a ten byte header needs only ten bytes here, where the reference reads fourteen outright and would fail on a
  file that short; a file shorter than its own header size is refused;
* an indexed depth whose header counts no palette entries would leave the reference asking WPF for a palette it
  has not got; the port writes a grey ramp instead, which is a deviation for that unusual header only;
* the pixel buffer is tight: three or four bytes a pixel take the width's own stride, eight bit pixels a byte
  each, and one bit pixels a byte a row of eight.

The tests cover both registered words, the fallback pass, the header size, version and depth checks, both header
forms with their measurements, a literal run behind the palette, a match out of the window, the column order and
channel reversal of a block, the one bit path, the thirty two bit first version reading twenty four, the second
version's alpha, a stream that stops early with one that does not, and the entry name.
