# Project Rules and Custom Commands

## Custom Commands
- **Install App**: Whenever the user asks to "install", "install the app", "install release", "run install", or similar, run the `./install.sh` script at the project root using the `run_command` tool. This command quits any running instance of the app, builds the release app, copies it to `/Applications/`, and launches the newly installed version. Since this is an automated custom installation command, execute it immediately without creating a multi-step implementation plan.

## Rules
- **AI Models**: Do not rely on pre-trained memory (weights) to determine active or latest AI models. Training knowledge is outdated. You MUST use live web search/docs to verify current production model IDs and deprecations. Do not hardcode or use outdated models (such as `gpt-3.5-turbo`, `gpt-4-turbo`, `gpt-4o`, `gpt-4o-mini`, `claude-3-5-sonnet`, `gemini-1.5-pro`, `deepseek-chat`). For June 2026, the actual production models are GPT-5.5/5.4 family, Claude Fable 5/Sonnet 4.6/Haiku 4.5, Gemini 3.5/3.1 family, and DeepSeek-V4. Always perform a web search to confirm latest models.


