# Lilim obfuscated bitmap (IMG/BMP)

A bitmap with its **first thirty two bytes** xored by `0xFF`. The rest of the file is already a plain bitmap, so
the obfuscation hides the header and nothing else.

## Reference

| Element | Value |
| --- | --- |
| Tag | `IMG/BMP` |
| Class | `ImgBmpFormat` (`ArcFormats/Lilim/ImageIMG.cs`), which extends `BaseImgFormat` |
| Signature | None; the probe checks the first two stored bytes |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Obfuscation

`BaseImgFormat.DeobfuscateStream` reads the first `0x20` bytes, xors each of them, and puts them back in front of
a region that starts at `0x20` and is passed through untouched. The port's `deobfuscateLilim` does the same, and
the boundary matters: a file whose whole body had been xored would not read as a bitmap behind the prefix.

The probe checks `byte[0] ^ 0xFF == 'B'` and `byte[1] ^ 0xFF == 'M'`, so the stored prefix is `BD B2`. It then
deobfuscates and reads a bitmap header with the shared reader, which requires a `BM` tag, a DIB header of at least
forty bytes, a positive width, a non-zero height and a non-zero bit depth.

## The shared prefix

`BD B2` is the same prefix the Regrips bitmap stores, and neither reference tells the two apart: both deobfuscate
the header and read it, and the fields they read all live within the first thirty two bytes, so both readers accept
either file. What actually differs is where the obfuscation stops — Regrips xors the whole file, this format only
its prefix — which is a property of the file rather than of anything in the header. The tests pin that behaviour
down in both directions instead of pretending to a distinction the reference does not make.

## Extraction

The port hands the deobfuscated original over rather than decoding and re-encoding it. That is a bitmap again, with
its size word and its row padding intact, and it keeps every pixel byte as the writer left it. A caller that wants
pixels can read the result with any bitmap decoder.

## The places of the picture

The reference reads the deobfuscated surface with `Bmp.Read`, so this port reads that bitmap with the shared bitmap walk
and hands the places of the picture over as a bitmap of its own: of the width, the height and the depth of the head of the
bitmap, of a row of the count of the places a row of the picture holds (so the row padding of the file stands of no
count) and of the rows in the order the head names. The places the file holds behind the picture stand of no count of the
walk.
