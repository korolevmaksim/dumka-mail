# Project Rules and Custom Commands

## Custom Commands
- **Install App**: Whenever the user asks to "install", "install the app", "install release", "run install", or similar, run the `./install.sh` script at the project root using the `run_command` tool. This command quits any running instance of the app, builds the release app, copies it to `/Applications/`, and launches the newly installed version. Since this is an automated custom installation command, execute it immediately without creating a multi-step implementation plan.
