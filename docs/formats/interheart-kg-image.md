# Interheart image

Reference: `GARbro/ArcFormats/Interheart/ImageKG.cs`, class `KgFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/interheart/kg-image.ts` (`interheartKgImageDescriptor`,
`interheartKgImageFormat`, id `interheart-kg-image`).

A **thirty two bit image with alpha runs**. The file starts with `GCGK` (the reference's word `0x4B474347`),
then the width (`0x04`, word), the height (`0x06`, word) and the **packed size** (`0x08`, word), which only has
to be positive. Twelve bytes in comes a table of **row offsets**, one word a row, counted from the byte after
the table; each row's run stream lives at its own offset.

A run is **two bytes and then its pixels**: the **alpha** and a **count**, where a count of zero stands for
`0x100` pixels. An alpha of zero is a **transparent run** — the reference writes nothing for it and skips the
pixels it covers, which is why they stay zero in the bitmap, alpha included — while any other alpha is followed
by **three bytes per pixel** in red, green and blue order, which land in the bitmap as BGRA.

Details worth recording:

* the reference reads a row's stream until it has counted `width` pixels, so a token whose count overshoots the
  row ends it early while the pixels it claimed still shift every following row, because the output index is a
  single running number. The port refuses such a run instead, a documented deviation on malformed input;
* a run whose pixels would fall outside the file fails, in the port as a `GarbroError`;
* the reference allocates `width * height * 4` bytes and passes neither a stride nor a flip, so the bitmap is
  **top down** with tight rows;
* the class declares **no extension**, and its third signature branch — a first word of `1` with the depth read
  behind it — is unreachable, because that form is only reached through the zero signature pass and this class
  declares no extensions to be matched by. The port registers `GCGK` alone.

The tests cover the marker and the header checks, the metadata, a visible run, a transparent run, a count of
zero, the per-row offset table with the bodies stored out of order, the two failure cases and the entry name.
