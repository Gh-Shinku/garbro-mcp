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
`{base}#blend#{name}.png`. The stand-in carries no payload of its own and extracts to nothing; the reference
merges it with the sheet while decoding.

Extraction rebuilds a PNG stream: the PNG signature, the payload, and a trailing IEND chunk. When a frame has
a non-zero offset and is not the sheet entry itself, an `oFFs` chunk holding the frame position is injected
right behind the IHDR chunk, exactly like `ChrOpener.OpenEntry` does.

## Port notes and deviations

- The frame header bytes are read for the offsets only; width and height are not validated.
- The blended stand-ins have no extraction logic, so they report a zero size and empty content.
- PNG blending and image decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Palette/ArcCHR.cs` - `ChrOpener.TryOpen`, `ChrOpener.OpenEntry`
