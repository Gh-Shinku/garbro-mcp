# Windows 16-bit executable resources (`EXE/NE`)

Reference: GARbro `Experimental/Microsoft/ArcNE.cs`, class `NeExeOpener` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/microsoft/ne-archive.ts`, registered as `microsoft-ne-archive`.

A 16-bit Windows executable declares its resources in a table that the NE header points at, and the
reference reads that table as an archive: one entry per resource, named after its type and its id. The
format needs no key and no companion file.

## Detection

The reference is exported with `Priority -2` and `Signature => 0`, and its `TryOpen` starts from the DOS
stub, so the port declares the `MZ` bytes as its signature hint with the same priority and then checks the
structure: the file must be at least as long as the DOS header, the long word at `0x3C` must point at an
`NE` signature inside the file, and the resource table that the word at `NE + 0x24` gives, added to the NE
offset, must lie strictly between the NE header and the end of the file.

## The resource table

The table opens with the resource alignment shift count. What follows is a sequence of type records, each
an id, an entry count and a reserved word, and each followed by its entries; the sequence ends at a zero
type id. An entry record holds the offset and the size in the high words, both to be shifted left by the
shift count, and the resource id at `+6`. The names the reference builds are

```
<type>/<id, five digits>
```

where the type is `#<id>` for every type except the ones the reference lists in its `TypeMap`
(`RT_CURSOR`, `RT_BITMAP`, `RT_ICON`, `RT_MENU`, `RT_DIALOG`, `RT_STRING`, `RT_DATA`, `RT_MESSAGETABLE`
and `RT_VERSION`).

Two details of that naming are easy to get wrong:

* the map is consulted **only** for a type word whose integer flag `0x8000` is set. A file whose type word
  is the plain number 10 is therefore filed under `#10`, even though the map holds `RT_DATA` for that
  number. The port follows the reference and uses the same name for the entry path and for the
  `resourceType` metadata.
* a resource id with the same flag set has it cleared for the name, but the id is not otherwise resolved:
  the reference does not follow a name string, so a *named* resource is still named after the number in
  its id field.

## Entry payloads

`OpenEntry` hands out the stored bytes, with a single special case for `RT_VERSION` described below.
`NeExeOpener` does not check that an entry lies inside the file, so a table may describe an entry that
cannot be read; the port keeps the entry and lets the read fail, rather than rejecting a whole archive the
reference would open.

## The version resource path the reference cannot reach

`NeExeOpener.OpenVersion` is meant to reformat an `RT_VERSION` payload as text. Its own read cannot get
there. After consuming the resource length and the value length, it compares the next string with
`VS_VERSION_INFO`, but the next field is the version resource's type word — two zero bytes, which read as
the empty string — and it decodes the key as CP932 although a version resource stores its key as UTF-16.
The comparison therefore always fails, the read breaks out of its loop, and the stored bytes are returned
as they are.

The sibling parser in `Experimental/Microsoft/ArcEXE.cs` shows the intent: it reads that third word
(`int type = input.ReadUInt16()`) and decodes the key with `Encoding.Unicode`. The port keeps to the
reference's behaviour and hands the payload over unchanged, and marks such an entry with a
`versionResource` metadata flag so a caller can tell it apart. One test builds a conforming version
resource and shows that it comes back byte for byte.

## Deviations from the reference

* The table walk is bounded: the port stops when a record would not fit the bytes it was given, where the
  reference reads past the end of a malformed table and lets the read throw. A well formed table is
  unaffected.
* Detection reads a 64 KiB head of the file and passes the full size as the loop's bound; extraction reads
  the whole file, so a table that reaches past that head is described by extraction and not by detection.
  The resource table of a real executable is far smaller than that head.
* The shifted offset and size are computed as unsigned 32 bit values, where the reference keeps them in a
  signed `int`; a shift large enough to overflow is not something a real file does, and the port documents
  the difference rather than reproducing the sign.
* The format is registered with the `exe` extension for the CLI's benefit; detection is by signature and
  structure, not by extension.

## Verification

Six fixtures in `tests/formats/microsoft-ne-archive.test.ts` cover the header and pointer rejections, an
empty table, a table cut short inside an entry record, the walk over a table holding a listed type, a
numeric type, `RT_VERSION` and an unlisted type with the integer flag, the name and id rules above,
detection, listing, extraction, and the version resource passthrough. The fixture's offsets and sizes are
chosen so that the shift is visible in the expectations (`0x10` at shift 4 gives `0x100`).
