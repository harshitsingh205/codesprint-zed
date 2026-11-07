//! CodeSprint for Zed.
//!
//! Zed extensions are WebAssembly modules and cannot draw sidebars, status-bar
//! items or webviews, so CodeSprint is delivered as a Model Context Protocol
//! (MCP) server. This module is the thin Rust shim that installs the server
//! from npm, forwards the user's Zed settings to it and tells Zed how to launch
//! it. All timer logic lives in the Node server (see `server/`).

use std::env;

use zed_extension_api::{
    self as zed, serde_json, settings::ContextServerSettings, Command, ContextServerConfiguration,
    ContextServerId, Project, Result,
};

/// npm package that contains the compiled MCP server.
const PACKAGE_NAME: &str = "codesprint-mcp-server";
/// Entry point of that package, relative to the extension's working directory.
const SERVER_PATH: &str = "node_modules/codesprint-mcp-server/dist/index.js";
/// Must match `[context_servers.codesprint]` in `extension.toml`.
const SERVER_ID: &str = "codesprint";
/// Environment variable through which the server receives the user's settings (JSON).
const SETTINGS_ENV: &str = "CODESPRINT_SETTINGS";

struct CodeSprintExtension;

impl CodeSprintExtension {
    /// Makes sure the server package is present, updating it when a newer
    /// version exists. If the registry cannot be reached (for example offline)
    /// an already installed copy keeps working instead of failing the launch.
    fn ensure_server_installed() -> Result<()> {
        let installed = zed::npm_package_installed_version(PACKAGE_NAME)?;
        match zed::npm_package_latest_version(PACKAGE_NAME) {
            Ok(latest) => {
                if installed.as_deref() != Some(latest.as_str()) {
                    zed::npm_install_package(PACKAGE_NAME, &latest)?;
                }
                Ok(())
            }
            Err(error) if installed.is_none() => Err(format!(
                "could not install {PACKAGE_NAME}: {error}. Check your network connection and try again."
            )),
            Err(_) => Ok(()),
        }
    }
}

impl zed::Extension for CodeSprintExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        Self::ensure_server_installed()?;

        let server_path = env::current_dir()
            .map_err(|e| format!("could not resolve the extension directory: {e}"))?
            .join(SERVER_PATH)
            .to_string_lossy()
            .to_string();

        // User settings from `context_servers.codesprint.settings` in Zed's settings.json.
        let settings = ContextServerSettings::for_project(SERVER_ID, project)?;
        let env = match settings.settings {
            Some(value) => vec![(SETTINGS_ENV.to_string(), value.to_string())],
            None => Vec::new(),
        };

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![server_path],
            env,
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        let installation_instructions =
            include_str!("../configuration/installation_instructions.md").to_string();
        let default_settings = include_str!("../configuration/default_settings.jsonc").to_string();
        let settings_schema = include_str!("../configuration/settings_schema.json").to_string();

        // Fail at build time rather than in the editor if the bundled schema is malformed.
        serde_json::from_str::<serde_json::Value>(&settings_schema)
            .map_err(|e| format!("invalid settings schema: {e}"))?;

        Ok(Some(ContextServerConfiguration {
            installation_instructions,
            default_settings,
            settings_schema,
        }))
    }
}

zed::register_extension!(CodeSprintExtension);

#[cfg(test)]
mod tests {
    use zed_extension_api::serde_json::{self, Value};

    #[test]
    fn bundled_schema_is_valid_json_and_matches_defaults() {
        let schema: Value =
            serde_json::from_str(include_str!("../configuration/settings_schema.json")).unwrap();
        let props = schema["properties"].as_object().unwrap();
        for key in [
            "focusMinutes",
            "shortBreakMinutes",
            "longBreakMinutes",
            "sessionsBeforeLongBreak",
            "dailyGoalMinutes",
            "notifications",
            "autoBreakSuggestions",
        ] {
            assert!(props.contains_key(key), "schema is missing {key}");
        }
    }
}
