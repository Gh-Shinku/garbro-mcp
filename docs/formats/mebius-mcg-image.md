# Mebius image format

Reference: `GARbro/ArcFormats/Mebius/ImageMCG.cs`, classes `McgFormat`, `McgMetaData` and `McgReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/mebius/mcg-image.ts` (`mebiusMcgImageDescriptor`,
`mebiusMcgImageFormat`, id `mebius-mcg-image`, `readMcgLayout`, `unpackMcg`).

The head begins with `MCG` and the kind of the picture behind it, of which nought through seven are read; the
offsets stand at eight and ten and the width and the height at twelve and fourteen, all of them as **big
endian** words. The depth is eight bits of grey for the kinds four and five and thirty two bits for the rest,
so the row of the reader's own buffer is a whole number of pixels.

| kind | what the stream holds |
| --- | --- |
| `0` | three planes a byte wide, laid into every **fourth** byte of the row |
| `1`, `4` | the picture as it stands, a row at a time |
| `2`, `3` | runs of a byte a channel, three channels for the second and four for the third |
| `5` | a run walk of a byte a pixel |
| `6`, `7` | nothing at all: the picture stands as the zeros the buffer began with |

A run walk of a channel begins with the byte that stands for a run; a step of the walk is then either a byte
that stands itself, or that same byte with a count and a value behind it, standing for as many bytes as the
count says. The walk of the fifth kind is the same without the channels.

The rows are handed out **bottom up**, which is what `ImageData.CreateFlipped` means, and only the third kind
carries a fourth byte of its own — the others leave it at zero, which is what `Bgr32` means. The write path
of the reference throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a picture with nothing for a width or a height, a kind
that carries a stream but none behind the head, and a run that reaches past the picture are refused, where
the reference would read past its own array.

The tests cover the head of both depths, the mark, kind and measurements it is turned away for, the three
planes of the first kind, a picture that stands as it stands, the runs of a byte a channel of the second and
of the third kind, the run walk of a byte a pixel, the zeros the last two kinds leave, and a file that does
not hold a picture.
