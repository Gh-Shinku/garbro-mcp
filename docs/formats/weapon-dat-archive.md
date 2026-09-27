# Weapon resource archive (`weapon-dat-archive`)

Reference: `Legacy/Weapon/ArcDAT.cs`, class `DatOpener`, tag `DAT/WEAPON`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Also ported beside it: the voice archive of the
same engine, `weapon-voice` (`Legacy/Weapon/ArcVoice.cs`).

## What the format is

An archive of this engine carries **no index at all**. The reference holds the index itself: for every name
of an archive the engine ships, `KnownFileTables` holds a list of the dimensions of the pictures of that
archive, in the order they stand in the file. `TryOpen` looks the archive's own name up in that table and
refuses the file when the name is not there; every picture then stands of `Width * Height * 2` bytes, one
behind the other from the head of the file, and `CheckPlacement` refuses the whole archive when the last of
them would reach past the end of the file. A picture is named `<base>#0000`, `<base>#0001` and so on, where
`<base>` is the archive's own name without its extension.

`OpenImage` hands the bytes of a picture to `CgDecoder`, which stands of the file *in place*: for every two
bytes it computes

```text
high = (first << 2) | (second & 3)
low  = (second >> 2) | (first & ~0x1F)
```

and writes `low` first. The result is a `Bgr555` picture, i.e. five bits per colour in the order blue,
green, red, and the port writes it out as a 16 colour-bit bitmap whose head names the top down order of its
rows (`CgDecoder` hands its rows over from the first of them).

## The port

`packages/formats/src/weapon/dat-archive.ts` holds the eight lists of the reference verbatim, read off
`ArcDAT.cs` itself rather than retyped, and the walk above. The format is **name gated**: it stands last
among the formats that claim the `.dat` extension, and `detect` accepts a file only when its own name stands
in the lists *and* the whole list of its pictures fits within the file.

## Deviations from the reference

* **A picture of an odd count of bytes** stands refused (`INVALID_ARCHIVE`). The reference walks in place two
  bytes at a time and would drop the last byte silently; every picture of every list of the reference stands
  of an even count (the dimensions of a picture are the counts of a picture and every one of them stands of
  two bytes), so the refusal cannot stand in the way of a real file.
* The reference's `TryOpen` returns `null` where its `CheckPlacement` fails, which is the reference's way of
  saying "not this format"; the port's `detect` answers the same question with the same walk and its `read`
  then throws `INVALID_ARCHIVE` rather than returning a listing of no picture.
* The reference exports this opener only in a **debug** build (`#if DEBUG [Export(typeof(ArchiveFormat))]
  #endif` in front of the class), so a stock release build of GARbro does not list the format at all. The
  port carries it because the algorithm stands in the reference and the project's own deliverable list holds
  the row; the tag, the class and the walks above are unaffected by the guard.

## Verification

`tests/formats/weapon-dat-archive.test.ts` (4 tests) pins the eight lists (their names, their counts and two
of their orders), the derived places of a 14 picture archive of `heyacg.dat` (`0`, `82128`, ..., `1067664`),
the two names at the ends of the listing, and the picture walk against pairs worked out **by hand**:
`00 07` and `0e 15` stand of `01 03` and `05 39`, the last place of the picture
(`a2 a9`) stands of `aa 89`, and `1f 00` stands of `00 7c`. Refusals: a name no list holds
(`other.dat`), a truncated `heyacg.dat`, and an odd count of bytes handed to the walk. The name gate is
pinned in both spellings, `heyacg.dat` and `HEYACG.DAT` (the reference compares names without regard to
case, `StringComparer.OrdinalIgnoreCase`).
