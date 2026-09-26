# `gs-pack-scw-script`

A script of the GsWin engine. The port is read from `ArcFormats/GsPack/ArcGsPack.cs`, class
`GsScriptFormat`, at GARbro's baseline commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The format

A script is named by the first four places of the file, which stand of one of three words: `SCW `, `Scw5`
and `Scw4`. The class carries the first of the three as its `Signature` (the word `SCW `, read as a number)
and all three as its `Signatures`, so all three name a script. Beyond that word the reference stands of
**no layout at all**.

## What the port does

`GsScriptFormat` is a `GenericScriptFormat`. In `GameRes/ScriptText.cs` that base class hands the places of
the file over unchanged from `ConvertFrom`, refuses `Read` and `Write` with `NotImplementedException`, and
answers `false` from `IsScript`. The three words are therefore the whole of the format, and the port carries
exactly that: it detects a file whose first four places stand of one of the three words, lists it as one
entry named after the file with the extension changed to `.txt`, names it a script, and hands the whole file
over on extraction.

The places of the file are handed over **as they stand, including the four-place word at the head**, because
that is what the reference hands over; nothing is stripped or decoded, and no line of the script is parsed.

## Deviations

* None in the walk, since there is no walk in the reference to deviate from. The port names the entry after
  the source file, where the reference names an entry of a `ScriptFormat` from the archive or the file the
  caller passed in, which is the same name.
* The port carries no writer, as the reference has none (`Write` throws).

## Verification

`tests/formats/gspack-scw-script.test.ts` builds files in the test: one for each of the three words, of
which each stands detected; a file of another word at its head and a file standing short of four places, of
which each stands undetected; and one script whose entry is listed, named and handed back place for place.
