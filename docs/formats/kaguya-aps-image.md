# KaGuYa APS tiled image (the older container)

Reference: `GARbro/ArcFormats/Kaguya/ImageAPS.cs`, class `ApsFormat : Aps3Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/aps-image.ts` (`apsImageDescriptor`, `apsImageFormat`, id
`kaguya-aps-image`).

| field | offset |
|---|---|
| name count (`i16`), 1 to 1000 | 0 |
| names, each an `i32` length then that many bytes | 2 |
| tile count (`i16`), 1 to 1000 | after the names |
| tiles, each an `i32` length, the name, 0xC skipped, a rectangle, 0x28 skipped | after the tiles' count |
| compression header, no payload size word | after the tiles |

## No signature: the table shape is the identity

`Signature` is zero, so nothing is registered and the probe is the parse itself. What makes that safe is how
strict the shape is: both counts have to be between **one and a thousand**, and every name between **one and two
hundred and sixty** bytes. A test runs through zero and over-large counts and zero and over-long names and shows
each one declined — and an empty or arbitrary file fails at the first count.

The separation from the newer container is automatic rather than arranged: `APS3`'s four byte signature reads as
a name count of 0x4104, which is far above the ceiling, and this format's own files have no version byte for
`APS3` to accept. A test asserts both directions.

## How it differs from APS3

The two generations share a payload format and the same compression header, but their tables are different
enough that the port keeps two readers:

| | APS3 | APS |
|---|---|---|
| identity | `\x04APS` plus a `3` | the table shape alone |
| name lengths in the first table | one byte | `i32` |
| payload size word before the header | present, checked, unused | absent |
| tiles skipped after the name | `i32` then the name, then 12 bytes | the name, then 12 bytes |
| tiles skipped after the rectangle | 12 bytes | 0x28 bytes |
| union | only tiles with a name | every tile |

The union rule follows from the guards: this format has already refused a zero length name, so every tile
contributes, while APS3 tests the name length explicitly. In both, the box starts at the origin and therefore
always contains it — a test gives a tile at (10, 10) reaching (15, 15) and gets a fifteen by fifteen image.

## One payload reader

Both containers end with the same question — is the payload packed, and if so what does the KaGuYa LZ codec
make of it — and the answer is always "a complete `AP` image". That path lives in one exported function,
`readApsPayload`, which the two formats call from their `openEntry`; the compression header parse and the
rectangle union are shared the same way. The payload inherits the base format's conventions: bottom-up rows
reversed into a top-down bitmap.

The refactor that pulled those helpers out of the APS3 port was committed on its own, before this format
existed, so the change that introduced it stayed behaviour-neutral and its tests could prove it.

## Notes

* The declared extensions are `aps` and `parts`; neither is a gate.
* Because the extraction gains a header, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
* With this port the whole Kaguya image family is complete: AP, AO, AP-0, AP-2, AP-3, APS3 and APS.
