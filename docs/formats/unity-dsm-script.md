# UTAGE Unity engine script file

Reference: `GARbro/ArcFormats/Unity/ScriptDSM.cs`, classes `DsmConverter` and `DsmDecryptor`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unity/dsm-script.ts` (`unityDsmScriptDescriptor`,
`unityDsmScriptFormat`, id `unity-dsm-script`, `dsmKeyAndIv`, `hasDsmName`, `decryptDsm`), with the standard
cipher of `node:crypto`.

the name `data.dsm`.

stands in four places of six and sixty four, and those stand under the standard cipher with a key and a block
the reference stands from its own words:

| the word of the reference | what it stands as |
| ------------------------- | ----------------- |
| the word a key stands from | `pass` |
| how many steps the walk stands over | a thousand |

## Deviations from the reference

- The reference claims a file of the name `data.dsm` whether or not its places stand in the clear under the key
  of its own; this port also asks that they do, so a file of that name that holds something else is left to
  the kinds that read it.
  whole or does not stand in the clear, are refused with a message, where the reference would throw while
  its own.

## Tests

the test stands under a key another walk of the standard kind stood and under the cipher of the command line,
so it does not stand under a key this port stood itself.
