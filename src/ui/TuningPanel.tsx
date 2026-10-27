import { useState } from "react";
import { tuning, type EaseName } from "../tuning";

// 動きの調整値を実行中に変える（?tune で表示）。値は tuning を直接書き換え、毎フレーム読まれる。

type NumKey = {
  [K in keyof typeof tuning]: (typeof tuning)[K] extends number ? K : never;
}[keyof typeof tuning];

const sliders: [NumKey, string, number, number, number][] = [
  ["selectMs", "選択の移動 ms", 150, 1200, 10],
  ["diveMs", "入る・出る ms", 250, 2000, 10],
  ["hopMinMs", "移動 1 階層の下限 ms", 150, 1000, 10],
  ["selectZoom", "選択時の寄り", 0.3, 1.2, 0.01],
  ["innerSpreadFrom", "子の広がり始め", 0.1, 1, 0.01],
  ["innerStagger", "子の出現のずれ", 0, 0.4, 0.01],
  ["tiltDeg", "カメラの傾き°", 0, 35, 1],
  ["depthJitter", "奥行きのばらつき", 0, 60, 1],
  ["floatAmp", "浮遊の振幅", 0, 15, 0.5],
  ["breatheAmp", "発光の呼吸", 0, 0.4, 0.01],
];
const eases: EaseName[] = ["outExpo", "outQuart", "outCubic", "inOutCubic"];

export function TuningPanel() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(true);
  const set = (fn: () => void) => {
    fn();
    force((n) => n + 1);
  };
  if (!open) {
    return (
      <button className="tuning-toggle" onClick={() => setOpen(true)}>
        調整
      </button>
    );
  }
  return (
    <div className="tuning">
      <header>
        <strong>動きの調整</strong>
        <button className="icon" onClick={() => setOpen(false)} aria-label="閉じる">
          ×
        </button>
      </header>
      {sliders.map(([key, label, min, max, step]) => (
        <label key={key}>
          <span>
            {label} <b>{tuning[key]}</b>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={tuning[key]}
            onChange={(e) => set(() => ((tuning[key] as number) = Number(e.target.value)))}
          />
        </label>
      ))}
      {(["selectEase", "diveEase"] as const).map((key) => (
        <label key={key}>
          <span>{key === "selectEase" ? "選択の曲線" : "出入りの曲線"}</span>
          <select
            value={tuning[key]}
            onChange={(e) => set(() => (tuning[key] = e.target.value as EaseName))}
          >
            {eases.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
      ))}
      <button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2))}>
        値をコピー
      </button>
    </div>
  );
}
