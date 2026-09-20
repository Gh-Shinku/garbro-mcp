# SVIU System image format

Reference: `GARbro/ArcFormats/Sviu/ImageJBP.cs`, class `JbpFormat`, whose places stand in
`GARbro/ArcFormats/Cmvs/ImagePB3.cs`, class `JbpReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sviu/jbp-image.ts` (`sviuJbpImageDescriptor`, `sviuJbpImageFormat`, id
`sviu-jbp-image`, `readJbpLayout`), over `packages/codecs/src/jbp-reader.ts`, `jbp-huffman.ts`,
`jbp-coefficients.ts`, `jbp-dct.ts` and `jbp-ycc.ts`.

The reference stands the places of a picture of the Purple engine as a picture of its own: `JbpFormat` reads
the head of such a file and hands the places behind it to the walk of the places of a picture that the kind of
pictures of `PB3` stands.

## The head

The reference registers the words `JBP1` and reads the words of the head of a picture behind them: where the
places of the walk of its places stand, the kind of the picture, how wide and how tall it stands, and how many
places of the two walks of the places of the picture stand. This port reads the same words and reads those of
the walk as well, so that a file whose head names no walk at all stands as no picture of this kind.

## The walk of the places of a picture

The places of the picture stand as the places of the picture of the kind of the file: the places of a picture
stand as the places of eight, sixteen, or two and thirty and sixteen places of the picture. Behind the places
the head names stand the words that name how many places of the walk of the places of the picture stand for the
places of a colour, the places the walk stands for itself, and then the two walks of the places of the picture
themselves, which stand as the places of a colour that stand beside the places that stand before them, the
places of the picture standing as the places of the colours of the picture through two walks of their own.

## Deviations from the reference

- The reference reads the words of the head of a picture of this kind and no others, and stands a picture whose
  places stand short of the places of its walk as an error of the walk itself; this port reads the words of the
  walk of the places of the picture and turns such a picture away as a picture of no kind this project reads.
- A picture of no places, of more than two hundred and fifty six million places, and whose head names places
  that stand outside the file is turned away; the reference would throw while reading those.
- The places of the picture stand as the places of a bitmap of three colours apiece and are handed out as a
  bitmap of three and twenty places a place, which is what the reference names the places of a picture of this
  kind as.
- The walk of the places of a picture of the kinds of the engine that read the places of the picture of the
  game beside them stands as no part of this port.

## Tests

`tests/formats/sviu-jbp-image.test.ts` covers the head of a picture and the heads it is turned away for, the
places of a picture stood as a picture of its own, the words the picture is handed out as, a file whose places
stand short of the walk of the places of the picture, and the words of the picture. The picture of the test
stands worked out with a walk of the places of the reference's own, so its places stand under a walk this port
did not work out. `tests/unit/jbp-huffman.test.ts`, `jbp-coefficients.test.ts`, `jbp-dct.test.ts` and
`jbp-ycc.test.ts` cover the walks the picture stands as.
