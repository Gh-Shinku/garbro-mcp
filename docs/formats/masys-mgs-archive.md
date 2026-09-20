# Masys audio resources archive (`MGS`)

Reference: GARbro `ArcFormats/Masys/ArcMGS.cs`, class `MgsOpener` with its `PcmDecoder` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/masys/mgs-archive.ts`, registered as `masys-mgs`.

The archive holds sounds of the engine: each record names a payload, gives it a format byte, and stores it
with its size and offset. Nothing is compressed at the archive level, but a wave payload may be packed, and
that packing is the part worth reading carefully.

## Detection and the record walk

The file opens with `MGS`, a flag word at 3, and a signed 16 bit record count at `0x20` that must be sane.
Records then form a chain from `0x22`:

| offset in record | field |
| --- | --- |
| 0 | the format byte: 0 wave, 1 midi, anything else opaque |
| 1 | the channel word, for a wave |
| 3 | the sample rate, for a wave |
| 7 | the bits per sample, for a wave |
| 9 | the length of the name |
| 10 | the name, and any bytes the length leaves |
| 10 + length | the stored size, then the data offset |

The name carries no extension of its own: it is run through the reference's format map, so a wave record
becomes `.wav` and a midi record `.mid`, and every other format has its extension **removed**, which is
what `Path.ChangeExtension (name, null)` does. A zero name length, a record that would reach past the file,
and a payload that fails the placement check all reject the archive.

When the flag word is 100 the names are XORed with a repeating key. That key and the walk over it are
`MgdOpener.Decrypt`, which the reference calls from this file too, so the port exports the helper from its
MGD module and shares it rather than writing a second copy.

## Unpacking a record

`OpenEntry` hands an opaque payload over unchanged. A wave payload is wrapped in a canonical RIFF header
whose format tag is 1, whose channel count has the high bit of the stored channel word cleared, and whose
bits per sample is 16 for a packed payload and the stored value otherwise; the block align and the average
bytes per second follow from those.

The high bit of the channel word marks a payload the reference decodes itself. Its `PcmDecoder` reads a
chunk of `BytesPerChunk` bytes — and `BytesPerChunk` is the **stored bits per sample**, which for these
files is a chunk size rather than a sample width:

* one channel: a 16 bit seed sample, a 16 bit word whose low byte is the starting quantiser, then
  `BytesPerChunk - 4` octets holding two samples each;
* otherwise: two seed samples with their quantisers, then `(BytesPerChunk - 8) / 8` iterations of one 32 bit
  word per channel, each holding eight nibbles.

The nibble walk is the Abogado `AdpDecoder`, which the reference reaches by name (`using
GameRes.Formats.Abogado`), so the port reuses the Abogado decoder it already had and adds the `Reset`
method that method's chunks need. A nibble's low four bits choose the step from the quantiser table and move
the quantiser along it; the top bit says which way the step goes. Note that this walk takes the **low**
nibble of an octet first, where the container walk of the Abogado port takes the high one first.

## Deviations from the reference

* Every record, name and payload bound is checked; a packed payload that ends inside a chunk, or that would
  outgrow the chunk count the size implies, raises a `GarbroError` where the reference lets the read throw.
* The record's format fields travel through the entry metadata, so extraction does not walk the index a
  second time.
* The starting quantiser is taken modulo the table, where the reference indexes the table directly; a real
  file keeps it inside the table.
* A channel count above two follows the two channel path, exactly as the reference's `if (1 == Channels)`
  does.

## Verification

Eight fixtures in `tests/formats/masys-mgs-archive.test.ts` cover the rejection paths (missing signature, an
empty and a negative count, a zero name length, an out of range payload, a truncated archive), the record
walk with the format driven renaming including the removal of an unknown format's extension, an XORed name,
the packed sample walks, the RIFF wrapping of a stored payload, and detection, listing and extraction
through the registered format.

The packed expectations are derived from the reference's own tables by hand rather than from the port: with
the starting quantiser at zero the table holds `0x0007`, so a nibble of fifteen steps down by
`((2 * 7 + 1) * 7) >> 3`, i.e. thirteen, and moves the quantiser by eight to the step `0x0010`, where a
nibble of zero steps up by two.
