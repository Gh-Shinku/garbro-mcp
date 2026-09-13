# For/Ucom image (GPC)

A marked header and rows of run length encoded pixels, where the rows in the file are stored bottom row first and
the alignment bytes behind every row are part of the compressed stream.

## Reference

| Element | Value |
| --- | --- |
| Tag | `GPC/UCOM` — the reference calls it `GPC`, which the Advanced 98 and SuperNekoX readers also use |
| Class | `GpcFormat` (`ArcFormats/Ucom/ImageGPC.cs`) |
| Signature | `0x00285047`, which reads back as `GP(` and a null |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `GP(` and a null |
| `0x02` | 4 | A header length that nothing ever reads |
| `0x06` | 4 | Width |
| `0x0A` | 4 | Height |
| `0x10` | 2 | Bits per pixel: `8`, `24` or `32` |
| `0x22` | 4 | Palette entries, used by eight bit images only |

The depth is checked while the header is read and a value outside the three is refused, so unlike the An*tique
reader a sixteen bit file is not detected at all. The length word at `0x02` looks like it should move the pixels,
but the reference reads its header at a fixed offset and the pixels at a fixed `0x2A`, four bytes behind the
header's end, whatever that word holds.

An eight bit image whose palette entry count is zero gets a **full page** of colours, the opposite of the An*tique
reader, which assumes nothing. The palette itself is a run of four byte blue-first entries starting at `0x2A`, and
the pixels follow it.

## Pixels

Rows are `width * depth / 8` bytes rounded up to four, and the alignment bytes behind each row are **stored**: the
reader consumes them as part of the stream whatever they hold. The reference hands its buffer to the image with
the padded stride, so those bytes survive as the image's own row padding; this port writes tight rows and lets the
shared bitmap writer pad them with zeros instead, which no viewer can tell apart.

Each token is one control byte and whatever it names. The top seven bits are the pixel count less one, so a token
covers between one and a hundred and twenty eight pixels:

* **Bit zero clear** — the pixels follow as raw bytes, `count * depth / 8` of them.
* **Bit zero set** — one pixel follows and the rest of the run repeats it. The reference copies the bytes it just
  read over the remainder of the run, which for a multi-byte pixel repeats the pixel itself, so the port does the
  same byte for byte.

A token may name more pixels than the row has left. The reference runs over the row's end into the alignment bytes
and keeps going, so the port follows the same path, refusing only when a token would leave the image itself.

The reference fills its buffer from the image's **last** row up, writing the first row in the file into the buffer's
last row. The buffer therefore already reads top to bottom, and since that reader does not flip its image, the
resulting bitmap is **top down**: its height is negative and its first row is the file's last.
