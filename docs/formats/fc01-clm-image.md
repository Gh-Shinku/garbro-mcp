# F&C Co. image

Reference: `GARbro/ArcFormats/FC01/ImageCLM.cs`, class `ClmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/clm-image.ts` (`fc01ClmImageDescriptor`,
`fc01ClmImageFormat`, id `fc01-clm-image`).

A **compressed image with a version stamp**: the file starts with `CLM ` (the reference's word `0x204D4C43`)
and the four byte string `1.00` at offset four — the only version the reference accepts.

| field | offset |
|---|---|
| marker `CLM ` | 0 |
| `1.00` | 4 |
| data offset, at least 0x40 | 0x10 |
| width | 0x1C |
| height | 0x20 |
| depth | 0x24 |
| unpacked size | 0x28 |
| palette, eight bit images only | data offset |
| mrg lzss body | behind the palette, to the end of the file |

An **eight bit** image puts its palette in front of the body: 256 entries of four bytes in blue, green, red and
unused order, which is what the library's default palette reader (`PaletteFormat.BgrX`) produces and the same
layout a bitmap palette uses, so the port passes it through as it stands. That reader throws when the stream
ends inside the palette, and the port raises a `GarbroError` there. The body then runs to the end of the file —
the reference takes its packed size as everything that is left — and decodes through the LZSS reader the MRG
archive shares, so the port calls the decoder that was already written for it.

Details worth recording:

* the depth decides the bitmap: eight bits become an indexed image with the palette, twenty four a `Bgr24` and
  thirty two a `Bgr32`, which is the same four bytes a pixel that the port writes into a 32 bit bitmap;
* any **other** depth is still described by `ReadMetaData` — the reference only raises `NotSupportedException`
  when the image is read — so detection accepts such a file and extraction fails, exactly as there;
* neither the unpacked size nor the dimensions are validated by the reference; the port requires a positive
  length to decode into and declines an image it could not hold in memory;
* the reference passes neither a stride nor a flip, so the bitmap is **top down** with tight rows.

The tests cover the marker, the version string, the data offset bounds, the dimension and length checks, the
metadata of an unsupported depth, the three depths, the palette in front of an eight bit body, the short palette
and short body failures, and the entry name.
