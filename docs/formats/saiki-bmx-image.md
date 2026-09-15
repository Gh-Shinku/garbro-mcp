# Saiki obfuscated bitmap

Reference: `GARbro/Legacy/Saiki/ImageJPX.cs`, classes `ObfuscatedImageFormat` and `BmxFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. The picture beside it shares the obfuscation and is
ported in the same module, `docs/formats/saiki-jpx-image.md`.

Implementation: `packages/formats/src/saiki/obfuscated-image.ts` (`saikiBmxImageDescriptor`,
`saikiBmxImageFormat`, id `saiki-bmx-image`, `decryptSaiki`, `readSaikiBmxLayout`).

The obfuscation is the one described in `docs/formats/saiki-jpx-image.md`; what the reference registers beside
the word of nothing is a format with no signature of its own, so it is a candidate for every file, and what
actually gates it is the pair of letters `BD 59` at the start of the file. Those two bytes are the
obfuscation of `'BM'`, the letters of the bitmap behind it — the first turned about, the second complemented
and turned left once, which is what the reference checks before it takes the obfuscation off.

Once it is off the picture is a Windows bitmap, whose measurements come from the shared header reader and which
the port reads and writes out again at the depth it was stored in, the way the reference reads and writes it.
The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover a picture found where the obfuscation hides a bitmap, a plain bitmap turned away for carrying
the wrong letters, the measurements of the bitmap behind the obfuscation, the bitmap written out again, and the
refusal of a picture whose obfuscation hides no bitmap.
