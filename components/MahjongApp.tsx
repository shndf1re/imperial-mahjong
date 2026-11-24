'use client';

import React, { useState, useEffect } from 'react';
import { supabase, UserProfile } from '@/lib/supabase';
import MahjongTable from './MahjongTable';
import {
  Crown,
  Users,
  Play,
  Copy,
  Check,
  LogOut,
  ShieldAlert,
  UserCheck,
  Trophy,
  Sparkles,
} from 'lucide-react';

export default function MahjongApp() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  // State Room, Lobby & Permainan
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeRoom, setActiveRoom] = useState<{
    id: string;
    code: string;
    type: 'ranked' | 'private';
  } | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);

  // Cek sesi login saat halaman dibuka
  useEffect(() => {
    checkSession();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      checkSession();
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function checkSession() {
    setLoading(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user) {
      let { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      // Fallback: jika trigger SQL belum selesai membuat profil, buatkan langsung
      if (!data) {
        const fallbackName =
          session.user.user_metadata?.username ||
          `Player_${session.user.id.slice(0, 5)}`;
        const { data: inserted } = await supabase
          .from('profiles')
          .upsert({
            id: session.user.id,
            username: fallbackName,
            is_guest: session.user.is_anonymous ?? true,
          })
          .select()
          .single();
        data = inserted;
      }

      if (data) setProfile(data as UserProfile);
      fetchLeaderboard();
    } else {
      setProfile(null);
    }
    setLoading(false);
  }

  async function fetchLeaderboard() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('rank_points', { ascending: false })
      .limit(5);
    if (data) setLeaderboard(data as UserProfile[]);
  }

  // 1. Login Mode Guest (Anonymous)
  async function handleGuestLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    const cleanName =
      usernameInput.trim() || `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { username: cleanName } },
    });
    if (error) setAuthError(error.message);
    setLoading(false);
  }

  // 2. Login / Register Akun Permanen
  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    if (authMode === 'register') {
      const { error } = await supabase.auth.signUp({
        email: emailInput,
        password: passwordInput,
        options: {
          data: { username: usernameInput.trim() || emailInput.split('@')[0] },
        },
      });
      if (error) setAuthError(error.message);
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailInput,
        password: passwordInput,
      });
      if (error) setAuthError(error.message);
    }
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setProfile(null);
    setActiveRoom(null);
    setIsPlaying(false);
  }

  // 3. Buat Room (Ranked atau Private)
  async function createRoom(roomType: 'ranked' | 'private') {
    if (!profile) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: room, error } = await supabase
      .from('rooms')
      .insert({ room_code: code, room_type: roomType, host_id: profile.id })
      .select()
      .single();

    if (error || !room) {
      alert('Gagal membuat room: ' + error?.message);
      return;
    }

    // Dudukkan host di kursi 0 (East)
    await supabase.from('room_players').insert({
      room_id: room.id,
      user_id: profile.id,
      seat_index: 0,
      is_bot: false,
      is_ready: true,
    });

    setActiveRoom({ id: room.id, code: room.room_code, type: roomType });
    subscribeRoomPlayers(room.id);
  }

  // 4. Gabung Private Room dengan Kode
  async function joinPrivateRoom() {
    if (!profile || !roomCodeInput.trim()) return;
    const code = roomCodeInput.trim().toUpperCase();
    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_code', code)
      .eq('status', 'waiting')
      .single();

    if (!room) {
      alert('Kode room tidak ditemukan atau pertandingan sudah dimulai.');
      return;
    }

    const { data: existingPlayers } = await supabase
      .from('room_players')
      .select('*')
      .eq('room_id', room.id);

    const takenSeats = (existingPlayers || []).map((p) => p.seat_index);
    const availableSeat = [0, 1, 2, 3].find((s) => !takenSeats.includes(s));

    if (availableSeat === undefined) {
      alert('Room sudah penuh (4/4 pemain).');
      return;
    }

    await supabase.from('room_players').insert({
      room_id: room.id,
      user_id: profile.id,
      seat_index: availableSeat,
      is_bot: false,
      is_ready: true,
    });

    setActiveRoom({ id: room.id, code: room.room_code, type: room.room_type });
    subscribeRoomPlayers(room.id);
  }

  // Dengarkan pemain yang masuk/keluar room secara Real-Time
  function subscribeRoomPlayers(roomId: string) {
    fetchPlayers(roomId);
    supabase
      .channel(`room_${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`,
        },
        () => fetchPlayers(roomId)
      )
      .subscribe();
  }

  async function fetchPlayers(roomId: string) {
    const { data } = await supabase
      .from('room_players')
      .select('*, profiles(username, rank_tier, rank_points)')
      .eq('room_id', roomId)
      .order('seat_index', { ascending: true });
    if (data) setRoomPlayers(data);
  }

  // Isi kursi kosong dengan Bot AI lalu masuk ke Meja 3D
  async function startMatchWithBots() {
    if (!activeRoom) return;
    const botNames = ['Chen Tao (AI)', 'Mei Lin (AI)', 'Kenji Sato (AI)'];
    const takenSeats = roomPlayers.map((p) => p.seat_index);
    const emptySeats = [0, 1, 2, 3].filter((s) => !takenSeats.includes(s));

    for (let i = 0; i < emptySeats.length; i++) {
      await supabase.from('room_players').insert({
        room_id: activeRoom.id,
        user_id: null,
        seat_index: emptySeats[i],
        is_bot: true,
        bot_name: botNames[i % botNames.length],
        is_ready: true,
      });
    }

    await supabase
      .from('rooms')
      .update({ status: 'playing' })
      .eq('id', activeRoom.id);

    await fetchPlayers(activeRoom.id);
    setIsPlaying(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 text-amber-100 flex items-center justify-center">
        Memuat Imperial Mahjong...
      </div>
    );
  }

  // TAMPILAN 1: LOGIN / MODE GUEST
  if (!profile) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_center,#1c1917_0%,#09090b_100%)] text-stone-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-stone-900/90 border border-amber-500/30 rounded-2xl p-6 shadow-2xl">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-900/60 border border-amber-400/40 text-3xl mb-3">
              🀄
            </div>
            <h1 className="text-2xl font-bold text-amber-300 tracking-wide">
              IMPERIAL MAHJONG
            </h1>
            <p className="text-xs text-stone-400 mt-1">
              Hong Kong 136-Tile • Ranked & Private Room
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-stone-950 p-1 rounded-lg mb-5 text-xs font-medium">
            {(['guest', 'login', 'register'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setAuthMode(tab);
                  setAuthError('');
                }}
                className={`py-2 rounded-md capitalize transition ${
                  authMode === tab
                    ? 'bg-amber-600 text-stone-950 font-bold'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {tab === 'guest'
                  ? 'Mode Guest'
                  : tab === 'login'
                  ? 'Login'
                  : 'Buat Akun'}
              </button>
            ))}
          </div>

          {authError && (
            <div className="mb-4 p-3 rounded-lg bg-red-950/70 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {authMode === 'guest' ? (
            <form onSubmit={handleGuestLogin} className="space-y-4">
              <div>
                <label className="block text-xs text-stone-400 mb-1">
                  Nama Panggilan di Meja
                </label>
                <input
                  type="text"
                  placeholder="User"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-stone-950 border border-stone-700 text-sm focus:border-amber-400 outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm transition flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" /> Masuk Langsung (Guest)
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-3">
              {authMode === 'register' && (
                <div>
                  <label className="block text-xs text-stone-400 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-stone-700 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-stone-400 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-stone-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-stone-700 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm transition"
              >
                {authMode === 'login'
                  ? 'Masuk ke Akun'
                  : 'Daftar & Simpan Rank'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // TAMPILAN 2: MEJA PERMAINAN 3D FIRST-PERSON POV
  if (isPlaying && activeRoom) {
    return (
      <MahjongTable
        profile={profile}
        room={activeRoom}
        players={roomPlayers}
        onExitRoom={() => {
          setIsPlaying(false);
          setActiveRoom(null);
          fetchLeaderboard();
        }}
        onProfileUpdated={checkSession}
      />
    );
  }

  // TAMPILAN 3: LOBBY UTAMA & WAITING ROOM REAL-TIME
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1c1917_0%,#09090b_100%)] text-stone-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Profil & Rank */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-stone-900 border border-amber-500/20 p-4 rounded-xl shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-amber-500/20 border border-amber-400 flex items-center justify-center font-bold text-amber-300">
              {profile.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">{profile.username}</span>
                {profile.is_guest && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-stone-800 text-stone-400">
                    GUEST
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-amber-300 mt-0.5">
                <Crown className="w-3.5 h-3.5" />
                <span>
                  {profile.rank_tier} • {profile.rank_points} RP ({profile.wins}W /{' '}
                  {profile.matches_played}M)
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-red-950 text-xs text-stone-300 hover:text-red-300 flex items-center gap-1.5 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Keluar
          </button>
        </div>

        {/* Jika Belum Masuk Room -> Pilih Mode */}
        {!activeRoom ? (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-emerald-950/40 border border-emerald-500/30 p-5 rounded-xl space-y-4 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold">
                    <Crown className="w-5 h-5" />
                    <h2>Ranked Competitive</h2>
                  </div>
                  <p className="text-xs text-stone-300 leading-relaxed">
                    Kumpulkan Rank Points (RP) untuk naik dari tier Bronze
                    hingga Master. Kursi kosong otomatis diisi Bot AI jika
                    matchmaking belum penuh.
                  </p>
                </div>
                <button
                  onClick={() => createRoom('ranked')}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm transition flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" /> Cari Match Ranked
                </button>
              </div>

              <div className="bg-stone-900 border border-amber-500/30 p-5 rounded-xl space-y-4">
                <div className="flex items-center gap-2 text-amber-300 font-bold">
                  <Users className="w-5 h-5" />
                  <h2>Private Room Mabar</h2>
                </div>
                <button
                  onClick={() => createRoom('private')}
                  className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm transition"
                >
                  + Buat Private Room Baru
                </button>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Kode 6 Digit"
                    value={roomCodeInput}
                    onChange={(e) =>
                      setRoomCodeInput(e.target.value.toUpperCase())
                    }
                    className="flex-1 px-3 py-2 rounded-lg bg-stone-950 border border-stone-700 text-sm uppercase tracking-widest"
                  />
                  <button
                    onClick={joinPrivateRoom}
                    className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-sm font-semibold"
                  >
                    Gabung
                  </button>
                </div>
              </div>
            </div>

            {/* Papan Peringkat Top 5 */}
            {leaderboard.length > 0 && (
              <div className="bg-stone-900/80 border border-stone-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm mb-3">
                  <Trophy className="w-4 h-4" />
                  <h3>Top 5 Peringkat Global</h3>
                </div>
                <div className="divide-y divide-stone-800/80 text-xs">
                  {leaderboard.map((item, idx) => (
                    <div
                      key={item.id}
                      className="py-2.5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-5 text-center font-bold text-stone-400">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold text-stone-200">
                          {item.username}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 rounded bg-stone-800 text-amber-300">
                          {item.rank_tier}
                        </span>
                        <span className="font-mono font-bold text-emerald-400">
                          {item.rank_points} RP
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Waiting Room Real-Time */
          <div className="bg-stone-900 border border-amber-500/30 p-6 rounded-xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs text-stone-400">
                  Kode {activeRoom.type === 'ranked' ? 'Ranked' : 'Private'}{' '}
                  Room
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-mono font-bold text-amber-300 tracking-widest">
                    {activeRoom.code}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(activeRoom.code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-1.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveRoom(null)}
                  className="px-4 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-stone-300"
                >
                  Batal
                </button>
                <button
                  onClick={startMatchWithBots}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm"
                >
                  Mulai Game (Isi Bot Jika Kosong)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                'East (Timur)',
                'South (Selatan)',
                'West (Barat)',
                'North (Utara)',
              ].map((wind, idx) => {
                const occupant = roomPlayers.find((p) => p.seat_index === idx);
                return (
                  <div
                    key={wind}
                    className={`p-3 rounded-lg border text-center ${
                      occupant
                        ? 'bg-emerald-950/30 border-emerald-500/40'
                        : 'bg-stone-950 border-stone-800 border-dashed'
                    }`}
                  >
                    <div className="text-[11px] text-stone-400 mb-1">
                      {wind}
                    </div>
                    {occupant ? (
                      <div className="font-semibold text-sm text-amber-200 flex items-center justify-center gap-1">
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          {occupant.is_bot
                            ? occupant.bot_name
                            : occupant.profiles?.username}
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-stone-600 py-1">
                        Menunggu Pemain...
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}