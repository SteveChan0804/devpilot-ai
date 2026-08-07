# DevPilot AI release process

## Versioning

Use semantic version tags such as `v0.1.0`, `v0.2.0`, and `v1.0.0`.
Update the extension version in `extension/package.json` before releasing.

## Local validation

```powershell
cd backend
npm.cmd run build
npm.cmd test
npm.cmd run test:integration

cd ..\frontend
npm.cmd run build

cd ..\extension
npm.cmd run typecheck
npm.cmd run package
```

## Publish a release

After committing and pushing the version change:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds all applications, packages the VSIX, and attaches it to a GitHub release with generated notes.

## Required deployment secrets

- `DATABASE_URL`
- `OLLAMA_URL`
- `OPENROUTER_API_KEY` when cloud inference is enabled
- `API_KEY`
- `POSTGRES_PASSWORD`
