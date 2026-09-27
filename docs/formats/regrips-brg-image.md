# Regrips encrypted bitmap (BRG)

A bitmap with every byte of the file xored by `0xFF`, and the same encryption as the graphic from the same reference
file, which is documented in `regrips-prg-image.md`.

## Reference

| Element | Value |
| --- | --- |
| Tag | `BRG` |
| Class | `BrgFormat` (`Legacy/Regrips/ImagePRG.cs`), which extends `PrgFormat` |
| Signature | None; the probe checks the first two stored bytes |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Probe

The reference reads two bytes and requires `BD B2`, which is `BM` xored — the bitmap tag it will see once the file
is decrypted. It then rewinds and decrypts the whole file before reading the header, so a file that merely starts
with those bytes is refused.

The Lilim obfuscated bitmap stores the same two bytes and reads its header the same way, so a file of either kind
passes both probes: the difference between them is where the obfuscation stops, not what the header says. Both
probes are faithful to their references in that, and the ambiguity is noted in `lilim-img-bmp-image.md` too. That makes the prefix unambiguous next to the compressed bitmap format whose stored
bytes begin with an xored `SZDD`: the two never start alike.

## Header

The decrypted bytes are read with the shared bitmap header reader, which requires a `BM` tag, a DIB header of at
least forty bytes, a positive width, a non-zero height and a non-zero bit depth. The probe sees only the first
fifty four bytes, so it does not compare the bitmap's own size word with anything.

Extraction reads the header the same way and hands the **decrypted original** over, which means:

* a size word of zero is accepted, and so is one larger than the file, because the reference treats a size it
  cannot trust as the stream's own length rather than as a fault;
* a truncated bitmap is handed over as far as it goes, where the reference's own decoder would report what it could
  not read. The port keeps the bytes it has and does not invent the rest;
* the padding after rows whose width is not a multiple of four is kept, because nothing is re-encoded.

## The places of the picture

The reference reads the decrypted surface with `Bmp.Read`, so this port reads that bitmap with the shared bitmap walk and
hands the places of the picture over as a bitmap of its own: of the width, the height and the depth of the head of the
bitmap, of a row of the count of the places a row of the picture holds (so the row padding of the file stands of no
count) and of the rows in the order the head names, which for a bitmap of a positive height means the last row of the
file first. The size word of the file stands of no count of the walk. A file that ends before the places its head names
hands a picture of those places over, where the reference reads the stream to its end and throws: that is a difference
this port takes on purpose, as the walk of the bitmap of this project does everywhere.
