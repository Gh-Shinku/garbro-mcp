# Ice Soft compressed bitmap

Reference: `GARbro/ArcFormats/Ice/ImageIBM.cs`, class `IbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).
Implementation: `packages/formats/src/ice/ibm-image.ts` (`ibmImageDescriptor`, `ibmImageFormat`, id
`ice-ibm-image`).

| field | offset |
|---|---|
| marker `TPW` plus a version byte | 0 |
| declared output size (`i32`) | 4 |
| the codec's stream — its seed word sits at 8 | 8 |

## The header is exactly what the codec skips

The codec (`GrpOpener.UnpackTpw`, the same one the Ankh archives use) seeks to offset **eight** in whatever
stream it is handed, then reads a seed word that seeds three copy distances. The file's own prefix is also eight
bytes — the marker and the declared size — so handing the codec the whole file puts its seed word exactly where
the header ends, which is what the reference does.

## Fifty six bytes to recognise, the whole declared size to extract

`ReadMetaData` decompresses **fifty six** bytes — one bitmap header — and reads the dimensions out of them with
the reference's bitmap reader. Nothing else is checked: the declared size only has to be positive, and the
compression word is never consulted. A test covers a zero and a negative size, a foreign marker, a payload that
is not a bitmap at all, and a stream too short to fill the header.

A stream that stops early leaves the rest of that buffer as allocated — zeroes — so it cannot pass the header
check and the file is simply not recognised. An eight bit bitmap shows the probe needs no more than it takes:
its palette lies past the fifty six bytes and the header is still complete.

Extraction allocates the declared size, decompresses into it, and passes the **bitmap through** rather than
decoding it, so the entry reports the declared size as its `unpackedSize` and `sizeKnown` is false. The pixels
themselves are not validated, because nothing here decodes them; the header is checked once more, since the
reference's decoder would fail on anything else. A declaration above 256 MiB is refused — the port's own guard,
and a test records both that the probe still accepts it and that extraction does not.

## Sharing the marker with the script format

`TPW\x01` also starts an Ice **ISD script**, and there the same second word is the size of the script. In the
reference the two are in different format lists — an image panel and a script panel — so nothing ever has to
choose between them; this registry does, and the script's probe is the looser of the two (signature and size
alone).

So the script's **detection** now decompresses the same fifty six byte prefix and steps aside when it holds a
bitmap header, which makes the two disjoint: a bitmap reaches this format, a script reaches that one, and a test
walks both directions. Extraction is untouched — a file the dispatcher routes to the script format is still
unpacked exactly as the reference does.

## A refactor first

The header checks this port needs — a `BM` tag, a DIB header of at least forty bytes, a positive width, a
non-zero height and bit depth — were previously inline in the Crowd ZBM port, which needed them without the
whole-file size comparison. They are now `readBmpHeaderFields` in `shared/bmp.ts`, with `readBmpMetaData`
delegating to it; that change landed as its own commit before this format existed, and it gave the Crowd probe
the bit depth check its reader always made.

`Write` throws `NotImplementedException` in the reference.
