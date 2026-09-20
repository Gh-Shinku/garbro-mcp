# Digital Romance System encrypted image format

Reference: `GARbro/ArcFormats/Ikura/ImageGGP.cs`, classes `GgpFormat`, `GgpMetaData` and `EncryptedStream`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ikura/ggp-image.ts` (`ikuraGgpImageDescriptor`, `ikuraGgpImageFormat`, id
`ikura-ggp-image`, `readGgpLayout`, `decryptGgp`).

The format is a portable network graphic with a fake header in front of it, laid over with a key. The reference
reads it by extending its portable network graphic reader; this project has no such reader, so the port passes
decode do — and reports the measurements of the picture from the header at the front of it. The write path of
the reference throws `NotImplementedException`, so this is a read only format.

The header is thirty six bytes:

| offset | what it holds |
| --- | --- |
| `0x00` | the letters `GGPFAIKE`, which the reference checks |
| `0x0C` | the eight bytes the key is found from |
| `0x14` | the place the picture stands at |
| `0x18` | how long the picture is |

The signature word the reference declares is `0x46504747`, the letters `GGPF`, and the extensions it declares
are `ggp` and `gg`. The key is found by laying the first eight bytes of the header — the letters themselves —
over the eight bytes that stand twelve bytes behind them, which is why a file the letters of which are not all
there is turned away. The picture itself is read from the place and the length the header gives, and every byte
of it is laid over with the key, walking the key round and round from its first byte and counted from the start
of the picture. A file whose picture does not stand wholly inside it, or whose length is nothing, is turned
away rather than throwing the way the reference's own readers would.

The measurements come from the portable network graphic inside the region: a file whose region does not begin
with one is turned away by detection, and reading such a file is refused rather than passed on as anything the
caller could not use. Extraction gives back the picture exactly as it stood before the key was laid over it,
named `png`, and the entry it is listed as is as long as the region the header declares.

The tests cover the four letters of the signature and the letters behind them, the declines of a file too short
to hold a header, of one whose picture stands outside it, of one whose length is nothing and of one whose
letters are not `GGPFAIKE`, the decline of a region that is not a portable network graphic, the measurements
and the depth the colour kind of the picture gives it, the key found by laying the first bytes of the header
over the ones behind them, the key walked round and round over a picture more than eight bytes long, a picture
that stands behind a gap in the file, the picture given back as it stood, and the refusal to read a region that
is not a portable network graphic.
