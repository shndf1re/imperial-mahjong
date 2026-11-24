'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MahjongTable from '@/components/MahjongTable';

const ACTIVE_ROOM_STORAGE_KEY = 'imperial_mahjong_active_room';

function RoomContent() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = decodeURIComponent(params?.code || '').toUpperCase();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [room, setRoom] = useState<{
    id: string;
    code: string;
    type: 'ranked' | 'private';
    host_id: string;
  } | null>(null);
  const [players, setPlayers] = useState<any[]>([]);

  const clearSavedRoom = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
    }
  };

  useEffect(() => {
    let active = true;

    async function restoreRoomSession() {
      if (!roomCode) return;
      setLoading(true);
      setErrorMsg(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        if (active) {
          setErrorMsg('Sesi login tidak ditemukan. Silakan masuk ke lobby terlebih dahulu.');
          setLoading(false);
        }
        return;
      }

      const [{ data: prof }, { data: roomRow, error: roomErr }] =
        await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase
            .from('rooms')
            .select('*')
            .eq('room_code', roomCode)
            .maybeSingle(),
        ]);

      if (!active) return;

      if (roomErr || !roomRow) {
        clearSavedRoom();
        setErrorMsg(`Room "${roomCode}" tidak ditemukan atau sudah dibubarkan.`);
        setLoading(false);
        return;
      }

      const { data: pRows } = await supabase
        .from('room_players')
        .select('*, profiles(username, rank_tier, rank_points)')
        .eq('room_id', roomRow.id)
        .order('seat_index', { ascending: true });

      if (!active) return;

      if (typeof window !== 'undefined') {
        sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, roomRow.room_code);
        localStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, roomRow.room_code);
      }

      setProfile(prof);
      setRoom({
        id: roomRow.id,
        code: roomRow.room_code,
        type: roomRow.room_type,
        host_id: roomRow.host_id,
      });
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
          type="button"
          onClick={() => {
            clearSavedRoom();
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
      onExitRoom={async () => {
        await supabase
          .from('room_players')
          .delete()
          .eq('room_id', room.id)
          .eq('user_id', profile.id);
        clearSavedRoom();
        router.push('/');
      }}
      onReturnWaitingRoom={async () => {
        await supabase.from('game_states').delete().eq('room_id', room.id);
        await supabase
          .from('room_players')
          .delete()
          .eq('room_id', room.id)
          .eq('is_bot', true);
        await supabase
          .from('rooms')
          .update({ status: 'waiting' })
          .eq('id', room.id);
        router.push('/');
      }}
      onDisbandRoom={async () => {
        await supabase.from('game_states').delete().eq('room_id', room.id);
        await supabase.from('room_players').delete().eq('room_id', room.id);
        await supabase.from('rooms').delete().eq('id', room.id);
        clearSavedRoom();
        router.push('/');
      }}
      onProfileUpdated={async () => {
        const { data: updated } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profile.id)
          .maybeSingle();
        if (updated) setProfile(updated);
      }}
    />
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-950 text-amber-200 flex items-center justify-center text-sm">
          Memuat Room...
        </div>
      }
    >
      <RoomContent />
    </Suspense>
  );
}