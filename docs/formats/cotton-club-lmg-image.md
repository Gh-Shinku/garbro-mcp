# Cotton Club encrypted image

Reference: `GARbro/Legacy/CottonClub/ImageLMG.cs`, classes `LmgFormat`, `LmgMetaData` and `LmgReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cotton-club/lmg-image.ts` (`cottonClubLmgImageDescriptor`,
`cottonClubLmgImageFormat`, id `cotton-club-lmg-image`, `readLmgLayout`, `decryptLmg`, `unpackLmg`).

The head begins with `LMG` and the method behind it, of which `1`, `2` and `3` are read; the width and the
height stand at four and eight as words, and the depth is thirty two bits for the run walk of method two and
twenty four for the other two. The stream behind the twelve byte head is scattered.

The key is the exclusive or of every byte of the file's **own name**, in lower case — which is why this port
takes the name from the path it was handed — and the stream is then unscrambled a byte at a time: every byte
is exclusive ored with the byte before it, the key for the first one being the name's own.

* method **one** hands the unscrambled bytes out as they stand, a `Bgr24` picture of a tight row;
* method **two** unfolds a run walk of `Bgra32` pixels. The walk runs while its place has a byte behind it,
  and a byte a step says what follows: `0xFF` is a run of as many **opaque** pixels as the word behind it;
  nothing is as many pixels that stand as they are, which are the zeros the picture was made of; anything
  else is the fourth byte of a pixel beyond one, of as many pixels as the byte behind it says, with the
  fourth bytes of the rest standing in the stream. The words and the bytes of a length are read with the
  reference's own rule: every byte of nothing before a length adds two hundred and fifty five to it, of two
  bytes for a word adding sixty five thousand five hundred and thirty five;
* method **three** is a JPEG, whose decoder this project does not carry: such a picture is recognised and
  listed, and its extraction is refused with a message of this project's own.

The rows are handed out top down, which is what `ImageData.Create` means. The write path of the reference
throws `NotImplementedException`, so this is a read only format.

The tests cover the head of both depths, the fields the reader is turned away for, a run of opaque pixels,
pixels that stand as they are, the fourth byte of a pixel taken from the stream, both pictures written out,
the refusal of the JPEG method, and a file that is not signed.
