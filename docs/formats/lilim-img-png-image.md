# Lilim obfuscated image (IMG/PNG)

A portable network graphic with its **first thirty two bytes** xored by `0xFF`, from the same class as the
obfuscated bitmap with the same prefix length.

## Reference

| Element | Value |
| --- | --- |
| Tag | `IMG/PNG` |
| Class | `ImgPngFormat` (`ArcFormats/Lilim/ImageIMG.cs`), which extends `BaseImgFormat` |
| Signature | `0xB8B1AF76`, which is the graphic's own signature xored |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

The whole graphic header lies inside the obfuscated prefix — the fields end at offset twenty nine, three bytes
before the prefix does — so deobfuscating thirty two bytes is enough to read them, and the format never needs to
touch the rest of the file to know what it is looking at. The fields are read with the shared reader, which
requires the signature, an `IHDR` chunk, a bit depth from `1`, `2`, `4`, `8` or `16`, and one of the five colour
types, with a palette image reported as twenty four bits.

## The shared signature

The stored bytes are the graphic's signature xored, which is exactly what the Regrips graphic stores, and the two
references tell the two apart no better than they tell the bitmaps apart: each reads its own deobfuscation of the
header, the header lies within the prefix either way, and so each accepts the other's files. The port keeps both
probes faithful and the tests state the overlap rather than inventing a rule the reference does not have.

What differs is where the obfuscation stops, and the extraction is where that shows: this format leaves everything
behind the prefix untouched, so the deobfuscated result is a graphic whose chunks are byte for byte the ones the
writer stored. A file from the other format would produce a result whose body stays xored, which a graphic decoder
would reject.

## Extraction

The port hands the deobfuscated original over instead of decoding and re-encoding it. Every chunk survives, the
compression stays lossless, and the entry is named after the graphic with a `.png` extension.
