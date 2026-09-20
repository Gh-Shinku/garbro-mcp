# DxLib engine resource archive

Reference: `GARBro/ArcFormats/DxLib/ArcMED.cs`, classes `MedOpener` and `ScrMedArchive`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/dxlib/med.ts` (`medDescriptor`, `medFormat`, id `dxlib-med`,
`readMedIndex`).

## The index

The reference registers no word of its own and tells an archive of this kind by the words `MD` in the first two
places of the file. The head names how many places every place of the index stands in and how many places of
the index stand, the first place of the index standing at `0x10`; every place of the index then names a file of
the archive in the places that stand before its own words, and those words name how much of the file stands and
where its places stand. A place of the index of fewer than eight and one places, an index of no places, and a
place of a file that stands outside the archive stand as no archive at all.

## Deviations from the reference

- The reference reads the name of a file of the archive as the words of the engine stand, which this kind of
  file system reads as the words of the kind of file systems that name them; this port reads them as the words
  of this kind of file system and stops at the first place of no words.
- A file of the archive the index names with nothing stands as no words at all in the reference; this port names
  it by its place in the index so that every file of the archive stands under a name of its own.
- The reference reads an archive whose name ends in `_scr` through the places of a scheme of the words of the
  engine, which stand as no places at all where no words of the engine stand beside the archive, and asks for
  the places of a scheme where none stand; this port reads the places of such an archive as they stand and
  reads no places of a scheme at all.
- The reference names the kind of every file of the archive behind its own words, one kind of picture of the
  engine among them; this port hands the places of a file of the archive out as they stand and reads no kind of
  file behind them.

## Tests

`tests/formats/dxlib-med.test.ts` covers the index of an archive, the heads it is turned away for, the places
of the files of an archive handed out as they stand, a place of the index that names a file standing outside
the archive, and the words of the head the archive is told by.
