# UTAGE Unity engine script file

Reference: `GARbro/ArcFormats/Unity/ScriptDSM.cs`, classes `DsmConverter` and `DsmDecryptor`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unity/dsm-script.ts` (`unityDsmScriptDescriptor`,
`unityDsmScriptFormat`, id `unity-dsm-script`, `dsmKeyAndIv`, `hasDsmName`, `decryptDsm`), with the standard
cipher of `node:crypto`.

The reference registers no word of its own: a script of this kind is told by its name alone, which stands as
the name `data.dsm`.

## The places of the script

The places of the script stand as a text, the text stands as the places of a ciphered block of the kind that
stands in four places of six and sixty four, and those stand under the standard cipher with a key and a block
the reference stands from its own words:

| the word of the reference | what it stands as |
| ------------------------- | ----------------- |
| the word a key stands from | `pass` |
| the places the walk of a key stands from | the places of the text `saltは必ず8バイト以上` of the kind that stands in eight places a place |
| how many steps the walk stands over | a thousand |
| the walk the key and the places of a block stand as | the walk of the standard kind that stands a key of its own |

The key of the cipher stands as the first two and thirty places of the walk of three and forty eight places
and the places of a block as the places behind them, which is what the reference stands them as.

## Deviations from the reference

- The reference reads the places of the script with the places of the kind that stand in four places of six
  and sixty four, which leaves the places of a line and the like out; this port stands the same places out
  before it stands the places of the ciphered block.
- The reference claims a file of the name `data.dsm` whether or not its places stand in the clear under the key
  of its own; this port also asks that they do, so a file of that name that holds something else is left to
  the kinds that read it.
- A file whose places do not stand as the places of a ciphered block, and a ciphered block that does not stand
  whole or does not stand in the clear, are refused with a message, where the reference would throw while
  reading the places of the text.
- The places of the script are handed out as a text of their own, the name of the file standing as it stood
  with the places of a text of the plain kind behind it; the reference hands the same places out as a stream of
  its own.

## Tests

`tests/formats/unity-dsm-script.test.ts` covers the key and the places of a block the reference stands from its
own words, the places of a script stood in the clear, the places of a text that stand with the places of a line
between them, a file whose places do not stand as the places of a ciphered block, a ciphered block that does
not stand whole, the name a script of this kind is read under, and the text a script hands out. The script of
the test stands under a key another walk of the standard kind stood and under the cipher of the command line,
so it does not stand under a key this port stood itself.
