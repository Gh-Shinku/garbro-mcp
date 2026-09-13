# Ice Soft ISD binary script

Reference: `GARbro/ArcFormats/Ice/ScriptISD.cs`, class `IsdScript`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ice/isd-script.ts` (`isdScriptDescriptor`, `isdScriptFormat`, id
`ice-isd-script`).

A **TPW compressed script**. The signature is `TPW` plus a version byte (`0x01575054`), followed by the
unpacked size and then the control stream:

| field | offset |
|---|---|
| signature `TPW\x01` | 0 |
| unpacked size (`i32`) | 4 |
| TPW stream, first word included | 8 |

GARbro's `ConvertFrom` calls `GrpOpener.UnpackTpw`, which lives in the **Ankh** archive opener
(`ArcFormats/Ankh/ArcGRP.cs`) and is shared across engines. This repository already had that decoder,
ported and verified with the Ankh GRP family in `packages/formats/src/ankh/grp-unpack.ts`, so this port is
a thin wrapper over the existing `unpackTpw` rather than a second implementation of the same codec.

The port exposes the resource as a single entry:

* detection checks the signature and reads the unpacked size, which is all the reference needs to list the
  file — its `IsScript` compares the signature and its `ConvertFrom` reads the size word without
  decompressing. The size must be positive and is capped at 64 MiB so a hostile header cannot ask for an
  unbounded allocation; a zero or negative size would make the reference allocate an empty or invalid array
  and fail, so declining it is equivalent;
* extraction decodes the stream into a buffer of exactly the declared size. The decoder stops on a zero
  control byte, so a stream that ends early leaves the remaining bytes **zero** — tested — and a truncated
  control word is rejected, which is also tested;
* the entry is named after the source file with a `bin` extension, because the reference hands the unpacked
  bytes through unchanged and they are binary rather than text. It covers the compressed payload, is
  flagged `compressed: true` and sets `sizeKnown: false` since the stored length is not the extracted one;
* entry metadata carries `type: "script"` and the unpacked size, and the archive metadata records
  `script: "isd"`, `compression: "tpw"` and the unpacked size.

The reference class declares no extension list, so the descriptor registers `isd`.

Encoding and archive creation are out of scope.

## Sharing the marker with the bitmap format

`TPW\x01` also starts `IbmFormat`, an image format whose second word is the size of a compressed bitmap. The
reference keeps the two in different format lists, so it never has to choose; a single registry does. Detection
here therefore decompresses the same fifty six byte prefix the bitmap format inspects and steps aside when it is
a bitmap header — see `docs/formats/ice-ibm-image.md`. Naming and extraction are unchanged, and a cross-format
test asserts that each file reaches exactly one of the two.
