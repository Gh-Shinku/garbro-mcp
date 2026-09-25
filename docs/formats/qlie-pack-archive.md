# QLIE engine resource archive (`PACK/QLIE`)

Format reference: GARbro `ArcFormats/Qlie/ArcQLIE.cs` (`PackOpener`, `QlieArchive`, `QlieEntry`,
`PackIndexReader`) and `ArcFormats/Qlie/Encryption.cs` (the `QlieEncryption` walks), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head and index

The index of the engine stands at the end of the archive of it: the last `0x1C` places of the file hold
the letters `FilePackVer`, the places of the file of the version of the engine (a letter each, at `0xB`
and `0xD`, of the letters `.` at `0xC`), the count of the entries of it (`i32` at `0x10`) and the places
of the file of the index of them (`i64` at `0x14`). The reference stands of the places of the file of
the *head* of the index of the engine of the walk of the places of the file of the index of it; this
port stands of the places of the file of the index of the engine itself.

Every entry of the index stands of the places of the file of the name of it (`u16` of the places of the
file of the walk of the engine first, of the places of the file of the *two* of them for the walk of the
third kind of the engine of the two places of a letter), of the name itself, of the places of the file
of the entry of the engine (`i64`), of the places of the file of the entry of the walk of it (`u32`), of
the places of the file of the picture of the walk of it (`u32`), of the walk of the places of the file of
the entry of it (`i32`), of the walk of the places of the file of the cipher of it (`i32`) and of the
places of the file of the hash of it (`u32`, of the walks of the engine of a hash of them alone). An
entry of the places of the file of the picture of the engine outside the places of the file of it stands
of `null` in the reference: this port stands of `INVALID_ARCHIVE` for the archive of it.

The version `1.0` of the reference stands of no walk of the places of the file of the engine of it
alone: the places of the file of the head of it of the letters `FilePackVer1.0` stand of the three walks
of the engine behind them (the first kind of it, the second kind of the pictures of no places of the
file of the hash of it, and the second kind of it). This port stands of the same three walks in turn.

## The walks of the places of the file of the name and of the entry of the engine

`EncryptionV1` (the first kind of the engine) stands of the places of the file of the name of an entry
of the wall of the engine itself (`name[k] ^= ((k+1) ^ key) + k + 1`, of the key of the engine of
`0xC4 ^ 0x3E`) and of the places of the file of the entry of it of the places of the file of the walk of
the engine itself: the places of the file of the walk of a picture of eight places of it, of the places
of the file of the colour of the walk of the engine of the places of the file of the key of it
(`MMX.PAddD` of `0xCE24F523CE24F523`, of the places of the file of the picture of the walk of the
engine themselves).

`EncryptionV2` stands of the same walk of the places of the file of the engine, of the places of the
file of the name of an entry of the count of the places of the file of it added to the key of the name,
and of the places of the file of the entry of it of the count of the places of the file of the entry
added to the places of the file of the key of the engine.

`EncryptionV3` (the third kind of the engine) stands of the places of the file of the walk of the engine
of the `0x100` places of the file of it at `0x41C` places of the file before the places of the file of
the head of the index of the engine (`MMX.PAddW` of `0x0307030703070307`), of the places of the file of
the walk of the engine of the places of the file of the entries of it of the walk of the second kind of
it alone: the places of the file of a key file of the game (`key.fkey`) and of the places of the file of
the key of the engine itself (`GameKeyData`, of the walk of the places of the file of the engine of a
picture of the places of the file of the engine itself) stand of no places of the file of this port, of
the walk of the places of the file of the engine of the two first kinds of it instead.

`EncryptionV3_1` (the third kind of the engine of the two places of a letter) stands of the places of
the file of the name of an entry of the walk of the engine of the *two* places of the file of a letter
(`Encoding.Unicode`) and of the places of the file of the two walks of the entry of it of the places of
the file of the table of the walk of the engine itself (`GenerateTable` of `0x20` places of the file of
it, of the two places of the file of the walk of the engine of the table of the key of the game of
`GenerateKeyData` of the walk of the places of the file of the *two* of them).

## The places of the file of the walk of the engine of a packed entry

An entry of the places of the file of the entry of the walk of it stands of the walk of the places of
the file of the engine of the PackFile of it: the walk of the places of the file of the engine of the
`ABMP` picture of the engine itself, which this project already carries. The places of the file of an
entry of the walk of the engine of no places of the file of the mark of it (`1PC\xFF`) stand of the
places of the file of the entry of the engine themselves, as the reference stands of them
(`Decompress (data) ?? data`).

## What this port does not carry

* **Creating an archive.** The reference `PackOpener.CanWrite` stands of no places of it.
* **The places of the file of the key file of the game (`key.fkey`) and of the places of the file of
  the key of the engine itself (`GameKeyData`).** The reference stands of the places of the file of the
  walk of the engine of the game of the places of the file of the file of a game itself (`FindKeyFile`,
  of the places of the file of the game and of its own picture of the engine); this port stands of the
  walk of the second kind of the engine for the entries of the third kind of it, as the reference stands
  of it of no places of the file of a key file of the game.

## How the walk stands verified

Seven walks of our own: the head of the index of the engine (of the letters of it, of the count of the
entries of it and of the places of the file of the index of them), the places of the file of the key of
the engine of the third kind of it, and the entries of the four walks of the engine (of the places of
the file of the names of them, of the places of the file of the entries of them, of the walk of the
places of the file of a packed entry of them and of the places of the file of an index of the engine of
no places of the file of it).

The reference stands of no walk of the places of the file of an archive of the engine, so the four
archives of the test of this port stand of a walk of the places of the file of the engine itself, of the
places of the file of the plaintext of them: the walks of the engine of the places of the file of the
name and of the entry of the engine stand of the places of the file of the plaintext of it of the walk
of the places of the file of the engine itself, of the same places of the file of the port behind them
(the walks of the two first kinds of the engine, of the first walk of the third kind of the two places
of a letter of `0x8DF21431`, and of the second walk of it of `0x8A77F473` of the places of the file of
the table of the key of the game).
