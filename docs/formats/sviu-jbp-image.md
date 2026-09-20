# SVIU System image format

Reference: `GARbro/ArcFormats/Sviu/ImageJBP.cs`, class `JbpFormat`, whose places stand in
`GARbro/ArcFormats/Cmvs/ImagePB3.cs`, class `JbpReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sviu/jbp-image.ts` (`sviuJbpImageDescriptor`, `sviuJbpImageFormat`, id
`sviu-jbp-image`, `readJbpLayout`), over `packages/codecs/src/jbp-reader.ts`, `jbp-huffman.ts`,
`jbp-coefficients.ts`, `jbp-dct.ts` and `jbp-ycc.ts`.

pictures of `PB3` stands.

## The head

The reference registers the words `JBP1` and reads the words of the head of a picture behind them: where the

## Deviations from the reference

- A picture of no places, of more than two hundred and fifty six million places, and whose head names places
  that stand outside the file is turned away; the reference would throw while reading those.
  kind as.
  game beside them stands as no part of this port.

## Tests

`tests/formats/sviu-jbp-image.test.ts` covers the head of a picture and the heads it is turned away for, the
places of a picture stood as a picture of its own, the words the picture is handed out as, a file whose places
did not work out. `tests/unit/jbp-huffman.test.ts`, `jbp-coefficients.test.ts`, `jbp-dct.test.ts` and
`jbp-ycc.test.ts` cover the walks the picture stands as.
