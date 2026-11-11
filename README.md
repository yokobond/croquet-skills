# croquet-skills

Croquet でマルチユーザーアプリを作るためのエージェントスキル集です。[Agent Skills](https://agentskills.io/specification) 形式なので、`gh skill` でインストールできます。

| スキル | 内容 |
| --- | --- |
| [`croquet-multiplayer`](skills/croquet-multiplayer/SKILL.md) | シングルプレイヤーのブラウザゲームやアプリを Croquet の複製計算でマルチプレイヤーにします（Microverse 方式）。物理は Rapier をモデル内で動かし、`world.takeSnapshot()` でスナップショットします |
| [`croquet-reflector-selfhost`](skills/croquet-reflector-selfhost/SKILL.md) | Croquet の reflector（`files` ブランチ）を、nginx と他のアプリが動いている既存の Linux サーバーで Docker を使わずに運用します。systemd による隔離、容量固定のデータ領域、nginx の設定、上流の版固定とパッチ、定期的な掃除、ヘッドレスクライアントでの検証と再起動テストを扱います |

## インストール

```bash
# Claude Code のプロジェクトに入れる場合（.claude/skills/）
gh skill install yokobond/croquet-skills croquet-multiplayer --agent claude-code

# 全プロジェクトで使う場合
gh skill install yokobond/croquet-skills croquet-multiplayer --agent claude-code --scope user

# 更新
gh skill update --all
```

## 開発

スキルは `skills/<name>/SKILL.md` に置きます。リリースは次のとおりです。

```bash
gh skill publish --dry-run      # 仕様に合っているか検査
gh skill publish --tag v0.1.0   # タグを打って GitHub Release を作成
```

## 参考

- Yoshiki Ohshima, Aran Lunzer, David A. Smith. "Croquetify: Transforming Single-User Functional Reactive Programs into Multi-user Applications." Onward! '26.
- [Croquet](https://croquet.io/croquet/croquet/index.html) / [Microverse](https://github.com/croquet/microverse) / [Rapier](https://rapier.rs/)
- このスキルは [yokobond/tabletop-rc-arena](https://github.com/yokobond/tabletop-rc-arena) の開発から抽出しました。
