# Koei resource archive (`YK`)

Reference: GARbro `Legacy/Koei/ArcYK.cs`, class `YkOpener`, together with its second half
`Legacy/Koei/YkTables.cs` (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).
Implemented as `packages/formats/src/koei/yk-archive.ts` with the tables in
`packages/formats/src/koei/yk-tables.ts`, registered as `koei-yk`.

Two different GARbro engines carry the tag `YK` and the class name `YkOpener`: this one, whose entries
are addressed by a table keyed on the file name, and the Rune one already ported as `rune-yk`
(`Legacy/Rune/ArcYK.cs`), whose entries carry their own index inside the file. They are unrelated
formats that happen to share a name; the gap inventory lists both.

The reference needs no header of its own: `TryOpen` is gated on the file name alone, so detection here
is the same, reading only the extension and the length of the source.

## Detection

The name must end in `.YK`, compared without regard to case, and the base name without its extension,
upper cased, must be either `DATA01` or one of the fourteen names of the offset table. Any other name is
not this format, however the file looks.

## `DATA01`: fixed picture blocks

A `DATA01` file is a whole number of `0x4B400` byte picture blocks. The count is
`length / 0x4B400`, which must divide the length exactly and be a sane count (`> 0`, `< 0x40000`);
otherwise the file is rejected. Each block is one entry, named with five decimal digits and the `.BMP`
extension, at that multiple of the block size, and each is a 640×480 eight bit picture.

## The offset table archives

For the other thirteen names the reference keeps a table of cumulative offsets, one per entry: entry `i`
starts where entry `i - 1` ended and runs to `offsets[i]`. Table lengths range from 10 entries
(`DATA04`) to 982 (`DATA11`). Every entry is checked for placement in the file, and a table that goes
backwards gives a size the reference wraps as an unsigned subtraction, which fails that check and
rejects the whole archive; the port models the same wrap.

Names are the archive name, a `#`, and four decimal digits. Two rules then apply:

* `DATA02`: the entry is a picture when its id is at least 11, or when the geometry table lists it,
  either way gaining the `.BMP` extension. Its geometry is the table's value, except that ids from 189 on
  use one fixed 128×192 shape whatever the table holds. Three ids (4, 9 and 10) are listed by the
  reference with no geometry at all; those entries are named as pictures but never reach a decoder, and
  this port marks them undecoded.
* the names `DATA05` through `DATA15`: the entry is audio, gaining the `.WAV` extension.

## Entry payloads

`YkOpener.OpenEntry` has two special cases and is otherwise a plain copy:

* `DATA03`: every whole word is mixed with `0x12C4D65`. A trailing partial word is left as stored. The
  reference works on the array it has just read, so the port mixes a copy and leaves the caller's buffer
  alone.
* the audio archives: sixteen bytes of a wave head are put in front of the stored data, with the size
  field at offset 4 set to the stored size plus eight (`YkOpener.RiffHeader`). The stored data is
  expected to carry the rest of the format.

## The picture decoder

`YkImageDecoder.GetImageData` reads 256 `BgrX` colour map entries (1024 bytes) and then
`width * height` indexed pixels, and records them through `ImageData.CreateFlipped`, i.e. with the rows
stored bottom up. The entries carry no signature of their own, so rather than register a second image
format this port exports `decodeYkImage(data, geometry)`, which produces a bitmap with a positive height
and the stored row order.

## Deviations from the reference

* The unsigned wrap of the offset table subtraction is modelled explicitly (`(end - current) >>> 0`)
  instead of relying on the placement check to see a negative size, which JavaScript would compare
  differently.
* Every length and placement is checked explicitly; the reference leans on the surrounding `try`/`catch`
  for several of them.
* The picture decoding is exposed as an exported function rather than through the archive format, as
  above.
* GARbro gates on `file.Name.HasExtension(".YK")`; the port compares the extension of `sourcePath` the
  same way, so an archive without a path is not detected.

## The tables

`yk-tables.ts` is generated from `YkTables.cs` rather than retyped: 11 audio names, 185 `DATA02` geometry
entries (of which 3 are `null`) and 14 offset tables holding 6374 offsets in total. The generator asserts
each of those counts against the source.

## Verification

Nine fixtures in `tests/formats/koei-yk-archive.test.ts` cover the name and size gate; the `DATA01` block
plan; a plain offset table plan; the `DATA02` naming, geometry, undecoded ids and the fixed high id
shape; the audio naming and the wave head; the `DATA03` whole word mixing including the untouched
trailing bytes and the untouched input buffer; the bitmap the picture decoder produces, including its
padding and colour map; and detection, listing and extraction through the registered format.

The fixtures assert values read off the reference rather than off this port: the `DATA01` block size, the
`0x168 × 0x90`, `888 × 480` and `128 × 192` geometries, the `0x12C4D65` mixing constant and the
`size + 8` wave head size.
