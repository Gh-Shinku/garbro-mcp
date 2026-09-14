# RC4 encrypted PNG image

Reference: `GARbro/ArcFormats/Dogenzaka/ImageRSA.cs`, class `Rc4PngFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/dogenzaka/rc4-png-image.ts` (`dogenzakaRc4PngImageDescriptor`,
`dogenzakaRc4PngImageFormat`, id `dogenzaka-rc4-png-image`); the cipher itself is
`packages/codecs/src/rc4.ts`.

A portable network graphic whose **whole stream runs through RC4**. The reference registers the word
`0xC4F7F61A`, which is the graphic's own signature read through the cipher, and declares the `a` extension —
the extension only orders candidates, the word is what finds the file. The key is one the reference carries in
its own source: SHA1 of `Hlk9D28p`, cut to its first sixteen bytes, the same for every file of this format.

The measurements come from the **decrypted** head. The port decrypts only as much as the signature, the first
chunk's own header and its thirteen header bytes need, and reads the width, height and depth from there with
the shared reader; the reference does the same through a decrypting stream in front of its graphic reader. A
palette colour type is reported as twenty four bits and the other types at their own depth, as that reader
does.

Because the cipher covers the whole file, an entry's bytes are not the ones the file holds: what the entry
returns is the decrypted graphic itself, produced by a fresh cipher instance starting at the file's first byte.
The entry is reported as compressed for the same reason.

Details worth recording:

* the reference's `Rc4Transform` (`GameRes/Cryptography/`) is **not** part of this repository's copy of GARbro,
  so the standard cipher was implemented from RFC 6229 — key scheduling and the generation that follows it,
  with nothing dropped from the keystream — and is checked against the published test vectors (`Key` and
  `Plaintext`, `Wiki` and `pedia`, `Secret` and `Attack at dawn`);
* a plain graphic is not one of these files: its word is the graphic's own signature, and decrypting it gives a
  head the reader refuses;
* a stream shorter than a header, one whose decrypted chunk is not `IHDR`, and one whose depth or colour type
  the reader does not know are all refused before anything further is decrypted.

The tests cover the registered word and the extension, the need for the cipher, the measurements of the
decrypted header, the palette and grey colour types, the decrypted output with the file's own bytes recovered by
putting it back through the cipher, three heads that are not graphics, and the entry name.
