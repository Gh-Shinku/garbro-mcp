# Windows executable resources (`executable-resources`)

Reference: `Experimental/Microsoft/ArcEXE.cs`, class `ExeOpener`, tag `EXE`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

The resources of a Windows executable, listed as the files of an archive. The reference stands of
`ExeFile.ResourceAccessor`, i.e. of the resource table of a portable executable, and of two tables of its
own:

* `RuntimeTypeMap` names the numbered kinds of resource the reference knows a directory for (`#2` is
  `RT_BITMAP`, `#10` is `RT_RCDATA`, `#16` is `RT_VERSION`); a numbered kind that stands in no table of it
  is **left out of the listing**,
* `ExtensionTypeMap` gives the extension of a file of every kind (`PNG` is `.PNG`, `#2` is `.BMP`, `#10` is
  `.BIN`), and a kind that stands in no table of it stands of no extension at all.

A file of the listing is named `<directory>/<name><extension>`, where a numbered name stands of five places
(`IdToString`: `#2` is `00002`). The places of every file of the listing stand at **nought**, as the
reference itself writes them (`entry.Offset = 0; // bogus XXX`), because the places of a resource stand in
no single run of the file.

`OpenImage` stands of a picture of the kind `#2`: the reference puts the fourteen places of the head of a
bitmap file in front of the resource, writes `BM` and the count of the places of the file into it, and works
out the places of the picture itself - from the counts of the places of the picture where they stand of a
count, and from the head of the picture itself (`biSize`) where they stand at nought.

`OpenEntry` stands of the version of the file of the kind `#16` as a **text** where `OpenRtVersionAsText`
stands set (a walk of the version resource of its own), and of the places of the resource as they stand for
every other kind.

## The port

`packages/formats/src/microsoft/resources-archive.ts`. The walk of the resource table stands of this
project's own reader (`shared/exe.ts`, `readExecutableResources` and `findExecutableResource`), which reads
the same table the reference's accessor does. Every file of the listing carries the native kind and name of
its resource, and the places of a file stand of a **second look** at the resource table of the executable
where they are asked for, the places of a resource standing in no single run of the file.

## Deviations from the reference

* The version resource of the kind `#16` stands **handed over as it stands** rather than written out as the
  text the reference makes of it (`OpenVersion`, reached through `OpenRtVersionAsText`). The reference's
  walk builds a `BLOCK "…"` / `VALUE "k", "v"` text of the version resource; the places of the resource
  itself therefore stand as they stand, and the walk itself is not carried.
* A resource too short to hold the two counts of the head of a picture (`biSizeImage` at `0x22` and `biSize`
  at `0x0E` of the head of the bitmap) stands of the count of the places of the file, where the reference
  would read the counts out of a resource that does not hold them.
* The port walks the whole executable twice for every file of it (once for the listing, once where the
  places of a file are asked for); the reference keeps a live accessor. The walk itself stands the same.

## Verification

`tests/formats/executable-resources.test.ts` (3 tests), against an image built in the test: a minimal 32 bit
image whose one `.rsrc` section carries three resources of the kinds `#2`, `#10` and `#6`.

* the shape of a name of a file of the listing (`executableResourceId`) and the head of a picture of the
  engine, of the counts of the places of a picture standing at nought (`14 + biSize` = `54`);
* the listing of an executable: the two resources of the kinds the reference holds a name for, the kind it
  does not left out, the places of a picture of the kind `#2` (`BM`, the count of the places of the file and
  the places of the picture of the head itself), and the places of a resource of another kind as they stand;
* the refusals: an executable of no resource at all, and a file of no word of an executable.
