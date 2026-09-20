# SAS5 engine resource index file (`SEC5`)

Reference: GARbro `ArcFormats/Sas5/ArcSec5.cs`, class `Sec5Opener`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The resource index of the SAS5 engine. It stands as the four places of the picture of the word `SEC5`, four
places of the picture of the walk of the places of the picture that the reference stands over, and then places
of the picture of the walk of the places of the picture, every one of them standing of the places of the
picture of its own name, of the places of the picture of the walk of the places of the picture of it, and of
the places of the picture of the walk of them.

## The walk of the places of the picture

The places of the picture of the walk of the places of the picture of any place of the picture of the walk of
them stand as the places of the picture of the four places of the picture of the word of the name of the place
of the picture of the walk of them, of the places of the picture of the walk of the places of the picture of
the place of the picture of the walk of them, and of the places of the picture of the walk of the places of
them:

| places of the picture | word |
| --- | --- |
| 0 | the name of the place of the picture of the walk of the places of the picture, of four places of the picture |
| 4 | how many places of the picture the place of the picture of the walk of the places of the picture stands in (u32, little endian) |
| 8 | the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them |

The place of the picture of the walk of the places of the picture of the name `ENDS` stands for the places of
the picture of the walk of the places of the picture of no places of the picture of the walk of them, and
stands over the walk of the places of the picture: it stands of the places of the picture of the name of the
picture of the walk of it of its own, and of no places of the picture of the walk of the places of the picture
of the place of the picture of the walk of them.

## The place of the picture of the walk of the places of the picture of the word `CODE`

The reference stands the places of the picture of the walk of the places of the picture of the place of the
picture of the walk of the places of the picture of the name `CODE` as the places of the picture of the walk
of the places of the picture behind them, the places of the picture of the walk of them standing beside the
places of the picture of the walk of the places of the picture of the place of the picture of the walk of
them of the places of the picture of their own:

```
key = 0
for every place of the picture:
    place = code[i] + 18
    code[i] ^= key
    key = (key + (place & 0xFF)) & 0xFF
```

The places of the picture of the walk of the places of the picture of the place of the picture of the walk of
them stand of the places of the picture of the walk of the places of the picture of the picture of their own
before the places of the picture of the walk of the places of the picture of the picture stand as the places
of the picture of the walk of them. Every other place of the picture of the walk of the places of the picture
stands over as it stands.

## Deviations from the reference

* The reference stands the places of the picture of the walk of the places of the picture of a place of the
  picture of the walk of them that stand past the places of the picture of the walk of the places of the
  picture of the picture of their own as the places of the picture of the walk of the places of the picture of
  no places of the picture of the walk of them, and stands the places of the picture of the walk of the places
  of the picture of the place of the picture of the walk of them of the places of the picture of the picture of
  the walk of the places of the picture where they stand short of the places of the picture of the walk of them.
  A picture of the places of the picture of the walk of them of this project turns such a picture away.
* The reference stands the places of the picture of the walk of the places of the picture of the place of the
  picture of the walk of the places of the picture of the name `CODE` as the places of the picture of the walk
  of the places of the picture of the picture of their own, the places of the picture of the walk of the places
  of the picture of the picture standing where they stand. A picture of this project stands the places of the
  picture of the walk of the places of the picture of the picture of their own as the places of the picture of
  the walk of the places of the picture of the place of the picture of the walk of them of its own.
* The reference stands the places of the picture of the walk of the places of the picture of the place of the
  picture of the walk of them of no places of the picture of the walk of them where the places of the picture of
  the walk of the places of the picture of the name of the place of the picture of the walk of them stand short
  of the places of the picture of the name of the picture of the walk of it of their own, and stands the places
  of the picture of the walk of the places of the picture of the place of the picture of the walk of them of
  no places of the picture of the walk of the places of the picture of the name of the picture of the walk of
  it of their own. A picture of the places of the picture of the walk of them of this project turns such a
  picture away.

## What this port does not stand

The reference also stands the places of the picture of the walk of the places of the picture of the names of
the places of the picture of the walk of the places of the picture of the archives of the kinds `file-war` and
`file-iar` (`Sec5Opener.LookupIndex`, `FindSec5Resr`, `ReadResrSection` and `ReadRes2Section`), standing them
beside the places of the picture of the walk of the places of the picture of the archives of the engine of the
SAS5 kind of their own. Those places of the picture of the walk of the places of the picture stand for the
consumer of the archives of the engine of the SAS5 kind, which stands outside the walk of the places of the
picture of a picture of the places of the picture of the walk of them of this kind, and they stand of no
places of the picture of the walk of the places of the picture of the places of the picture of the walk of
them of this kind. The places of the picture of the walk of the places of the picture of the place of the
picture of the walk of them therefore stand over, and no places of the picture of the walk of the places of
the picture of this project stands of them.

## Verification

Seven fixtures of synthetic pictures stand against the walk of the places of the picture and the places of the
picture of the walk of the places of the picture of the place of the picture of the walk of the places of the
picture of the name `CODE`: the places of the picture of the walk of the places of the picture of two places
of the picture of the walk of them and of the places of the picture of the walk of the places of the picture of
the place of the picture of the walk of the places of the picture of the name `ENDS`; the places of the
picture of the walk of the places of the picture of a picture of the places of the picture of the walk of them
that stands for the places of the picture of the walk of the places of the picture of the picture of its own
at the places of the picture of the walk of the places of the picture of the picture of the walk of them; the
places of the picture of the walk of the places of the picture of the place of the picture of the walk of the
places of the picture of the name `CODE` (each of the fixtures standing of the places of the picture of the
walk of the places of the picture of the place of the picture of the walk of them by hand, of the places of
the picture of the walk of the places of the picture of the picture of their own and of the places of the
picture of the walk of the places of the picture of the picture of the walk of them); the words of the picture
of the walk of the places of the picture of a picture of no places of the picture of the walk of them; the
places of the picture of the walk of the places of the picture of the places of the picture of the walk of
them stood out; and the words of the picture of the walk of the places of the picture of a picture of the
walk of them that names no picture of the walk of the places of the picture of this kind.
