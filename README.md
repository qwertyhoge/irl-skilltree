# 人生のスキルツリー

人生のさまざまな分野を、入れ子になったスキルのグラフとして探索するアプリの試作。
ノードを選ぶと視点が寄り、分野の球に入ると、その内側に次の階層のグラフが現れる。

構想は [docs/concept.md](docs/concept.md)、描画構成の判断は [docs/adr/0001-rendering-stack.md](docs/adr/0001-rendering-stack.md)、
受け入れ条件の確認結果は [docs/acceptance.md](docs/acceptance.md) にある。

## 起動

Node.js 22 以降と npm。

```sh
npm install
npm run dev          # http://localhost:5173
```

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー。`/?tune` で動きの調整パネルが出る |
| `npm run build` | 型検査と本番ビルド（`dist/`） |
| `npm test` | 単体テスト（意味モデル、取り込み・書き出し、表示グラフ、移動の履歴） |
| `npm run e2e` | 実ブラウザでの操作テスト。初回は `npx playwright install chromium`。動画は `test-results/` |
| `npm run tour` | 開発サーバー起動中に、操作動画を `docs/media/tour.webm` へ録る |
| `npm run schema` | 交換用 JSON Schema を `schema/` に生成する |

技術スパイクは開発サーバー上の `/spikes/cytoscape-elk/` と `/spikes/elk-three/` で開ける。

## 操作

| 操作 | 結果 |
| --- | --- |
| ノードをクリック | そのノードが中央に来て、右に説明が出る |
| 選択中の分野（輪のある球）をもう一度クリック、ダブルクリック、Enter、「中へ入る」 | 分野の中へ入る |
| Esc / Backspace / 「← 戻る」 | 一つ前の場所へ戻る。選択と視点も戻る |
| 上部の現在地 | 上の階層へ移る |
| 選択時に周りに出る菱形（ポータル）、説明パネルの「つながり」 | 別の枝にある関連先へ移動する |
| ドラッグ / ホイール | 視点の移動 / 拡大・縮小 |

右上の「編集」で、選択ノードの名前・種類・説明・できるようになること・親・関係を編集できる。
座標は扱わない。配置は構造から自動で決まる。

「書き出す」で全体または選択中の枝を JSON に保存し、「開く」で置き換え、「取り込む」で別のツリーの枝を今のツリーへコピーする。
作業中のツリーはブラウザに自動保存される。上部の表示は、最後にファイルを開いてから・書き出してから変更があるかを示す。

## 構成

```
src/
  model/       意味モデル（zod スキーマ、検証、編集操作、取り込み・部分書き出し）。UI に依存しない
  viewgraph/   階層と選択から、表示するノード・集約した線・別の枝へのポータルを作る
  layout/      ELK.js による階層ごとの配置（Web Worker、構造をキーにキャッシュ）
  camera/      移動の意図と履歴（navigation.ts）、イージング
  scene/       Three.js の描画と遷移（SkillScene.ts）、一階層分の見た目（frame.ts）
  persistence/ ブラウザへの自動保存、ファイル入出力
  ui/          React の説明パネル、編集、ダイアログ、調整パネル
  tuning.ts    動きの調整値
samples/       サンプルツリー
schema/        交換用 JSON Schema（生成物）
spikes/        Cytoscape.js と Three.js の比較スパイク
e2e/           Playwright の操作テスト
```

データの流れ: `TreeDoc`（正本）→ `buildLevelView`（表示グラフ）→ `getLayout`（ELK）→ `LevelFrame`（Three.js）。
移動は `navigation.ts` が意図（どの階層の何を見たいか）と履歴を持ち、`SkillScene` が現在地からそこへ一階層ずつ動く。
描画ライブラリのオブジェクトは保存しない。

交換形式は [docs/schema.md](docs/schema.md)。
