# ワークスペースの指示

日本語で回答する。短い文とやさしい言葉を使う。専門用語には簡単な言い換えを添える。

## 共通スキル

Claude、Codexなどで共通の手順は`.agents/skills/`を正本とする。`.claude/skills/`の入口は共通ファイルを参照する。変更は正本に行う。

- テスト実行：`.agents/skills/test/SKILL.md`
- 実際のVS Codeでの画面テスト：`.agents/skills/extension-ui-test/SKILL.md`
- ライセンス確認：`.agents/skills/license-check/SKILL.md`
- リリース：`.agents/skills/release/SKILL.md`

画面テストはコピーしたsampleで行う。自動テストと実際のVS Codeでの確認結果を分けて報告する。Claude専用のhooksは他のツールでは自動実行されない。テストやリリースの条件は共通スキルで確認する。
