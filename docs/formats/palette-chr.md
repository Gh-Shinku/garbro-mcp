# Palette multi-frame PNG archive (CHR/Palette)

## Reference and attribution

- GARbro reference: `ArcFormats/Palette/ArcCHR.cs`, class `ChrOpener`
- PNG constants: `ArcFormats/Palette/ImagePGA.cs` (`PgaFormat`), `GameRes/ImagePNG.cs`
- GARbro tag: `CHR/Palette`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[4]   'char'
0x04  uint32    index offset
0x08  bytes     the sprite sheet payload, up to the index offset
index int32     frame count minus one
      records   one record per frame:
                byte      name length
                char[]    frame name
                uint32    record size, covering the eight byte header and the payload
                int16     frame x offset
                int16     frame y offset
                uint16    width
                uint16    height
                bytes     payload of record size minus eight
```

The sheet payload is stored without the eight byte PNG signature, and each frame payload is preceded by its
eight byte frame header. Records whose size does not exceed eight are skipped, and every payload has to fit
inside the file.

Each frame is listed twice: once as `{base}#{name}.png` and once as a blended stand-in
`{base}#blend#{name}.png`. The stand-in carries no payload of its own: `CharOpener.BlendEntry` draws the sheet
of the archive — the first entry — and the frame the stand-in names into one surface, the frame standing at
the place that frame carries, and hands the result out.

Extraction rebuilds a PNG stream: the PNG signature, the payload, and a trailing IEND chunk. When a frame has
a non-zero offset and is not the sheet entry itself, an `oFFs` chunk holding the frame position is injected
right behind the IHDR chunk, exactly like `CharOpener.OpenEntry` does. The copied chunk is the **whole** of the
leading chunk — its length word, its name, its own bytes and its check word — so the injected chunk stands
twelve bytes behind the start of that chunk's own bytes.

This port reads both pictures of a blended stand-in with its own reader of the PNG interchange format and lays
the frame over the sheet with the alpha of the frame, which is what the premultiplied surface of the reference
stands for once its storage details are taken away. The stand-in is handed out as a bitmap of the size of the
sheet and is named `{base}#blend#{name}.bmp`.

## Port notes and deviations

- The frame header bytes are read for the offsets only; width and height are not validated.
- The reading of a blended stand-in decodes both pictures, where a picture whose bytes are in no format the
  reader of this project knows is refused with `INVALID_ARCHIVE`; the reference hands the stream to the
  decoder of its platform instead.
- A blended stand-in that names no frame, and a picture of the archive that unfolds to no picture of its own,
  are refused as well.
- Archive creation is out of scope.

## References

- `GARbro/ArcFormats/Palette/ArcCHR.cs` - `ChrOpener.TryOpen`, `ChrOpener.OpenEntry`
