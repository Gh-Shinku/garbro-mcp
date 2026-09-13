# Ikura GGA image

Reference: `GARbro/ArcFormats/Ikura/ImageGGA.cs`, class `GgaFormat` ("D.O. image format")
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ikura/gga-image.ts` (`ggaImageDescriptor`, `ggaImageFormat`, id
`ikura-gga-image`).

A twelve byte header in front of an LZSS stream of 24 bit pixels:

| field | offset |
|---|---|
| `offsetX` (`i16`) | 0 |
| `offsetY` (`i16`) | 2 |
| width (`u16`) | 4 |
| height (`u16`) | 6 |
| unpacked size (`i32`) | 8 |
| LZSS stream | 12 |

## A format with no signature and no extension

`Signature` is zero and the registration declares no extension, so the reference has nothing to identify the
format by except the **file name extension**, which it checks first:

```csharp
if (!file.Name.HasExtension (".gga"))
    return null;
```

The port follows the project's rule that an extension gate belongs to detection, not to a field reader: the
layout reader takes the source path and checks for `gga`, while the field reader stays free of the gate. The
descriptor registers an empty signature list, which makes the format a candidate for every file — the point of
keeping the gate cheap and first.

## The announced size is a checksum worth having

The header's last field has to equal **three bytes a pixel**, and this is what makes a signature-less format
workable at all: a width, a height and a size that agree to the byte are hard to happen upon. A test with a size
one byte off is declined.

The reference compares that product as a **signed thirty two bit integer**, and the port wraps the
multiplication the same way, because a file can only satisfy the check with a wrapped value. Three times 32767
squared is 3221028867, which does not fit; the reference sees `-1073938429`, and a file announcing exactly that
passes its metadata read. The port accepts such a file and then fails to extract it, since the reference would be
allocating a negatively sized array — a test pins both halves. That test also caught an arithmetic slip in my own
fixture: 32767 squared is 1073676289, not 1073741824, and the first version of the test asserted the wrong wrap.

## Notes

* `Read` seeks to twelve and decompresses with a **stock** `LzssStream` — a frame of 0x1000 bytes filled with
  zero and a write position of 0xFEE — then insists on reading exactly the announced size, so a short stream
  fails rather than filling with zeros. The port uses `inflateLzss` with `outputLength` and compares the result
  with the announcement, which reproduces that.
* Bytes after the payload are ignored: `Read` asks for the announced length and stops.
* The offsets are metadata only — a bitmap has nowhere to put them — and because they are read as **signed**
  sixteen bit values, a stored `ffff` is minus one and is declined.
* The output is a top-down 24 bit bitmap (`ImageData.Create`, so a negative bitmap height), and the padding a
  row needs is the writer's. A two pixel wide test shows the two zero bytes a row.
* Zero dimensions, dimensions above 0x7FFF, a header shorter than twelve bytes and the offsets above are all
  declined. Extraction of an announced size above 256 MiB is refused as a recorded deviation; the reference
  would try to allocate it.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
