# Contributing

## Commits

Use Conventional Commits with a meaningful scope when possible:

```text
<type>(<scope>): <description>
```

```text
feat(xp3): add archive index parsing
fix(lzss): preserve unsigned 32-bit overflow
test(afa): add extraction golden fixture
```

* Use lowercase types and scopes.
* Write concise, imperative subjects without a trailing period; avoid vague subjects such as
  `update`, `fix stuff`, or `wip`.
* Commit completed work promptly. Give each commit one explicit logical boundary and include only
  the files it requires; do not mix unrelated refactoring or other changes into it.
* Keep documentation, infrastructure, codecs, and individual format ports in separate commits
  unless they are inseparable parts of the same behavior.
* Before committing, inspect the staged diff and run checks appropriate to the changed scope so the
  commit remains reviewable.
* For a task with multiple logical changes, validate and commit each one before starting the next.
