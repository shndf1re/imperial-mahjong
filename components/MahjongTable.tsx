'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase, UserProfile } from '@/lib/supabase';
import { ArrowLeft, RotateCcw, Sparkles, Eye, Trophy } from 'lucide-react';

export interface Tile {
  id: string;
  suit: 'man' | 'pin' | 'sou' | 'wind' | 'dragon';
  value: number;
  label: string;
  sub: string;
  color: string;
}

interface Meld {
  type: 'CHI' | 'PONG' | 'KONG';
  tiles: Tile[];
  fromSeat?: number;
}

interface MahjongTableProps {
  profile: UserProfile;
  room: { id: string; code: string; type: 'ranked' | 'private' };
  players: any[];
  onExitRoom: () => void;
  onProfileUpdated: () => void;
}

const SUIT_SYMBOLS: Record<string, string[]> = {
  man: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
  pin: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'],
  sou: ['1索', '2索', '3索', '4索', '5索', '6索', '7索', '8索', '9索'],
  wind: ['東', '南', '西', '北'],
  dragon: ['中', '發', '白'],
};

const WIND_NAMES = ['East', 'South', 'West', 'North'];
const DRAGON_NAMES = ['Red Dragon', 'Green Dragon', 'White Dragon'];

function generateDeck(): Tile[] {
  const deck: Tile[] = [];
  let uid = 0;

  (['man', 'pin', 'sou'] as const).forEach((suit) => {
    for (let v = 1; v <= 9; v++) {
      for (let c = 0; c < 4; c++) {
        deck.push({
          id: `${suit}_${v}_${uid++}`,
          suit,
          value: v,
          label: SUIT_SYMBOLS[suit][v - 1],
          sub: suit === 'man' ? '萬' : suit === 'pin' ? '筒' : '索',
          color:
            suit === 'man'
              ? 'text-red-700'
              : suit === 'pin'
              ? 'text-blue-700'
              : 'text-emerald-700',
        });
      }
    }
  });

  for (let v = 1; v <= 4; v++) {
    for (let c = 0; c < 4; c++) {
      deck.push({
        id: `wind_${v}_${uid++}`,
        suit: 'wind',
        value: v,
        label: SUIT_SYMBOLS.wind[v - 1],
        sub: WIND_NAMES[v - 1],
        color: 'text-stone-900',
      });
    }
  }

  for (let v = 1; v <= 3; v++) {
    for (let c = 0; c < 4; c++) {
      deck.push({
        id: `dragon_${v}_${uid++}`,
        suit: 'dragon',
        value: v,
        label: SUIT_SYMBOLS.dragon[v - 1],
        sub: DRAGON_NAMES[v - 1],
        color:
          v === 1
            ? 'text-red-600'
            : v === 2
            ? 'text-emerald-600'
            : 'text-blue-800',
      });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortHand(hand: Tile[]): Tile[] {
  const order = { man: 1, pin: 2, sou: 3, wind: 4, dragon: 5 };
  return [...hand].sort((a, b) => {
    if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
    return a.value - b.value;
  });
}

function canWin(hand: Tile[], meldCount: number): boolean {
  const neededSets = 4 - meldCount;
  if (hand.length !== neededSets * 3 + 2) return false;

  const counts: Record<string, number> = {};
  hand.forEach((t) => {
    const key = `${t.suit}_${t.value}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const keys = Object.keys(counts);

  function checkSets(
    remCounts: Record<string, number>,
    setsLeft: number
  ): boolean {
    if (setsLeft === 0) return true;
    const firstKey = Object.keys(remCounts).find((k) => remCounts[k] > 0);
    if (!firstKey) return false;

    const [suit, valStr] = firstKey.split('_');
    const val = parseInt(valStr, 10);

    if (remCounts[firstKey] >= 3) {
      const next = { ...remCounts, [firstKey]: remCounts[firstKey] - 3 };
      if (checkSets(next, setsLeft - 1)) return true;
    }

    if (['man', 'pin', 'sou'].includes(suit) && val <= 7) {
      const k2 = `${suit}_${val + 1}`;
      const k3 = `${suit}_${val + 2}`;
      if ((remCounts[k2] || 0) > 0 && (remCounts[k3] || 0) > 0) {
        const next = {
          ...remCounts,
          [firstKey]: remCounts[firstKey] - 1,
          [k2]: remCounts[k2] - 1,
          [k3]: remCounts[k3] - 1,
        };
        if (checkSets(next, setsLeft - 1)) return true;
      }
    }
    return false;
  }

  for (const pairKey of keys) {
    if (counts[pairKey] >= 2) {
      const next = { ...counts, [pairKey]: counts[pairKey] - 2 };
      if (checkSets(next, neededSets)) return true;
    }
  }
  return false;
}

export default function MahjongTable({
  profile,
  room,
  players,
  onExitRoom,
  onProfileUpdated,
}: MahjongTableProps) {
  const [wall, setWall] = useState<Tile[]>([]);
  const [hands, setHands] = useState<Tile[][]>([[], [], [], []]);
  const [melds, setMelds] = useState<Meld[][]>([[], [], [], []]);
  const [discards, setDiscards] = useState<Tile[]>([]);
  const [turn, setTurn] = useState<number>(0);
  const [mustDraw, setMustDraw] = useState<boolean>(true);
  const [drawnTileId, setDrawnTileId] = useState<string | null>(null);
  const [tableTilt, setTableTilt] = useState<boolean>(true);
  const [inspectedTile, setInspectedTile] = useState<Tile | null>(null);
  const [claimOptions, setClaimOptions] = useState<{
    tile: Tile;
    fromSeat: number;
    canPong: boolean;
    canKong: boolean;
    chiCombos: Tile[][];
  } | null>(null);
  const [winnerInfo, setWinnerInfo] = useState<{
    seat: number;
    name: string;
    faan: number;
    rpDelta: number;
  } | null>(null);

  const initRound = useCallback(() => {
    const deck = generateDeck();
    const h0 = sortHand(deck.splice(0, 13));
    const h1 = sortHand(deck.splice(0, 13));
    const h2 = sortHand(deck.splice(0, 13));
    const h3 = sortHand(deck.splice(0, 13));

    setWall(deck);
    setHands([h0, h1, h2, h3]);
    setMelds([[], [], [], []]);
    setDiscards([]);
    setTurn(0);
    setMustDraw(true);
    setDrawnTileId(null);
    setClaimOptions(null);
    setWinnerInfo(null);
  }, []);

  useEffect(() => {
    initRound();
  }, [initRound]);

  const playTileClick = () => {
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.045);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {}
  };

  const recordMatchResult = useCallback(
    async (playerWon: boolean, faan: number) => {
      const rpDelta =
        room.type === 'private' ? 0 : playerWon ? 25 + faan * 5 : -15;
      if (rpDelta !== 0) {
        await supabase
          .from('profiles')
          .update({
            rank_points: Math.max(0, profile.rank_points + rpDelta),
            matches_played: profile.matches_played + 1,
            wins: playerWon ? profile.wins + 1 : profile.wins,
          })
          .eq('id', profile.id);
        onProfileUpdated();
      }
      return rpDelta;
    },
    [room.type, profile, onProfileUpdated]
  );

  const handleManualDraw = () => {
    if (turn !== 0 || !mustDraw || winnerInfo) return;
    if (wall.length === 0) {
      setWinnerInfo({
        seat: -1,
        name: 'Draw Game (Dinding Habis)',
        faan: 0,
        rpDelta: 0,
      });
      return;
    }

    playTileClick();
    const nextWall = [...wall];
    const drawn = nextWall.pop()!;
    const nextHands = [...hands];
    nextHands[0] = [...nextHands[0], drawn];

    setWall(nextWall);
    setHands(nextHands);
    setDrawnTileId(drawn.id);
    setMustDraw(false);
  };

  const handleDiscard = (tile: Tile) => {
    if (turn !== 0 || mustDraw || claimOptions || winnerInfo) return;
    playTileClick();

    const nextHands = [...hands];
    nextHands[0] = sortHand(nextHands[0].filter((t) => t.id !== tile.id));
    setHands(nextHands);
    setDiscards((prev) => [...prev, tile]);
    setDrawnTileId(null);
    setTurn(1);
    setMustDraw(true);
  };

  const evaluateClaimsForPlayer = useCallback(
    (discarded: Tile, fromSeat: number, playerHand: Tile[]) => {
      const same = playerHand.filter(
        (t) => t.suit === discarded.suit && t.value === discarded.value
      );
      const canPong = same.length >= 2;
      const canKong = same.length >= 3;

      const chiCombos: Tile[][] = [];
      if (fromSeat === 3 && ['man', 'pin', 'sou'].includes(discarded.suit)) {
        const v = discarded.value;
        const findVal = (val: number) =>
          playerHand.find((t) => t.suit === discarded.suit && t.value === val);
        const m2 = findVal(v - 2);
        const m1 = findVal(v - 1);
        const p1 = findVal(v + 1);
        const p2 = findVal(v + 2);
        if (m2 && m1) chiCombos.push([m2, m1]);
        if (m1 && p1) chiCombos.push([m1, p1]);
        if (p1 && p2) chiCombos.push([p1, p2]);
      }

      if (canPong || canKong || chiCombos.length > 0) {
        setClaimOptions({
          tile: discarded,
          fromSeat,
          canPong,
          canKong,
          chiCombos,
        });
        return true;
      }
      return false;
    },
    []
  );

  useEffect(() => {
    if (turn === 0 || claimOptions || winnerInfo) return;

    const timer = setTimeout(() => {
      if (wall.length === 0) {
        setWinnerInfo({
          seat: -1,
          name: 'Draw Game (Dinding Habis)',
          faan: 0,
          rpDelta: 0,
        });
        return;
      }

      const nextWall = [...wall];
      const drawn = nextWall.pop()!;
      const botHand = [...hands[turn], drawn];

      if (canWin(botHand, melds[turn].length)) {
        const botObj = players.find((p) => p.seat_index === turn);
        const botName = botObj?.bot_name || `Bot ${turn}`;
        recordMatchResult(false, 2).then((rpDelta) => {
          setWinnerInfo({ seat: turn, name: botName, faan: 2, rpDelta });
        });
        return;
      }

      const discardIdx = Math.floor(Math.random() * botHand.length);
      const discarded = botHand[discardIdx];
      const remaining = sortHand(botHand.filter((_, i) => i !== discardIdx));

      const nextHands = [...hands];
      nextHands[turn] = remaining;

      playTileClick();
      setWall(nextWall);
      setHands(nextHands);
      setDiscards((prev) => [...prev, discarded]);

      const nextTurn = (turn + 1) % 4;
      const hasClaim = evaluateClaimsForPlayer(discarded, turn, nextHands[0]);
      if (!hasClaim) {
        setTurn(nextTurn);
        if (nextTurn === 0) setMustDraw(true);
      }
    }, 850);

    return () => clearTimeout(timer);
  }, [
    turn,
    claimOptions,
    winnerInfo,
    wall,
    hands,
    melds,
    players,
    recordMatchResult,
    evaluateClaimsForPlayer,
  ]);

  const executeClaim = (type: 'PONG' | 'KONG' | 'CHI', pairTiles?: Tile[]) => {
    if (!claimOptions) return;
    playTileClick();
    const { tile, fromSeat } = claimOptions;
    let usedFromHand: Tile[] = [];

    if (type === 'PONG') {
      usedFromHand = hands[0]
        .filter((t) => t.suit === tile.suit && t.value === tile.value)
        .slice(0, 2);
    } else if (type === 'KONG') {
      usedFromHand = hands[0]
        .filter((t) => t.suit === tile.suit && t.value === tile.value)
        .slice(0, 3);
    } else if (type === 'CHI' && pairTiles) {
      usedFromHand = pairTiles;
    }

    const usedIds = new Set(usedFromHand.map((t) => t.id));
    const nextHands = [...hands];
    nextHands[0] = sortHand(nextHands[0].filter((t) => !usedIds.has(t.id)));

    const nextMelds = [...melds];
    nextMelds[0] = [
      ...nextMelds[0],
      { type, tiles: [...usedFromHand, tile], fromSeat },
    ];

    setDiscards((prev) => prev.slice(0, -1));
    setHands(nextHands);
    setMelds(nextMelds);
    setClaimOptions(null);
    setTurn(0);
    setMustDraw(type === 'KONG');
  };

  const declareWin = async () => {
    playTileClick();
    const faan = Math.max(1, melds[0].length + 1);
    const rpDelta = await recordMatchResult(true, faan);
    setWinnerInfo({ seat: 0, name: profile.username, faan, rpDelta });
  };

  const playerCanHu = canWin(hands[0], melds[0].length);
  const highlightedIds = new Set<string>();
  if (claimOptions) {
    hands[0].forEach((t) => {
      if (
        t.suit === claimOptions.tile.suit &&
        Math.abs(t.value - claimOptions.tile.value) <= 2
      ) {
        highlightedIds.add(t.id);
      }
    });
  }

  const getSeatName = (seatIdx: number) => {
    if (seatIdx === 0) return profile.username;
    const found = players.find((p) => p.seat_index === seatIdx);
    return found
      ? found.is_bot
        ? found.bot_name
        : found.profiles?.username
      : `Player ${seatIdx + 1}`;
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_center,#291d14_0%,#090705_100%)] text-stone-100 flex flex-col justify-between overflow-hidden select-none">
      {/* HUD ATAS MINIMALIS */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-black/50 border-b border-amber-500/20 backdrop-blur-sm z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onExitRoom}
            className="px-3 py-1.5 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-xs flex items-center gap-1.5 text-amber-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Lobby
          </button>
          <span className="text-xs px-2.5 py-1 rounded bg-amber-500/15 border border-amber-400/30 text-amber-300 font-mono">
            ROOM: {room.code} ({room.type.toUpperCase()})
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="text-stone-300">
            Sisa Dinding: <strong className="text-amber-300">{wall.length}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-semibold">
            Giliran: {getSeatName(turn)}
          </span>
        </div>
      </div>

      {/* AREA MEJA 3D FIRST-PERSON POV */}
      <div className="relative flex-1 flex items-center justify-center p-2 [perspective:1100px]">
        <div
          className={`relative w-full max-w-4xl h-[540px] rounded-3xl border-[12px] border-[#3d2314] bg-[radial-gradient(circle_at_center,#1b5e3a_0%,#0f3d24_75%,#092616_100%)] shadow-[0_30px_80px_rgba(0,0,0,0.85),inset_0_0_60px_rgba(0,0,0,0.65)] transition-transform duration-500 flex flex-col justify-between p-5 ${
            tableTilt ? '[transform:rotateX(22deg)]' : '[transform:rotateX(0deg)]'
          }`}
        >
          {/* LAWAN ATAS (WEST - SEAT 2) */}
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`px-3 py-0.5 rounded-full text-xs border ${
                turn === 2
                  ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                  : 'bg-black/50 text-stone-300 border-stone-700'
              }`}
            >
              西 {getSeatName(2)} ({hands[2].length})
            </div>
            <div className="flex gap-0.5">
              {hands[2].map((_, i) => (
                <div
                  key={i}
                  className="w-5 h-7 rounded-sm bg-gradient-to-b from-emerald-700 to-emerald-900 border border-emerald-400/40 shadow"
                />
              ))}
            </div>
          </div>

          {/* TENGAH MEJA */}
          <div className="flex items-center justify-between flex-1 my-2">
            {/* Lawan Kiri (North - Seat 3) */}
            <div className="flex flex-col items-center gap-2">
              <div
                className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
                  turn === 3
                    ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                    : 'bg-black/50 text-stone-300 border-stone-700'
                }`}
              >
                北 {getSeatName(3)}
              </div>
              <div className="flex flex-col gap-0.5">
                {hands[3].slice(0, 10).map((_, i) => (
                  <div
                    key={i}
                    className="w-7 h-3.5 rounded-sm bg-emerald-800 border border-emerald-400/40"
                  />
                ))}
              </div>
            </div>

            {/* Kolam Tengah (Discard Pile) */}
            <div className="w-80 min-h-[170px] bg-black/20 border border-emerald-400/15 rounded-xl p-2.5 flex flex-wrap content-start gap-1 shadow-inner">
              {discards.length === 0 && (
                <div className="w-full h-36 flex items-center justify-center text-xs text-emerald-200/30 italic">
                  Kolam Buangan Tengah Meja
                </div>
              )}
              {discards.map((tile, idx) => (
                <button
                  key={`${tile.id}_${idx}`}
                  onClick={() => setInspectedTile(tile)}
                  onMouseEnter={() => setInspectedTile(tile)}
                  className={`w-7 h-9 rounded bg-gradient-to-b from-[#fffdf7] to-[#e8dfc8] border border-stone-400 shadow flex flex-col items-center justify-center leading-none hover:scale-110 transition ${
                    tile.color
                  } ${idx === discards.length - 1 ? 'ring-2 ring-amber-400' : ''}`}
                >
                  <span className="text-xs font-bold">{tile.label}</span>
                  <span className="text-[8px] opacity-70">{tile.sub[0]}</span>
                </button>
              ))}
            </div>

            {/* Lawan Kanan (South - Seat 1) */}
            <div className="flex flex-col items-center gap-2">
              <div
                className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
                  turn === 1
                    ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                    : 'bg-black/50 text-stone-300 border-stone-700'
                }`}
              >
                南 {getSeatName(1)}
              </div>
              <div className="flex flex-col gap-0.5">
                {hands[1].slice(0, 10).map((_, i) => (
                  <div
                    key={i}
                    className="w-7 h-3.5 rounded-sm bg-emerald-800 border border-emerald-400/40"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* AREA PEMAIN BAWAH (EAST - SEAT 0) */}
          <div className="flex items-end justify-between gap-2 pt-2 border-t border-emerald-400/20">
            <div className="flex items-end gap-1 flex-wrap">
              {hands[0].map((tile) => {
                const isDrawn = tile.id === drawnTileId;
                const isHighlighted = highlightedIds.has(tile.id);
                return (
                  <button
                    key={tile.id}
                    onClick={() => handleDiscard(tile)}
                    disabled={turn !== 0 || mustDraw || Boolean(claimOptions)}
                    className={`w-10 h-14 rounded-md bg-gradient-to-b from-[#fffef9] via-[#f7f0dc] to-[#dfd3b6] border-b-4 border-emerald-800 shadow-lg flex flex-col items-center justify-center transition-transform ${
                      tile.color
                    } ${isDrawn ? 'ml-3 ring-2 ring-amber-400' : ''} ${
                      isHighlighted ? 'ring-2 ring-amber-400 -translate-y-2' : ''
                    } ${
                      turn === 0 && !mustDraw && !claimOptions
                        ? 'hover:-translate-y-3 cursor-pointer'
                        : 'opacity-95 cursor-default'
                    }`}
                  >
                    <span className="text-lg font-extrabold leading-none">
                      {tile.label}
                    </span>
                    <span className="text-[9px] font-semibold mt-0.5 opacity-75">
                      {tile.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {melds[0].length > 0 && (
              <div className="flex gap-2 bg-black/25 p-1.5 rounded-lg border border-amber-400/20">
                {melds[0].map((m, idx) => (
                  <div key={idx} className="flex gap-0.5">
                    {m.tiles.map((t, ti) => (
                      <div
                        key={ti}
                        className={`w-7 h-10 rounded bg-[#f7f0dc] border border-stone-400 flex flex-col items-center justify-center text-xs font-bold ${t.color}`}
                      >
                        <span>{t.label}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PANEL AKSI BAWAH */}
      <div className="bg-stone-950/90 border-t border-amber-500/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTableTilt(!tableTilt)}
            className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs flex items-center gap-1.5 text-stone-200"
          >
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            Sudut: {tableTilt ? '3D Miring' : 'Datar'}
          </button>

          {inspectedTile && (
            <div className="text-xs bg-stone-900 border border-stone-700 px-3 py-1.5 rounded-lg flex items-center gap-2">
              <span className={`font-bold ${inspectedTile.color}`}>
                {inspectedTile.label}
              </span>
              <span className="text-stone-400">
                {inspectedTile.sub} ({inspectedTile.value})
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {turn === 0 && mustDraw && !claimOptions && !winnerInfo && (
            <button
              onClick={handleManualDraw}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-stone-950 font-extrabold text-sm shadow-lg shadow-amber-500/20 flex items-center gap-2 animate-pulse"
            >
              <Sparkles className="w-4 h-4" /> DRAW TILE DARI DINDING
            </button>
          )}

          {turn === 0 && !mustDraw && !winnerInfo && (
            <span className="text-xs text-amber-300 font-medium">
              Klik salah satu batu di tangan Anda untuk membuang ke meja.
            </span>
          )}

          {playerCanHu && !winnerInfo && (
            <button
              onClick={declareWin}
              className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm shadow-lg animate-bounce"
            >
              🀄 HU (MENANG)!
            </button>
          )}

          {claimOptions && (
            <div className="flex items-center gap-2 bg-stone-900 border border-amber-400/50 px-3 py-1.5 rounded-xl">
              <span className="text-xs text-amber-200 mr-1">
                Klaim <strong>{claimOptions.tile.label}</strong>:
              </span>
              {claimOptions.canKong && (
                <button
                  onClick={() => executeClaim('KONG')}
                  className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-xs font-bold"
                >
                  KONG
                </button>
              )}
              {claimOptions.canPong && (
                <button
                  onClick={() => executeClaim('PONG')}
                  className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold"
                >
                  PONG
                </button>
              )}
              {claimOptions.chiCombos.map((combo, i) => (
                <button
                  key={i}
                  onClick={() => executeClaim('CHI', combo)}
                  className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold"
                >
                  CHI ({combo[0].value}-{combo[1].value})
                </button>
              ))}
              <button
                onClick={() => {
                  const nextSeat = (claimOptions.fromSeat + 1) % 4;
                  setClaimOptions(null);
                  setTurn(nextSeat);
                  if (nextSeat === 0) setMustDraw(true);
                }}
                className="px-3 py-1 rounded bg-stone-700 hover:bg-stone-600 text-xs"
              >
                Lewati
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL HASIL PERTANDINGAN */}
      {winnerInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-stone-900 border-2 border-amber-400 rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <Trophy className="w-12 h-12 text-amber-400 mx-auto" />
            <h2 className="text-xl font-bold text-amber-300">
              {winnerInfo.seat === 0 ? 'Selamat, Anda Menang!' : 'Ronde Selesai'}
            </h2>
            <p className="text-sm text-stone-300">
              Pemenang: <strong>{winnerInfo.name}</strong> ({winnerInfo.faan}{' '}
              Faan)
            </p>
            <div className="py-2 px-4 rounded-lg bg-stone-950 border border-stone-800 text-sm">
              Perubahan Rank:{' '}
              <span
                className={
                  winnerInfo.rpDelta >= 0
                    ? 'text-emerald-400 font-bold'
                    : 'text-red-400 font-bold'
                }
              >
                {winnerInfo.rpDelta >= 0
                  ? `+${winnerInfo.rpDelta}`
                  : winnerInfo.rpDelta}{' '}
                RP
              </span>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={initRound}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" /> Main Lagi
              </button>
              <button
                onClick={onExitRoom}
                className="flex-1 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-sm font-semibold"
              >
                Ke Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}