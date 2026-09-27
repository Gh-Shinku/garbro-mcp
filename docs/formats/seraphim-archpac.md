# Seraphim engine resource archive (`seraphim-archpac`)

Reference: `ArcFormats/Seraphim/ArcSeraph.cs`, class `ArchPacOpener`, tag `SERAPH/ARCH`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

The reference reads **two shapes** of this archive, and the difference is where the index stands.

The first shape stands of `KnownSchemes`, a table keyed by the name of the game that holds the place of the
index of every one of them - "different index offsets hardcoded into game executable", as the reference's own
note says. That table ships **empty** (`new Dictionary<string, ArchPacScheme>()`), and the walk of that shape
starts at the place a scheme names and continues from there, every index naming the place of the next.

The second shape needs no scheme at all. Where the file of the archive is named `ArchPac.dat` and a
`ScnPac.dat` stands beside it, the place of the index stands in that companion itself:

```text
first_offset = the count of the places of the file at 4 of the companion
index_offset = the count of the places of the file at `first_offset - 4` of the companion
```

The index behind it is a list of **runs**: the count of the runs (at most `0x40`), the count of the files of
the archive, and then a place of the file and a count of files for every run. The files themselves stand of a
window of one place more than there are runs, walked from the **last** run of the index down to the first:
the place in front of a file is the place of the file itself, the count of the places of a file stands of the
place of the next one, and every place of a file stands of the place of the run itself. A file of no places
stands of no file of the listing. The name of a file is `<run>-<%05d>.cts`.

The places of a file of the engine stand of zlib where the head of the file names it: the word `0x9C78` at
the head of the file (a stream of zlib as it stands), or the count one at the head of the file with a place
of `0x78` behind it, the four places of that head skipped.

`OpenImage` stands of `OpenRawImage`: where the head of the places of the file names counts of a place of a
picture that stand within the counts of the reference (`Width` at most `0x4100`, both counts of the place
above nought, and the count of the places of the file behind the head a count of the places of the picture),
the file stands of a picture of twenty four places of a colour, of three places of the file for every place
of the picture, read straight through.

## The port

`packages/formats/src/seraphim/archpac.ts`, of the **second** shape: the companion, the head of it, the walk
of the runs and of the window of places, the zlib places of a file and the plain picture of a file. The
format is name gated (`ArchPac.dat`) and companion based (`ScnPac.dat`), and it stands last among the
formats that claim the `.dat` extension.

## Deviations from the reference

* The **first** shape of the archive - the one that stands of `KnownSchemes`, with the index inside the
  archive and every index naming the place of the next - is **not carried**: the table stands empty in the
  reference (as it does for the port, which holds no scheme of a game and no place to take one from), so no
  archive of that shape can be told at all.
* The **event map** of a scheme (`EventMap`, which names the base picture an entry stands over) is not
  carried either, for the same reason: it stands of a scheme. Where a scheme of the reference would compose
  an overlay, this port hands the places of a file over as they stand; where the reference would decode a
  `CT` picture of the same engine (`OpenCtImage`), the port hands the places of the file over as well - the
  `CT` walk itself **is** carried by this project as `seraphim-ct-image`, of `ImageSeraph.cs`, but that
  module's reader stands of its own format rather than of a call from here.
* Where the head of a file names no counts of a picture the reference stands of, the reference falls back on
  its image walk of the whole engine (`ImageFormatDecoder`); this port hands the places over as they stand.
* The reference refuses a file of the shape of this port where its own name is not `ArchPac.dat`
  (`IsPathEqualsToFileName`), and a companion of no index; the port's `detect` answers `false` in the same
  places and its `read` throws `INVALID_ARCHIVE`.

## Verification

`tests/formats/seraphim-archpac.test.ts` (4 tests):

* the walk of the index: a two run index of three files, whose places the test works out **by hand** (the run
  of two files stands first of the listing, of the places `0x210` and `0x220`, and the run of one behind it
  at `0x140`, every one of them a place of the run itself plus a place of the window), and the refusals of
  the walk (a file standing past the end of the archive, and a run naming more files than stand behind it);
* the listing and the picture of an archive of the engine, through real companion files in a temporary
  directory: the three names, and the file of the first run handed out as a bitmap of twenty four places of a
  colour whose places of the colours stand of the places of the file of the archive;
* the picture of a file of the engine, of the counts of the head of it (and the refusal of a width past the
  counts of the reference), and the places of zlib behind a file of both heads the reference names;
* the refusals: a file of another name, and a name of the engine of no companion at all.
