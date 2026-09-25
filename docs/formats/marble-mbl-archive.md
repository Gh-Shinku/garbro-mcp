# Marble engine resource archive

Reference: `ArcFormats/Marble/ArcMBL.cs`, class `MblOpener`. The same file carries `GraMblOpener`, the
graphics archive of the same engine, which is ported beside this one as `marble-gra-archive`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `marble-mbl-archive`
(`packages/formats/src/marble/mbl-archive.ts`).

## The head

The archive writes no word of its own: the reference tells it by the shape of its head, which names how many
entries it holds at 0 and how long a name is at 4. Three layouts stand behind that, tried in turn: the length
the head declares when it lies between one and `0xFF`, with the index at 8; a length of **sixteen** bytes with
the index at 4; and a length of **fifty six** with the index at 4 as well. Every record holds its name, then
the extension that stands behind it in the same field when the field has room, and then the place and the
length of the entry. A record whose name is empty ends the walk. The archive is kept only when it names
something, when a single entry does not stand for a count of more, and when every entry stands inside it - and
the reference also asks that the place of an entry does not stand inside the index itself, which this port
keeps.

## The entries

A name is read as text and folded to lower case, and the reference types every entry through its own
catalogue: the extension decides whether an entry is an image, a sound or something else. This port names the
image, sound and script extensions it knows and leaves the rest untyped, so that the caller can hand the
bytes to the format that fits - the reference's own `AutoEntry` does the same by looking a signature up when
the name tells it nothing, and an entry whose signature is `BY` or `YP` is a picture of this very engine,
already ported as `marble-prs-image` and `marble-yp-image`.

## The scripts, and the pass phrase this port leaves out

An archive whose **file name** ends with `_data`, or which holds a name ending in `.s`, keeps **scripts**: the
reference reads their bytes with every one of them negated, which is what a stock build does when a user gives
no pass phrase. It can key such a script with a pass phrase instead, looked up in a table that ships empty and
otherwise asked of the user; that way is not ported, since it cannot be reached without a person to ask.

## Verification

Six tests over synthetic fixtures (`tests/formats/marble-mbl-archive.test.ts`): an archive of two entries
listed and handed over, the extension that stands behind a name in its own field, the two layouts whose length
the reference assumes, the bytes of a script negated with its kind kept, the head that names nothing with an
entry reaching past the end, and the graphics archive of the same engine, which stands in its own file.
