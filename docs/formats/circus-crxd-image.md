# Circus differential picture (`CRXD`)

Format reference: GARbro `ArcFormats/Circus/ImageCRXD.cs` (`CrxdFormat`, `CrxdMetaData`) standing over the
reader of `ArcFormats/Circus/ImageCRX.cs` (`CrxFormat`, `Reader`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

A difference of a picture stands of a head of its own and of a picture of the Circus engine (`CRXG`) behind
it. The places of the picture of the differences stand **over** the places of the base picture rather than
within them: a place of a colour of the base stands of the two places added, and a place of an alpha of it
stands of the place of the base less the place of the difference.

## The head

| place | field |
| --- | --- |
| 0 | the mark `CRXD` |
| 8 | the offset of the base picture within the archive of the engine (`u32`) |
| 0xc | the name of the base picture beside the file, of twenty places |
| 0x20 | the picture of the differences itself: a picture of the engine, of the head of `crx-image` |
| 0x20 | — of the kind `CRXJ` — the word `CRXJ` instead, and the offset of the picture of the differences within the archive at 0x28 (`u32`) |

The two kinds of a head are `CRXG` (the places of the differences stand within the file) and `CRXJ` (they
stand behind an offset of the **CRM archive** that holds the file). The reference reaches both the picture of
the differences and the base picture through the archive it stands in: `OpenByOffset` takes its `CrmArchive`
from the file system of the reference, and a picture of its own has no such archive under it. This port
therefore stands of the kind `CRXG` and of the base picture **beside** the name of it, and a `CRXJ` file of
no archive under it stands undetected — which is where the reference stands as well, because its own
`OpenByOffset` hands back nothing and its metadata walk then ends in nothing.

## The places of the picture

The picture of the differences is read with the walk of the engine (`Reader.Unpack`), of the places of a row
of the walk of it (`stride`), and so is the base. The two places of the two pictures stand of both over the
crossing of the places of the two of them:

```text
left   = max (base.offsetX, diff.offsetX)      top    = max (base.offsetY, diff.offsetY)
right  = min (base.right, diff.right)          bottom = min (base.bottom, diff.bottom)
```

A crossing of no places at all hands the base picture out as it stands. The picture that comes out of the
walk is the **base** picture, of the counts of the base; the places of the head of the difference (its counts
and its places within the picture) stand in the metadata of the file, which is where the reference names them
as well.

## Deviations

* The base picture is looked for beside the file by the name of the head and not through the archive of the
  engine, and the offset of the base of the head is read and reported rather than reached through.
* The reference turns a base of another count of places than the picture of the differences away where the
  picture is asked for (and not where the head of it is read); this port does the same.
* A difference of no base picture beside it names no picture rather than a failure of the walk, the way the
  reference stands as well.

## Tests

`tests/formats/circus-crxd-image.test.ts` builds a base picture of three places by two of four places a
colour and a difference of two by two standing over the second and the third place of every row of it: the
places of a colour of the two stand added, the places of an alpha of them stand of the one less the other,
and the places of the base no difference stands over come out as they stand. A difference standing apart from
its base stands beside it (the base picture comes out as it stands), a difference of no base beside it and a
base of another count of places are turned away, and a file of the kind `CRXJ` is no picture of this engine.
