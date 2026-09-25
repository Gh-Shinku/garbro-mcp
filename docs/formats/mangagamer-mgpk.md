# MG resource archive

Reference: `ArcFormats/MangaGamer/ArcMGPK.cs`, class `MgpkOpener`. The same file carries `Mgpk0Opener`, the
older version of the same archive, which is ported beside this one as `mangagamer-mgpk0`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `mangagamer-mgpk`
(`packages/formats/src/manga-gamer/mgpk.ts`).

## It shares its word with the older version of the same archive

Both open with `MGPK` and are told apart by the version in their head: the older one keeps the version of
**nothing** and holds its names in a fixed field of thirty two bytes with the length of an entry at 0x2C, while
this one keeps every version from **one** up and names the length of a name in front of it, with the length of
the entry at 0x24. The two therefore stand one beside the other without a clash, each reading the space the
other turns away.

## The index

The head names the version at 4 and how many records stand behind it at 8. Every record is forty eight bytes:
the length of the name and the name itself - read as text of its own - and the place and the length of the
entry at 0x20 and 0x24. The reference reads as many bytes of a name as the record names, which may reach past
the record itself; this port bounds the name by the file. A place is kept only when the whole entry stands
inside the archive.

## The key the reference can ask for

The reference unwraps the `png` and `txt` entries of an archive its own key table knows: it keys every byte
with a key that walks on as it goes, and unwraps a `txt` entry out of an LZF stream behind that. The keys
themselves stand under a scheme that ships **empty**, and the fallback asks a user for one, so a stock GARbro
build reads no such archive at all: the plain way is the only one it reaches, and it is the only one this port
keeps. What it does keep is the knowledge that an archive holds such a name - the formats metadata reports
`holdsKeyedNames` - so a caller can tell that the entries it is handed may not be the whole story.

## Verification

Six tests over synthetic fixtures (`tests/formats/mangagamer-mgpk.test.ts`): an archive of two entries listed
and handed over, the names read as text of their own with an empty one kept and a name the reference would key
reported, a text entry handed over as it stands, the head of the older format turned away, a head that names
nothing with an entry reaching past the end, and the word the archive is told by.
