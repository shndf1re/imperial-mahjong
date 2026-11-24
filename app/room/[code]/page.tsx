'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// Sesuaikan import komponen Lobby / WaitingRoom / MahjongTable Anda:
import MahjongTable from '@/components/MahjongTable';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = decodeURIComponent(params?.code || '').toUpperCase();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);

  useEffect(() => {
    let active = true;

    async function restoreRoomSession() {
      if (!roomCode) return;
      setLoading(true);
      setErrorMsg(null);

      // 1. Ambil user login aktif
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      if (!userId) {
        if (active) {
          setErrorMsg('Sesi login tidak ditemukan. Silakan login ulang.');
          setLoading(false);
        }
        return;
      }

      // 2. Ambil profil pemain & data room berdasarkan kode
      const [{ data: prof }, { data: roomRow, error: roomErr }] =
        await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).single(),
          supabase
            .from('rooms')
            .select('*')
            .eq('code', roomCode)
            .maybeSingle(),
        ]);

      if (!active) return;

      if (roomErr || !roomRow) {
        setErrorMsg(`Room "${roomCode}" tidak ditemukan atau sudah dibubarkan.`);
        setLoading(false);
        return;
      }

      // 3. Ambil daftar pemain di room tersebut
      const { data: pRows } = await supabase
        .from('room_players')
        .select('*, profiles(username, rank_tier, rank_points)')
        .eq('room_id', roomRow.id)
        .order('seat_index', { ascending: true });

      if (!active) return;

      // Simpan kode room aktif agar tetap ingat saat navigasi
      sessionStorage.setItem('imperial_mahjong_active_room', roomRow.code);

      setProfile(prof);
      setRoom(roomRow);
      setPlayers(pRows || []);
      setLoading(false);
    }

    restoreRoomSession();
    return () => {
      active = false;
    };
  }, [roomCode]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 text-amber-200 flex items-center justify-center text-sm">
        Memulihkan sesi Room {roomCode}...
      </div>
    );
  }

  if (errorMsg || !room || !profile) {
    return (
      <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-red-300">
          {errorMsg || 'Room tidak tersedia.'}
        </p>
        <button
          onClick={() => {
            sessionStorage.removeItem('imperial_mahjong_active_room');
            router.push('/');
          }}
          className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-bold text-xs"
        >
          Kembali ke Lobby
        </button>
      </div>
    );
  }

  return (
    <MahjongTable
      profile={profile}
      room={room}
      players={players}
      onExitRoom={() => {
        sessionStorage.removeItem('imperial_mahjong_active_room');
        router.push('/');
      }}
      onReturnWaitingRoom={() => {
        router.push(`/room/${room.code}/waiting`);
      }}
      onDisbandRoom={async () => {
        await supabase.from('rooms').delete().eq('id', room.id);
        sessionStorage.removeItem('imperial_mahjong_active_room');
        router.push('/');
      }}
      onProfileUpdated={async () => {
        const { data: updated } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profile.id)
          .single();
        if (updated) setProfile(updated);
      }}
    />
  );
}