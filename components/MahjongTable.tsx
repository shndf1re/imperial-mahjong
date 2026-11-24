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

const SUIT_SYMBOLS: Record<string, string[]> = {
  man: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
  pin: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'],
  sou: ['1索', '2索', '3索', '4索', '5索', '6索', '7索', '8索', '9索'],
  wind: ['東', '南', '西', '北'],
  dragon: ['中', '發', '白'],
};

const WIND_NAMES = ['East', 'South', 'West', 'North'];
const WIND_KANJI = ['東', '南', '西', '北'];
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
  const myPlayerObj = players.find((p) => p.user_id === profile.id);
  const mySeat = myPlayerObj ? myPlayerObj.seat_index : 0;
  const isHost = room.host_id === profile.id;

  const [gameState, setGameState] = useState<GameStatePayload | null>(null);
  const [drawnTileId, setDrawnTileId] = useState<string | null>(null);
  const [tableTilt, setTableTilt] = useState<boolean>(false);
  const [inspectedTile, setInspectedTile] = useState<Tile | null>(null);
  const [rpChangeShown, setRpChangeShown] = useState<number | null>(null);
  const recordedWinRef = useRef<string | null>(null);

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

  // Simpan state permainan ke Supabase agar tersinkron ke semua pemain di room
  const pushStateToSupabase = useCallback(
    async (nextState: GameStatePayload) => {
      setGameState(nextState);
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

  // Bangun ulang state dari baris database Supabase
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

  // Inisialisasi ronde baru (dijalankan oleh Host)
  const initRound = useCallback(async () => {
    recordedWinRef.current = null;
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

  // Sinkronisasi awal & langganan Realtime ke tabel game_states
  useEffect(() => {
    let isMounted = true;

    async function loadInitialState() {
      const { data } = await supabase
        .from('game_states')
        .select('*')
        .eq('room_id', room.id)
        .maybeSingle();

      if (data && isMounted) {
        setGameState(parseDbRow(data));
      } else if (isHost && isMounted) {
        await initRound();
      }
    }

    loadInitialState();

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
            playTileClick();
            setGameState(incoming);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [room.id, isHost, initRound, parseDbRow]);

  // Update RP otomatis untuk masing-masing pemain saat pertandingan selesai
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

  // Evaluasi apakah pemain lokal bisa mengklaim buangan lawan
  useEffect(() => {
    if (!gameState || gameState.winnerInfo || !gameState.mustDraw) {
      setClaimOptions(null);
      return;
    }
    if (gameState.discards.length === 0) return;

    // Siapa yang baru saja membuang kartu? Kursi sebelum current_turn
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
    // Chi hanya boleh dari pemain tepat sebelum giliran kita (seat - 1)
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

  // Eksekusi giliran Bot AI (hanya dijalankan oleh Host agar tidak bentrok)
  useEffect(() => {
    if (!isHost || !gameState || gameState.winnerInfo) return;

    const currentSeatObj = players.find(
      (p) => p.seat_index === gameState.turn
    );
    if (!currentSeatObj || !currentSeatObj.is_bot) return;

    const timer = setTimeout(async () => {
      if (gameState.wall.length === 0) {
        await pushStateToSupabase({
          ...gameState,
          winnerInfo: {
            seat: -1,
            name: 'Draw Game (Dinding Habis)',
            faan: 0,
          },
        });
        return;
      }

      const nextWall = [...gameState.wall];
      const drawn = nextWall.pop()!;
      const seatKey = String(gameState.turn);
      const botHand = [...(gameState.hands[seatKey] || []), drawn];
      const botMelds = gameState.melds[seatKey] || [];

      if (canWin(botHand, botMelds.length)) {
        const botName = currentSeatObj.bot_name || `Bot ${gameState.turn + 1}`;
        await pushStateToSupabase({
          ...gameState,
          wall: nextWall,
          hands: { ...gameState.hands, [seatKey]: sortHand(botHand) },
          winnerInfo: { seat: gameState.turn, name: botName, faan: 2 },
        });
        return;
      }

      const discardIdx = Math.floor(Math.random() * botHand.length);
      const discarded = botHand[discardIdx];
      const remaining = sortHand(botHand.filter((_, i) => i !== discardIdx));

      await pushStateToSupabase({
        ...gameState,
        wall: nextWall,
        hands: { ...gameState.hands, [seatKey]: remaining },
        discards: [...gameState.discards, discarded],
        turn: (gameState.turn + 1) % 4,
        mustDraw: true,
      });
    }, 1100);

    return () => clearTimeout(timer);
  }, [isHost, gameState, players, pushStateToSupabase]);

  // Aksi Draw Manual oleh Pemain Lokal
  const handleManualDraw = async () => {
    if (!gameState || gameState.turn !== mySeat || !gameState.mustDraw || gameState.winnerInfo) return;

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

  // Pemain membuang batu ke tengah meja
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

  // Eksekusi Klaim (Pong / Kong / Chi)
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

  // Deklarasi Menang (HU)
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

  // Rotasi kursi relatif terhadap pemain lokal (mySeat selalu berada di bawah)
  const bottomSeat = mySeat;
  const rightSeat = (mySeat + 1) % 4;
  const topSeat = (mySeat + 2) % 4;
  const leftSeat = (mySeat + 3) % 4;

  const getSeatName = (seatIdx: number) => {
    if (seatIdx === mySeat) return `${profile.username} (Anda)`;
    const found = players.find((p) => p.seat_index === seatIdx);
    return found
      ? found.is_bot
        ? found.bot_name
        : found.profiles?.username
      : `Player ${seatIdx + 1}`;
  };

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
      {/* HUD ATAS RESPONSIF MOBILE */}
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
            Dinding: <strong className="text-amber-300">{gameState.wall.length}</strong>
          </span>
          <span
            className={`px-2 py-1 rounded border font-semibold truncate max-w-[140px] sm:max-w-none ${
              gameState.turn === mySeat
                ? 'bg-amber-500 text-stone-950 border-amber-300'
                : 'bg-emerald-950 border-emerald-500/40 text-emerald-300'
            }`}
          >
            {gameState.turn === mySeat
              ? 'Giliran Anda!'
              : `Giliran: ${getSeatName(gameState.turn)}`}
          </span>
        </div>
      </div>

      {/* AREA MEJA 3D RESPONSIF */}
      <div className="relative flex-1 flex items-center justify-center p-1.5 sm:p-3 [perspective:1100px]">
        <div
          className={`relative w-full max-w-4xl min-h-[430px] sm:h-[520px] rounded-2xl sm:rounded-3xl border-[6px] sm:border-[12px] border-[#3d2314] bg-[radial-gradient(circle_at_center,#1b5e3a_0%,#0f3d24_75%,#092616_100%)] shadow-[0_20px_60px_rgba(0,0,0,0.85),inset_0_0_40px_rgba(0,0,0,0.65)] transition-transform duration-500 flex flex-col justify-between p-2.5 sm:p-5 ${
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

          {/* TENGAH MEJA: LAWAN KIRI/KANAN + KOLAM BUANGAN */}
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

            {/* Kolam Tengah (Discard Pile) */}
            <div className="flex-1 max-w-xs sm:max-w-sm min-h-[140px] sm:min-h-[175px] max-h-[210px] overflow-y-auto bg-black/25 border border-emerald-400/15 rounded-xl p-1.5 sm:p-2.5 flex flex-wrap content-start gap-1 shadow-inner">
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
                  className={`w-6 h-8 sm:w-7 sm:h-9 rounded bg-gradient-to-b from-[#fffdf7] to-[#e8dfc8] border border-stone-400 shadow flex flex-col items-center justify-center leading-none hover:scale-110 transition ${
                    tile.color
                  } ${
                    idx === gameState.discards.length - 1
                      ? 'ring-2 ring-amber-400'
                      : ''
                  }`}
                >
                  <span className="text-[11px] sm:text-xs font-bold">
                    {tile.label}
                  </span>
                  <span className="text-[7px] sm:text-[8px] opacity-70">
                    {tile.sub[0]}
                  </span>
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

          {/* AREA PEMAIN BAWAH (TANGAN TERBUKA + MELD) */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pt-2 border-t border-emerald-400/20">
            {/* Tangan Pemain */}
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
                    disabled={!canClickDiscard}
                    className={`w-8 h-12 sm:w-10 sm:h-14 rounded-md bg-gradient-to-b from-[#fffef9] via-[#f7f0dc] to-[#dfd3b6] border-b-[3px] sm:border-b-4 border-emerald-800 shadow-lg flex flex-col items-center justify-center transition-transform ${
                      tile.color
                    } ${isDrawn ? 'ml-1.5 sm:ml-3 ring-2 ring-amber-400' : ''} ${
                      isHighlighted ? 'ring-2 ring-amber-400 -translate-y-2' : ''
                    } ${
                      canClickDiscard
                        ? 'hover:-translate-y-2.5 active:-translate-y-2.5 cursor-pointer'
                        : 'opacity-95 cursor-default'
                    }`}
                  >
                    <span className="text-sm sm:text-lg font-extrabold leading-none">
                      {tile.label}
                    </span>
                    <span className="text-[7px] sm:text-[9px] font-semibold mt-0.5 opacity-75">
                      {tile.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Meld Set Terbuka */}
            {myMelds.length > 0 && (
              <div className="flex justify-center sm:justify-end gap-1.5 bg-black/30 p-1.5 rounded-lg border border-amber-400/20 overflow-x-auto">
                {myMelds.map((m, idx) => (
                  <div key={idx} className="flex gap-0.5 shrink-0">
                    {m.tiles.map((t, ti) => (
                      <div
                        key={ti}
                        className={`w-6 h-9 sm:w-7 sm:h-10 rounded bg-[#f7f0dc] border border-stone-400 flex flex-col items-center justify-center text-[11px] sm:text-xs font-bold ${t.color}`}
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

      {/* PANEL AKSI BAWAH RESPONSIF */}
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
              <span className={`font-bold ${inspectedTile.color}`}>
                {inspectedTile.label}
              </span>
              <span className="text-stone-400">
                {inspectedTile.sub} ({inspectedTile.value})
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
                Klaim <strong>{claimOptions.tile.label}</strong>:
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