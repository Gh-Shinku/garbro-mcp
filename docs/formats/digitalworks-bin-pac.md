# Digital Works resource archive

Reference: `ArcFormats/DigitalWorks/ArcBIN.cs`, class `BinOpener` (tag `BIN/PAC`), together with the half of
`ArcFormats/ExeFile.cs` that reads a Windows executable's own headers. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `digitalworks-bin-pac`
(`packages/formats/src/digitalworks/bin-pac.ts`) on the shared helper `packages/formats/src/microsoft/exe-file.ts`.

## The archive holds no index of its own

A `.bin` or `.pac` archive of this engine is a plain run of bytes; where its entries stand is kept in the
**executable** that stands beside it. The reference knows two ways to find that index:

* a table of ready made indexes, one for every archive name of every game it knows. **That table ships
  empty** (`KnownSchemes` is a new, empty dictionary), so a stock build never takes this way; and
* the way this port keeps: the archive's **own size**, written twice over in twelve bytes, is searched for in
  the executable's `.data` section, four bytes at a time. The executable stands in the **parent** of the
  directory that holds the archive, and the first one that carries the mark is the one used.

## The index

The mark names the size the archive had when the index was written. The index itself stands **behind** the
mark, twelve bytes to an entry, and is walked **backwards**:

```text
offset  u32   where the entry stands in the archive
size    u32   how many bytes it takes
packed  u16   one when the entry is packed, nothing when it stands as it is
id      u16   the number the entry's name is built from
```

Every entry has to stand **before** the one read before it, and no entry may reach past the archive, so the
walk ends where the archive itself begins. A walk that meets an entry of no size, an entry that reaches past
its predecessor, or a packed word that is neither nothing nor one, gives up and the file is not an archive of
this engine.

An entry is named `<archive name><number: five digits>.<extension>`, where the extension comes from a table
of the engine's own archive names - `ANM` is a `BIN`, `MOV` an `MPG`, `STR` an `OGG`, `TAK` a `BIN`, `VCE` an
`OGG`, `VIS` a `TMX` and `_SE` an `OGG` - and is **empty** for a name the table does not know, which leaves
the name ending in a dot exactly as the reference writes it.

## The shared executable reader

`packages/formats/src/microsoft/exe-file.ts` ports the managed half of the reference's `ExeFile`:

* the header of the file (`MZ`), the second header it names at 0x3C, and whether that header is a
  thirty-two-bit `PE` one or a sixteen-bit `NE` one;
* the section table of a thirty-two-bit executable - its name, its virtual size and address, its stored size
  and place, and its flags - and the **overlay** behind the last section, rounded up to sixteen bytes;
* the segments of a sixteen-bit executable, which carry no names of their own and so leave the section map
  empty;
* the base the executable is loaded at, and with it the two ways a **virtual address** is turned into a place
  in the file: the section it stands in, and the offset inside that section;
* a place in the file found by a run of bytes, stepping as the caller asks, and a name read up to its first
  nothing.

## Deliberate deviations

* **The Windows loader is not ported.** The reference's `ResourceAccessor` reaches an executable's resources
  through `LoadLibraryEx`, `FreeLibrary`, `FindResource`, `LoadResource`, `SizeofResource` and the
  enumeration callbacks behind them, all of them the operating system's own. That is why the `EXE` archive
  format stands unported, and this helper keeps only what can be read from the file itself.
* A file that is not a Windows executable, and one whose second header is missing or malformed, gives back
  **nothing** where the reference throws. A caller walking several executables can therefore walk on, which
  is what this port's own search does.
* Every read is bounded to the file; the reference reads past the end of its own view in places.

## Verification

Five tests, all on hand-built files: a thirty-two-bit executable built word by word, whose `.data` section,
its overlay, its loaded base, a name read back from a virtual address and a place turned from a virtual
address are all checked; an index walked backwards from its own mark, with the order of its entries, their
sizes and their packed words checked, and the extensions the engine's name table gives; a file whose word is
not `MZ` and one whose section is renamed, both turned away; and the whole format over **two real files** in
a directory - the archive below the executable's own directory, as the reference looks for it - with the
entry names, the extracted bytes and the refusals for a missing executable and a name the engine never uses.

What stands on the reference alone: no fixture here holds a *packed* entry's unpacked picture - the port
hands a packed entry over as it stands, as the reference's own `OpenEntry` does not unpack either - and no
real game is on hand to compare against GARbro's output.
