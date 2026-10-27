// 動きの調整値。体感で比べて決める出発点で、合意済みの値ではない。
// 開発時は画面右下の調整パネル（?tune）から実行中に変えられる。

export type EaseName = "outExpo" | "outQuart" | "outCubic" | "inOutCubic";

export const tuning = {
  /** ノード選択で中央へ寄る時間 */
  selectMs: 550,
  selectEase: "outQuart" as EaseName,
  /** 一階層ぶん入る・出る時間 */
  diveMs: 900,
  diveEase: "outCubic" as EaseName,
  /** 何階層もまたいで移動するとき、一階層あたりの時間の下限 */
  hopMinMs: 380,
  /** 子階層を親の球に収める縮尺（球の半径に対する子の外接半径の比） */
  innerFit: 0.85,
  /** 親が消え始め・消え終わる進み具合（0 = 外、1 = 中） */
  outerFade: [0.55, 0.92] as [number, number],
  /** 子が現れ始め・現れ終わる進み具合 */
  innerAppear: [0.35, 0.85] as [number, number],
  /** 子が中心から広がり始めるときの大きさ */
  innerSpreadFrom: 0.55,
  /** 子ノードごとの出現の遅れ（進み具合の割合） */
  innerStagger: 0.12,
  /** カメラの傾き（度） */
  tiltDeg: 12,
  /** 視野角（度） */
  fovDeg: 40,
  /** ノードの前後のばらつき（ワールド単位） */
  depthJitter: 14,
  /** 浮遊の振幅と周期 */
  floatAmp: 4,
  floatPeriodMs: 8800,
  /** 発光の呼吸の強さと周期 */
  breatheAmp: 0.12,
  breathePeriodMs: 5600,
  /** 選択時に寄る距離（階層全体が収まる距離に対する比） */
  selectZoom: 0.8,
};

export type Tuning = typeof tuning;
