# DXT block decoder

Reference: `GARbro/ArcFormats/DirectDraw/DxtDecoder.cs`, class `DxtDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/shared/dxt.ts` — `decompressDxt1Block`, `decompressDxt3Block`,
`decompressDxt5Block`, `unpackDxt1`, `unpackDxt3`, `unpackDxt5`. It is a codec the format ports share rather
than a format of its own, so it carries no entry in `docs/support-status.json`.

Every kind of a block is four by four pixels and hands out four bytes a pixel in the order a bitmap of that
size holds them. What the blocks hold is:

* **the first kind** — a word of two colours of five, six and five bits and a word of two places a pixel. Where
  the second colour stands at or above the first the two places between them are the half of the two and a
  fourth colour of nought that lets the pixel see through; where it does not they stand two thirds and one
  third of the way from the first colour to the second. The two places of a pixel name the four colours in
  turn — nought the first, one the second, two the third and three the fourth.
* **the third kind** — sixteen places of alpha of four bits, the lower place of a byte first, spread out over a
  byte each by taking the place seventeen times over, in front of the two colours of the first kind — always
  with the two places of interpolation and never with a fourth colour of nought, whatever the two colours are.
* **the fifth kind** — two places of alpha of a byte each and sixteen places of three bits between them. A
  place of nought and one of one stand for the two given places; where the first stands above the second the
  other six are spread between them over seven steps, and where it does not there are four steps between them
  with the last two standing at nought and at the whole. The two colours are words of five, six and five bits
  spread out the long way round — every place taking itself over and over up to the whole through a word of
  the size of the colour — and the two places of interpolation are two thirds and one third of the way from
  the first colour to the second.

Where the sides of a picture are not whole numbers of blocks the blocks on the right and at the bottom write
only the pixels that stand inside the picture, which is what the reference's own bounds of its loops do.

The tests cover both walks of the first kind of block, the places of alpha of the third, the eight steps of
alpha of the fifth with both orders of its two places, a picture of more than one block with the blocks on the
right and at the bottom reaching past it, and one picture of every kind.
