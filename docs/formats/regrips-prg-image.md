# Regrips encrypted image (PRG)

A portable network graphic with every byte of the file xored by `0xFF`. The port decrypts the graphic and hands it
over whole; the sibling bitmap from the same reference file is documented in `regrips-brg-image.md`.

## Reference

| Element | Value |
| --- | --- |
| Tag | `PRG` |
| Class | `PrgFormat` (`Legacy/Regrips/ImagePRG.cs`) |
| Signature | `0xB8B1AF76`, which is the graphic's own signature xored |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Encryption

The reference wraps the file in `XoredStream(input, 0xFF, true)`, whose key is a **single byte** applied to every
byte of the stream, so there is no key length or alignment to respect. Both the probe and the extraction decrypt
first: the stored signature is `89 50 4E 47` xored to `76 AF B1 B8`, but that is only where the reading starts.

## Inner header

The decrypted graphic is read with the reference's own portable network graphic reader, which is faithful in a few
places worth naming:

| Field | Meaning |
| --- | --- |
| Signature | All eight bytes, checked as four read bytes and the `0x0A1A0A0D` word |
| Chunk | The first chunk's type must be `IHDR` |
| Width, height | Big endian, at offsets `0x10` and `0x14`, and neither is checked for being non-zero |
| Bit depth | Must be `1`, `2`, `4`, `8` or `16` |
| Colour type | `2` gives `depth * 3`, `3` gives **`24`**, `4` gives `depth * 2`, `6` gives `depth * 4`, `0` gives `depth` |

The palette case is the reference's own choice rather than a bitmap's real depth, and the port keeps it. Because
the fields end at offset twenty nine, a file shorter than that is rejected before anything is decrypted.

## The shared signature

The stored signature is the graphic's own, xored, which is exactly what the Lilim obfuscated image stores. That
format xors only its first thirty two bytes and this one the whole file, but the graphic's header lies within
those thirty two bytes, so each probe accepts the other's files — the references are no more discriminating than
that, and neither are the ports. The extraction is where the difference tells: this format decrypts the whole
file, so its result is a readable graphic whatever the input was named.

## Extraction

The reference decodes the graphic and re-encodes it as a bitmap; the port hands the **decrypted original** over
instead, which keeps every chunk, the exact bytes and the lossless compression of the source. The reference's walk
over the chunks after the header — it looks for `IDAT`, `IEND` or an `oFFs` offset — is therefore not performed:
nothing in the port's output depends on it. The reference's offset handling has no counterpart here, since the
port's image metadata has no offset fields.
