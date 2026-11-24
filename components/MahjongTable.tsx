'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

interface GameStatePayload {
  wall: Tile[];
  hands: Record<string, Tile[]>;
  melds: Record<string, Meld[]>;
  discards: Tile[];
  turn: number;
  mustDraw: boolean;
  winnerInfo: {
    seat: number;
    name: string;
    faan: number;
  } | null;
}

interface MahjongTableProps {
  profile: UserProfile;
  room: { id: string; code: string; type: 'ranked' | 'private'; host_id: string };
  players: any[];
  onExitRoom: () => void;
  onProfileUpdated: () => void;
}

const MAN_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_KANJI = ['東', '南', '西', '北'];
const WIND_NAMES = ['East', 'South', 'West', 'North'];
const DRAGON_KANJI = ['中', '發', '白'];
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
          label: suit === 'man' ? MAN_KANJI[v - 1] : `${v}`,
          sub:
            suit === 'man'
              ? `${v} Wan`
              : suit === 'pin'
              ? `${v} Dots`
              : `${v} Bamboo`,
          color:
            suit === 'man'
              ? 'text-blue-800'
              : suit === 'pin'
              ? 'text-red-700'
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
        label: WIND_KANJI[v - 1],
        sub: WIND_NAMES[v - 1],
        color: 'text-blue-800',
      });
    }
  }

  for (let v = 1; v <= 3; v++) {
    for (let c = 0; c < 4; c++) {
      deck.push({
        id: `dragon_${v}_${uid++}`,
        suit: 'dragon',
        value: v,
        label: DRAGON_KANJI[v - 1],
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

/* KOMPONEN VISUAL BATU MAHJONG KLASIK (DOTS, BAMBOO, SYMBOLS, WINDS, DRAGONS) */
function TileFace({ tile }: { tile: Tile }) {
  // 1. SUIT: SYMBOLS (MAN / WAN) -> Angka Biru di atas + 萬 Merah di bawah
  if (tile.suit === 'man') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center leading-none py-0.5">
        <span className="text-[13px] sm:text-[17px] font-serif font-extrabold text-[#1d4ed8]">
          {MAN_KANJI[tile.value - 1]}
        </span>
        <span className="text-[12px] sm:text-[15px] font-serif font-extrabold text-[#b91c1c] mt-0.5">
          萬
        </span>
      </div>
    );
  }

  // 2. SUIT: DOTS (PIN) -> Ilustrasi Lingkaran Warna-Warni Klasik
  if (tile.suit === 'pin') {
    const dotLayouts: Record<
      number,
      { cx: number; cy: number; r: number; fill: string }[]
    > = {
      1: [{ cx: 30, cy: 40, r: 17, fill: '#b91c1c' }],
      2: [
        { cx: 30, cy: 23, r: 11, fill: '#15803d' },
        { cx: 30, cy: 57, r: 11, fill: '#1d4ed8' },
      ],
      3: [
        { cx: 17, cy: 19, r: 8.5, fill: '#1d4ed8' },
        { cx: 30, cy: 40, r: 8.5, fill: '#b91c1c' },
        { cx: 43, cy: 61, r: 8.5, fill: '#15803d' },
      ],
      4: [
        { cx: 19, cy: 23, r: 9.5, fill: '#1d4ed8' },
        { cx: 41, cy: 23, r: 9.5, fill: '#15803d' },
        { cx: 19, cy: 57, r: 9.5, fill: '#15803d' },
        { cx: 41, cy: 57, r: 9.5, fill: '#1d4ed8' },
      ],
      5: [
        { cx: 18, cy: 20, r: 8, fill: '#1d4ed8' },
        { cx: 42, cy: 20, r: 8, fill: '#15803d' },
        { cx: 30, cy: 40, r: 8, fill: '#b91c1c' },
        { cx: 18, cy: 60, r: 8, fill: '#15803d' },
        { cx: 42, cy: 60, r: 8, fill: '#1d4ed8' },
      ],
      6: [
        { cx: 19, cy: 18, r: 8, fill: '#15803d' },
        { cx: 41, cy: 18, r: 8, fill: '#15803d' },
        { cx: 19, cy: 41, r: 8, fill: '#b91c1c' },
        { cx: 41, cy: 41, r: 8, fill: '#b91c1c' },
        { cx: 19, cy: 62, r: 8, fill: '#b91c1c' },
        { cx: 41, cy: 62, r: 8, fill: '#b91c1c' },
      ],
      7: [
        { cx: 16, cy: 15, r: 6.5, fill: '#15803d' },
        { cx: 30, cy: 21, r: 6.5, fill: '#15803d' },
        { cx: 44, cy: 27, r: 6.5, fill: '#15803d' },
        { cx: 19, cy: 45, r: 7.5, fill: '#b91c1c' },
        { cx: 41, cy: 45, r: 7.5, fill: '#b91c1c' },
        { cx: 19, cy: 64, r: 7.5, fill: '#b91c1c' },
        { cx: 41, cy: 64, r: 7.5, fill: '#b91c1c' },
      ],
      8: [
        { cx: 20, cy: 14, r: 6.5, fill: '#1d4ed8' },
        { cx: 40, cy: 14, r: 6.5, fill: '#1d4ed8' },
        { cx: 20, cy: 31, r: 6.5, fill: '#1d4ed8' },
        { cx: 40, cy: 31, r: 6.5, fill: '#1d4ed8' },
        { cx: 20, cy: 49, r: 6.5, fill: '#1d4ed8' },
        { cx: 40, cy: 49, r: 6.5, fill: '#1d4ed8' },
        { cx: 20, cy: 66, r: 6.5, fill: '#1d4ed8' },
        { cx: 40, cy: 66, r: 6.5, fill: '#1d4ed8' },
      ],
      9: [
        { cx: 15, cy: 17, r: 6.5, fill: '#15803d' },
        { cx: 30, cy: 17, r: 6.5, fill: '#15803d' },
        { cx: 45, cy: 17, r: 6.5, fill: '#15803d' },
        { cx: 15, cy: 40, r: 6.5, fill: '#b91c1c' },
        { cx: 30, cy: 40, r: 6.5, fill: '#b91c1c' },
        { cx: 45, cy: 40, r: 6.5, fill: '#b91c1c' },
        { cx: 15, cy: 63, r: 6.5, fill: '#1d4ed8' },
        { cx: 30, cy: 63, r: 6.5, fill: '#1d4ed8' },
        { cx: 45, cy: 63, r: 6.5, fill: '#1d4ed8' },
      ],
    };

    const dots = dotLayouts[tile.value] || [];
    return (
      <svg viewBox="0 0 60 80" className="w-full h-full p-0.5">
        {dots.map((d, i) => (
          <g key={i}>
            <circle
              cx={d.cx}
              cy={d.cy}
              r={d.r}
              fill={d.fill}
              stroke="#fffdf7"
              strokeWidth="1.2"
            />
            <circle
              cx={d.cx}
              cy={d.cy}
              r={d.r * 0.55}
              fill="none"
              stroke="#fffdf7"
              strokeWidth="1.3"
              strokeDasharray="2.5 2"
            />
            <circle cx={d.cx} cy={d.cy} r={d.r * 0.2} fill="#fffdf7" />
          </g>
        ))}
      </svg>
    );
  }

  // 3. SUIT: BAMBOO (SOU) -> Batang Bambu Beruas Hijau & Merah
  if (tile.suit === 'sou') {
    const sticks: Record<
      number,
      { x: number; y: number; h: number; fill: string }[]
    > = {
      1: [{ x: 26, y: 16, h: 48, fill: '#b91c1c' }],
      2: [
        { x: 27, y: 12, h: 25, fill: '#15803d' },
        { x: 27, y: 43, h: 25, fill: '#15803d' },
      ],
      3: [
        { x: 27, y: 12, h: 25, fill: '#15803d' },
        { x: 16, y: 43, h: 25, fill: '#15803d' },
        { x: 38, y: 43, h: 25, fill: '#15803d' },
      ],
      4: [
        { x: 17, y: 12, h: 25, fill: '#15803d' },
        { x: 37, y: 12, h: 25, fill: '#15803d' },
        { x: 17, y: 43, h: 25, fill: '#15803d' },
        { x: 37, y: 43, h: 25, fill: '#15803d' },
      ],
      5: [
        { x: 13, y: 12, h: 25, fill: '#15803d' },
        { x: 41, y: 12, h: 25, fill: '#15803d' },
        { x: 27, y: 27, h: 26, fill: '#b91c1c' },
        { x: 13, y: 43, h: 25, fill: '#15803d' },
        { x: 41, y: 43, h: 25, fill: '#15803d' },
      ],
      6: [
        { x: 14, y: 12, h: 25, fill: '#15803d' },
        { x: 27, y: 12, h: 25, fill: '#15803d' },
        { x: 40, y: 12, h: 25, fill: '#15803d' },
        { x: 14, y: 43, h: 25, fill: '#15803d' },
        { x: 27, y: 43, h: 25, fill: '#15803d' },
        { x: 40, y: 43, h: 25, fill: '#15803d' },
      ],
      7: [
        { x: 27, y: 8, h: 19, fill: '#b91c1c' },
        { x: 14, y: 31, h: 19, fill: '#15803d' },
        { x: 27, y: 31, h: 19, fill: '#15803d' },
        { x: 40, y: 31, h: 19, fill: '#15803d' },
        { x: 14, y: 53, h: 19, fill: '#15803d' },
        { x: 27, y: 53, h: 19, fill: '#15803d' },
        { x: 40, y: 53, h: 19, fill: '#15803d' },
      ],
      8: [
        { x: 13, y: 10, h: 18, fill: '#15803d' },
        { x: 27, y: 10, h: 18, fill: '#15803d' },
        { x: 41, y: 10, h: 18, fill: '#15803d' },
        { x: 19, y: 31, h: 18, fill: '#b91c1c' },
        { x: 35, y: 31, h: 18, fill: '#b91c1c' },
        { x: 13, y: 52, h: 18, fill: '#15803d' },
        { x: 27, y: 52, h: 18, fill: '#15803d' },
        { x: 41, y: 52, h: 18, fill: '#15803d' },
      ],
      9: [
        { x: 13, y: 10, h: 18, fill: '#b91c1c' },
        { x: 27, y: 10, h: 18, fill: '#15803d' },
        { x: 41, y: 10, h: 18, fill: '#15803d' },
        { x: 13, y: 31, h: 18, fill: '#b91c1c' },
        { x: 27, y: 31, h: 18, fill: '#15803d' },
        { x: 41, y: 31, h: 18, fill: '#15803d' },
        { x: 13, y: 52, h: 18, fill: '#b91c1c' },
        { x: 27, y: 52, h: 18, fill: '#15803d' },
        { x: 41, y: 52, h: 18, fill: '#15803d' },
      ],
    };

    const items = sticks[tile.value] || [];
    return (
      <svg viewBox="0 0 60 80" className="w-full h-full p-0.5">
        {items.map((s, i) => (
          <g key={i}>
            <rect
              x={s.x}
              y={s.y}
              width={tile.value === 1 ? 8 : 6}
              height={s.h}
              rx={3}
              fill={s.fill}
            />
            <line
              x1={s.x}
              y1={s.y + s.h / 2}
              x2={s.x + (tile.value === 1 ? 8 : 6)}
              y2={s.y + s.h / 2}
              stroke="#fffdf7"
              strokeWidth="1.5"
            />
            <line
              x1={s.x + (tile.value === 1 ? 4 : 3)}
              y1={s.y + 3}
              x2={s.x + (tile.value === 1 ? 4 : 3)}
              y2={s.y + s.h - 3}
              stroke="#fffdf7"
              strokeWidth="1"
              opacity="0.7"
            />
          </g>
        ))}
      </svg>
    );
  }

  // 4. WINDS -> Kanji Biru Klasik
  if (tile.suit === 'wind') {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-xl sm:text-2xl font-serif font-extrabold text-[#1e40af]">
          {WIND_KANJI[tile.value - 1]}
        </span>
      </div>
    );
  }

  // 5. DRAGONS -> Red (中), Green (發), White (Bingkai Biru Klasik)
  if (tile.value === 1) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-xl sm:text-2xl font-serif font-extrabold text-[#b91c1c]">
          中
        </span>
      </div>
    );
  }
  if (tile.value === 2) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-xl sm:text-2xl font-serif font-extrabold text-[#15803d]">
          發
        </span>
      </div>
    );
  }
  return (
    <div className="w-full h-full p-1.5 flex items-center justify-center">
      <div className="w-full h-full border-[2.5px] border-[#1d4ed8] rounded-sm relative">
        <div className="absolute inset-0.5 border border-[#1d4ed8]/60" />
      </div>
    </div>
  );
}

export default function MahjongTable({
  profile,
  room,
  players,
  onExitRoom,
  onProfileUpdated,
}: MahjongTableProps) {
  const [livePlayers, setLivePlayers] = useState<any[]>(players);
  const myPlayerObj = livePlayers.find((p) => p.user_id === profile.id);
  const mySeat = myPlayerObj ? myPlayerObj.seat_index : 0;
  const isHost = room.host_id === profile.id;

  const [gameState, setGameState] = useState<GameStatePayload | null>(null);
  const gameStateRef = useRef<GameStatePayload | null>(null);
  const livePlayersRef = useRef<any[]>(players);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    livePlayersRef.current = livePlayers;
  }, [livePlayers]);

  const [drawnTileId, setDrawnTileId] = useState<string | null>(null);
  const [tableTilt, setTableTilt] = useState<boolean>(false);
  const [inspectedTile, setInspectedTile] = useState<Tile | null>(null);
  const [rpChangeShown, setRpChangeShown] = useState<number | null>(null);
  const recordedWinRef = useRef<string | null>(null);
  const lastDiscardCountRef = useRef<number>(0);

  const [claimOptions, setClaimOptions] = useState<{
    tile: Tile;
    fromSeat: number;
    canPong: boolean;
    canKong: boolean;
    chiCombos: Tile[][];
  } | null>(null);

  const playTileClick = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.045);
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {}
  };

  const pushStateToSupabase = useCallback(
    async (nextState: GameStatePayload) => {
      setGameState(nextState);
      gameStateRef.current = nextState;
      await supabase.from('game_states').upsert({
        room_id: room.id,
        current_turn: nextState.turn,
        wall_tiles: nextState.wall,
        discard_pile: nextState.discards,
        player_hands: nextState.hands,
        player_melds: nextState.melds,
        round_wind: JSON.stringify({
          mustDraw: nextState.mustDraw,
          winnerInfo: nextState.winnerInfo,
        }),
        updated_at: new Date().toISOString(),
      });
    },
    [room.id]
  );

  const parseDbRow = useCallback((row: any): GameStatePayload => {
    let meta = { mustDraw: true, winnerInfo: null };
    try {
      if (row.round_wind && row.round_wind.startsWith('{')) {
        meta = JSON.parse(row.round_wind);
      }
    } catch {}
    return {
      wall: row.wall_tiles || [],
      hands: row.player_hands || { '0': [], '1': [], '2': [], '3': [] },
      melds: row.player_melds || { '0': [], '1': [], '2': [], '3': [] },
      discards: row.discard_pile || [],
      turn: row.current_turn ?? 0,
      mustDraw: meta.mustDraw,
      winnerInfo: meta.winnerInfo,
    };
  }, []);

  const initRound = useCallback(async () => {
    recordedWinRef.current = null;
    lastDiscardCountRef.current = 0;
    setRpChangeShown(null);
    setClaimOptions(null);
    setDrawnTileId(null);

    const deck = generateDeck();
    const hands: Record<string, Tile[]> = {
      '0': sortHand(deck.splice(0, 13)),
      '1': sortHand(deck.splice(0, 13)),
      '2': sortHand(deck.splice(0, 13)),
      '3': sortHand(deck.splice(0, 13)),
    };

    const freshState: GameStatePayload = {
      wall: deck,
      hands,
      melds: { '0': [], '1': [], '2': [], '3': [] },
      discards: [],
      turn: 0,
      mustDraw: true,
      winnerInfo: null,
    };

    await pushStateToSupabase(freshState);
  }, [pushStateToSupabase]);

  // Sinkronisasi Realtime + Polling 1.5 detik
  useEffect(() => {
    let isMounted = true;

    async function syncFromServer() {
      const [{ data: stateRow }, { data: pRows }] = await Promise.all([
        supabase
          .from('game_states')
          .select('*')
          .eq('room_id', room.id)
          .maybeSingle(),
        supabase
          .from('room_players')
          .select('*, profiles(username, rank_tier, rank_points)')
          .eq('room_id', room.id)
          .order('seat_index', { ascending: true }),
      ]);

      if (!isMounted) return;
      if (pRows && pRows.length > 0) setLivePlayers(pRows);

      if (stateRow) {
        const parsed = parseDbRow(stateRow);
        if (parsed.discards.length > lastDiscardCountRef.current) {
          playTileClick();
        }
        lastDiscardCountRef.current = parsed.discards.length;
        setGameState(parsed);
      } else if (isHost) {
        await initRound();
      }
    }

    syncFromServer();
    const pollInterval = setInterval(syncFromServer, 1500);

    const channel = supabase
      .channel(`game_state_${room.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_states',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          if (payload.new && isMounted) {
            const incoming = parseDbRow(payload.new);
            if (incoming.discards.length > lastDiscardCountRef.current) {
              playTileClick();
            }
            lastDiscardCountRef.current = incoming.discards.length;
            setGameState(incoming);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [room.id, isHost, initRound, parseDbRow]);

  useEffect(() => {
    if (!gameState?.winnerInfo) {
      recordedWinRef.current = null;
      return;
    }

    const winSig = `${gameState.winnerInfo.seat}_${gameState.winnerInfo.name}_${gameState.discards.length}`;
    if (recordedWinRef.current === winSig) return;
    recordedWinRef.current = winSig;

    const { seat, faan } = gameState.winnerInfo;
    if (seat === -1 || room.type === 'private') {
      setRpChangeShown(0);
      return;
    }

    const didIWin = seat === mySeat;
    const delta = didIWin ? 25 + faan * 5 : -15;
    setRpChangeShown(delta);

    supabase
      .from('profiles')
      .update({
        rank_points: Math.max(0, profile.rank_points + delta),
        matches_played: profile.matches_played + 1,
        wins: didIWin ? profile.wins + 1 : profile.wins,
      })
      .eq('id', profile.id)
      .then(() => onProfileUpdated());
  }, [gameState, mySeat, profile, room.type, onProfileUpdated]);

  useEffect(() => {
    if (!gameState || gameState.winnerInfo || !gameState.mustDraw) {
      setClaimOptions(null);
      return;
    }
    if (gameState.discards.length === 0) return;

    const lastDiscarder = (gameState.turn + 3) % 4;
    if (lastDiscarder === mySeat) return;

    const lastTile = gameState.discards[gameState.discards.length - 1];
    const myHand = gameState.hands[String(mySeat)] || [];

    const same = myHand.filter(
      (t) => t.suit === lastTile.suit && t.value === lastTile.value
    );
    const canPong = same.length >= 2;
    const canKong = same.length >= 3;

    const chiCombos: Tile[][] = [];
    const leftSeat = (mySeat + 3) % 4;
    if (
      lastDiscarder === leftSeat &&
      ['man', 'pin', 'sou'].includes(lastTile.suit)
    ) {
      const v = lastTile.value;
      const findVal = (val: number) =>
        myHand.find((t) => t.suit === lastTile.suit && t.value === val);
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
        tile: lastTile,
        fromSeat: lastDiscarder,
        canPong,
        canKong,
        chiCombos,
      });
    } else {
      setClaimOptions(null);
    }
  }, [gameState, mySeat]);

  // FIX ANTI-STUCK: Timer Bot AI tidak akan ter-reset oleh polling 1.5 detik
  const activeTurn = gameState?.turn;
  const isRoundOver = Boolean(gameState?.winnerInfo);

  useEffect(() => {
    if (!isHost || activeTurn === undefined || isRoundOver) return;

    const currentSeatObj = livePlayersRef.current.find(
      (p) => p.seat_index === activeTurn
    );
    if (!currentSeatObj || !currentSeatObj.is_bot) return;

    const timer = setTimeout(async () => {
      const latest = gameStateRef.current;
      if (!latest || latest.winnerInfo || latest.turn !== activeTurn) return;

      if (latest.wall.length === 0) {
        await pushStateToSupabase({
          ...latest,
          winnerInfo: {
            seat: -1,
            name: 'Draw Game (Dinding Habis)',
            faan: 0,
          },
        });
        return;
      }

      const nextWall = [...latest.wall];
      const drawn = nextWall.pop()!;
      const seatKey = String(activeTurn);
      const botHand = [...(latest.hands[seatKey] || []), drawn];
      const botMelds = latest.melds[seatKey] || [];

      if (canWin(botHand, botMelds.length)) {
        const botName = currentSeatObj.bot_name || `Bot ${activeTurn + 1}`;
        await pushStateToSupabase({
          ...latest,
          wall: nextWall,
          hands: { ...latest.hands, [seatKey]: sortHand(botHand) },
          winnerInfo: { seat: activeTurn, name: botName, faan: 2 },
        });
        return;
      }

      const discardIdx = Math.floor(Math.random() * botHand.length);
      const discarded = botHand[discardIdx];
      const remaining = sortHand(botHand.filter((_, i) => i !== discardIdx));

      await pushStateToSupabase({
        ...latest,
        wall: nextWall,
        hands: { ...latest.hands, [seatKey]: remaining },
        discards: [...latest.discards, discarded],
        turn: (activeTurn + 1) % 4,
        mustDraw: true,
      });
    }, 2400);

    return () => clearTimeout(timer);
  }, [isHost, activeTurn, isRoundOver, pushStateToSupabase]);

  const handleManualDraw = async () => {
    if (
      !gameState ||
      gameState.turn !== mySeat ||
      !gameState.mustDraw ||
      gameState.winnerInfo
    )
      return;

    if (gameState.wall.length === 0) {
      await pushStateToSupabase({
        ...gameState,
        winnerInfo: { seat: -1, name: 'Draw Game (Dinding Habis)', faan: 0 },
      });
      return;
    }

    playTileClick();
    const nextWall = [...gameState.wall];
    const drawn = nextWall.pop()!;
    const seatKey = String(mySeat);
    const updatedHand = [...(gameState.hands[seatKey] || []), drawn];

    setDrawnTileId(drawn.id);
    setClaimOptions(null);

    await pushStateToSupabase({
      ...gameState,
      wall: nextWall,
      hands: { ...gameState.hands, [seatKey]: updatedHand },
      mustDraw: false,
    });
  };

  const handleDiscard = async (tile: Tile) => {
    if (
      !gameState ||
      gameState.turn !== mySeat ||
      gameState.mustDraw ||
      claimOptions ||
      gameState.winnerInfo
    )
      return;

    playTileClick();
    const seatKey = String(mySeat);
    const remaining = sortHand(
      (gameState.hands[seatKey] || []).filter((t) => t.id !== tile.id)
    );

    setDrawnTileId(null);
    await pushStateToSupabase({
      ...gameState,
      hands: { ...gameState.hands, [seatKey]: remaining },
      discards: [...gameState.discards, tile],
      turn: (mySeat + 1) % 4,
      mustDraw: true,
    });
  };

  const executeClaim = async (
    type: 'PONG' | 'KONG' | 'CHI',
    pairTiles?: Tile[]
  ) => {
    if (!claimOptions || !gameState) return;
    playTileClick();

    const { tile, fromSeat } = claimOptions;
    const seatKey = String(mySeat);
    const myHand = gameState.hands[seatKey] || [];
    let usedFromHand: Tile[] = [];

    if (type === 'PONG') {
      usedFromHand = myHand
        .filter((t) => t.suit === tile.suit && t.value === tile.value)
        .slice(0, 2);
    } else if (type === 'KONG') {
      usedFromHand = myHand
        .filter((t) => t.suit === tile.suit && t.value === tile.value)
        .slice(0, 3);
    } else if (type === 'CHI' && pairTiles) {
      usedFromHand = pairTiles;
    }

    const usedIds = new Set(usedFromHand.map((t) => t.id));
    const remainingHand = sortHand(myHand.filter((t) => !usedIds.has(t.id)));
    const nextMelds = [
      ...(gameState.melds[seatKey] || []),
      { type, tiles: [...usedFromHand, tile], fromSeat },
    ];

    setClaimOptions(null);
    await pushStateToSupabase({
      ...gameState,
      hands: { ...gameState.hands, [seatKey]: remainingHand },
      melds: { ...gameState.melds, [seatKey]: nextMelds },
      discards: gameState.discards.slice(0, -1),
      turn: mySeat,
      mustDraw: type === 'KONG',
    });
  };

  const declareWin = async () => {
    if (!gameState) return;
    playTileClick();
    const myMelds = gameState.melds[String(mySeat)] || [];
    const faan = Math.max(1, myMelds.length + 1);

    await pushStateToSupabase({
      ...gameState,
      winnerInfo: { seat: mySeat, name: profile.username, faan },
    });
  };

  if (!gameState) {
    return (
      <div className="min-h-screen bg-stone-950 text-amber-200 flex items-center justify-center text-sm">
        Menyiapkan Meja Multiplayer...
      </div>
    );
  }

  const bottomSeat = mySeat;
  const rightSeat = (mySeat + 1) % 4;
  const topSeat = (mySeat + 2) % 4;
  const leftSeat = (mySeat + 3) % 4;

  const getSeatName = (seatIdx: number) => {
    if (seatIdx === mySeat) return `${profile.username} (Anda)`;
    const found = livePlayers.find((p) => p.seat_index === seatIdx);
    return found
      ? found.is_bot
        ? found.bot_name
        : found.profiles?.username
      : `Player ${seatIdx + 1}`;
  };

  const currentTurnObj = livePlayers.find(
    (p) => p.seat_index === gameState.turn
  );
  const isBotThinking = Boolean(currentTurnObj?.is_bot);

  const myHand = gameState.hands[String(bottomSeat)] || [];
  const myMelds = gameState.melds[String(bottomSeat)] || [];
  const topHand = gameState.hands[String(topSeat)] || [];
  const leftHand = gameState.hands[String(leftSeat)] || [];
  const rightHand = gameState.hands[String(rightSeat)] || [];

  const playerCanHu = canWin(myHand, myMelds.length);
  const highlightedIds = new Set<string>();
  if (claimOptions) {
    myHand.forEach((t) => {
      if (
        t.suit === claimOptions.tile.suit &&
        Math.abs(t.value - claimOptions.tile.value) <= 2
      ) {
        highlightedIds.add(t.id);
      }
    });
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_center,#291d14_0%,#090705_100%)] text-stone-100 flex flex-col justify-between overflow-x-hidden select-none">
      {/* HUD ATAS RESPONSIF */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-black/60 border-b border-amber-500/20 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2">
          <button
            onClick={onExitRoom}
            className="px-2.5 py-1.5 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-xs flex items-center gap-1 text-amber-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Lobby
          </button>
          <span className="text-[11px] sm:text-xs px-2 py-1 rounded bg-amber-500/15 border border-amber-400/30 text-amber-300 font-mono">
            {room.code} • {room.type.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs">
          <span className="text-stone-300">
            Dinding:{' '}
            <strong className="text-amber-300">{gameState.wall.length}</strong>
          </span>
          <span
            className={`px-2 py-1 rounded border font-semibold truncate max-w-[170px] sm:max-w-none ${
              gameState.turn === mySeat
                ? 'bg-amber-500 text-stone-950 border-amber-300'
                : 'bg-emerald-950 border-emerald-500/40 text-emerald-300'
            }`}
          >
            {gameState.turn === mySeat
              ? 'Giliran Anda!'
              : `${getSeatName(gameState.turn)}${
                  isBotThinking ? ' berpikir...' : ''
                }`}
          </span>
        </div>
      </div>

      {/* AREA MEJA 3D */}
      <div className="relative flex-1 flex items-center justify-center p-1.5 sm:p-3 [perspective:1100px]">
        <div
          className={`relative w-full max-w-4xl min-h-[440px] sm:h-[530px] rounded-2xl sm:rounded-3xl border-[6px] sm:border-[12px] border-[#3d2314] bg-[radial-gradient(circle_at_center,#1b5e3a_0%,#0f3d24_75%,#092616_100%)] shadow-[0_20px_60px_rgba(0,0,0,0.85),inset_0_0_40px_rgba(0,0,0,0.65)] transition-transform duration-500 flex flex-col justify-between p-2.5 sm:p-5 ${
            tableTilt ? 'sm:[transform:rotateX(20deg)]' : ''
          }`}
        >
          {/* LAWAN ATAS */}
          <div className="flex flex-col items-center gap-1">
            <div
              className={`px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs border ${
                gameState.turn === topSeat
                  ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                  : 'bg-black/50 text-stone-300 border-stone-700'
              }`}
            >
              {WIND_KANJI[topSeat]} {getSeatName(topSeat)} ({topHand.length})
            </div>
            <div className="flex gap-0.5">
              {topHand.map((_, i) => (
                <div
                  key={i}
                  className="w-3.5 h-5 sm:w-5 sm:h-7 rounded-sm bg-gradient-to-b from-emerald-700 to-emerald-900 border border-emerald-400/40 shadow"
                />
              ))}
            </div>
          </div>

          {/* TENGAH MEJA */}
          <div className="flex items-center justify-between flex-1 my-1.5 sm:my-2 gap-1.5 sm:gap-3">
            {/* Lawan Kiri */}
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className={`px-1.5 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[11px] border max-w-[70px] sm:max-w-none truncate ${
                  gameState.turn === leftSeat
                    ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                    : 'bg-black/50 text-stone-300 border-stone-700'
                }`}
              >
                {WIND_KANJI[leftSeat]} {getSeatName(leftSeat)}
              </div>
              <div className="flex flex-col gap-0.5">
                {leftHand.slice(0, 9).map((_, i) => (
                  <div
                    key={i}
                    className="w-5 h-2.5 sm:w-7 sm:h-3.5 rounded-sm bg-emerald-800 border border-emerald-400/40"
                  />
                ))}
              </div>
            </div>

            {/* Kolam Tengah (Discard Pile) dengan Visual Batu Klasik */}
            <div className="flex-1 max-w-xs sm:max-w-sm min-h-[145px] sm:min-h-[185px] max-h-[220px] overflow-y-auto bg-black/25 border border-emerald-400/15 rounded-xl p-1.5 sm:p-2.5 flex flex-wrap content-start gap-1 shadow-inner">
              {gameState.discards.length === 0 && (
                <div className="w-full h-32 flex items-center justify-center text-[11px] text-emerald-200/30 italic text-center">
                  Kolam Buangan Tengah Meja
                </div>
              )}
              {gameState.discards.map((tile, idx) => (
                <button
                  key={`${tile.id}_${idx}`}
                  onClick={() => setInspectedTile(tile)}
                  onMouseEnter={() => setInspectedTile(tile)}
                  className={`w-6 h-8 sm:w-7 sm:h-9 rounded bg-gradient-to-b from-[#faf6eb] to-[#e9dec4] border border-stone-400 border-b-2 border-b-stone-500 shadow flex items-center justify-center hover:scale-110 transition overflow-hidden ${
                    idx === gameState.discards.length - 1
                      ? 'ring-2 ring-amber-400'
                      : ''
                  }`}
                >
                  <TileFace tile={tile} />
                </button>
              ))}
            </div>

            {/* Lawan Kanan */}
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className={`px-1.5 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[11px] border max-w-[70px] sm:max-w-none truncate ${
                  gameState.turn === rightSeat
                    ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                    : 'bg-black/50 text-stone-300 border-stone-700'
                }`}
              >
                {WIND_KANJI[rightSeat]} {getSeatName(rightSeat)}
              </div>
              <div className="flex flex-col gap-0.5">
                {rightHand.slice(0, 9).map((_, i) => (
                  <div
                    key={i}
                    className="w-5 h-2.5 sm:w-7 sm:h-3.5 rounded-sm bg-emerald-800 border border-emerald-400/40"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* AREA PEMAIN BAWAH */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pt-2 border-t border-emerald-400/20">
            <div className="flex items-end justify-center sm:justify-start gap-1 flex-wrap">
              {myHand.map((tile) => {
                const isDrawn = tile.id === drawnTileId;
                const isHighlighted = highlightedIds.has(tile.id);
                const canClickDiscard =
                  gameState.turn === mySeat &&
                  !gameState.mustDraw &&
                  !claimOptions &&
                  !gameState.winnerInfo;

                return (
                  <button
                    key={tile.id}
                    onClick={() => handleDiscard(tile)}
                    onMouseEnter={() => setInspectedTile(tile)}
                    disabled={!canClickDiscard}
                    className={`w-8 h-12 sm:w-10 sm:h-14 rounded-md bg-gradient-to-b from-[#fcf9f0] via-[#f5eedc] to-[#e3d6b8] border border-stone-300 border-b-[3px] sm:border-b-4 border-b-emerald-800 shadow-lg flex items-center justify-center transition-transform overflow-hidden ${
                      isDrawn ? 'ml-1.5 sm:ml-3 ring-2 ring-amber-400' : ''
                    } ${
                      isHighlighted ? 'ring-2 ring-amber-400 -translate-y-2' : ''
                    } ${
                      canClickDiscard
                        ? 'hover:-translate-y-2.5 active:-translate-y-2.5 cursor-pointer'
                        : 'opacity-95 cursor-default'
                    }`}
                  >
                    <TileFace tile={tile} />
                  </button>
                );
              })}
            </div>

            {myMelds.length > 0 && (
              <div className="flex justify-center sm:justify-end gap-1.5 bg-black/30 p-1.5 rounded-lg border border-amber-400/20 overflow-x-auto">
                {myMelds.map((m, idx) => (
                  <div key={idx} className="flex gap-0.5 shrink-0">
                    {m.tiles.map((t, ti) => (
                      <div
                        key={ti}
                        className="w-6 h-9 sm:w-7 sm:h-10 rounded bg-[#f5eedc] border border-stone-400 flex items-center justify-center overflow-hidden"
                      >
                        <TileFace tile={t} />
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
      <div className="bg-stone-950/95 border-t border-amber-500/20 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTableTilt(!tableTilt)}
            className="hidden sm:flex px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs items-center gap-1.5 text-stone-200"
          >
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            Sudut: {tableTilt ? '3D Miring' : 'Datar'}
          </button>

          {inspectedTile && (
            <div className="text-xs bg-stone-900 border border-stone-700 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
              <span className="font-bold text-amber-300">
                {inspectedTile.sub}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
          {gameState.turn === mySeat &&
            gameState.mustDraw &&
            !claimOptions &&
            !gameState.winnerInfo && (
              <button
                onClick={handleManualDraw}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-stone-950 font-extrabold text-xs sm:text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 animate-pulse"
              >
                <Sparkles className="w-4 h-4" /> DRAW TILE DARI DINDING
              </button>
            )}

          {gameState.turn === mySeat &&
            !gameState.mustDraw &&
            !gameState.winnerInfo && (
              <span className="text-xs text-amber-300 font-medium text-center">
                Tap batu di tangan Anda untuk membuang ke meja.
              </span>
            )}

          {playerCanHu && !gameState.winnerInfo && (
            <button
              onClick={declareWin}
              className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm shadow-lg animate-bounce"
            >
              🀄 HU (MENANG)!
            </button>
          )}

          {claimOptions && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 bg-stone-900 border border-amber-400/50 px-2.5 py-1.5 rounded-xl w-full sm:w-auto">
              <span className="text-xs text-amber-200 mr-1">
                Klaim <strong>{claimOptions.tile.sub}</strong>:
              </span>
              {claimOptions.canKong && (
                <button
                  onClick={() => executeClaim('KONG')}
                  className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-xs font-bold"
                >
                  KONG
                </button>
              )}
              {claimOptions.canPong && (
                <button
                  onClick={() => executeClaim('PONG')}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold"
                >
                  PONG
                </button>
              )}
              {claimOptions.chiCombos.map((combo, i) => (
                <button
                  key={i}
                  onClick={() => executeClaim('CHI', combo)}
                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold"
                >
                  CHI ({combo[0].value}-{combo[1].value})
                </button>
              ))}
              <button
                onClick={() => setClaimOptions(null)}
                className="px-2.5 py-1 rounded bg-stone-700 hover:bg-stone-600 text-xs"
              >
                Lewati
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL HASIL PERTANDINGAN */}
      {gameState.winnerInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-stone-900 border-2 border-amber-400 rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <Trophy className="w-12 h-12 text-amber-400 mx-auto" />
            <h2 className="text-xl font-bold text-amber-300">
              {gameState.winnerInfo.seat === mySeat
                ? 'Selamat, Anda Menang!'
                : 'Ronde Selesai'}
            </h2>
            <p className="text-sm text-stone-300">
              Pemenang: <strong>{gameState.winnerInfo.name}</strong> (
              {gameState.winnerInfo.faan} Faan)
            </p>
            <div className="py-2 px-4 rounded-lg bg-stone-950 border border-stone-800 text-sm">
              Perubahan Rank:{' '}
              <span
                className={
                  (rpChangeShown ?? 0) >= 0
                    ? 'text-emerald-400 font-bold'
                    : 'text-red-400 font-bold'
                }
              >
                {(rpChangeShown ?? 0) >= 0
                  ? `+${rpChangeShown ?? 0}`
                  : rpChangeShown}{' '}
                RP
              </span>
            </div>
            <div className="flex gap-2 pt-2">
              {isHost ? (
                <button
                  onClick={initRound}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" /> Main Lagi
                </button>
              ) : (
                <div className="flex-1 py-2.5 rounded-lg bg-stone-950 border border-stone-800 text-xs text-stone-400 flex items-center justify-center">
                  Menunggu Host...
                </div>
              )}
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