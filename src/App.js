import React, { useEffect, useRef, useState } from "react";

// Helper math
const dBToLinear = (db) => Math.pow(10, db / 20);

// --- Main Component ---
export default function MeterGameWithWaveform() {
  const TOTAL_ROUNDS = 3;
  const ROUND_DURATION = 15; // seconds per round

  // Controls
  const [gainDb, setGainDb] = useState(-6);
  const [dynamics, setDynamics] = useState(0.6);
  const [running, setRunning] = useState(true);
  const [seed, setSeed] = useState(1);

  // Game state
  const [round, setRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);
  const [rounds, setRounds] = useState([]);
  const [gameOver, setGameOver] = useState(false);

  // Meter state
  const [vuValue, setVuValue] = useState(0);
  const [ppmValue, setPpmValue] = useState(0);
  const [peakValue, setPeakValue] = useState(0);
  const [lufsValue, setLufsValue] = useState(0);

  const historyRef = useRef(new Array(200).fill(0));
  const rafRef = useRef(null);
  const lastTimeRef = useRef(performance.now());

  const seedRef = useRef(seed);
  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  // Random generator
  function seededRandom() {
    seedRef.current = (seedRef.current * 1664525 + 1013904223) % 4294967296;
    return seedRef.current / 4294967296;
  }

  // Simulation constants
  const VU_TAU = 0.3;
  const PPM_ATTACK = 0.01;
  const PPM_RELEASE = 0.08;
  const PEAK_ATTACK = 0.0005;
  const PEAK_RELEASE = 0.05;
  const LUFS_INTEGRATION = 3.0;

  const lufsBufferRef = useRef([]);
  const ppmHoldRef = useRef(0);
  const ppmHoldTimerRef = useRef(0);

  // --- Simulation Loop ---
  useEffect(() => {
    function step(now) {
      const dt = Math.max(0.001, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      if (running && !gameOver) {
        // Generate signal
        const base = dBToLinear(gainDb);
        const r = seededRandom();
        const spikeProb = 0.08 * dynamics;
        const isSpike = r < spikeProb;
        const spike = isSpike ? (0.6 + seededRandom() * 0.4) * dynamics : 0;
        const t = now / 1000 + seed * 0.1;
        const tone = 0.25 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t));
        const instantaneous = Math.min(
          1,
          base * (0.2 + tone + spike + 0.1 * seededRandom())
        );

        // Update waveform history
        historyRef.current.push(instantaneous);
        if (historyRef.current.length > 200) historyRef.current.shift();

        // --- VU ---
        const vuAlpha = 1 - Math.exp(-dt / VU_TAU);
        setVuValue((prev) => prev + vuAlpha * (instantaneous - prev));

        // --- Peak ---
        const peakAlphaAttack = 1 - Math.exp(-dt / PEAK_ATTACK);
        const peakAlphaRelease = 1 - Math.exp(-dt / PEAK_RELEASE);
        setPeakValue((prev) =>
          instantaneous > prev
            ? prev + peakAlphaAttack * (instantaneous - prev)
            : prev + peakAlphaRelease * (instantaneous - prev)
        );

        // --- PPM ---
        setPpmValue((prev) => {
          const attack = 1 - Math.exp(-dt / PPM_ATTACK);
          const release = 1 - Math.exp(-dt / PPM_RELEASE);
          let next =
            instantaneous > prev
              ? prev + attack * (instantaneous - prev)
              : prev + release * (instantaneous - prev);
          if (next > ppmHoldRef.current) {
            ppmHoldRef.current = next;
            ppmHoldTimerRef.current = 0.08;
          }
          ppmHoldTimerRef.current = Math.max(0, ppmHoldTimerRef.current - dt);
          if (ppmHoldTimerRef.current <= 0) {
            ppmHoldRef.current += (prev - ppmHoldRef.current) * 0.3;
          }
          return next;
        });

        // --- LUFS ---
        const instEnergy = instantaneous * instantaneous;
        lufsBufferRef.current.push({ energy: instEnergy, dt });
        let totalT = 0;
        for (let i = lufsBufferRef.current.length - 1; i >= 0; i--) {
          totalT += lufsBufferRef.current[i].dt;
          if (totalT > LUFS_INTEGRATION) {
            lufsBufferRef.current.splice(0, i);
            break;
          }
        }
        const sumEnergy = lufsBufferRef.current.reduce(
          (s, x) => s + x.energy * x.dt,
          0
        );
        const intRms = Math.sqrt(sumEnergy / Math.max(1e-6, totalT));
        setLufsValue(intRms);

        // Countdown timer
        setTimeLeft((prev) => Math.max(0, prev - dt));
      }

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, gainDb, dynamics, seed, gameOver]);

  // --- End of round ---
  const submitRound = () => {
    let score = 100 - Math.abs(gainDb + 6) * 5;
    score -= Math.max(0, peakValue - 0.9) * 50;
    score = Math.max(0, Math.round(score));
    setRounds([...rounds, score]);

    if (round < TOTAL_ROUNDS) {
      setRound(round + 1);
      setSeed((s) => s + 1);
      setTimeLeft(ROUND_DURATION);
      setVuValue(0);
      setPeakValue(0);
      setPpmValue(0);
      setLufsValue(0);
      historyRef.current = new Array(200).fill(0);
    } else {
      setGameOver(true);
      setRunning(false);
    }
  };

  useEffect(() => {
    if (timeLeft <= 0 && !gameOver) submitRound();
  }, [timeLeft]);

  // --- Utility Meters ---
  const linearToMeter = (lin) => Math.max(0, Math.min(1, lin));

  function BarMeter({ value, label }) {
    const pct = Math.round(100 * linearToMeter(value));
    return (
      <div className="w-full p-2 bg-gray-800/50 rounded">
        <div className="flex justify-between text-xs text-gray-300">
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full h-4 bg-gray-700 rounded overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  function Waveform({ data }) {
    const path = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 50 - v * 45;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <svg
        viewBox="0 0 100 100"
        className="w-full h-24 bg-gray-900 rounded-md mt-2"
      >
        <path
          d={path}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <div className="p-6 bg-slate-900 min-h-screen text-gray-100">
      <h1 className="text-2xl font-bold mb-4">Meter Madness Challenge</h1>
      <div className="mb-4">
        Round {round} / {TOTAL_ROUNDS} — Time left: {Math.ceil(timeLeft)}s
      </div>

      <div className="space-y-2">
        <BarMeter value={vuValue} label="VU Meter" />
        <BarMeter value={ppmValue} label="PPM" />
        <BarMeter value={peakValue} label="Peak" />
        <BarMeter value={lufsValue} label="LUFS" />
      </div>

      <Waveform data={historyRef.current} />

      <div className="mt-4 flex gap-2">
        <button
          className="px-4 py-2 bg-teal-600 rounded"
          onClick={() => setRunning((r) => !r)}
        >
          {running ? "Pause" : "Play"}
        </button>
        <button className="px-4 py-2 bg-gray-700 rounded" onClick={submitRound}>
          Submit Round
        </button>
      </div>

      {gameOver && (
        <div className="mt-6 p-4 bg-gray-800/60 rounded">
          <h2 className="font-bold text-lg mb-2">Game Over! 🏆</h2>
          <ul className="list-disc list-inside">
            {rounds.map((s, i) => (
              <li key={i}>
                Round {i + 1}: {s} / 100
              </li>
            ))}
          </ul>
          <div className="mt-2 font-semibold">
            Total Score: {rounds.reduce((a, b) => a + b, 0)} /{" "}
            {TOTAL_ROUNDS * 100}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2">
        <div>
          <label>Gain: {gainDb} dB</label>
          <input
            type="range"
            min={-24}
            max={12}
            step={0.5}
            value={gainDb}
            onChange={(e) => setGainDb(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label>Dynamics: {Math.round(dynamics * 100)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={dynamics}
            onChange={(e) => setDynamics(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
