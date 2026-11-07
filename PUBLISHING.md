# Building and publishing

Replace every `your-username` and `you@example.com` first (`extension.toml`, `Cargo.toml`, `server/package.json`, READMEs).

## 1. Publish the server to npm

The extension installs `codesprint-mcp-server` from npm at runtime, so publish it first.

```
cd server
npm install
npm test
npm publish          # use --access public for scoped names
```

If the name is taken, rename it in `server/package.json`, `src/lib.rs` (`PACKAGE_NAME`, `SERVER_PATH`).

## 2. Test the extension locally

1. Install Rust with `rustup` (required; Zed compiles the extension to WebAssembly).
2. In Zed run **zed: install dev extension** and select this folder.
3. Open the Agent panel, enable CodeSprint tools and ask it to start a timer.
4. Check logs with **zed: open log** if the server fails to start.

Run `cargo test` and `cargo clippy` before releasing. Commit `Cargo.lock`.

## 3. Submit to the Zed registry

1. Make sure the repository is public and contains the MIT `LICENSE`.
2. Fork `zed-industries/extensions`.
3. Add this repository as a submodule: `git submodule add https://github.com/harshitsingh205/codesprint-zed.git extensions/codesprint`
4. Add to the root `extensions.toml`:

   ```toml
   [codesprint]
   submodule = "extensions/codesprint"
   version = "1.0.0"
   ```
5. Run `pnpm sort-extensions`, commit, and open a pull request.

Check the registry's current contribution guide, since requirements change.

## Releasing updates

Bump `version` in `extension.toml` and `Cargo.toml`, update the submodule commit and `version` in your registry fork, and open a PR. Publish server changes to npm first.
