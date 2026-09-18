# CatSystem engine HG-2 image format

Reference: `GARbro/ArcFormats/CatSystem/ImageHG2.cs` (`Hg2Format`, `Hg2MetaData`, `Hg2Reader`) with the reader
it shares with HG-3, `GARbro/ArcFormats/CatSystem/ImageHG3.cs` (`HgReader`). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cat-system/hg2-image.ts` (`catSystemHg2ImageDescriptor`,
`catSystemHg2ImageFormat`, id `cat-system-hg2-image`, `readHg2Layout`, `readHg2Pixels`) with the shared reader
in `packages/formats/src/cat-system/hg-core.ts` (`unpackHgStream`, `applyHgDelta`, `readHgBitCount`,
`HgBitReader`, `hgGeometry`).

## The head

Behind the mark `HG-2` stands the version as a word at eight, and only three versions are read, each with the
head size it stands for: `0x25` with `0x58`, `0x20` with `0x50` and `0x10` with `0x30`. The width and the
height stand at `0x0C` and `0x10` as words, the depth and the bits of a channel behind them as words, and the
packed and unpacked sizes of the data and of the control bits stand from `0x20`. The stream of the picture
begins at the head size, the data stands there and the control bits right behind it.

## The shared reader

`HgReader.UnpackStream` takes two zlib streams. The data stream has to hold the whole picture; the control
bits begin with one bit that says whether the picture begins with a run copied from the data or with one left
as it stands, and every run from then on takes the other. A run's length is written with `GetBitCount`: a run
of clear bits says how many bits follow, and the value then stands as a leading one with those bits behind it
(a run that nests past thirty two bits is refused, as the reference refuses it). A copied run takes its bytes
from where the last one ended.

`HgReader.ApplyDelta` then reads the picture as four planes: every four bytes stand as four planes of two bit
fields, spread over four bytes again by a table, and the lowest bit of a byte says whether the seven above it
are the value or its inverse. A step is added to every byte from the one a pixel behind — in the **first row
only** — and another from the byte a row above, so the whole picture is built from differences.

## The picture

A picture of twenty four bits a pixel is `Bgr24` and one of thirty two is `Bgra32`. A version newer than
`0x10` stores its rows **bottom up**, which is what `CreateFlipped` means. A picture of the version `0x10`
may hold fewer than eight bits a channel, which are stretched over the whole byte, and its fourth byte stands
inverted. The write path of the reference throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, all in the message only: a depth other than twenty four or thirty two bits, a
picture whose declared sizes disagree with its own measurements, and a run that reaches past either stream
are refused, where the reference would read or write past its own array.

The tests cover the head of every version and the fields the reader turns away, the walk of a run's length,
the four planes and the step of every byte, the step from the row above, the alternation of copied and
skipped runs, a picture of five bits a channel with its fourth byte inverted, the rows of the newer head, and
a file that is not signed.
