'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, UserProfile } from '@/lib/supabase';
import {
  ArrowLeft,
  RotateCcw,
  Sparkles,
  Eye,
  EyeOff,
  Trophy,
  Dices,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Trash2,
  Flower2,
  MessageSquare,
  Flame,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';

export interface Tile {
  id: string;
  suit: 'man' | 'pin' | 'sou' | 'wind' | 'dragon' | 'flower' | 'season';
  value: number;
  label: string;
  sub: string;
  color: string;
}

interface Meld {
  type: 'CHI' | 'PONG' | 'KONG' | 'AN_KONG';
  tiles: Tile[];
  fromSeat?: number;
}

interface FaanItem {
  label: string;
  faan: number;
}

interface DiceRollInfo {
  phase: 'rolling' | 'playing';
  rolls: Record<string, number[]>;
  startingSeat: number;
  wallBreakStack: number;
}

interface ClaimDecision {
  type: 'WU' | 'KONG' | 'PONG' | 'CHI' | 'PASS';
  pairTiles?: Tile[];
}

interface PendingClaimWindow {
  tile: Tile;
  fromSeat: number;
  eligibleSeats: number[];
  decisions: Record<string, ClaimDecision>;
  expiresAt: number;
}

interface ChatBubble {
  seat: number;
  sender: string;
  text: string;
  sub: string;
  timestamp: number;
}

interface GameStatePayload {
  wall: Tile[];
  initialWallCount?: number;
  hands: Record<string, Tile[]>;
  melds: Record<string, Meld[]>;
  bonuses: Record<string, Tile[]>;
  sessionScores?: Record<string, number>;
  discards: Tile[];
  turn: number;
  dealerSeat?: number;
  prevailingWind?: number;
  roundNumber?: number;
  mustDraw: boolean;
  turnStartedAt?: number;
  lastActionNotice?: string;
  chatBubble?: ChatBubble | null;
  claimWindow?: PendingClaimWindow | null;
  diceInfo: DiceRollInfo;
  winnerInfo: {
    seat: number;
    name: string;
    faan: number;
    breakdown?: FaanItem[];
    isSelfDraw?: boolean;
  } | null;
}

interface MahjongTableProps {
  profile: UserProfile;
  room: { id: string; code: string; type: 'ranked' | 'private'; host_id: string };
  players: any[];
  onExitRoom: () => void;
  onReturnWaitingRoom: () => void;
  onDisbandRoom: () => void;
  onProfileUpdated: () => void;
}

const MAN_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_KANJI = ['東', '南', '西', '北'];
const WIND_NAMES = ['East', 'South', 'West', 'North'];
const DRAGON_KANJI = ['中', '發', '白'];
const DRAGON_NAMES = ['Red Dragon', 'Green Dragon', 'White Dragon'];
const FLOWER_KANJI = ['梅', '蘭', '菊', '竹'];
const FLOWER_NAMES = [
  'Plum (Flower 1)',
  'Orchid (Flower 2)',
  'Chrysanthemum (Flower 3)',
  'Bamboo (Flower 4)',
];
const SEASON_KANJI = ['春', '夏', '秋', '冬'];
const SEASON_NAMES = [
  'Spring (Season 1)',
  'Summer (Season 2)',
  'Autumn (Season 3)',
  'Winter (Season 4)',
];

const MAHJONG_QUICK_CHATS = [
  { text: 'Ting! (聽牌)', sub: 'Udah siap Wu nih!' },
  { text: 'Zi Mo! (自摸)', sub: 'Tarik sendiri dong!' },
  { text: 'Kuai Dian! (快點)', sub: 'Ayo jalan, jangan lama!' },
  { text: 'Aiya! (哎呀)', sub: 'Waduh, salah buang!' },
  { text: 'Dian Pao! (點炮)', sub: 'Hati-hati kartu bahaya!' },
  { text: 'Hao Pai! (好牌)', sub: 'Kartu bagus banget!' },
  { text: 'Peng! (碰)', sub: 'Ayo buang yang kembar!' },
  { text: 'Xie Xie! (謝謝)', sub: 'Makasih batunya!' },
];

const TURN_LIMIT_SECONDS = 60;
const CLAIM_WINDOW_MS = 5000;
const DRAW_NEXT_ROUND_SECONDS = 8;

function isBonusTile(tile: Tile): boolean {
  return tile.suit === 'flower' || tile.suit === 'season';
}

function rollThreeDice(): number[] {
  return [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
  ];
}

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

  for (let v = 1; v <= 4; v++) {
    deck.push({
      id: `flower_${v}_${uid++}`,
      suit: 'flower',
      value: v,
      label: FLOWER_KANJI[v - 1],
      sub: FLOWER_NAMES[v - 1],
      color: 'text-pink-600',
    });
    deck.push({
      id: `season_${v}_${uid++}`,
      suit: 'season',
      value: v,
      label: SEASON_KANJI[v - 1],
      sub: SEASON_NAMES[v - 1],
      color: 'text-amber-600',
    });
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawWithFlowerReplacement(
  wall: Tile[],
  currentHand: Tile[],
  currentBonuses: Tile[],
  countToDraw: number
): {
  wall: Tile[];
  hand: Tile[];
  bonuses: Tile[];
  drawnPlayable: Tile[];
  drawnBonusCount: number;
} {
  const nextWall = [...wall];
  const nextHand = [...currentHand];
  const nextBonuses = [...currentBonuses];
  const drawnPlayable: Tile[] = [];
  let drawnBonusCount = 0;
  let needed = countToDraw;

  while (needed > 0 && nextWall.length > 0) {
    const t = nextWall.pop()!;
    if (isBonusTile(t)) {
      nextBonuses.push(t);
      drawnBonusCount++;
    } else {
      nextHand.push(t);
      drawnPlayable.push(t);
      needed--;
    }
  }

  return {
    wall: nextWall,
    hand: nextHand,
    bonuses: nextBonuses,
    drawnPlayable,
    drawnBonusCount,
  };
}

function sortHand(hand: Tile[]): Tile[] {
  const order: Record<Tile['suit'], number> = {
    man: 1,
    pin: 2,
    sou: 3,
    wind: 4,
    dragon: 5,
    flower: 6,
    season: 7,
  };
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

  if (meldCount === 0 && keys.every((k) => counts[k] === 2 || counts[k] === 4)) {
    return true;
  }

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

function calculateHongKongFaan(
  hand: Tile[],
  melds: Meld[],
  bonuses: Tile[],
  seatIndex: number,
  dealerSeat: number,
  prevailingWind: number,
  isSelfDraw: boolean
): { totalFaan: number; breakdown: FaanItem[] } {
  const breakdown: FaanItem[] = [];
  const allTiles = [...hand, ...melds.flatMap((m) => m.tiles)];

  if (isSelfDraw) {
    breakdown.push({ label: 'Self-Draw (Zimo / 自摸)', faan: 1 });
  }

  const hasExposedMeld = melds.some((m) => m.type !== 'AN_KONG');
  if (!hasExposedMeld) {
    breakdown.push({ label: 'Concealed Hand (門清)', faan: 1 });
  }

  const suitSet = new Set(
    allTiles
      .filter((t) => ['man', 'pin', 'sou'].includes(t.suit))
      .map((t) => t.suit)
  );
  const hasHonors = allTiles.some(
    (t) => t.suit === 'wind' || t.suit === 'dragon'
  );
  if (suitSet.size === 1 && !hasHonors) {
    breakdown.push({ label: 'Full Flush (Qing Yi Se / 清一色)', faan: 6 });
  } else if (suitSet.size === 1 && hasHonors) {
    breakdown.push({ label: 'Half Flush (Hun Yi Se / 混一色)', faan: 3 });
  } else if (suitSet.size === 0 && hasHonors) {
    breakdown.push({ label: 'All Honors (Zi Yi Se / 字一色)', faan: 10 });
  }

  const counts: Record<string, number> = {};
  allTiles.forEach((t) => {
    const k = `${t.suit}_${t.value}`;
    counts[k] = (counts[k] || 0) + 1;
  });

  const nonPairKeys = Object.keys(counts).filter((k) => counts[k] >= 3);
  const hasChi = melds.some((m) => m.type === 'CHI');
  if (!hasChi && nonPairKeys.length >= 4) {
    breakdown.push({ label: 'All Triplets (Dui Dui Hu / 對對胡)', faan: 3 });
  } else if (
    melds.every((m) => m.type === 'CHI') &&
    !hasHonors &&
    bonuses.length === 0
  ) {
    breakdown.push({ label: 'All Chow / No Flowers (Ping Hu)', faan: 1 });
  }

  [1, 2, 3].forEach((dVal) => {
    if ((counts[`dragon_${dVal}`] || 0) >= 3) {
      breakdown.push({
        label: `${DRAGON_NAMES[dVal - 1]} Pung (${DRAGON_KANJI[dVal - 1]})`,
        faan: 1,
      });
    }
  });

  const playerSeatWind = ((seatIndex - dealerSeat + 4) % 4) + 1;
  if ((counts[`wind_${playerSeatWind}`] || 0) >= 3) {
    breakdown.push({
      label: `Seat Wind (${WIND_NAMES[playerSeatWind - 1]})`,
      faan: 1,
    });
  }
  if ((counts[`wind_${prevailingWind}`] || 0) >= 3) {
    breakdown.push({
      label: `Prevailing Wind (${WIND_NAMES[prevailingWind - 1]})`,
      faan: 1,
    });
  }

  if (bonuses.length > 0) {
    breakdown.push({
      label: `Bonus Bunga & Musim (${bonuses.length}x)`,
      faan: bonuses.length,
    });
    const hasSeatBonus = bonuses.some((b) => b.value === playerSeatWind);
    if (hasSeatBonus) {
      breakdown.push({
        label: `Seat Bonus Match (#${playerSeatWind})`,
        faan: 1,
      });
    }
  }

  if (breakdown.length === 0) {
    breakdown.push({ label: 'Chicken Hand (Ji Hu / 雞胡)', faan: 1 });
  }

  const totalFaan = breakdown.reduce((sum, item) => sum + item.faan, 0);
  return { totalFaan, breakdown };
}

function getTenpaiWaitingTiles(
  hand: Tile[],
  meldCount: number
): { suit: Tile['suit']; value: number; sub: string; label: string }[] {
  const neededSets = 4 - meldCount;
  if (hand.length !== neededSets * 3 + 1) return [];

  const candidates: {
    suit: Tile['suit'];
    value: number;
    sub: string;
    label: string;
  }[] = [];

  (['man', 'pin', 'sou'] as const).forEach((suit) => {
    for (let v = 1; v <= 9; v++) {
      candidates.push({
        suit,
        value: v,
        label: suit === 'man' ? MAN_KANJI[v - 1] : `${v}`,
        sub:
          suit === 'man'
            ? `${v} Wan`
            : suit === 'pin'
            ? `${v} Dots`
            : `${v} Bamboo`,
      });
    }
  });
  for (let v = 1; v <= 4; v++) {
    candidates.push({
      suit: 'wind',
      value: v,
      label: WIND_KANJI[v - 1],
      sub: WIND_NAMES[v - 1],
    });
  }
  for (let v = 1; v <= 3; v++) {
    candidates.push({
      suit: 'dragon',
      value: v,
      label: DRAGON_KANJI[v - 1],
      sub: DRAGON_NAMES[v - 1],
    });
  }

  return candidates.filter((cand) => {
    const testTile: Tile = {
      id: 'test',
      suit: cand.suit,
      value: cand.value,
      label: cand.label,
      sub: cand.sub,
      color: '',
    };
    return canWin([...hand, testTile], meldCount);
  });
}

function evaluateSeatClaim(
  seat: number,
  fromSeat: number,
  discardedTile: Tile,
  hand: Tile[],
  meldCount: number
): {
  canWu: boolean;
  canKong: boolean;
  canPong: boolean;
  chiCombos: Tile[][];
} {
  if (seat === fromSeat || isBonusTile(discardedTile)) {
    return { canWu: false, canKong: false, canPong: false, chiCombos: [] };
  }

  const canWu = canWin([...hand, discardedTile], meldCount);
  const matching = hand.filter(
    (t) => t.suit === discardedTile.suit && t.value === discardedTile.value
  );
  const canPong = matching.length >= 2;
  const canKong = matching.length >= 3;

  const chiCombos: Tile[][] = [];
  const nextSeatAfterDiscarder = (fromSeat + 1) % 4;
  if (
    seat === nextSeatAfterDiscarder &&
    ['man', 'pin', 'sou'].includes(discardedTile.suit)
  ) {
    const v = discardedTile.value;
    const findV = (val: number) =>
      hand.find((t) => t.suit === discardedTile.suit && t.value === val);
    const m2 = findV(v - 2);
    const m1 = findV(v - 1);
    const p1 = findV(v + 1);
    const p2 = findV(v + 2);
    if (m2 && m1) chiCombos.push([m2, m1]);
    if (m1 && p1) chiCombos.push([m1, p1]);
    if (p1 && p2) chiCombos.push([p1, p2]);
  }

  return { canWu, canKong, canPong, chiCombos };
}

/* KOMPONEN VISUAL BATU MAHJONG KLASIK */
function TileFace({ tile, compact = false }: { tile: Tile; compact?: boolean }) {
  if (tile.suit === 'flower') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center leading-none bg-pink-50/70">
        <span
          className={`${
            compact ? 'text-[10px]' : 'text-base sm:text-lg'
          } font-serif font-extrabold text-pink-600`}
        >
          {FLOWER_KANJI[tile.value - 1]}
        </span>
        <span className="text-[8px] font-bold text-pink-800">花{tile.value}</span>
      </div>
    );
  }

  if (tile.suit === 'season') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center leading-none bg-amber-50/70">
        <span
          className={`${
            compact ? 'text-[10px]' : 'text-base sm:text-lg'
          } font-serif font-extrabold text-amber-600`}
        >
          {SEASON_KANJI[tile.value - 1]}
        </span>
        <span className="text-[8px] font-bold text-amber-800">季{tile.value}</span>
      </div>
    );
  }

  if (tile.suit === 'man') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center leading-none py-0.5">
        <span
          className={`${
            compact ? 'text-[10px]' : 'text-[13px] sm:text-[17px]'
          } font-serif font-extrabold text-[#1d4ed8]`}
        >
          {MAN_KANJI[tile.value - 1]}
        </span>
        <span
          className={`${
            compact ? 'text-[9px]' : 'text-[12px] sm:text-[15px]'
          } font-serif font-extrabold text-[#b91c1c] mt-0.5`}
        >
          萬
        </span>
      </div>
    );
  }

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

  if (tile.suit === 'wind') {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span
          className={`${
            compact ? 'text-xs' : 'text-xl sm:text-2xl'
          } font-serif font-extrabold text-[#1e40af]`}
        >
          {WIND_KANJI[tile.value - 1]}
        </span>
      </div>
    );
  }

  if (tile.value === 1) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span
          className={`${
            compact ? 'text-xs' : 'text-xl sm:text-2xl'
          } font-serif font-extrabold text-[#b91c1c]`}
        >
          中
        </span>
      </div>
    );
  }
  if (tile.value === 2) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span
          className={`${
            compact ? 'text-xs' : 'text-xl sm:text-2xl'
          } font-serif font-extrabold text-[#15803d]`}
        >
          發
        </span>
      </div>
    );
  }
  return (
    <div className="w-full h-full p-1 flex items-center justify-center">
      <div className="w-full h-full border-[2px] border-[#1d4ed8] rounded-sm relative">
        <div className="absolute inset-0.5 border border-[#1d4ed8]/60" />
      </div>
    </div>
  );
}

/* MELD TERBUKA + BONUS BUNGA/MUSIM */
function MeldAndBonusStrip({
  melds,
  bonuses,
  vertical = false,
}: {
  melds: Meld[];
  bonuses: Tile[];
  vertical?: boolean;
}) {
  if ((!melds || melds.length === 0) && (!bonuses || bonuses.length === 0)) {
    return null;
  }

  return (
    <div
      className={`flex ${
        vertical ? 'flex-col' : 'flex-row flex-wrap'
      } gap-1 bg-black/40 p-1 rounded-lg border border-amber-400/30`}
    >
      {melds.map((m, idx) => (
        <div key={`m_${idx}`} className="flex flex-row gap-0.5" title={m.type}>
          {m.tiles.map((t, ti) => {
            const isConcealedEdge =
              m.type === 'AN_KONG' && (ti === 0 || ti === 3);
            if (isConcealedEdge) {
              return (
                <div
                  key={ti}
                  className="w-5 h-7 sm:w-6 sm:h-8 rounded bg-emerald-800 border border-emerald-400/60 shadow-sm"
                />
              );
            }
            return (
              <div
                key={ti}
                className="w-5 h-7 sm:w-6 sm:h-8 rounded bg-[#f5eedc] border border-stone-400 flex items-center justify-center overflow-hidden shadow-sm"
              >
                <TileFace tile={t} compact />
              </div>
            );
          })}
        </div>
      ))}

      {bonuses.length > 0 && (
        <div className="flex flex-row gap-0.5" title="Bonus Bunga & Musim (+1 Faan)">
          {bonuses.map((b, bi) => (
            <div
              key={`b_${bi}`}
              className="w-5 h-7 sm:w-6 sm:h-8 rounded bg-pink-50 border border-pink-400 flex items-center justify-center overflow-hidden shadow-sm"
            >
              <TileFace tile={b} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MahjongTable({
  profile,
  room,
  players,
  onExitRoom,
  onReturnWaitingRoom,
  onDisbandRoom,
  onProfileUpdated,
}: MahjongTableProps) {
  const [livePlayers, setLivePlayers] = useState<any[]>(players);
  const myPlayerObj = livePlayers.find((p) => p.user_id === profile.id);
  const mySeat = myPlayerObj ? myPlayerObj.seat_index : 0;
  const isHost = room.host_id === profile.id;

  const [gameState, setGameState] = useState<GameStatePayload | null>(null);
  const gameStateRef = useRef<GameStatePayload | null>(null);
  const livePlayersRef = useRef<any[]>(players);
  const botBusyRef = useRef<boolean>(false);
  const resolvingClaimRef = useRef<boolean>(false);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    livePlayersRef.current = livePlayers;
  }, [livePlayers]);

  const [customOrderIds, setCustomOrderIds] = useState<string[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [draggedTileId, setDraggedTileId] = useState<string | null>(null);

  const [drawnTileId, setDrawnTileId] = useState<string | null>(null);
  const [tableTilt, setTableTilt] = useState<boolean>(false);
  const [inspectedTile, setInspectedTile] = useState<Tile | null>(null);
  const [rpChangeShown, setRpChangeShown] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(TURN_LIMIT_SECONDS);
  const [claimSecondsLeft, setClaimSecondsLeft] = useState<number>(5);
  const [showChatPicker, setShowChatPicker] = useState<boolean>(false);

  const [hideWinModalForShowdown, setHideWinModalForShowdown] =
    useState<boolean>(false);
  const [drawCountdown, setDrawCountdown] = useState<number>(
    DRAW_NEXT_ROUND_SECONDS
  );

  const recordedWinRef = useRef<string | null>(null);
  const lastDiscardCountRef = useRef<number>(0);
  const autoTimeoutTriggeredRef = useRef<string | null>(null);

  const playSoundEffect = (type: 'tile' | 'call' | 'win' = 'tile') => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === 'win') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24);
        gain.gain.setValueAtTime(0.28, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.52);
      } else if (type === 'call') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.14);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.17);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.045);
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.045);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      }
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
          initialWallCount: nextState.initialWallCount ?? 92,
          bonuses: nextState.bonuses || { '0': [], '1': [], '2': [], '3': [] },
          sessionScores: nextState.sessionScores || {
            '0': 0,
            '1': 0,
            '2': 0,
            '3': 0,
          },
          dealerSeat: nextState.dealerSeat ?? 0,
          prevailingWind: nextState.prevailingWind ?? 1,
          roundNumber: nextState.roundNumber ?? 1,
          turnStartedAt: nextState.turnStartedAt ?? Date.now(),
          lastActionNotice: nextState.lastActionNotice ?? '',
          chatBubble: nextState.chatBubble ?? null,
          claimWindow: nextState.claimWindow ?? null,
          diceInfo: nextState.diceInfo,
          winnerInfo: nextState.winnerInfo,
        }),
        updated_at: new Date().toISOString(),
      });
    },
    [room.id]
  );

  const parseDbRow = useCallback((row: any): GameStatePayload => {
    let meta: {
      mustDraw: boolean;
      initialWallCount?: number;
      bonuses?: Record<string, Tile[]>;
      sessionScores?: Record<string, number>;
      dealerSeat?: number;
      prevailingWind?: number;
      roundNumber?: number;
      turnStartedAt?: number;
      lastActionNotice?: string;
      chatBubble?: ChatBubble | null;
      claimWindow?: PendingClaimWindow | null;
      diceInfo?: DiceRollInfo;
      winnerInfo: any;
    } = {
      mustDraw: true,
      initialWallCount: 92,
      bonuses: { '0': [], '1': [], '2': [], '3': [] },
      sessionScores: { '0': 0, '1': 0, '2': 0, '3': 0 },
      dealerSeat: 0,
      prevailingWind: 1,
      roundNumber: 1,
      turnStartedAt: Date.now(),
      lastActionNotice: '',
      chatBubble: null,
      claimWindow: null,
      winnerInfo: null,
    };
    try {
      if (row.round_wind && row.round_wind.startsWith('{')) {
        meta = JSON.parse(row.round_wind);
      }
    } catch {}

    const defaultDice: DiceRollInfo = {
      phase: 'playing',
      rolls: {},
      startingSeat: row.current_turn ?? 0,
      wallBreakStack: 8,
    };

    return {
      wall: row.wall_tiles || [],
      initialWallCount: meta.initialWallCount ?? 92,
      hands: row.player_hands || { '0': [], '1': [], '2': [], '3': [] },
      melds: row.player_melds || { '0': [], '1': [], '2': [], '3': [] },
      bonuses: meta.bonuses || { '0': [], '1': [], '2': [], '3': [] },
      sessionScores: meta.sessionScores || {
        '0': 0,
        '1': 0,
        '2': 0,
        '3': 0,
      },
      discards: row.discard_pile || [],
      turn: row.current_turn ?? 0,
      dealerSeat: meta.dealerSeat ?? 0,
      prevailingWind: meta.prevailingWind ?? 1,
      roundNumber: meta.roundNumber ?? 1,
      mustDraw: meta.mustDraw,
      turnStartedAt: meta.turnStartedAt || Date.now(),
      lastActionNotice: meta.lastActionNotice || '',
      chatBubble: meta.chatBubble ?? null,
      claimWindow: meta.claimWindow ?? null,
      diceInfo: meta.diceInfo || defaultDice,
      winnerInfo: meta.winnerInfo,
    };
  }, []);

  const rawMyHand = gameState?.hands?.[String(mySeat)] || [];
  useEffect(() => {
    if (rawMyHand.length === 0) {
      setCustomOrderIds([]);
      return;
    }
    setCustomOrderIds((prev) => {
      const currentMap = new Map(rawMyHand.map((t) => [t.id, t]));
      const kept = prev.filter((id) => currentMap.has(id));
      const keptSet = new Set(kept);
      const newlyAdded = rawMyHand
        .filter((t) => !keptSet.has(t.id))
        .map((t) => t.id);
      return [...kept, ...newlyAdded];
    });
  }, [rawMyHand]);

  const orderedMyHand: Tile[] = React.useMemo(() => {
    if (customOrderIds.length === 0) return rawMyHand;
    const map = new Map(rawMyHand.map((t) => [t.id, t]));
    const res: Tile[] = [];
    customOrderIds.forEach((id) => {
      const found = map.get(id);
      if (found) {
        res.push(found);
        map.delete(id);
      }
    });
    map.forEach((t) => res.push(t));
    return res;
  }, [rawMyHand, customOrderIds]);

  const myMelds = gameState?.melds?.[String(mySeat)] || [];
  const isShowdown = Boolean(gameState?.winnerInfo);

  const visibleCounts = React.useMemo(() => {
    const map: Record<string, number> = {};
    const countTile = (t: Tile) => {
      const k = `${t.suit}_${t.value}`;
      map[k] = (map[k] || 0) + 1;
    };
    (gameState?.discards || []).forEach(countTile);
    Object.values(gameState?.melds || {}).forEach((mList) =>
      mList.forEach((m) => m.tiles.forEach(countTile))
    );
    orderedMyHand.forEach(countTile);
    return map;
  }, [gameState?.discards, gameState?.melds, orderedMyHand]);

  const tenpaiWaits = React.useMemo(() => {
    if (gameState?.diceInfo?.phase !== 'playing' || isShowdown) return [];
    return getTenpaiWaitingTiles(orderedMyHand, myMelds.length).map((w) => {
      const used = visibleCounts[`${w.suit}_${w.value}`] || 0;
      return { ...w, remaining: Math.max(0, 4 - used) };
    });
  }, [
    gameState?.diceInfo?.phase,
    isShowdown,
    orderedMyHand,
    myMelds.length,
    visibleCounts,
  ]);

  const moveTilePosition = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= orderedMyHand.length ||
      toIndex >= orderedMyHand.length ||
      fromIndex === toIndex
    )
      return;
    const next = [...orderedMyHand];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setCustomOrderIds(next.map((t) => t.id));
    playSoundEffect('tile');
  };

  const handleAutoSortMyHand = () => {
    const sorted = sortHand(orderedMyHand);
    setCustomOrderIds(sorted.map((t) => t.id));
    playSoundEffect('tile');
  };

  const initRound = useCallback(
    async (carryOver?: {
      dealerSeat: number;
      prevailingWind: number;
      roundNumber: number;
      sessionScores: Record<string, number>;
      skipDice: boolean;
    }) => {
      recordedWinRef.current = null;
      lastDiscardCountRef.current = 0;
      botBusyRef.current = false;
      resolvingClaimRef.current = false;
      autoTimeoutTriggeredRef.current = null;
      setRpChangeShown(null);
      setHideWinModalForShowdown(false);
      setDrawnTileId(null);
      setSelectedTileId(null);

      const { data: latestP } = await supabase
        .from('room_players')
        .select('*, profiles(username, rank_tier, rank_points)')
        .eq('room_id', room.id)
        .order('seat_index', { ascending: true });

      const pList = latestP || livePlayersRef.current;
      if (latestP) setLivePlayers(latestP);

      const nextDealer = carryOver?.dealerSeat ?? 0;
      const nextWind = carryOver?.prevailingWind ?? 1;
      const nextRound = carryOver?.roundNumber ?? 1;
      const nextScores = carryOver?.sessionScores ?? {
        '0': 0,
        '1': 0,
        '2': 0,
        '3': 0,
      };

      const initialRolls: Record<string, number[]> = {};
      [0, 1, 2, 3].forEach((seatIdx) => {
        const p = pList.find((item) => item.seat_index === seatIdx);
        if (!p || p.is_bot) {
          initialRolls[String(seatIdx)] = rollThreeDice();
        }
      });

      let currentWall = generateDeck();
      const hands: Record<string, Tile[]> = {
        '0': [],
        '1': [],
        '2': [],
        '3': [],
      };
      const bonuses: Record<string, Tile[]> = {
        '0': [],
        '1': [],
        '2': [],
        '3': [],
      };

      [0, 1, 2, 3].forEach((s) => {
        const res = drawWithFlowerReplacement(currentWall, [], [], 13);
        currentWall = res.wall;
        hands[String(s)] = sortHand(res.hand);
        bonuses[String(s)] = res.bonuses;
      });

      const freshState: GameStatePayload = {
        wall: currentWall,
        initialWallCount: currentWall.length,
        hands,
        melds: { '0': [], '1': [], '2': [], '3': [] },
        bonuses,
        sessionScores: nextScores,
        discards: [],
        turn: nextDealer,
        dealerSeat: nextDealer,
        prevailingWind: nextWind,
        roundNumber: nextRound,
        mustDraw: true,
        turnStartedAt: Date.now(),
        lastActionNotice: carryOver?.skipDice
          ? `${WIND_NAMES[nextWind - 1]} Round • Hand #${nextRound} dimulai!`
          : 'Dek 144 Tiles (termasuk 8 Bunga & Musim) siap!',
        chatBubble: null,
        claimWindow: null,
        diceInfo: {
          phase: carryOver?.skipDice ? 'playing' : 'rolling',
          rolls: initialRolls,
          startingSeat: nextDealer,
          wallBreakStack: 0,
        },
        winnerInfo: null,
      };

      await pushStateToSupabase(freshState);
    },
    [room.id, pushStateToSupabase]
  );

  const handleNextRoundWithRotation = useCallback(async () => {
    const latest = gameStateRef.current;
    if (!latest || !latest.winnerInfo) {
      await initRound();
      return;
    }

    const currentDealer = latest.dealerSeat ?? 0;
    const currentWind = latest.prevailingWind ?? 1;
    const currentRound = latest.roundNumber ?? 1;
    const winSeat = latest.winnerInfo.seat;
    const winFaan = latest.winnerInfo.faan;
    const updatedScores: Record<string, number> = {
      '0': 0,
      '1': 0,
      '2': 0,
      '3': 0,
      ...(latest.sessionScores || {}),
    };

    if (winSeat >= 0) {
      const gained = 10 + winFaan * 5;
      updatedScores[String(winSeat)] =
        (updatedScores[String(winSeat)] || 0) + gained;
    }

    if (winSeat === currentDealer || winSeat === -1) {
      await initRound({
        dealerSeat: currentDealer,
        prevailingWind: currentWind,
        roundNumber: currentRound + 1,
        sessionScores: updatedScores,
        skipDice: true,
      });
    } else {
      const rotatedDealer = (currentDealer + 1) % 4;
      const wrappedWind =
        rotatedDealer === 0 ? (currentWind % 4) + 1 : currentWind;
      await initRound({
        dealerSeat: rotatedDealer,
        prevailingWind: wrappedWind,
        roundNumber: currentRound + 1,
        sessionScores: updatedScores,
        skipDice: true,
      });
    }
  }, [initRound]);

  const isDrawResult = gameState?.winnerInfo?.seat === -1;
  useEffect(() => {
    if (!isDrawResult) {
      setDrawCountdown(DRAW_NEXT_ROUND_SECONDS);
      return;
    }

    setDrawCountdown(DRAW_NEXT_ROUND_SECONDS);
    const interval = setInterval(() => {
      setDrawCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (isHost) {
            handleNextRoundWithRotation();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isDrawResult, isHost, handleNextRoundWithRotation]);

  const handlePlayerRollDice = async () => {
    if (!gameState || gameState.diceInfo.phase !== 'rolling') return;
    if (gameState.diceInfo.rolls[String(mySeat)]) return;

    playSoundEffect('tile');
    const myRoll = rollThreeDice();
    const updatedRolls = {
      ...gameState.diceInfo.rolls,
      [String(mySeat)]: myRoll,
    };

    const allRolled = [0, 1, 2, 3].every((s) => Boolean(updatedRolls[String(s)]));

    if (!allRolled) {
      await pushStateToSupabase({
        ...gameState,
        diceInfo: {
          ...gameState.diceInfo,
          rolls: updatedRolls,
        },
      });
    } else {
      let bestSeat = 0;
      let highestSum = -1;
      [0, 1, 2, 3].forEach((s) => {
        const sum = (updatedRolls[String(s)] || [0, 0, 0]).reduce(
          (a, b) => a + b,
          0
        );
        if (sum > highestSum) {
          highestSum = sum;
          bestSeat = s;
        }
      });

      const cutWall = [...gameState.wall];
      const cutOffset = highestSum % Math.max(1, cutWall.length);
      const rotatedWall = [
        ...cutWall.slice(cutOffset),
        ...cutWall.slice(0, cutOffset),
      ];

      await pushStateToSupabase({
        ...gameState,
        wall: rotatedWall,
        turn: bestSeat,
        dealerSeat: bestSeat,
        mustDraw: true,
        turnStartedAt: Date.now(),
        diceInfo: {
          phase: 'rolling',
          rolls: updatedRolls,
          startingSeat: bestSeat,
          wallBreakStack: highestSum,
        },
      });
    }
  };

  const allDiceRolled = [0, 1, 2, 3].every((s) =>
    Boolean(gameState?.diceInfo?.rolls?.[String(s)])
  );
  const isRollingPhase = gameState?.diceInfo?.phase === 'rolling';

  useEffect(() => {
    if (!isHost || !isRollingPhase || !allDiceRolled) return;

    const timer = setTimeout(async () => {
      const latest = gameStateRef.current;
      if (!latest || latest.diceInfo.phase !== 'rolling') return;
      await pushStateToSupabase({
        ...latest,
        turnStartedAt: Date.now(),
        diceInfo: {
          ...latest.diceInfo,
          phase: 'playing',
        },
      });
    }, 2200);

    return () => clearTimeout(timer);
  }, [isHost, isRollingPhase, allDiceRolled, pushStateToSupabase]);

  const hasWinner = Boolean(gameState?.winnerInfo);

  useEffect(() => {
    let isMounted = true;

    async function syncFromServer() {
      const [{ data: roomRow }, { data: stateRow }, { data: pRows }] =
        await Promise.all([
          supabase
            .from('rooms')
            .select('id, status')
            .eq('id', room.id)
            .maybeSingle(),
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

      if (!roomRow) {
        onExitRoom();
        return;
      }

      if (pRows && pRows.length > 0) {
        setLivePlayers(pRows);
        livePlayersRef.current = pRows;
      }

      if (stateRow) {
        const parsed = parseDbRow(stateRow);
        if (parsed.discards.length > lastDiscardCountRef.current) {
          playSoundEffect('tile');
        }
        lastDiscardCountRef.current = parsed.discards.length;
        if (!parsed.winnerInfo) {
          setHideWinModalForShowdown(false);
        }
        setGameState(parsed);
      } else if (isHost) {
        await initRound();
      }
    }

    syncFromServer();
    const pollInterval = setInterval(() => {
      syncFromServer();
    }, 1300);

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
              playSoundEffect('tile');
            }
            lastDiscardCountRef.current = incoming.discards.length;
            if (!incoming.winnerInfo) {
              setHideWinModalForShowdown(false);
            }
            setGameState(incoming);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${room.id}`,
        },
        () => {
          if (isMounted) onExitRoom();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [room.id, isHost, initRound, parseDbRow, onExitRoom]);

  useEffect(() => {
    if (!hasWinner || !gameState?.winnerInfo) {
      recordedWinRef.current = null;
      return;
    }

    const { seat, name, faan } = gameState.winnerInfo;
    const roundNum = gameState.roundNumber ?? 1;
    const winSig = `${room.id}_r${roundNum}_${seat}_${name}_${faan}`;
    if (recordedWinRef.current === winSig) return;
    recordedWinRef.current = winSig;
    playSoundEffect('win');

    if (seat === -1 || room.type === 'private') {
      setRpChangeShown(0);
      return;
    }

    const didIWin = seat === mySeat;
    const delta = didIWin ? 20 + faan * 5 : -15;
    setRpChangeShown(delta);

    const storageKey = `mahjong_rp_claimed_${winSig}_${profile.id}`;
    if (typeof window !== 'undefined' && localStorage.getItem(storageKey)) {
      return;
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, '1');
    }

    supabase
      .from('profiles')
      .update({
        rank_points: Math.max(0, profile.rank_points + delta),
        matches_played: profile.matches_played + 1,
        wins: didIWin ? profile.wins + 1 : profile.wins,
      })
      .eq('id', profile.id)
      .then(() => {});
  }, [
    hasWinner,
    gameState?.winnerInfo,
    gameState?.roundNumber,
    mySeat,
    profile.id,
    profile.rank_points,
    profile.matches_played,
    profile.wins,
    room.id,
    room.type,
  ]);

  const resolveClaimWindow = useCallback(
    async (stateToResolve: GameStatePayload) => {
      const cw = stateToResolve.claimWindow;
      if (!cw || resolvingClaimRef.current) return;
      resolvingClaimRef.current = true;

      try {
        const getSeatLabel = (seatIdx: number) => {
          const found = livePlayersRef.current.find(
            (p) => p.seat_index === seatIdx
          );
          return found
            ? found.is_bot
              ? found.bot_name
              : found.profiles?.username
            : `Player ${seatIdx + 1}`;
        };

        const orderedSeats = [1, 2, 3].map((offset) => (cw.fromSeat + offset) % 4);

        const wuWinnerSeat = orderedSeats.find(
          (s) => cw.decisions[String(s)]?.type === 'WU'
        );
        if (wuWinnerSeat !== undefined) {
          const seatKey = String(wuWinnerSeat);
          const winHand = sortHand([
            ...(stateToResolve.hands[seatKey] || []),
            cw.tile,
          ]);
          const melds = stateToResolve.melds[seatKey] || [];
          const bonuses = stateToResolve.bonuses[seatKey] || [];
          const faanResult = calculateHongKongFaan(
            winHand,
            melds,
            bonuses,
            wuWinnerSeat,
            stateToResolve.dealerSeat ?? 0,
            stateToResolve.prevailingWind ?? 1,
            false
          );

          await pushStateToSupabase({
            ...stateToResolve,
            hands: { ...stateToResolve.hands, [seatKey]: winHand },
            discards: stateToResolve.discards.slice(0, -1),
            claimWindow: null,
            lastActionNotice: `🀄 ${getSeatLabel(
              wuWinnerSeat
            )} WU dari buangan ${getSeatLabel(cw.fromSeat)}!`,
            winnerInfo: {
              seat: wuWinnerSeat,
              name: getSeatLabel(wuWinnerSeat),
              faan: faanResult.totalFaan,
              breakdown: faanResult.breakdown,
              isSelfDraw: false,
            },
          });
          return;
        }

        const kongOrPongSeat = orderedSeats.find((s) => {
          const d = cw.decisions[String(s)]?.type;
          return d === 'KONG' || d === 'PONG';
        });

        if (kongOrPongSeat !== undefined) {
          playSoundEffect('call');
          const decision = cw.decisions[String(kongOrPongSeat)]!;
          const seatKey = String(kongOrPongSeat);
          const hand = stateToResolve.hands[seatKey] || [];
          const neededFromHand = decision.type === 'KONG' ? 3 : 2;
          const used = hand
            .filter(
              (t) => t.suit === cw.tile.suit && t.value === cw.tile.value
            )
            .slice(0, neededFromHand);
          const usedIds = new Set(used.map((t) => t.id));
          let remHand = hand.filter((t) => !usedIds.has(t.id));
          let nextWall = [...stateToResolve.wall];
          let nextBonuses = [...(stateToResolve.bonuses[seatKey] || [])];

          if (decision.type === 'KONG') {
            const drawRes = drawWithFlowerReplacement(
              nextWall,
              remHand,
              nextBonuses,
              1
            );
            nextWall = drawRes.wall;
            remHand = drawRes.hand;
            nextBonuses = drawRes.bonuses;
          }

          const newMeld: Meld = {
            type: decision.type as 'KONG' | 'PONG',
            tiles: [...used, cw.tile],
            fromSeat: cw.fromSeat,
          };

          await pushStateToSupabase({
            ...stateToResolve,
            wall: nextWall,
            hands: { ...stateToResolve.hands, [seatKey]: remHand },
            melds: {
              ...stateToResolve.melds,
              [seatKey]: [...(stateToResolve.melds[seatKey] || []), newMeld],
            },
            bonuses: { ...stateToResolve.bonuses, [seatKey]: nextBonuses },
            discards: stateToResolve.discards.slice(0, -1),
            turn: kongOrPongSeat,
            mustDraw: false,
            turnStartedAt: Date.now(),
            claimWindow: null,
            lastActionNotice: `🀄 ${getSeatLabel(kongOrPongSeat)} ${
              decision.type
            } ${cw.tile.sub}!`,
          });
          return;
        }

        const chiSeat = orderedSeats.find(
          (s) => cw.decisions[String(s)]?.type === 'CHI'
        );

        if (chiSeat !== undefined) {
          playSoundEffect('call');
          const decision = cw.decisions[String(chiSeat)]!;
          const seatKey = String(chiSeat);
          const hand = stateToResolve.hands[seatKey] || [];
          const pair = decision.pairTiles || [];
          const usedIds = new Set(pair.map((t) => t.id));
          const remHand = hand.filter((t) => !usedIds.has(t.id));

          const newMeld: Meld = {
            type: 'CHI',
            tiles: [...pair, cw.tile],
            fromSeat: cw.fromSeat,
          };

          await pushStateToSupabase({
            ...stateToResolve,
            hands: { ...stateToResolve.hands, [seatKey]: remHand },
            melds: {
              ...stateToResolve.melds,
              [seatKey]: [...(stateToResolve.melds[seatKey] || []), newMeld],
            },
            discards: stateToResolve.discards.slice(0, -1),
            turn: chiSeat,
            mustDraw: false,
            turnStartedAt: Date.now(),
            claimWindow: null,
            lastActionNotice: `🀄 ${getSeatLabel(chiSeat)} CHI ${cw.tile.sub}!`,
          });
          return;
        }

        await pushStateToSupabase({
          ...stateToResolve,
          turn: (cw.fromSeat + 1) % 4,
          mustDraw: true,
          turnStartedAt: Date.now(),
          claimWindow: null,
        });
      } finally {
        resolvingClaimRef.current = false;
      }
    },
    [pushStateToSupabase]
  );

  const submitMyClaimDecision = async (decision: ClaimDecision) => {
    if (!gameState || !gameState.claimWindow) return;
    playSoundEffect(decision.type === 'PASS' ? 'tile' : 'call');

    const updatedDecisions: Record<string, ClaimDecision> = {
      ...gameState.claimWindow.decisions,
      [String(mySeat)]: decision,
    };

    const nextState: GameStatePayload = {
      ...gameState,
      claimWindow: {
        ...gameState.claimWindow,
        decisions: updatedDecisions,
      },
    };

    const allDecided = gameState.claimWindow.eligibleSeats.every((s) =>
      Boolean(updatedDecisions[String(s)])
    );

    if (allDecided) {
      await resolveClaimWindow(nextState);
    } else {
      await pushStateToSupabase(nextState);
    }
  };

  useEffect(() => {
    if (!gameState?.claimWindow || gameState.winnerInfo) return;

    const interval = setInterval(async () => {
      const latest = gameStateRef.current;
      const cw = latest?.claimWindow;
      if (!latest || !cw || latest.winnerInfo) return;

      const remMs = Math.max(0, cw.expiresAt - Date.now());
      setClaimSecondsLeft(Math.ceil(remMs / 1000));

      const allDecided = cw.eligibleSeats.every((s) =>
        Boolean(cw.decisions[String(s)])
      );

      // Selesaikan jika semua sudah memutuskan ATAU waktu claim sudah habis (0s)
      if (allDecided || remMs === 0) {
        await resolveClaimWindow(latest);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [gameState?.claimWindow, gameState?.winnerInfo, resolveClaimWindow]);

  const executeDiscardWithPriorityCheck = useCallback(
    async (
      baseState: GameStatePayload,
      discarderSeat: number,
      discardedTile: Tile,
      remainingHand: Tile[],
      nextWall: Tile[],
      updatedDiscarderBonuses: Tile[],
      noticeText = ''
    ) => {
      const seatKey = String(discarderSeat);
      const updatedHands = { ...baseState.hands, [seatKey]: remainingHand };
      const updatedBonuses = {
        ...baseState.bonuses,
        [seatKey]: updatedDiscarderBonuses,
      };
      const updatedDiscards = [...baseState.discards, discardedTile];

      const eligibleSeats: number[] = [];
      const initialDecisions: Record<string, ClaimDecision> = {};

      [0, 1, 2, 3].forEach((s) => {
        if (s === discarderSeat) return;
        const evalRes = evaluateSeatClaim(
          s,
          discarderSeat,
          discardedTile,
          updatedHands[String(s)] || [],
          (baseState.melds[String(s)] || []).length
        );

        const hasAnyOption =
          evalRes.canWu ||
          evalRes.canKong ||
          evalRes.canPong ||
          evalRes.chiCombos.length > 0;

        if (hasAnyOption) {
          eligibleSeats.push(s);
          const pObj = livePlayersRef.current.find((p) => p.seat_index === s);
          if (pObj?.is_bot) {
            if (evalRes.canWu) {
              initialDecisions[String(s)] = { type: 'WU' };
            } else if (evalRes.canKong) {
              initialDecisions[String(s)] = { type: 'KONG' };
            } else if (evalRes.canPong) {
              initialDecisions[String(s)] = { type: 'PONG' };
            } else if (evalRes.chiCombos.length > 0) {
              initialDecisions[String(s)] = {
                type: 'CHI',
                pairTiles: evalRes.chiCombos[0],
              };
            }
          }
        }
      });

      if (eligibleSeats.length > 0) {
        const stateWithClaim: GameStatePayload = {
          ...baseState,
          wall: nextWall,
          hands: updatedHands,
          bonuses: updatedBonuses,
          discards: updatedDiscards,
          turn: (discarderSeat + 1) % 4,
          mustDraw: true,
          turnStartedAt: Date.now(),
          lastActionNotice: noticeText,
          claimWindow: {
            tile: discardedTile,
            fromSeat: discarderSeat,
            eligibleSeats,
            decisions: initialDecisions,
            expiresAt: Date.now() + CLAIM_WINDOW_MS,
          },
        };

        const allBotsAlreadyDecided = eligibleSeats.every((s) =>
          Boolean(initialDecisions[String(s)])
        );
        if (allBotsAlreadyDecided) {
          await resolveClaimWindow(stateWithClaim);
        } else {
          await pushStateToSupabase(stateWithClaim);
        }
      } else {
        await pushStateToSupabase({
          ...baseState,
          wall: nextWall,
          hands: updatedHands,
          bonuses: updatedBonuses,
          discards: updatedDiscards,
          turn: (discarderSeat + 1) % 4,
          mustDraw: true,
          turnStartedAt: Date.now(),
          lastActionNotice: noticeText,
          claimWindow: null,
        });
      }
    },
    [pushStateToSupabase, resolveClaimWindow]
  );

  useEffect(() => {
    if (
      !gameState ||
      gameState.diceInfo.phase !== 'playing' ||
      gameState.winnerInfo ||
      gameState.claimWindow
    ) {
      setSecondsLeft(TURN_LIMIT_SECONDS);
      return;
    }

    const interval = setInterval(async () => {
      const latest = gameStateRef.current;
      if (
        !latest ||
        latest.diceInfo.phase !== 'playing' ||
        latest.winnerInfo ||
        latest.claimWindow
      ) {
        return;
      }

      const started = latest.turnStartedAt || Date.now();
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const rem = Math.max(0, TURN_LIMIT_SECONDS - elapsed);
      setSecondsLeft(rem);

      if (rem === 0 && latest.turn === mySeat) {
        const turnSig = `${latest.turn}_${started}`;
        if (autoTimeoutTriggeredRef.current === turnSig) return;
        autoTimeoutTriggeredRef.current = turnSig;

        const seatKey = String(mySeat);
        let nextWall = [...latest.wall];
        let hand = [...(latest.hands[seatKey] || [])];
        let bonuses = [...(latest.bonuses[seatKey] || [])];

        if (latest.mustDraw) {
          if (nextWall.length === 0) {
            await pushStateToSupabase({
              ...latest,
              winnerInfo: {
                seat: -1,
                name: 'Huang Zhuang (Ronde Seri)',
                faan: 0,
              },
            });
            return;
          }
          const drawRes = drawWithFlowerReplacement(nextWall, hand, bonuses, 1);
          nextWall = drawRes.wall;
          hand = drawRes.hand;
          bonuses = drawRes.bonuses;
        }

        if (hand.length === 0) return;
        const discarded = hand[hand.length - 1];
        const remaining = sortHand(hand.slice(0, -1));
        setSelectedTileId(null);
        setDrawnTileId(null);

        await executeDiscardWithPriorityCheck(
          latest,
          mySeat,
          discarded,
          remaining,
          nextWall,
          bonuses,
          `${profile.username} kehabisan waktu (otomatis buang)`
        );
      }
    }, 500);

    return () => clearInterval(interval);
  }, [
    gameState,
    mySeat,
    profile.username,
    pushStateToSupabase,
    executeDiscardWithPriorityCheck,
  ]);

  useEffect(() => {
    const botWatchdog = setInterval(async () => {
      const latest = gameStateRef.current;
      if (
        !latest ||
        latest.diceInfo.phase !== 'playing' ||
        latest.winnerInfo ||
        latest.claimWindow ||
        botBusyRef.current
      ) {
        return;
      }

      if (latest.turn === mySeat) return;

      const currentSeatObj = livePlayersRef.current.find(
        (p) => p.seat_index === latest.turn
      );

      // Jika kursi ini milik pemain manusia terdaftar yang bukan bot, jangan dijalankan bot
      if (currentSeatObj && !currentSeatObj.is_bot && currentSeatObj.user_id) {
        return;
      }

      // Hanya host (atau pemain pertama jika host tidak aktif) yang mengeksekusi langkah bot agar tidak dobel
      const isActiveExecutor =
        isHost ||
        !livePlayersRef.current.some(
          (p) => p.user_id === room.host_id && !p.is_bot
        );
      if (!isActiveExecutor) return;

      botBusyRef.current = true;
      const activeTurn = latest.turn;

      setTimeout(async () => {
        try {
          const fresh = gameStateRef.current;
          if (
            !fresh ||
            fresh.diceInfo.phase !== 'playing' ||
            fresh.winnerInfo ||
            fresh.claimWindow ||
            fresh.turn !== activeTurn
          ) {
            botBusyRef.current = false;
            return;
          }

          const seatKey = String(activeTurn);
          const botName = currentSeatObj?.bot_name || `Bot ${activeTurn + 1}`;
          let botHand = [...(fresh.hands[seatKey] || [])];
          let botBonuses = [...(fresh.bonuses[seatKey] || [])];
          let botMelds = [...(fresh.melds[seatKey] || [])];
          let nextWall = [...fresh.wall];
          let flowerNotice = '';

          if (fresh.mustDraw) {
            if (nextWall.length === 0) {
              await pushStateToSupabase({
                ...fresh,
                winnerInfo: {
                  seat: -1,
                  name: 'Huang Zhuang (Ronde Seri)',
                  faan: 0,
                },
              });
              botBusyRef.current = false;
              return;
            }

            const drawRes = drawWithFlowerReplacement(
              nextWall,
              botHand,
              botBonuses,
              1
            );
            nextWall = drawRes.wall;
            botHand = drawRes.hand;
            botBonuses = drawRes.bonuses;

            if (drawRes.drawnBonusCount > 0) {
              flowerNotice = `🌸 ${botName} mendapat ${drawRes.drawnBonusCount} Bunga/Musim (+Faan)!`;
            }

            if (drawRes.drawnPlayable.length === 0 && nextWall.length === 0) {
              await pushStateToSupabase({
                ...fresh,
                wall: nextWall,
                bonuses: { ...fresh.bonuses, [seatKey]: botBonuses },
                winnerInfo: {
                  seat: -1,
                  name: 'Huang Zhuang (Ronde Seri)',
                  faan: 0,
                },
              });
              botBusyRef.current = false;
              return;
            }
          }

          const countMap: Record<string, Tile[]> = {};
          botHand.forEach((t) => {
            const k = `${t.suit}_${t.value}`;
            if (!countMap[k]) countMap[k] = [];
            countMap[k].push(t);
          });
          const anKongKey = Object.keys(countMap).find(
            (k) => countMap[k].length === 4
          );
          if (anKongKey && nextWall.length > 0) {
            const kongTiles = countMap[anKongKey];
            const kongIds = new Set(kongTiles.map((t) => t.id));
            botHand = botHand.filter((t) => !kongIds.has(t.id));
            botMelds.push({ type: 'AN_KONG', tiles: kongTiles });
            const repRes = drawWithFlowerReplacement(
              nextWall,
              botHand,
              botBonuses,
              1
            );
            nextWall = repRes.wall;
            botHand = repRes.hand;
            botBonuses = repRes.bonuses;
            flowerNotice = `🀄 ${botName} membuka Concealed KONG!`;
          }

          if (canWin(botHand, botMelds.length)) {
            const faanRes = calculateHongKongFaan(
              botHand,
              botMelds,
              botBonuses,
              activeTurn,
              fresh.dealerSeat ?? 0,
              fresh.prevailingWind ?? 1,
              true
            );
            await pushStateToSupabase({
              ...fresh,
              wall: nextWall,
              hands: { ...fresh.hands, [seatKey]: sortHand(botHand) },
              melds: { ...fresh.melds, [seatKey]: botMelds },
              bonuses: { ...fresh.bonuses, [seatKey]: botBonuses },
              winnerInfo: {
                seat: activeTurn,
                name: botName,
                faan: faanRes.totalFaan,
                breakdown: faanRes.breakdown,
                isSelfDraw: true,
              },
            });
            botBusyRef.current = false;
            return;
          }

          const counts: Record<string, number> = {};
          botHand.forEach((t) => {
            const k = `${t.suit}_${t.value}`;
            counts[k] = (counts[k] || 0) + 1;
          });
          const isolatedIndices = botHand
            .map((t, idx) => ({ t, idx }))
            .filter(({ t }) => counts[`${t.suit}_${t.value}`] === 1);

          const chosenPool =
            isolatedIndices.length > 0
              ? isolatedIndices
              : botHand.map((t, idx) => ({ t, idx }));
          const pick =
            chosenPool[Math.floor(Math.random() * chosenPool.length)];
          const discarded = pick.t;
          const remaining = sortHand(
            botHand.filter((_, i) => i !== pick.idx)
          );

          await executeDiscardWithPriorityCheck(
            {
              ...fresh,
              melds: { ...fresh.melds, [seatKey]: botMelds },
            },
            activeTurn,
            discarded,
            remaining,
            nextWall,
            botBonuses,
            flowerNotice
          );
        } finally {
          botBusyRef.current = false;
        }
      }, 1400);
    }, 600);

    return () => clearInterval(botWatchdog);
  }, [isHost, mySeat, room.host_id, pushStateToSupabase, executeDiscardWithPriorityCheck]);

  const handleManualDraw = async () => {
    if (
      !gameState ||
      gameState.diceInfo.phase !== 'playing' ||
      gameState.turn !== mySeat ||
      !gameState.mustDraw ||
      gameState.claimWindow ||
      gameState.winnerInfo
    )
      return;

    if (gameState.wall.length === 0) {
      await pushStateToSupabase({
        ...gameState,
        winnerInfo: {
          seat: -1,
          name: 'Huang Zhuang (Ronde Seri)',
          faan: 0,
        },
      });
      return;
    }

    playSoundEffect('tile');
    const seatKey = String(mySeat);
    const drawRes = drawWithFlowerReplacement(
      gameState.wall,
      gameState.hands[seatKey] || [],
      gameState.bonuses[seatKey] || [],
      1
    );

    if (drawRes.drawnPlayable.length === 0 && drawRes.wall.length === 0) {
      await pushStateToSupabase({
        ...gameState,
        wall: drawRes.wall,
        bonuses: { ...gameState.bonuses, [seatKey]: drawRes.bonuses },
        winnerInfo: {
          seat: -1,
          name: 'Huang Zhuang (Ronde Seri)',
          faan: 0,
        },
      });
      return;
    }

    const lastPlayable =
      drawRes.drawnPlayable[drawRes.drawnPlayable.length - 1];
    if (lastPlayable) {
      setDrawnTileId(lastPlayable.id);
      setSelectedTileId(lastPlayable.id);
    }

    await pushStateToSupabase({
      ...gameState,
      wall: drawRes.wall,
      hands: { ...gameState.hands, [seatKey]: drawRes.hand },
      bonuses: { ...gameState.bonuses, [seatKey]: drawRes.bonuses },
      mustDraw: false,
      lastActionNotice:
        drawRes.drawnBonusCount > 0
          ? `🌸 Anda menarik ${drawRes.drawnBonusCount} Bunga/Musim (+Faan) & batu pengganti!`
          : '',
    });
  };

  const handleSelfKong = async (
    mode: 'AN_KONG' | 'ADD_KONG',
    tilesToUse: Tile[],
    existingPongIndex?: number
  ) => {
    if (!gameState || gameState.wall.length === 0) return;
    playSoundEffect('call');

    const seatKey = String(mySeat);
    const currentHand = gameState.hands[seatKey] || [];
    const usedIds = new Set(tilesToUse.map((t) => t.id));
    const remHand = currentHand.filter((t) => !usedIds.has(t.id));
    const nextMelds = [...(gameState.melds[seatKey] || [])];

    if (mode === 'AN_KONG') {
      nextMelds.push({ type: 'AN_KONG', tiles: tilesToUse });
    } else if (mode === 'ADD_KONG' && existingPongIndex !== undefined) {
      const oldPong = nextMelds[existingPongIndex];
      nextMelds[existingPongIndex] = {
        type: 'KONG',
        tiles: [...oldPong.tiles, tilesToUse[0]],
        fromSeat: oldPong.fromSeat,
      };
    }

    const repRes = drawWithFlowerReplacement(
      gameState.wall,
      remHand,
      gameState.bonuses[seatKey] || [],
      1
    );

    const lastRep = repRes.drawnPlayable[repRes.drawnPlayable.length - 1];
    if (lastRep) {
      setDrawnTileId(lastRep.id);
      setSelectedTileId(lastRep.id);
    }

    await pushStateToSupabase({
      ...gameState,
      wall: repRes.wall,
      hands: { ...gameState.hands, [seatKey]: repRes.hand },
      melds: { ...gameState.melds, [seatKey]: nextMelds },
      bonuses: { ...gameState.bonuses, [seatKey]: repRes.bonuses },
      mustDraw: false,
      lastActionNotice: `🀄 ${profile.username} melakukan ${
        mode === 'AN_KONG' ? 'Concealed KONG' : 'Upgrade KONG'
      }!`,
    });
  };

  const handleDiscard = async (tile: Tile) => {
    if (
      !gameState ||
      gameState.diceInfo.phase !== 'playing' ||
      gameState.turn !== mySeat ||
      gameState.mustDraw ||
      gameState.claimWindow ||
      gameState.winnerInfo
    )
      return;

    playSoundEffect('tile');
    const seatKey = String(mySeat);
    const remaining = (gameState.hands[seatKey] || []).filter(
      (t) => t.id !== tile.id
    );

    setDrawnTileId(null);
    setSelectedTileId(null);

    await executeDiscardWithPriorityCheck(
      gameState,
      mySeat,
      tile,
      remaining,
      gameState.wall,
      gameState.bonuses[seatKey] || [],
      ''
    );
  };

  const declareSelfWin = async () => {
    if (!gameState) return;
    playSoundEffect('win');
    const currentMelds = gameState.melds[String(mySeat)] || [];
    const currentBonuses = gameState.bonuses[String(mySeat)] || [];
    const faanRes = calculateHongKongFaan(
      orderedMyHand,
      currentMelds,
      currentBonuses,
      mySeat,
      gameState.dealerSeat ?? 0,
      gameState.prevailingWind ?? 1,
      true
    );

    await pushStateToSupabase({
      ...gameState,
      lastActionNotice: `🀄 ${profile.username} WU (Zimo)!`,
      winnerInfo: {
        seat: mySeat,
        name: profile.username,
        faan: faanRes.totalFaan,
        breakdown: faanRes.breakdown,
        isSelfDraw: true,
      },
    });
  };

  const sendMahjongQuickChat = async (item: { text: string; sub: string }) => {
    if (!gameState) return;
    setShowChatPicker(false);
    playSoundEffect('tile');

    await pushStateToSupabase({
      ...gameState,
      chatBubble: {
        seat: mySeat,
        sender: profile.username,
        text: item.text,
        sub: item.sub,
        timestamp: Date.now(),
      },
    });
  };

  if (!gameState) {
    return (
      <div className="min-h-screen bg-stone-950 text-amber-200 flex items-center justify-center text-sm">
        Menyiapkan Meja Multiplayer (144 Tiles)...
      </div>
    );
  }

  const bottomSeat = mySeat;
  const rightSeat = (mySeat + 1) % 4;
  const topSeat = (mySeat + 2) % 4;
  const leftSeat = (mySeat + 3) % 4;
  const dealerSeat = gameState.dealerSeat ?? 0;
  const prevailingWind = gameState.prevailingWind ?? 1;

  const getSeatName = (seatIdx: number) => {
    const isDealerTag = seatIdx === dealerSeat ? ' [Bandar]' : '';
    if (seatIdx === mySeat) return `${profile.username}${isDealerTag}`;
    const found = livePlayers.find((p) => p.seat_index === seatIdx);
    const base = found
      ? found.is_bot
        ? found.bot_name
        : found.profiles?.username
      : `Player ${seatIdx + 1}`;
    return `${base}${isDealerTag}`;
  };

  const currentTurnObj = livePlayers.find(
    (p) => p.seat_index === gameState.turn
  );
  const isBotThinking =
    Boolean(currentTurnObj?.is_bot || !currentTurnObj) &&
    gameState.turn !== mySeat &&
    !gameState.claimWindow;

  const myBonuses = gameState.bonuses[String(bottomSeat)] || [];
  const topHand = gameState.hands[String(topSeat)] || [];
  const topMelds = gameState.melds[String(topSeat)] || [];
  const topBonuses = gameState.bonuses[String(topSeat)] || [];
  const leftHand = gameState.hands[String(leftSeat)] || [];
  const leftMelds = gameState.melds[String(leftSeat)] || [];
  const leftBonuses = gameState.bonuses[String(leftSeat)] || [];
  const rightHand = gameState.hands[String(rightSeat)] || [];
  const rightMelds = gameState.melds[String(rightSeat)] || [];
  const rightBonuses = gameState.bonuses[String(rightSeat)] || [];

  const playerCanSelfHu =
    !gameState.claimWindow && !isShowdown && canWin(orderedMyHand, myMelds.length);

  let selfKongOption: {
    mode: 'AN_KONG' | 'ADD_KONG';
    tiles: Tile[];
    pongIdx?: number;
    label: string;
  } | null = null;

  if (
    gameState.diceInfo.phase === 'playing' &&
    gameState.turn === mySeat &&
    !gameState.mustDraw &&
    !gameState.claimWindow &&
    !isShowdown
  ) {
    const handGroups: Record<string, Tile[]> = {};
    orderedMyHand.forEach((t) => {
      const k = `${t.suit}_${t.value}`;
      if (!handGroups[k]) handGroups[k] = [];
      handGroups[k].push(t);
    });
    const fourKey = Object.keys(handGroups).find(
      (k) => handGroups[k].length === 4
    );
    if (fourKey) {
      selfKongOption = {
        mode: 'AN_KONG',
        tiles: handGroups[fourKey],
        label: `AN-KONG (${handGroups[fourKey][0].sub})`,
      };
    } else {
      myMelds.forEach((m, idx) => {
        if (m.type === 'PONG' && !selfKongOption) {
          const match = orderedMyHand.find(
            (t) => t.suit === m.tiles[0].suit && t.value === m.tiles[0].value
          );
          if (match) {
            selfKongOption = {
              mode: 'ADD_KONG',
              tiles: [match],
              pongIdx: idx,
              label: `UPGRADE KONG (${match.sub})`,
            };
          }
        }
      });
    }
  }

  const cw = gameState.claimWindow;
  const amIEligibleToClaim = Boolean(
    cw &&
      cw.eligibleSeats.includes(mySeat) &&
      !cw.decisions[String(mySeat)]
  );
  const myClaimEval =
    cw && amIEligibleToClaim
      ? evaluateSeatClaim(
          mySeat,
          cw.fromSeat,
          cw.tile,
          orderedMyHand,
          myMelds.length
        )
      : null;

  const highlightedIds = new Set<string>();
  if (cw && amIEligibleToClaim) {
    orderedMyHand.forEach((t) => {
      if (
        t.suit === cw.tile.suit &&
        Math.abs(t.value - cw.tile.value) <= 2
      ) {
        highlightedIds.add(t.id);
      }
    });
  }

  const myDiceRoll = gameState.diceInfo.rolls[String(mySeat)];
  const canClickDrawNow =
    gameState.diceInfo.phase === 'playing' &&
    gameState.turn === mySeat &&
    gameState.mustDraw &&
    !cw &&
    !isShowdown;

  const canClickDiscardNow =
    gameState.diceInfo.phase === 'playing' &&
    gameState.turn === mySeat &&
    !gameState.mustDraw &&
    !cw &&
    !isShowdown;

  const initialTotal = gameState.initialWallCount || 92;
  const drawnCount = Math.max(0, initialTotal - gameState.wall.length);
  const perSide = Math.ceil(initialTotal / 4);

  const renderWallSide = (sideIdx: number, horizontal: boolean) => {
    const startGlobal = sideIdx * perSide;
    return Array.from({ length: perSide }).map((_, i) => {
      const globalIdx = startGlobal + i;
      if (globalIdx >= initialTotal) return null;
      const isTaken = globalIdx < drawnCount;
      const isNextToDraw = globalIdx === drawnCount;

      if (isTaken) {
        return (
          <div
            key={i}
            className={
              horizontal
                ? 'w-2.5 h-2 sm:w-3.5 sm:h-2.5 rounded-[2px] border border-emerald-400/10'
                : 'w-2 h-2.5 sm:w-2.5 sm:h-3.5 rounded-[2px] border border-emerald-400/10'
            }
          />
        );
      }

      return (
        <button
          key={i}
          type="button"
          disabled={!isNextToDraw || !canClickDrawNow}
          onClick={() => {
            if (isNextToDraw && canClickDrawNow) handleManualDraw();
          }}
          title={
            isNextToDraw
              ? canClickDrawNow
                ? 'Klik untuk Draw batu ini dari dinding!'
                : 'Batu dinding berikutnya'
              : `Sisa dinding (${gameState.wall.length})`
          }
          className={`${
            horizontal
              ? 'w-2.5 h-2 sm:w-3.5 sm:h-2.5 border-b-2'
              : 'w-2 h-2.5 sm:w-2.5 sm:h-3.5 border-r-2'
          } rounded-[2px] transition-all ${
            isNextToDraw
              ? canClickDrawNow
                ? 'bg-amber-400 border-amber-100 scale-125 animate-pulse cursor-pointer shadow-md shadow-amber-400/60'
                : 'bg-amber-500/80 border-amber-200'
              : 'bg-emerald-700 border-amber-200/75 shadow-sm'
          }`}
        />
      );
    });
  };

  const selectedIndex = orderedMyHand.findIndex((t) => t.id === selectedTileId);
  const selectedTileObj =
    selectedIndex >= 0 ? orderedMyHand[selectedIndex] : null;
  const selectedOutCount = selectedTileObj
    ? gameState.discards.filter(
        (d) =>
          d.suit === selectedTileObj.suit && d.value === selectedTileObj.value
      ).length +
      Object.values(gameState.melds)
        .flatMap((ml) => ml.flatMap((m) => m.tiles))
        .filter(
          (mt) =>
            mt.suit === selectedTileObj.suit &&
            mt.value === selectedTileObj.value
        ).length
    : 0;

  const activeChat =
    gameState.chatBubble && Date.now() - gameState.chatBubble.timestamp < 5500
      ? gameState.chatBubble
      : null;

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_center,#291d14_0%,#090705_100%)] text-stone-100 flex flex-col justify-between overflow-x-hidden select-none">
      {/* HUD ATAS */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-black/60 border-b border-amber-500/20 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onProfileUpdated();
              onExitRoom();
            }}
            className="px-2.5 py-1.5 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-xs flex items-center gap-1 text-amber-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Keluar
          </button>
          <span className="text-[11px] sm:text-xs px-2 py-1 rounded bg-amber-500/15 border border-amber-400/30 text-amber-300 font-mono">
            {WIND_KANJI[prevailingWind - 1]} {WIND_NAMES[prevailingWind - 1]} •
            Hand #{gameState.roundNumber ?? 1}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs">
          {gameState.diceInfo.phase === 'playing' && !isShowdown && (
            <span
              className={`px-2 py-1 rounded font-mono font-bold flex items-center gap-1 border ${
                cw
                  ? 'bg-purple-950 border-purple-400 text-purple-200 animate-pulse'
                  : secondsLeft <= 10
                  ? 'bg-red-950 border-red-500 text-red-300 animate-pulse'
                  : 'bg-stone-900 border-stone-700 text-amber-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />{' '}
              {cw ? `Klaim ${claimSecondsLeft}s` : `${secondsLeft}s`}
            </span>
          )}
          <span className="text-stone-300">
            Dinding:{' '}
            <strong className="text-amber-300">{gameState.wall.length}</strong>
          </span>
          {isShowdown && hideWinModalForShowdown ? (
            <button
              onClick={() => setHideWinModalForShowdown(false)}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold flex items-center gap-1"
            >
              <Trophy className="w-3.5 h-3.5" /> Buka Hasil Ronde
            </button>
          ) : (
            <span
              className={`px-2 py-1 rounded border font-semibold truncate max-w-[165px] sm:max-w-none ${
                gameState.diceInfo.phase === 'rolling'
                  ? 'bg-purple-950 border-purple-500/40 text-purple-200'
                  : cw
                  ? 'bg-amber-600 text-stone-950 border-amber-300'
                  : gameState.turn === mySeat
                  ? 'bg-amber-500 text-stone-950 border-amber-300'
                  : 'bg-emerald-950 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {gameState.diceInfo.phase === 'rolling'
                ? 'Fase Lempar Dadu'
                : isShowdown
                ? 'Showdown Ronde Selesai'
                : cw
                ? 'Jendela Klaim Prioritas'
                : gameState.turn === mySeat
                ? 'Giliran Anda!'
                : `${getSeatName(gameState.turn)}${
                    isBotThinking ? ' berpikir...' : ''
                  }`}
            </span>
          )}
        </div>
      </div>

      {/* AREA MEJA MAHJONG */}
      <div className="relative flex-1 flex items-center justify-center p-1.5 sm:p-3 [perspective:1100px]">
        <div
          className={`relative w-full max-w-5xl min-h-[515px] sm:h-[615px] rounded-2xl sm:rounded-3xl border-[6px] sm:border-[12px] border-[#3d2314] bg-[radial-gradient(circle_at_center,#1b5e3a_0%,#0f3d24_75%,#092616_100%)] shadow-[0_20px_60px_rgba(0,0,0,0.85),inset_0_0_40px_rgba(0,0,0,0.65)] transition-transform duration-500 flex flex-col justify-between p-2 sm:p-4 ${
            tableTilt ? 'sm:[transform:rotateX(20deg)]' : ''
          }`}
        >
          {/* LAWAN ATAS + SHOWDOWN SAAT RONDE SELESAI */}
          <div className="flex flex-col items-center gap-1 relative">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div
                className={`px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs border ${
                  gameState.turn === topSeat &&
                  gameState.diceInfo.phase === 'playing' &&
                  !cw &&
                  !isShowdown
                    ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                    : 'bg-black/50 text-stone-300 border-stone-700'
                }`}
              >
                {WIND_KANJI[topSeat]} {getSeatName(topSeat)} ({topHand.length})
              </div>
              <MeldAndBonusStrip melds={topMelds} bonuses={topBonuses} />
            </div>
            <div className="flex gap-0.5 flex-wrap justify-center">
              {isShowdown
                ? topHand.map((t, i) => (
                    <div
                      key={i}
                      className="w-5 h-7 sm:w-6 sm:h-8 rounded bg-[#f5eedc] border border-stone-400 flex items-center justify-center overflow-hidden shadow"
                    >
                      <TileFace tile={t} compact />
                    </div>
                  ))
                : topHand.map((_, i) => (
                    <div
                      key={i}
                      className="w-3.5 h-5 sm:w-5 sm:h-7 rounded-sm bg-gradient-to-b from-emerald-700 to-emerald-900 border border-emerald-400/40 shadow"
                    />
                  ))}
            </div>
          </div>

          {/* TENGAH MEJA */}
          <div className="flex items-center justify-between flex-1 my-1 sm:my-2 gap-1 sm:gap-3">
            {/* Lawan Kiri + Showdown */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[11px] border max-w-[75px] sm:max-w-[105px] truncate ${
                    gameState.turn === leftSeat &&
                    gameState.diceInfo.phase === 'playing' &&
                    !cw &&
                    !isShowdown
                      ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                      : 'bg-black/50 text-stone-300 border-stone-700'
                  }`}
                >
                  {WIND_KANJI[leftSeat]} {getSeatName(leftSeat)}
                </div>
                {isShowdown ? (
                  <div className="grid grid-cols-2 gap-0.5">
                    {leftHand.map((t, i) => (
                      <div
                        key={i}
                        className="w-4 h-6 sm:w-5 sm:h-7 rounded bg-[#f5eedc] border border-stone-400 flex items-center justify-center overflow-hidden"
                      >
                        <TileFace tile={t} compact />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {leftHand.slice(0, 9).map((_, i) => (
                      <div
                        key={i}
                        className="w-4 h-2.5 sm:w-6 sm:h-3 rounded-sm bg-emerald-800 border border-emerald-400/40"
                      />
                    ))}
                  </div>
                )}
              </div>
              <MeldAndBonusStrip
                melds={leftMelds}
                bonuses={leftBonuses}
                vertical
              />
            </div>

            {/* DINDING TILES 4 SISI AKTIF + KOLAM BUANGAN + TOMBOL AKSI TENGAH */}
            <div className="relative flex-1 max-w-md flex flex-col items-center justify-center">
              {activeChat && (
                <div className="mb-1.5 px-3 py-1 rounded-xl bg-stone-950/95 border border-sky-400/70 text-xs shadow-lg flex items-center gap-2 animate-bounce">
                  <span className="font-bold text-sky-300">
                    {activeChat.sender}:
                  </span>
                  <span className="font-extrabold text-amber-300">
                    {activeChat.text}
                  </span>
                  <span className="text-[10px] text-stone-400">
                    ({activeChat.sub})
                  </span>
                </div>
              )}

              {gameState.lastActionNotice &&
                gameState.diceInfo.phase === 'playing' && (
                  <div className="mb-1 px-3 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-[11px] text-amber-200 font-bold text-center">
                    {gameState.lastActionNotice}
                  </div>
                )}

              <div className="flex gap-0.5 mb-1">
                {renderWallSide(0, true)}
              </div>

              <div className="flex items-center justify-center w-full gap-1">
                <div className="flex flex-col gap-0.5">
                  {renderWallSide(3, false)}
                </div>

                <div className="flex-1 min-h-[155px] sm:min-h-[195px] max-h-[235px] overflow-y-auto bg-black/35 border border-emerald-400/30 rounded-xl p-2 sm:p-2.5 flex flex-wrap content-start gap-1 shadow-inner relative">
                  {gameState.diceInfo.phase === 'rolling' ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-center space-y-2 py-1">
                      <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs sm:text-sm">
                        <Dices className="w-4 h-4" />
                        <span>Lempar Dadu Penentu Bandar & Giliran</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 w-full text-[11px]">
                        {[0, 1, 2, 3].map((s) => {
                          const r = gameState.diceInfo.rolls[String(s)];
                          const total = r ? r.reduce((a, b) => a + b, 0) : 0;
                          const isWinner =
                            allDiceRolled &&
                            gameState.diceInfo.startingSeat === s;
                          return (
                            <div
                              key={s}
                              className={`p-1.5 rounded border ${
                                isWinner
                                  ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                                  : 'bg-stone-900/80 border-stone-700 text-stone-300'
                              }`}
                            >
                              <div className="truncate text-[10px]">
                                {WIND_KANJI[s]} {getSeatName(s)}
                              </div>
                              {r ? (
                                <div className="font-mono text-xs mt-0.5 text-emerald-300">
                                  🎲 {r.join('-')} = <strong>{total}</strong>
                                </div>
                              ) : (
                                <div className="text-[10px] text-stone-500 italic mt-0.5">
                                  Belum lempar...
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {!myDiceRoll ? (
                        <button
                          onClick={handlePlayerRollDice}
                          className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-extrabold text-xs shadow-lg animate-bounce"
                        >
                          🎲 Lempar 3 Dadu Sekarang
                        </button>
                      ) : allDiceRolled ? (
                        <div className="space-y-1">
                          <div className="text-[11px] text-emerald-300 font-semibold">
                            Dinding dipotong urutan ke-
                            {gameState.diceInfo.wallBreakStack} •{' '}
                            {getSeatName(gameState.diceInfo.startingSeat)} jadi
                            Bandar!
                          </div>
                          {isHost && (
                            <button
                              onClick={() =>
                                pushStateToSupabase({
                                  ...gameState,
                                  turnStartedAt: Date.now(),
                                  diceInfo: {
                                    ...gameState.diceInfo,
                                    phase: 'playing',
                                  },
                                })
                              }
                              className="px-3.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow"
                            >
                              Masuk ke Meja Permainan →
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-stone-400">
                          Menunggu pemain lain melempar dadu...
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {gameState.discards.length === 0 && (
                        <div className="w-full h-32 flex items-center justify-center text-[11px] text-emerald-200/35 italic text-center">
                          Kolam Tengah Meja • Klik batu emas di dinding atau
                          tombol Draw
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
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-0.5">
                  {renderWallSide(1, false)}
                </div>
              </div>

              <div className="flex gap-0.5 mt-1">
                {renderWallSide(2, true)}
              </div>

              {gameState.diceInfo.phase === 'playing' && !isShowdown && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 z-20">
                  {canClickDrawNow && (
                    <button
                      onClick={handleManualDraw}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-stone-950 font-extrabold text-xs sm:text-sm shadow-xl shadow-amber-500/30 flex items-center gap-1.5 animate-pulse"
                    >
                      <Sparkles className="w-4 h-4" /> DRAW TILE (
                      {secondsLeft}s)
                    </button>
                  )}

                  {selfKongOption && (
                    <button
                      onClick={() =>
                        handleSelfKong(
                          selfKongOption!.mode,
                          selfKongOption!.tiles,
                          selfKongOption!.pongIdx
                        )
                      }
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs sm:text-sm shadow-xl"
                    >
                      🀄 {selfKongOption.label}
                    </button>
                  )}

                  {playerCanSelfHu && (
                    <button
                      onClick={declareSelfWin}
                      className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs sm:text-sm shadow-xl animate-bounce"
                    >
                      🀄 WU / ZI MO (MENANG)!
                    </button>
                  )}

                  {cw && amIEligibleToClaim && myClaimEval && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5 bg-stone-950/95 border-2 border-amber-400 px-3 py-1.5 rounded-xl shadow-2xl">
                      <span className="text-[11px] text-amber-200 mr-1">
                        Prioritas ({claimSecondsLeft}s) •{' '}
                        <strong>{cw.tile.sub}</strong>:
                      </span>

                      {myClaimEval.canWu && (
                        <button
                          onClick={() => submitMyClaimDecision({ type: 'WU' })}
                          className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold animate-bounce"
                        >
                          🀄 WU (#1)
                        </button>
                      )}

                      {myClaimEval.canKong && (
                        <button
                          onClick={() =>
                            submitMyClaimDecision({ type: 'KONG' })
                          }
                          className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-extrabold"
                        >
                          KONG (#2)
                        </button>
                      )}

                      {myClaimEval.canPong && (
                        <button
                          onClick={() =>
                            submitMyClaimDecision({ type: 'PONG' })
                          }
                          className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-extrabold"
                        >
                          PONG (#2)
                        </button>
                      )}

                      {myClaimEval.chiCombos.map((combo, i) => (
                        <button
                          key={i}
                          onClick={() =>
                            submitMyClaimDecision({
                              type: 'CHI',
                              pairTiles: combo,
                            })
                          }
                          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-extrabold"
                        >
                          CHI ({combo[0].value}-{combo[1].value})
                        </button>
                      ))}

                      <button
                        onClick={() => submitMyClaimDecision({ type: 'PASS' })}
                        className="px-2.5 py-1 rounded-lg bg-stone-700 hover:bg-stone-600 text-xs font-semibold"
                      >
                        Lewati
                      </button>
                    </div>
                  )}

                  {cw && !amIEligibleToClaim && (
                    <div className="px-3 py-1 rounded-lg bg-stone-950/90 border border-amber-400/40 text-xs text-amber-200 animate-pulse">
                      Menunggu keputusan klaim pemain ({claimSecondsLeft}s)...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Lawan Kanan + Showdown */}
            <div className="flex items-center gap-1.5 shrink-0">
              <MeldAndBonusStrip
                melds={rightMelds}
                bonuses={rightBonuses}
                vertical
              />
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[11px] border max-w-[75px] sm:max-w-[105px] truncate ${
                    gameState.turn === rightSeat &&
                    gameState.diceInfo.phase === 'playing' &&
                    !cw &&
                    !isShowdown
                      ? 'bg-amber-500 text-stone-950 font-bold border-amber-300'
                      : 'bg-black/50 text-stone-300 border-stone-700'
                  }`}
                >
                  {WIND_KANJI[rightSeat]} {getSeatName(rightSeat)}
                </div>
                {isShowdown ? (
                  <div className="grid grid-cols-2 gap-0.5">
                    {rightHand.map((t, i) => (
                      <div
                        key={i}
                        className="w-4 h-6 sm:w-5 sm:h-7 rounded bg-[#f5eedc] border border-stone-400 flex items-center justify-center overflow-hidden"
                      >
                        <TileFace tile={t} compact />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {rightHand.slice(0, 9).map((_, i) => (
                      <div
                        key={i}
                        className="w-4 h-2.5 sm:w-6 sm:h-3 rounded-sm bg-emerald-800 border border-emerald-400/40"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AREA PEMAIN BAWAH */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-emerald-400/20">
            {tenpaiWaits.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 bg-amber-500/20 border border-amber-400/60 px-2.5 py-1 rounded-lg text-[11px]">
                <span className="font-extrabold text-amber-300 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-400" /> SIAP WU
                  (Ting):
                </span>
                {tenpaiWaits.map((w, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded bg-stone-950/90 border border-amber-400/40 text-amber-200 font-semibold"
                  >
                    {w.sub}{' '}
                    <span className="text-emerald-400">
                      (sisa {w.remaining})
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleAutoSortMyHand}
                  className="px-2.5 py-1 rounded-md bg-stone-900/90 hover:bg-stone-800 border border-amber-400/30 text-[11px] text-amber-200 flex items-center gap-1"
                >
                  <ArrowUpDown className="w-3 h-3" /> Rapikan Urutan
                </button>

                {selectedTileObj && (
                  <div className="flex items-center gap-1 bg-stone-900/95 border border-stone-700 rounded-md px-1.5 py-0.5">
                    <button
                      onClick={() =>
                        moveTilePosition(selectedIndex, selectedIndex - 1)
                      }
                      disabled={selectedIndex <= 0}
                      className="p-0.5 hover:bg-stone-700 rounded disabled:opacity-30"
                      title="Geser Kiri"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] text-amber-300 font-semibold px-1">
                      {selectedTileObj.sub}{' '}
                      <span className="text-stone-400">
                        (keluar {selectedOutCount}/4)
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        moveTilePosition(selectedIndex, selectedIndex + 1)
                      }
                      disabled={selectedIndex >= orderedMyHand.length - 1}
                      className="p-0.5 hover:bg-stone-700 rounded disabled:opacity-30"
                      title="Geser Kanan"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    {canClickDiscardNow && (
                      <button
                        onClick={() => handleDiscard(selectedTileObj)}
                        className="ml-1 px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold flex items-center gap-0.5"
                      >
                        <Trash2 className="w-3 h-3" /> Buang
                      </button>
                    )}
                  </div>
                )}
              </div>

              <span className="text-[10px] text-emerald-200/75">
                {canClickDiscardNow
                  ? 'Tap 2x kartu (atau tombol Buang) untuk membuang'
                  : 'Drag atau klik kartu untuk menyusun urutan'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div className="flex items-end justify-center sm:justify-start gap-1 flex-wrap">
                {orderedMyHand.map((tile, idx) => {
                  const isDrawn = tile.id === drawnTileId;
                  const isSelected = tile.id === selectedTileId;
                  const isHighlighted = highlightedIds.has(tile.id);

                  return (
                    <button
                      key={tile.id}
                      draggable
                      onDragStart={() => setDraggedTileId(tile.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (!draggedTileId) return;
                        const fromIdx = orderedMyHand.findIndex(
                          (t) => t.id === draggedTileId
                        );
                        moveTilePosition(fromIdx, idx);
                        setDraggedTileId(null);
                      }}
                      onClick={() => {
                        setInspectedTile(tile);
                        if (isSelected && canClickDiscardNow) {
                          handleDiscard(tile);
                        } else {
                          setSelectedTileId(tile.id);
                          playSoundEffect('tile');
                        }
                      }}
                      onMouseEnter={() => setInspectedTile(tile)}
                      className={`w-8 h-12 sm:w-10 sm:h-14 rounded-md bg-gradient-to-b from-[#fcf9f0] via-[#f5eedc] to-[#e3d6b8] border border-stone-300 border-b-[3px] sm:border-b-4 border-b-emerald-800 shadow-lg flex items-center justify-center transition-transform overflow-hidden cursor-grab active:cursor-grabbing ${
                        isDrawn ? 'ml-1.5 sm:ml-3 ring-2 ring-amber-400' : ''
                      } ${
                        isSelected
                          ? '-translate-y-3 ring-2 ring-sky-400'
                          : isHighlighted
                          ? 'ring-2 ring-amber-400 -translate-y-2'
                          : 'hover:-translate-y-1.5'
                      }`}
                    >
                      <TileFace tile={tile} />
                    </button>
                  );
                })}
              </div>

              <MeldAndBonusStrip melds={myMelds} bonuses={myBonuses} />
            </div>
          </div>
        </div>
      </div>

      {/* PANEL INFO BAWAH */}
      <div className="relative bg-stone-950/95 border-t border-amber-500/20 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChatPicker(!showChatPicker)}
            className="px-3 py-1.5 rounded-lg bg-sky-900/70 hover:bg-sky-800 border border-sky-500/40 text-xs flex items-center gap-1.5 text-sky-200 font-semibold"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Quick Chat
          </button>

          <button
            onClick={() => setTableTilt(!tableTilt)}
            className="hidden sm:flex px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs items-center gap-1.5 text-stone-200"
          >
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            Sudut: {tableTilt ? '3D' : 'Datar'}
          </button>

          {inspectedTile && (
            <div className="text-xs bg-stone-900 border border-stone-700 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
              <span className="font-bold text-amber-300">
                {inspectedTile.sub}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-stone-400">
          <span className="hidden md:inline-flex items-center gap-1 text-pink-300">
            <Flower2 className="w-3.5 h-3.5" /> WU &gt; KONG/PONG &gt; CHI
          </span>
          <span>
            Batas jalan: <strong className="text-amber-300">60s</strong>
          </span>
        </div>

        {showChatPicker && (
          <div className="absolute bottom-12 left-3 w-72 sm:w-80 bg-stone-900 border border-amber-400/50 rounded-xl p-2.5 shadow-2xl grid grid-cols-2 gap-1.5 z-50">
            {MAHJONG_QUICK_CHATS.map((item, idx) => (
              <button
                key={idx}
                onClick={() => sendMahjongQuickChat(item)}
                className="p-2 rounded-lg bg-stone-950 hover:bg-amber-500/20 border border-stone-800 hover:border-amber-400/50 text-left transition"
              >
                <div className="text-xs font-bold text-amber-300">
                  {item.text}
                </div>
                <div className="text-[10px] text-stone-400">{item.sub}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* MODAL HASIL PERTANDINGAN + SHOWDOWN + ALUR LANJUTAN */}
      {gameState.winnerInfo && !hideWinModalForShowdown && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-stone-900 border-2 border-amber-400 rounded-2xl p-5 sm:p-6 max-w-md w-full text-center space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-800 text-stone-300">
                {WIND_KANJI[prevailingWind - 1]} Hand #
                {gameState.roundNumber ?? 1}
              </span>
              <button
                onClick={() => setHideWinModalForShowdown(true)}
                className="text-xs px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-amber-300 flex items-center gap-1"
              >
                <EyeOff className="w-3.5 h-3.5" /> Lihat Meja (Showdown)
              </button>
            </div>

            <Trophy className="w-10 h-10 text-amber-400 mx-auto" />

            {isDrawResult ? (
              <>
                <h2 className="text-xl font-bold text-amber-300">
                  Huang Zhuang (Ronde Seri)
                </h2>
                <p className="text-xs text-stone-300">
                  Seluruh batu dinding telah habis tanpa pemenang. Bandar tetap
                  bertahan (<em>Lian Zhuang</em>) dan otomatis lanjut ke Hand
                  berikutnya dalam{' '}
                  <strong className="text-emerald-400">{drawCountdown}s</strong>
                  .
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-amber-300">
                  {gameState.winnerInfo.seat === mySeat
                    ? 'Selamat, Anda Wu!'
                    : 'Ronde Selesai'}
                </h2>
                <p className="text-sm text-stone-200">
                  Pemenang: <strong>{gameState.winnerInfo.name}</strong> • Total{' '}
                  <strong className="text-amber-300">
                    {gameState.winnerInfo.faan} Faan
                  </strong>
                </p>
              </>
            )}

            {!isDrawResult &&
              gameState.winnerInfo.breakdown &&
              gameState.winnerInfo.breakdown.length > 0 && (
                <div className="bg-stone-950/90 border border-stone-800 rounded-xl p-3 text-left space-y-1.5 max-h-32 overflow-y-auto">
                  <div className="text-[11px] font-bold text-amber-300 flex items-center gap-1 border-b border-stone-800 pb-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Rincian Skor Faan:
                  </div>
                  {gameState.winnerInfo.breakdown.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs text-stone-300"
                    >
                      <span>{item.label}</span>
                      <span className="font-mono font-bold text-emerald-400">
                        +{item.faan} Faan
                      </span>
                    </div>
                  ))}
                </div>
              )}

            <div className="bg-stone-950/90 border border-stone-800 rounded-xl p-2.5 text-left space-y-1">
              <div className="text-[11px] font-bold text-stone-400 flex items-center justify-between">
                <span>Skor Sesi Room ({room.code}):</span>
                {room.type === 'ranked' && (
                  <span
                    className={
                      (rpChangeShown ?? 0) >= 0
                        ? 'text-emerald-400 font-bold'
                        : 'text-red-400 font-bold'
                    }
                  >
                    Rank:{' '}
                    {(rpChangeShown ?? 0) >= 0
                      ? `+${rpChangeShown ?? 0}`
                      : rpChangeShown}{' '}
                    RP
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                {[0, 1, 2, 3].map((s) => {
                  const baseScore = gameState.sessionScores?.[String(s)] || 0;
                  const roundBonus =
                    gameState.winnerInfo?.seat === s
                      ? 10 + (gameState.winnerInfo?.faan || 0) * 5
                      : 0;
                  return (
                    <div
                      key={s}
                      className="flex items-center justify-between px-2 py-1 rounded bg-stone-900 border border-stone-800"
                    >
                      <span className="truncate max-w-[100px] text-stone-300">
                        {WIND_KANJI[s]} {getSeatName(s).replace(' [Bandar]', '')}
                      </span>
                      <span className="font-mono font-bold text-amber-300">
                        {baseScore + roundBonus} pts
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {isHost ? (
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => {
                    onProfileUpdated();
                    handleNextRoundWithRotation();
                  }}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  {isDrawResult
                    ? `Lanjut Hand Sekarang (${drawCountdown}s)`
                    : 'Lanjut Hand Berikutnya (Rotasi Bandar)'}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      onProfileUpdated();
                      onReturnWaitingRoom();
                    }}
                    className="py-2 px-3 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-amber-200 flex items-center justify-center gap-1"
                  >
                    <Users className="w-3.5 h-3.5" /> Ruang Tunggu
                  </button>
                  <button
                    onClick={() => {
                      onProfileUpdated();
                      onDisbandRoom();
                    }}
                    className="py-2 px-3 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-500/40 text-xs font-semibold text-red-200 flex items-center justify-center gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Bubarkan Room
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <div className="flex-1 py-2.5 px-2 rounded-lg bg-stone-950 border border-stone-800 text-xs text-stone-400 flex items-center justify-center">
                  {isDrawResult
                    ? `Otomatis lanjut (${drawCountdown}s)...`
                    : 'Menunggu keputusan Host...'}
                </div>
                <button
                  onClick={() => {
                    onProfileUpdated();
                    onExitRoom();
                  }}
                  className="px-4 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold"
                >
                  Keluar Room
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}