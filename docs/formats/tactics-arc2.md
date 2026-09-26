# `tactics-arc2`

The second shape of an archive of the Tactics engine. The port is read from
`ArcFormats/Tactics/ArcTactics.cs`, class `Arc2Opener`, at GARbro's baseline commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. The first shape of the same archive, class `ArcOpener` of the
same file, is the port `tactics-arc`.

## The format

The head is the same as the first shape's: the word `TACT` at the head of the file and the words
`ICS_ARC_FILE` at 4. The two shapes part at 0x10. The first shape stands of a **packed index** there (the
count of the places of the index, the count of the places the index stands of, and the count of the
pictures), which the port `tactics-arc` reads; the second shape stands of a **flat list** of the pictures
themselves:

| at | of what count | what stands there |
| --- | --- | --- |
| 0 | 4 | the count of the places of the picture in the file |
| 4 | 4 | the count of the places the picture stands of where its places are packed, of nought where they are not |
| 8 | 4 | the count of the places of the name of the picture |
| 0xC | 8 | places the reference itself stands of no use of |
| 0x10 | the count at 8 | the name of the picture |
| behind the name | the count at 0 | the places of the picture |

The list ends at the first word whose count of the places of a name is nought, and every count of a name of
more than 0x100 places of the file is refused, as is a picture whose places stand past the end of the file
and a list that holds no picture at all. The walk stops there, so a file cut inside a record is refused
rather than read past its end.

## The password of the game, and what this port does about it

Every picture of the second shape stands of the password of its game: the reference reads the places of the
file, exclusive-ors them with the places of the password, and then, where the picture's places are packed,
walks them with a compression of the engine's own (`UnpackCustomLzss`). The password stands nowhere in the
file and nowhere in the reference tree: `Arc2Opener.TryOpen` reads the flat list and then asks for a
`TacticsOptions` scheme, which the reference fills from its format database keyed on the title of the game
or from the settings of the user, and it **returns nothing at all** where it holds none. Without a scheme
the reference therefore cannot even list the pictures of the archive.

This port carries no place to take a password from outside a file, so it takes the other road: it **lists**
the pictures of the archive - exactly the walk the reference stands of once a scheme is at hand - and
**refuses** every one of them where its places are asked for, with `UNSUPPORTED_FEATURE` and the reason
named. That is a departure from the reference, which refuses the whole archive instead. The walk of the
places of a packed picture (`UnpackCustomLzss`) is not carried either, because without a password no place
of any picture can be checked against anything.

## Deviations

* The archive is listed where the reference holds no scheme for it and so refuses the whole file. See above.
* The count at 4 of a record is read but not used: the reference stands of it as the count of the places a
  packed picture unpacks into, and this port reports it in the metadata of the entry (`unpackedSize`) while
  the entry's own size stays the count of the places of the file.
* A record whose count of the places of a name is more than 0x100 is refused, as the reference refuses it.

## Verification

`tests/formats/tactics-arc2.test.ts` builds archives in the test: one of two pictures, one of them plain and
one packed, whose names, counts, packed flags and metadata stand pinned (the second name is written in the
places of the engine, so the reading of a name of that kind stands pinned too); one whose pictures stand
refused with `UNSUPPORTED_FEATURE`; a file cut inside a record, a name beyond 0x100, a picture past the end
of the file and a list of no picture, of which each stands undetected; and the same head read by the first
shape of the archive, which stands of no such file, so that the two walks part where the reference's two
classes part.
