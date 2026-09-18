# KApp compressed image format

Reference: `GARbro/Legacy/KApp/ImageCGD.cs`, classes `CgdKToolFormat`, `CgdSpielFormat`, `CgdMetaData`,
`KTool` and `KTool.HuffmanDecoder`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/kapp/cgd-image.ts` — `cgdKToolImageDescriptor` / `cgdKToolImageFormat`
(id `kapp-cgd-ktool-image`) and `cgdSpielImageDescriptor` / `cgdSpielImageFormat` (id
`kapp-cgd-spiel-image`), with `readCgdKToolLayout`, `readCgdSpielLayout`, `readCgdInnerWindow`,
`decompressKToolRle`, `inflateKToolHuffman` and `unpackCgdPicture`.

## The two heads

The KApp head begins with `ktool210`, holds one as a word at eight and the place of the picture as a word at
`0x10` **with its highest bit cleared**. The Spiel head begins with `spiel100`, holds one as a word at eight,
the width and the height as words at `0x18` and `0x1A`, the depth and the compression as bytes behind them,
and the place of the stream as a word at `0x10`; its size is the picture worked out from its own
measurements.

Behind whichever head it is stands the engine's inner head: the unpacked size as a word at nought, a word
that is not read, the compression as a word at eight, the head size as a word at `0x0A`, one of the two
words `0x973768` and `0xB29EA4` as a word at `0x0C`, and the width, the height and the depth as words from
`0x10`. The stream begins the head size plus sixteen bytes in, and the head size may not be smaller than
sixteen.

## The walk

| method | what it does |
| --- | --- |
| nothing | the pixels stand as they are |
| one to four | that many run streams, one byte of the picture apart |
| `0x10` | the engine's own Huffman |

A run stream has a **signed** control byte a step: a positive one introduces a value written that many
times, a negative one that many values that stand themselves, and nothing ends the step. The streams of two
to four steps therefore fill every other byte, every third byte and every fourth byte of the picture.

The Huffman dictionary is itself a run stream of two hundred and fifty six weights, behind which stands one
more leaf of weight one. The tree is built by taking the two lightest nodes again and again; everything up
to `0x100` is a leaf, so a walk that reaches `0x100` hands out a zero byte. A stream that ends before the
picture is full ends the picture quietly, as the reference returns there.

## The picture

Thirty two bits a pixel is `Bgra32` and stands as it is; twenty four bits is `Rgb24` for the KApp head and
`Bgr24` for the Spiel head, so the red and the blue bytes of a KApp picture are swapped before the bitmap is
written. The rows are top down, which is what `ImageData.Create` means. The write paths of both formats
throw `NotImplementedException`, so this is a read only pair.

Deviations from the reference, all in the message only: a head whose declared unpacked size disagrees with
its own measurements, a depth other than twenty four or thirty two bits, and a run or a Huffman walk that
reaches past the picture are refused, where the reference would read or write past its own array. An unknown
compression is refused as the reference also refuses it.

The tests cover both heads and the fields they are turned away for, the flag on the place of the KApp
stream, the stored, the run and the Huffman walks of both formats, the channel swap of a twenty four bit
KApp picture, and the two files that are not signed.
