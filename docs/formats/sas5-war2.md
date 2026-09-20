# SAS5 engine audio archive, second kind

Reference: `GARbro/ArcFormats/Sas5/ArcWAR.cs`, class `War2Opener`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sas5/war.ts` (`sas5War2Descriptor`, `sas5War2Format`, id `sas5-war2`).

This is the kind of archive of the SAS5 engine that stands behind the words `war2` rather than the words
`war `, and it stands as the archive of the first kind in every other way. What the head and the index of such
an archive stand for, what the places of a sound of it stand for, and what this port reads of them differently
stand in `docs/formats/sas5-war.md`, which the tests of both kinds stand under.
