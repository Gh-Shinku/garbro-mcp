# UMeSoft ike bitmap

Reference: `GARbro/Legacy/UMeSoft/ImageIKE.cs`, class `IkeFormat` ("ike-compressed bitmap")
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ume-soft/ike-image.ts` (`ikeImageDescriptor`, `ikeImageFormat`, id
`ume-soft-ike-image`).

| field | offset |
|---|---|
| signature `9D 89 69 6B` | 0 |
| marker `ike` | 2 |
| unpacked size, three bytes | 10 |
| the codec's stream starts here | 0x0D |
| the first decoded literal, `BM` | 0x0F |

## Three formats, one signature

The Ike family now has three members in this project — the BIN archive, this bitmap and `ume-soft-ike-audio` —
and the last two register **the same three byte tag**. What separates them is a single byte at offset 0x0F: the
bitmap requires `BM` there, the audio requires `RIFF`. Both are the *first literal of the compressed stream*,
which is why they sit at 0x0F rather than wherever a header field would: the codec starts at 0x0D and its
stream begins with a sixteen bit flag word.

A test checks both formats against both payloads and expects exactly one to accept each, and the audio port's
doc explains the same adjacency from its side. Neither format can lean on the dispatcher's signature gate,
because the gate cannot tell them apart — which is the concrete reason this project's rule about re-checking a
signature inside `detect` exists.

## The probe decompresses only a header

`ReadMetaData` decompresses exactly **0x36** bytes — a bitmap header — and hands that to the bitmap reader for
the dimensions and the depth, while `Read` decompresses the size the Ike header declares. The port does the
same: the probe is parsed for width, height and depth, and the extraction decompresses the declared size.

That split has a visible consequence, and a test pins it. The probe does not depend on the declared size, so a
file whose declared size covers only the fifty four byte header **lists successfully** with correct metadata and
**fails on extraction**, which is where the reference's `Bmp.Read` first notices. The port fails there too,
because it reads the unpacked surface with the shared bitmap reader before handing it out.

## Notes

* The extraction stands of `IkeFormat.Read`, which is `Bmp.Read` over the unpacked surface: the surface stands
  read with the shared bitmap walk of this project — one, four, eight, sixteen, twenty four or thirty two places
  of a colour to a pixel, top down — and handed over as a bitmap of its own, so the places of a colour of the
  picture stand of the surface rather than of the bytes of the file. A surface the shared walk cannot read fails
  on extraction. The test reads the extraction back and compares its places of a colour with those of the fixture.
* The probe checks the DIB size is at least forty, the width and height are non-zero, and the height is taken as
  an absolute value, since a bitmap records a top-down image with a negative one.
* Zero dimensions, a DIB size below forty, a wrong marker, a wrong signature, a header shorter than seventeen
  bytes and a declared size above the codec's 64 MiB limit are all declined.
* The size field shares the audio format's encoding, whose first byte carries six significant bits, so the same
  truncation behaviour applies; the ceiling is unreachable through the encoding and is kept as a guard.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
