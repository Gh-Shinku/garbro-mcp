# KScript image (KGP)

A graphic that starts behind a header and is xored with a single byte key folded out of that header.

## Reference

| Element | Value |
| --- | --- |
| Tag | `KGP` |
| Class | `KgpFormat` (`ArcFormats/KScript/ImageKGP.cs`) |
| Signature | `0x48505247`, which reads back as the stored bytes `GRPH` |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `GRPH` |
| `0x04` | 1 | Key, low half: `byte[4] ^ byte[5]` is the whole key |
| `0x05` | 1 | Key, high half |
| `0x08` | 4 | Length of the graphic |
| `0x0C` | 1 | When zero, the graphic begins at `0x14` and the fields below are not read |
| `0x10` | 4 | Coarse offset, signed |
| `0x14` | 4 | X offset, read only when `0x0C` is non-zero |
| `0x18` | 4 | Y offset, read only when `0x0C` is non-zero |

The graphic's offset is the header's own arithmetic, truncating division included:

```text
offset = 0x14 + int(offset_field / 16) * 0x18
```

A field of twenty therefore gives the same offset as a field of sixteen, because twenty divided by sixteen is one:
the reference counts in twenty fours and the remainder is dropped. Note that the base offset `0x14` is **inside**
the header, which is twenty eight bytes long — a graphic stored that way covers the header's last eight bytes, so
the two offset fields are only meaningful when `0x0C` asks for them.

## Extraction

The key is `byte[4] ^ byte[5]`, one byte for the whole graphic, and the region runs from the offset to the **end**
of the file: the reference seeks once and reads on, and the port takes the rest of the source for the same reason.
The decrypted bytes are read with the shared graphic reader, which requires the signature, an `IHDR` chunk, a
known bit depth and a known colour type.

A region that starts outside the file, or holds less than a graphic header's worth of bytes, is refused — the
reference's own reader fails on such a region, so the probe does too. The port hands the **decrypted original**
over rather than decoding and re-encoding it, which keeps every chunk, and its entry starts at the graphic's own
offset and describes the region rather than the file around it. The reference's X and Y offsets have no counterpart
in the port's image metadata.
