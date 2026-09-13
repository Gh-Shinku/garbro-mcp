# Studio Nabe Bugyou image (YPF)

A plain image whose pixels follow a sixteen byte header, three bytes a pixel and an optional alpha plane.

## Reference

| Element | Value |
| --- | --- |
| Tag | `YPF/NABE` |
| Class | `YpfFormat` (`Legacy/Nabe/ImageYPF.cs`) |
| Signature | None; the file's own extension is the gate |
| Extensions | `.ypf` |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Probe

The reference checks `Name.HasExtension(".ypf")` **before** it looks at the header, so the same bytes under any
other name are not this format. Its declared signature table holds `0`, `1`, `2` and `3`, which is why the probe
does not require a particular first byte — the depth byte is checked separately:

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 1 | Depth: `1` is twenty four bits, `3` is thirty two; anything else is refused |
| `0x04` | 4 | Width, little endian, above zero and at most `0x8000` |
| `0x08` | 4 | Height, little endian, above zero and at most `0x8000` |

The header has sixteen bytes and the pixels begin at `0x10`. Because the depth byte is read rather than compared
with zero, the first four declared signatures are a subset of what the probe accepts rather than the whole rule.

## Extraction

Colour comes first, three bytes a pixel, and the alpha plane follows it when the depth byte is three. The port
reads what the file holds and leaves the rest of its buffer blank, which is what the reference's own `ReadBytes`
does: a short file produces black pixels or a transparent alpha rather than a fault.

The three byte colours are handed over in the order they are stored — the reference's `Bgr24` — and the alpha is
interleaved with them a pixel at a time for a thirty two bit image. Rows are padded to a multiple of four bytes by
the shared bitmap writer, as any bitmap's are, so a two pixel row at twenty four bits occupies eight bytes.
