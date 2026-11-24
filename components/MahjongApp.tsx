'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  ArrowLeftRight,
} from 'lucide-react';

export default function MahjongApp() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeRoom, setActiveRoom] = useState<{
    id: string;
    code: string;
    type: 'ranked' | 'private';
    host_id: string;
  } | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [switchingSeat, setSwitchingSeat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);

  const activeRoomRef = useRef(activeRoom);
  const profileRef = useRef(profile);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const fetchLeaderboard = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('rank_points', { ascending: false })
      .limit(5);
    if (data) setLeaderboard(data as UserProfile[]);
  }, []);

  // Sapu bersih room temporary yang sudah kosong dari manusia atau kadaluarsa (> 2 jam)
  const cleanupOrphanRooms = useCallback(async () => {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: oldRooms } = await supabase
        .from('rooms')
        .select('id')
        .lt('created_at', twoHoursAgo);

      if (oldRooms && oldRooms.length > 0) {
        const ids = oldRooms.map((r) => r.id);
        await supabase.from('game_states').delete().in('room_id', ids);
        await supabase.from('room_players').delete().in('room_id', ids);
        await supabase.from('rooms').delete().in('id', ids);
      }

      // Cek room aktif yang sudah tidak punya manusia sama sekali
      const { data: recentRooms } = await supabase
        .from('rooms')
        .select('id')
        .limit(20);

      if (recentRooms && recentRooms.length > 0) {
        for (const r of recentRooms) {
          const { data: humans } = await supabase
            .from('room_players')
            .select('id')
            .eq('room_id', r.id)
            .eq('is_bot', false);

          if (!humans || humans.length === 0) {
            await supabase.from('game_states').delete().eq('room_id', r.id);
            await supabase.from('room_players').delete().eq('room_id', r.id);
            await supabase.from('rooms').delete().eq('id', r.id);
          }
        }
      }
    } catch {}
  }, []);

  // Fungsi pembersih saat pemain keluar room / tutup tab
  const leaveAndCleanupRoom = useCallback(
    async (roomId: string, userId: string) => {
      await supabase
        .from('room_players')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', userId);

      // Cek apakah masih ada pemain asli (non-bot) di dalam room
      const { data: remainingHumans } = await supabase
        .from('room_players')
        .select('id, user_id')
        .eq('room_id', roomId)
        .eq('is_bot', false)
        .order('seat_index', { ascending: true });

      if (!remainingHumans || remainingHumans.length === 0) {
        // Tidak ada orang asli tersisa -> hapus room permanen beserta bot & game_states
        await supabase.from('game_states').delete().eq('room_id', roomId);
        await supabase.from('room_players').delete().eq('room_id', roomId);
        await supabase.from('rooms').delete().eq('id', roomId);
      } else {
        // Jika yang keluar adalah Host, wariskan host_id ke pemain asli berikutnya
        const { data: roomInfo } = await supabase
          .from('rooms')
          .select('host_id')
          .eq('id', roomId)
          .maybeSingle();

        if (roomInfo && roomInfo.host_id === userId && remainingHumans[0]?.user_id) {
          await supabase
            .from('rooms')
            .update({ host_id: remainingHumans[0].user_id })
            .eq('id', roomId);
        }
      }
    },
    []
  );

  // Otomatis bersihkan kursi / room jika pemain menutup tab atau browser
  useEffect(() => {
    const handleTabClose = () => {
      const r = activeRoomRef.current;
      const p = profileRef.current;
      if (r && p) {
        leaveAndCleanupRoom(r.id, p.id);
      }
    };

    window.addEventListener('beforeunload', handleTabClose);
    window.addEventListener('pagehide', handleTabClose);
    return () => {
      window.removeEventListener('beforeunload', handleTabClose);
      window.removeEventListener('pagehide', handleTabClose);
    };
  }, [leaveAndCleanupRoom]);

  const silentRefreshProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    if (data) {
      setProfile(data as UserProfile);
    }
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const checkSession = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        if (error) {
          setAuthError('Database Error: ' + error.message);
          setProfile(null);
          setLoading(false);
          return;
        }

        if (data) {
          setProfile(data as UserProfile);
        } else {
          const fallbackName =
            session.user.user_metadata?.username ||
            `Guest_${session.user.id.slice(0, 5)}`;
          const { data: created, error: insertErr } = await supabase
            .from('profiles')
            .insert({
              id: session.user.id,
              username: fallbackName,
              is_guest: true,
            })
            .select()
            .single();

          if (insertErr) {
            setAuthError('Gagal membuat profil: ' + insertErr.message);
            setProfile(null);
          } else if (created) {
            setProfile(created as UserProfile);
          }
        }
        cleanupOrphanRooms();
        fetchLeaderboard();
      } else {
        setProfile(null);
      }
      setLoading(false);
    },
    [fetchLeaderboard, cleanupOrphanRooms]
  );

  useEffect(() => {
    checkSession(true);
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        checkSession(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [checkSession]);

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
    if (activeRoom && profile) {
      await leaveAndCleanupRoom(activeRoom.id, profile.id);
    }
    await supabase.auth.signOut();
    setProfile(null);
    setActiveRoom(null);
    setIsPlaying(false);
  }

  const fetchPlayers = useCallback(async (roomId: string) => {
    const { data } = await supabase
      .from('room_players')
      .select('*, profiles(username, rank_tier, rank_points)')
      .eq('room_id', roomId)
      .order('seat_index', { ascending: true });
    if (data) {
      setRoomPlayers(data);
      return data;
    }
    return [];
  }, []);

  // Sinkronisasi Waiting Room & Deteksi jika Room dibubarkan / status berubah
  useEffect(() => {
    if (!activeRoom) return;

    if (!isPlaying) {
      fetchPlayers(activeRoom.id);
    }

    const interval = setInterval(async () => {
      const { data: roomCheck } = await supabase
        .from('rooms')
        .select('status, host_id')
        .eq('id', activeRoom.id)
        .maybeSingle();

      // Jika room sudah dihapus karena kosong atau dibubarkan host
      if (!roomCheck) {
        setIsPlaying(false);
        setActiveRoom(null);
        setRoomPlayers([]);
        silentRefreshProfile();
        return;
      }

      if (roomCheck.host_id !== activeRoom.host_id) {
        setActiveRoom((prev) =>
          prev ? { ...prev, host_id: roomCheck.host_id } : null
        );
      }

      if (!isPlaying) {
        await fetchPlayers(activeRoom.id);
        if (roomCheck.status === 'playing') {
          setIsPlaying(true);
        }
      } else if (roomCheck.status === 'waiting') {
        // Host mengembalikan semua pemain ke Ruang Tunggu (ganti kursi / siap-siap)
        await fetchPlayers(activeRoom.id);
        setIsPlaying(false);
      }
    }, 1800);

    const channel = supabase
      .channel(`room_sync_${activeRoom.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${activeRoom.id}`,
        },
        () => {
          if (!isPlaying) fetchPlayers(activeRoom.id);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${activeRoom.id}`,
        },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            setIsPlaying(false);
            setActiveRoom(null);
            setRoomPlayers([]);
            silentRefreshProfile();
            return;
          }
          if (payload.new) {
            const updated = payload.new as any;
            if (updated.host_id) {
              setActiveRoom((prev) =>
                prev ? { ...prev, host_id: updated.host_id } : null
              );
            }
            if (updated.status === 'playing') {
              await fetchPlayers(activeRoom.id);
              setIsPlaying(true);
            } else if (updated.status === 'waiting') {
              await fetchPlayers(activeRoom.id);
              setIsPlaying(false);
            }
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [activeRoom, isPlaying, fetchPlayers, silentRefreshProfile]);

  async function createRoom(roomType: 'ranked' | 'private') {
    if (!profile) return;
    await cleanupOrphanRooms();
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

    await supabase.from('room_players').insert({
      room_id: room.id,
      user_id: profile.id,
      seat_index: 0,
      is_bot: false,
      is_ready: true,
    });

    setActiveRoom({
      id: room.id,
      code: room.room_code,
      type: roomType,
      host_id: room.host_id,
    });
  }

  async function joinPrivateRoom() {
    if (!profile || !roomCodeInput.trim()) return;
    const code = roomCodeInput.trim().toUpperCase();
    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_code', code)
      .eq('status', 'waiting')
      .maybeSingle();

    if (!room) {
      alert('Kode room tidak ditemukan, sudah bubar, atau pertandingan sedang berlangsung.');
      return;
    }

    const existingPlayers = await fetchPlayers(room.id);
    const alreadyIn = existingPlayers.find((p) => p.user_id === profile.id);

    if (!alreadyIn) {
      const takenSeats = existingPlayers.map((p) => p.seat_index);
      const availableSeat = [0, 1, 2, 3].find((s) => !takenSeats.includes(s));

      if (availableSeat === undefined) {
        alert('Room sudah penuh (4/4 pemain).');
        return;
      }

      const { error: joinErr } = await supabase.from('room_players').insert({
        room_id: room.id,
        user_id: profile.id,
        seat_index: availableSeat,
        is_bot: false,
        is_ready: true,
      });

      if (joinErr) {
        alert('Gagal bergabung ke kursi: ' + joinErr.message);
        return;
      }
    }

    await fetchPlayers(room.id);
    setActiveRoom({
      id: room.id,
      code: room.room_code,
      type: room.room_type,
      host_id: room.host_id,
    });
  }

  async function handleSwitchSeat(targetSeatIndex: number) {
    if (!activeRoom || !profile || switchingSeat) return;

    const latestPlayers = await fetchPlayers(activeRoom.id);
    const isTaken = latestPlayers.some((p) => p.seat_index === targetSeatIndex);
    if (isTaken) {
      alert('Kursi tersebut baru saja diisi pemain lain.');
      return;
    }

    const myRow = latestPlayers.find((p) => p.user_id === profile.id);
    if (!myRow || myRow.seat_index === targetSeatIndex) return;

    setSwitchingSeat(true);
    try {
      const { error } = await supabase
        .from('room_players')
        .update({ seat_index: targetSeatIndex })
        .eq('id', myRow.id);

      if (error) {
        alert('Gagal pindah posisi: ' + error.message);
      } else {
        await fetchPlayers(activeRoom.id);
      }
    } finally {
      setSwitchingSeat(false);
    }
  }

  async function startMatchAsHost() {
    if (!activeRoom || !profile || activeRoom.host_id !== profile.id) return;

    const latestPlayers = await fetchPlayers(activeRoom.id);
    const botNames = ['Chen Tao (AI)', 'Mei Lin (AI)', 'Kenji Sato (AI)'];
    const takenSeats = latestPlayers.map((p) => p.seat_index);
    const emptySeats = [0, 1, 2, 3].filter((s) => !takenSeats.includes(s));

    if (emptySeats.length > 0) {
      const botsToInsert = emptySeats.map((seatIdx, idx) => ({
        room_id: activeRoom.id,
        user_id: null,
        seat_index: seatIdx,
        is_bot: true,
        bot_name: botNames[idx % botNames.length],
        is_ready: true,
      }));
      await supabase.from('room_players').insert(botsToInsert);
    }

    await fetchPlayers(activeRoom.id);
    await supabase
      .from('rooms')
      .update({ status: 'playing' })
      .eq('id', activeRoom.id);

    setIsPlaying(true);
  }

  // Host mengembalikan semua pemain ke Ruang Tunggu (menghapus Bot & state meja)
  async function returnToWaitingRoomAsHost() {
    if (!activeRoom || !profile || activeRoom.host_id !== profile.id) return;

    await supabase.from('game_states').delete().eq('room_id', activeRoom.id);
    await supabase
      .from('room_players')
      .delete()
      .eq('room_id', activeRoom.id)
      .eq('is_bot', true);
    await supabase
      .from('rooms')
      .update({ status: 'waiting' })
      .eq('id', activeRoom.id);

    await fetchPlayers(activeRoom.id);
    setIsPlaying(false);
    silentRefreshProfile();
  }

  // Host membubarkan room untuk seluruh pemain
  async function disbandRoomAsHost() {
    if (!activeRoom) return;
    const roomId = activeRoom.id;
    await supabase.from('game_states').delete().eq('room_id', roomId);
    await supabase.from('room_players').delete().eq('room_id', roomId);
    await supabase.from('rooms').delete().eq('id', roomId);

    setIsPlaying(false);
    setActiveRoom(null);
    setRoomPlayers([]);
    silentRefreshProfile();
  }

  async function leaveRoom() {
    if (activeRoom && profile) {
      await leaveAndCleanupRoom(activeRoom.id, profile.id);
    }
    setIsPlaying(false);
    setActiveRoom(null);
    setRoomPlayers([]);
    silentRefreshProfile();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 text-amber-100 flex items-center justify-center text-sm">
        Memuat Imperial Mahjong...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_center,#1c1917_0%,#09090b_100%)] text-stone-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-stone-900/90 border border-amber-500/30 rounded-2xl p-5 sm:p-6 shadow-2xl">
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-emerald-900/60 border border-amber-400/40 text-2xl sm:text-3xl mb-2.5">
              🀄
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-amber-300 tracking-wide">
              IMPERIAL MAHJONG
            </h1>
            <p className="text-xs text-stone-400 mt-1">
              Hong Kong 144-Tile • Ranked & Private Room
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-stone-950 p-1 rounded-lg mb-4 text-xs font-medium">
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
                  placeholder="Masukkan nama panggilan..."
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

  if (isPlaying && activeRoom) {
    return (
      <MahjongTable
        profile={profile}
        room={activeRoom}
        players={roomPlayers}
        onExitRoom={leaveRoom}
        onReturnWaitingRoom={returnToWaitingRoomAsHost}
        onDisbandRoom={disbandRoomAsHost}
        onProfileUpdated={silentRefreshProfile}
      />
    );
  }

  const isHost = activeRoom ? activeRoom.host_id === profile.id : false;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1c1917_0%,#09090b_100%)] text-stone-100 p-3 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
        {/* Header Profil & Rank */}
        <div className="flex items-center justify-between gap-3 bg-stone-900 border border-amber-500/20 p-3.5 sm:p-4 rounded-xl shadow-lg">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full bg-amber-500/20 border border-amber-400 flex items-center justify-center font-bold text-amber-300 text-sm">
              {profile.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="truncate">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-white text-sm sm:text-base truncate">
                  {profile.username}
                </span>
                {profile.is_guest && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400 shrink-0">
                    GUEST
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-amber-300 mt-0.5">
                <Crown className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {profile.rank_tier} • {profile.rank_points} RP ({profile.wins}W /{' '}
                  {profile.matches_played}M)
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-red-950 text-xs text-stone-300 hover:text-red-300 flex items-center gap-1.5 shrink-0 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>

        {!activeRoom ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-emerald-950/40 border border-emerald-500/30 p-4 sm:p-5 rounded-xl space-y-4 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm sm:text-base">
                    <Crown className="w-5 h-5" />
                    <h2>Ranked Competitive</h2>
                  </div>
                  <p className="text-xs text-stone-300 leading-relaxed">
                    Kumpulkan Rank Points (RP) untuk naik dari tier Bronze
                    hingga Master. Room bersifat sementara dan otomatis terhapus
                    saat kosong.
                  </p>
                </div>
                <button
                  onClick={() => createRoom('ranked')}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-sm transition flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" /> Buat Match Ranked
                </button>
              </div>

              <div className="bg-stone-900 border border-amber-500/30 p-4 sm:p-5 rounded-xl space-y-3.5">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm sm:text-base">
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
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-stone-950 border border-stone-700 text-sm uppercase tracking-widest"
                  />
                  <button
                    onClick={joinPrivateRoom}
                    className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-sm font-semibold shrink-0"
                  >
                    Gabung
                  </button>
                </div>
              </div>
            </div>

            {leaderboard.length > 0 && (
              <div className="bg-stone-900/80 border border-stone-800 rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm mb-3">
                  <Trophy className="w-4 h-4" />
                  <h3>Top 5 Peringkat Global</h3>
                </div>
                <div className="divide-y divide-stone-800/80 text-xs">
                  {leaderboard.map((item, idx) => (
                    <div
                      key={item.id}
                      className="py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 text-center font-bold text-stone-400 shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold text-stone-200 truncate">
                          {item.username}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
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
          <div className="bg-stone-900 border border-amber-500/30 p-4 sm:p-6 rounded-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs text-stone-400">
                  Kode {activeRoom.type === 'ranked' ? 'Ranked' : 'Private'}{' '}
                  Room Temporary (Otomatis hilang jika kosong)
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
                    className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300"
                    title="Salin Kode Room"
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
                  onClick={leaveRoom}
                  className="px-4 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-stone-300"
                >
                  Keluar Room
                </button>

                {isHost ? (
                  <button
                    onClick={startMatchAsHost}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-xs sm:text-sm"
                  >
                    Mulai Game (Isi Bot Jika Kosong)
                  </button>
                ) : (
                  <div className="px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-300 text-xs font-medium animate-pulse">
                    Menunggu Host memulai...
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] text-stone-400 flex items-center justify-between">
                <span>Pilih Posisi Kursi Angin (klik slot kosong untuk pindah):</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                {[
                  'East (Timur)',
                  'South (Selatan)',
                  'West (Barat)',
                  'North (Utara)',
                ].map((wind, idx) => {
                  const occupant = roomPlayers.find((p) => p.seat_index === idx);
                  const isMe = occupant?.user_id === profile.id;

                  if (occupant) {
                    return (
                      <div
                        key={wind}
                        className={`p-3 rounded-lg border text-center transition ${
                          isMe
                            ? 'bg-emerald-950/50 border-amber-400 shadow-md shadow-amber-500/10'
                            : 'bg-emerald-950/30 border-emerald-500/40'
                        }`}
                      >
                        <div className="text-[11px] text-stone-400 mb-1">
                          {wind}{' '}
                          {isMe && <span className="text-amber-300">(Anda)</span>}
                        </div>
                        <div className="font-semibold text-xs sm:text-sm text-amber-200 flex items-center justify-center gap-1 truncate">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">
                            {occupant.is_bot
                              ? occupant.bot_name
                              : occupant.profiles?.username}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={wind}
                      type="button"
                      disabled={switchingSeat}
                      onClick={() => handleSwitchSeat(idx)}
                      className="p-3 rounded-lg border border-dashed border-stone-700 hover:border-amber-400 bg-stone-950 hover:bg-amber-500/10 text-center transition group cursor-pointer disabled:opacity-50"
                      title={`Pindah ke kursi ${wind}`}
                    >
                      <div className="text-[11px] text-stone-400 group-hover:text-amber-300 mb-1">
                        {wind}
                      </div>
                      <div className="text-xs text-stone-500 group-hover:text-amber-200 py-1 flex items-center justify-center gap-1 font-medium">
                        <ArrowLeftRight className="w-3 h-3" />
                        <span>Pindah ke Sini</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}