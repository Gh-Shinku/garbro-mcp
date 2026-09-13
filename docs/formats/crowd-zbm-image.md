# Crowd ZBM compressed bitmap

Reference: `GARbro/ArcFormats/Crowd/ImageZBM.cs`, class `ZbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/crowd/zbm-image.ts` (`crowdZbmImageDescriptor`, `crowdZbmImageFormat`, id
`crowd-zbm-image`).

| field | offset |
|---|---|
| signature `SZDD` | 0 |
| unpacked size (`i32`), used only on extraction | 0xA |
| LZSS stream | 0xE |

## Three formats on one signature

`SZDD` is the Microsoft COMPRESS.EXE marker, and three formats here start with it: the `BM_` compressed bitmap,
the `SZDD` texture (`DDS` payload) and this one. All three also use the **same codec settings** — a 0x1000 frame
filled with 0x20, starting at 0xFF0 — so the settings cannot tell them apart either.

What separates this format is that its bitmap is stored **obfuscated**: the probe decompresses fifty four bytes
and inverts every one of them before looking for `BM`. The other two look for `BM` as stored, and since a stored
`BM` (`42 4D`) inverts to `BD B2`, no file can satisfy both probes. That is not a happy accident but the reason
the shared signature is safe, and a cross-format test asserts both directions: a file this format accepts is
refused by the `BM_` format, and vice versa.

## Fifty four bytes to read, a hundred to extract

The two halves of the reference disagree about how much is obfuscated, and the port keeps both:

* `ReadMetaData` decompresses exactly **fifty four** bytes — whatever the size word says — and inverts those to
  read the bitmap header;
* `Read` decompresses the **whole** image, then inverts `min(100, length)` bytes of it.

So the header *and* the first forty six bytes of pixel data come back with the image, while byte 100 onwards is
already plain. A test checks the three regions: the header's last byte and byte 99 are inverted relative to the
file, and byte 100 is not.

The size word at 0xA is the codec's output length. It is not read during the probe, and nothing bounds it from
below, so a small value produces a short bitmap rather than a refusal — the port follows the reference there,
with only a 256 MiB cap as its own guard.

## Extraction is a pass-through

What comes out is a bitmap, so the port neither decodes nor rewrites it: the decompressed and partly inverted
bytes are handed over as they are, named `.bmp`. That is why the entry reports the stored size word as its
`unpackedSize` and `sizeKnown` is false. The reference's `CanWrite` is false as well, so there is nothing to
encode.

## Notes

* No extension is declared, and detection is by signature plus the inverted header.
* The port records `encryption: true`, since the reference's obfuscation is not something a reader can ignore.
* `Write` throws `NotImplementedException` in the reference.
