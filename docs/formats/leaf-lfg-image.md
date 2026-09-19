# Leaf image format

Reference: `GARbro/ArcFormats/Leaf/ImageLFG.cs`, classes `LfgFormat`, `LfgMetaData` and `LfgReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/leaf/lfg-image.ts` (`leafLfgImageDescriptor`, `leafLfgImageFormat`, id
`leaf-lfg-image`, `readLfgLayout`, `readLfgPalette`, `unpackLfg`, `decodeLfg`), with the bitmap writer of
`packages/formats/src/shared/bmp.ts` and the table of the walk of the reference (`ColorMap`).

The reference registers the word `LEAFCODE` and no name at all.

## The head

The file begins with that word. Four words stand at `0x20`: how far the left and the top edge of the picture
stand from nought and how far its right and its bottom edge do. The width of the picture stands in eight
places of a byte for every place between its left and its right edge and its height in the places between its
top and its bottom edge. The byte behind those says which way the places of the picture are written — along the
rows or down the columns — the byte behind that names the colour that stands for the shape of the picture and
the word behind them says how many bytes the walk of the picture gives.

The colours of the picture stand in the twenty four bytes behind the word of the file, every byte of them
standing for two parts of a colour of four places, the higher four places of the byte first. The red, the green
and the blue of a colour stand one behind the other, and every part of four places stands for thirty four
places of a colour of eight bits.

## The walk of pairs of places

The walk of a picture takes pairs of places at a time, a pair standing in one byte of the picture. Every step
of the walk stands behind a place of the byte at hand: where that place stands the walk takes one byte of the
file, which the table of the picture stands for a pair of places, and any other step takes two bytes whose
four lowest places are how many pairs stand there, less three, and whose twelve places above them name where in
the frame the pairs stand, the frame being walked round as it is written — so a run may lean on the pairs that
stand before it in the picture itself.

The places of the picture stand along the rows of a picture of the first way and down its columns of the
second. What is handed out is a bitmap of four bits with the colours of the head.

## Deviations from the reference

- The reference hands its picture to the platform with the shape of its colours — the colour the head names as
  the shape of the picture standing as a whole shape; a bitmap holds no shape in its colours, so the port
  writes the colours of the head as they stand and the colour the head names keeps its own value among them.
- A file of fewer than forty eight bytes, a file whose word is not `LEAFCODE`, a picture whose width or height
  does not stand above nought or stands beyond what this project will hold, and a walk of no bytes or of more
  bytes than this project will hold are turned away; the reference would throw while reading its head.
- A walk that runs out of the file and a walk that reaches beyond the places of the picture are refused with a
  message, where the reference reads beyond the file and throws.

## Tests

`tests/formats/leaf-lfg-image.test.ts` covers the head, a file whose word is not that of the engine and a
picture of no places, the colours of the head, the walk of a picture along its rows, the walk of a picture down
its columns, a run of pairs that stand before the place at hand, a picture gathered into a bitmap of four bits
with the colours of its head, a file that does not hold a picture, and a walk that runs out of the file. The
vectors are worked out by hand: the bytes `0x00`, `0x01`, `0x02` and `0x03` of a walk stand for the places
`0x00`, `0x01`, `0x10` and `0x11`, and the walk of a picture down its columns stands them at the beginning and
at the end of its rows.
