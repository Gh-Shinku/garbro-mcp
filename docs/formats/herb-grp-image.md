# Herb Soft image (GRP/HERB)

A zlib stream of rows that use the file's own stride, at one of three bit depths that the first byte names — the
same byte is also the signature.

## Reference

| Element | Value |
| --- | --- |
| Tag | `GRP/HERB` |
| Class | `GrpFormat` (`Legacy/Herb/ImageGRP.cs`) |
| Signature | The first byte: `0x08`, `0x18` or `0x20` |
| Header | `0x28` bytes, followed by a reserved palette area |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 1 | Bit depth: `0x08` eight, `0x18` sixteen, `0x20` twenty four |
| `0x04` | 4 | Must be zero |
| `0x08` | 4 | Must be one |
| `0x0C` | 4 | Row stride, signed |
| `0x20` | 4 | Width |
| `0x24` | 4 | Height |

The palette of an eight bit image sits at `0x28` — the header's end — and is read as red, green, blue and a spare
byte, so it is swapped to a bitmap's blue-first order on the way out. The zlib stream begins at `0x428`, behind the
palette area, for **every** depth: the space is reserved whether or not it holds a palette.

## Decoding

The stream inflates to `stride * height` bytes of pixels in the depth's own layout. The stride is the file's, not
the bitmap's, so rows are copied into a tight bitmap layout: a stored row that is wider than a bitmap row has its
tail dropped, one that is *narrower* than a row cannot describe a row at all and fails. Sixteen bit rows are
written as `RGB555` with a `BI_BITFIELDS` header, which puts the pixels at `0x42`. The image is handed over
unflipped, so the bitmap is top down.

GARbro inflates straight into its pixel array with a single `Read` and never looks at how much arrived, so a stream
that holds less than the image leaves zeros behind it. The port reads through a capped inflater, which means a
stream that holds **more** than the image fails instead of being cut short — a deliberate deviation, as in
[`rits-hbm-image`](./rits-hbm-image.md).

## Process notes

The port's first version forgot that the shared inflater is asynchronous; the fixture's first version assumed a two
pixel row at twenty four bits was tight, when a bitmap pads it to eight bytes.
