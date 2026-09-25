# Marble engine graphics archive

Reference: `ArcFormats/Marble/ArcMBL.cs`, class `GraMblOpener`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `marble-gra-archive`
(`packages/formats/src/marble/mbl-archive.ts`), beside the resource archive of the same engine.

## The head

This archive writes no word of its own either, and the reference tells it by the **name of its file**, which
has to be `mg_gra` and nothing else. Its head names the length of a name at 0 and how many entries stand
behind it at 4, the length lying between eight bytes and sixty four. Every record holds a name, the place of
the entry and its length, and the place has to stand behind the index, with the whole entry inside the
archive. Every entry is named after a picture - the reference gives it the extension `bmp` whatever the file
called it - and stands as an image.

## The entries

An entry is handed over as it stands, unless its first byte is `0x78`: that is the first byte of a zlib
stream, and the reference then inflates the entry. This port does the same, and refuses an entry whose zlib
stream does not read, where the reference's own stream would fail while it is read.

## Verification

Three of the six tests of the resource archive beside it cover this one (`tests/formats/marble-mbl-archive.test.ts`):
the zlib stream of an entry inflated and the plain bytes of another handed over as they stand, the names of
the entries as the reference writes them, and the same bytes under another name of a file turned away.
